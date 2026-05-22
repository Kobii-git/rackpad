import { getJsonSetting, putJsonSetting } from './app-settings.js'

type OuiCache = {
  fetchedAt: string
  entries: Record<string, string>
}

const OUI_CACHE_KEY = 'ouiVendorMap'
const OUI_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30
const IEEE_OUI_SOURCES = [
  'https://standards-oui.ieee.org/oui/oui.txt',
  'https://standards-oui.ieee.org/oui28/mam.txt',
  'https://standards-oui.ieee.org/oui36/oui36.txt',
]

const FALLBACK_OUI_VENDOR_MAP: Record<string, string> = {
  '001b54': 'Cisco',
  '002545': 'Cisco',
  '003048': 'Supermicro',
  '24a43c': 'Ubiquiti',
  '3c22fb': 'Apple',
  '3cce73': 'Cisco',
  '3cfdfe': 'Intel',
  '7483c2': 'Ubiquiti',
  'b00875': 'Intel',
  'b827eb': 'Raspberry Pi',
  'd8a3dd': 'TP-Link',
  'dca632': 'Raspberry Pi',
  'e45f01': 'Raspberry Pi',
  'f01898': 'Apple',
  'f492bf': 'Ubiquiti',
  'f4f26d': 'Aruba',
}

let memoryCache: OuiCache | null = null
let refreshPromise: Promise<OuiCache> | null = null

function envFlag(name: string, fallback = true) {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

export async function lookupOuiVendor(macAddress: string | null | undefined) {
  const mac = normalizeMac(macAddress)
  if (!mac) return null
  const entries = (await loadOuiCache()).entries
  for (const length of [9, 7, 6]) {
    const vendor = entries[mac.slice(0, length)]
    if (vendor) return vendor
  }
  return null
}

export function parseIeeeOuiText(input: string) {
  const entries: Record<string, string> = {}
  for (const line of input.split(/\r?\n/)) {
    const match = line.match(/^\s*([0-9A-Fa-f]{6,9})\s+\(base 16\)\s+(.+?)\s*$/)
    if (!match) continue
    const prefix = match[1].toLowerCase()
    const vendor = normalizeVendor(match[2])
    if (vendor) entries[prefix] = vendor
  }
  return entries
}

async function loadOuiCache(): Promise<OuiCache> {
  if (memoryCache && cacheFresh(memoryCache)) return memoryCache

  const stored = getJsonSetting<OuiCache | null>(OUI_CACHE_KEY, null)
  if (stored?.entries && cacheFresh(stored)) {
    memoryCache = {
      fetchedAt: stored.fetchedAt,
      entries: { ...FALLBACK_OUI_VENDOR_MAP, ...stored.entries },
    }
    return memoryCache
  }

  if (!envFlag('OUI_AUTO_UPDATE', true)) {
    memoryCache = { fetchedAt: new Date(0).toISOString(), entries: FALLBACK_OUI_VENDOR_MAP }
    return memoryCache
  }

  refreshPromise ??= refreshOuiCache(stored).finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

async function refreshOuiCache(previous: OuiCache | null): Promise<OuiCache> {
  const entries: Record<string, string> = {}
  for (const source of IEEE_OUI_SOURCES) {
    try {
      const response = await fetch(source, {
        headers: { accept: 'text/plain' },
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) continue
      Object.assign(entries, parseIeeeOuiText(await response.text()))
    } catch {
      // Keep the local fallback if IEEE cannot be reached from this deployment.
    }
  }

  const cache = {
    fetchedAt: new Date().toISOString(),
    entries: Object.keys(entries).length > 0
      ? { ...FALLBACK_OUI_VENDOR_MAP, ...entries }
      : { ...FALLBACK_OUI_VENDOR_MAP, ...(previous?.entries ?? {}) },
  }
  if (Object.keys(entries).length > 0) {
    putJsonSetting(OUI_CACHE_KEY, cache)
  }
  memoryCache = cache
  return cache
}

function cacheFresh(cache: OuiCache) {
  return Date.now() - Date.parse(cache.fetchedAt) < OUI_CACHE_TTL_MS
}

function normalizeMac(value: string | null | undefined) {
  if (!value) return null
  const normalized = value.toLowerCase().replace(/[^0-9a-f]/g, '')
  return normalized.length >= 6 ? normalized : null
}

function normalizeVendor(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

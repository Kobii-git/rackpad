import { execFile } from 'node:child_process'
import { reverse } from 'node:dns/promises'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { requireAdmin } from '../lib/auth.js'
import { optionalDeviceType } from '../lib/device-types.js'
import { createId } from '../lib/ids.js'
import { runIcmpProbe } from '../lib/monitoring.js'
import { lookupOuiVendor } from '../lib/oui.js'
import {
  asObject,
  ensureCidr,
  ensureIsoDate,
  optionalEnum,
  optionalString,
  ValidationError,
} from '../lib/validation.js'

const DEVICE_PLACEMENTS = [
  'rack',
  'room',
  'wireless',
  'virtual',
  'shelf',
] as const
const DISCOVERY_STATUSES = ['new', 'imported', 'dismissed'] as const
const DISCOVERY_MAC_SCAN_MODES = [
  'auto',
  'neighbor',
  'arp-scan',
  'nmap',
  'off',
] as const
const execFileAsync = promisify(execFile)

type DiscoveryMacScanMode = (typeof DISCOVERY_MAC_SCAN_MODES)[number]
type DiscoveryScanDiagnostic = {
  code: string
  severity: 'info' | 'warning'
  message: string
  detail?: string
}

type MacScanContext = {
  macByIp: Map<string, string>
  diagnostics: DiscoveryScanDiagnostic[]
}

function parseDiscoveredDevice(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    labId: String(row.labId),
    ipAddress: String(row.ipAddress),
    hostname: row.hostname ? String(row.hostname) : null,
    displayName: row.displayName ? String(row.displayName) : null,
    deviceType: row.deviceType ? String(row.deviceType) : null,
    placement: row.placement ? String(row.placement) : null,
    macAddress: row.macAddress ? String(row.macAddress) : null,
    vendor: row.vendor ? String(row.vendor) : null,
    source: String(row.source),
    status: String(row.status),
    notes: row.notes ? String(row.notes) : null,
    importedDeviceId: row.importedDeviceId
      ? String(row.importedDeviceId)
      : null,
    lastSeen: row.lastSeen ? String(row.lastSeen) : null,
    lastScannedAt: String(row.lastScannedAt),
  }
}

function ipToInt(ipAddress: string) {
  return (
    ipAddress
      .split('.')
      .reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0
  )
}

function intToIp(value: number) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.')
}

function cidrHosts(cidr: string) {
  ensureCidr(cidr)
  const [networkAddress, prefixRaw] = cidr.split('/')
  const prefix = Number.parseInt(prefixRaw, 10)
  const hostCount = Math.pow(2, 32 - prefix) - 2

  if (hostCount < 1) {
    throw new ValidationError('CIDR must include at least one usable host.')
  }
  if (hostCount > 254) {
    throw new ValidationError(
      'Discovery scans are limited to /24 or smaller networks.',
    )
  }

  const network = ipToInt(networkAddress)
  return Array.from({ length: hostCount }, (_, index) =>
    intToIp(network + index + 1),
  )
}

function inferDeviceType(hostname: string | null) {
  const value = hostname?.toLowerCase() ?? ''
  if (!value) return 'endpoint' as const
  if (value.includes('ap') || value.includes('wifi') || value.includes('wlan'))
    return 'ap' as const
  if (value.includes('vm')) return 'vm' as const
  if (
    value.includes('fw') ||
    value.includes('firewall') ||
    value.includes('pfsense') ||
    value.includes('opnsense')
  )
    return 'firewall' as const
  if (value.includes('sw') || value.includes('switch')) return 'switch' as const
  if (value.includes('rtr') || value.includes('router') || value.includes('gw'))
    return 'router' as const
  if (
    value.includes('srv') ||
    value.includes('proxmox') ||
    value.includes('esx') ||
    value.includes('host')
  )
    return 'server' as const
  if (value.includes('nas') || value.includes('storage'))
    return 'storage' as const
  return 'endpoint' as const
}

function inferPlacement(deviceType: string) {
  if (deviceType === 'ap') return 'wireless' as const
  if (deviceType === 'vm') return 'virtual' as const
  return 'room' as const
}

async function reverseLookup(ipAddress: string) {
  try {
    const names = await reverse(ipAddress)
    const hostname = names[0]?.replace(/\.$/, '') ?? null
    return hostname
  } catch {
    return null
  }
}

async function systemHostnameLookup(ipAddress: string) {
  if (process.platform !== 'win32') {
    try {
      const { stdout } = await execFileAsync('getent', ['hosts', ipAddress], {
        timeout: 4000,
      })
      const entry = String(stdout).trim().split(/\s+/).slice(1).find(Boolean)
      if (entry) return entry.replace(/\.$/, '')
    } catch {
      // Ignore missing getent or empty results.
    }
  }

  try {
    const { stdout } = await execFileAsync('nslookup', [ipAddress], {
      timeout: 4000,
    })
    const line = String(stdout)
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => /name\s*=|^name:/i.test(entry))
    if (!line) return null
    return (
      line
        .split(/name\s*=|name:/i)[1]
        ?.trim()
        .replace(/\.$/, '') ?? null
    )
  } catch {
    return null
  }
}

async function resolveHostname(ipAddress: string) {
  return (
    (await reverseLookup(ipAddress)) ?? (await systemHostnameLookup(ipAddress))
  )
}

function normalizeMacAddress(value: string | null | undefined) {
  if (!value) return null
  const normalized = value.trim().replaceAll('-', ':').toLowerCase()
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(normalized)) return null
  if (normalized === '00:00:00:00:00:00') return null
  return normalized
}

async function lookupMacAddress(ipAddress: string) {
  const fromProc = await lookupMacFromProc(ipAddress)
  if (fromProc) return fromProc

  const fromIpNeighbour = await lookupMacFromIpNeighbour(ipAddress)
  if (fromIpNeighbour) return fromIpNeighbour

  try {
    const { stdout } = await execFileAsync('arp', ['-a'], { timeout: 4000 })
    return parseArpOutput(String(stdout), ipAddress)
  } catch {
    return null
  }
}

async function lookupMacFromIpNeighbour(ipAddress: string) {
  try {
    const { stdout } = await execFileAsync('ip', ['neigh', 'show', ipAddress], {
      timeout: 4000,
    })
    const match = String(stdout).match(
      /lladdr\s+((?:[0-9a-f]{2}:){5}[0-9a-f]{2})/i,
    )
    return normalizeMacAddress(match?.[1])
  } catch {
    return null
  }
}

async function lookupMacFromProc(ipAddress: string) {
  try {
    const raw = await readFile('/proc/net/arp', 'utf8')
    const match = raw
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .find((columns) => columns[0] === ipAddress)
    return normalizeMacAddress(match?.[3])
  } catch {
    return null
  }
}

function parseArpOutput(output: string, ipAddress: string) {
  const lines = output.split(/\r?\n/)
  for (const line of lines) {
    if (!line.includes(ipAddress)) continue

    const windowsMatch = line.match(/((?:[0-9a-f]{2}-){5}[0-9a-f]{2})/i)
    if (windowsMatch) {
      return normalizeMacAddress(windowsMatch[1])
    }

    const unixMatch = line.match(/((?:[0-9a-f]{2}:){5}[0-9a-f]{2})/i)
    if (unixMatch) {
      return normalizeMacAddress(unixMatch[1])
    }
  }
  return null
}

async function collectSubnetMacAddresses(
  cidr: string,
): Promise<MacScanContext> {
  const mode = discoveryMacScanMode()
  const diagnostics: DiscoveryScanDiagnostic[] = []
  const macByIp = new Map<string, string>()

  if (mode === 'off' || mode === 'neighbor') {
    return { macByIp, diagnostics }
  }

  if (mode === 'auto' || mode === 'arp-scan') {
    const result = await runArpScan(cidr)
    for (const [ipAddress, macAddress] of result.macByIp) {
      macByIp.set(ipAddress, macAddress)
    }
    if (result.macByIp.size > 0) {
      diagnostics.push({
        code: 'mac-scan-arp-scan',
        severity: 'info',
        message: `arp-scan found ${result.macByIp.size} MAC address${result.macByIp.size === 1 ? '' : 'es'}.`,
      })
    } else if (mode === 'arp-scan') {
      diagnostics.push(result.diagnostic)
    }
  }

  if ((mode === 'auto' && macByIp.size === 0) || mode === 'nmap') {
    const result = await runNmapPingScan(cidr)
    for (const [ipAddress, macAddress] of result.macByIp) {
      macByIp.set(ipAddress, macAddress)
    }
    if (result.macByIp.size > 0) {
      diagnostics.push({
        code: 'mac-scan-nmap',
        severity: 'info',
        message: `nmap found ${result.macByIp.size} MAC address${result.macByIp.size === 1 ? '' : 'es'}.`,
      })
    } else if (mode === 'nmap') {
      diagnostics.push(result.diagnostic)
    }
  }

  return { macByIp, diagnostics }
}

async function runArpScan(cidr: string) {
  try {
    const { stdout } = await execFileAsync(
      'arp-scan',
      ['--retry=1', '--timeout=500', cidr],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    )
    return {
      macByIp: parseArpScanOutput(String(stdout)),
      diagnostic: unavailableToolDiagnostic(
        'arp-scan',
        'arp-scan returned no MAC addresses.',
      ),
    }
  } catch (err) {
    return {
      macByIp: new Map<string, string>(),
      diagnostic: unavailableToolDiagnostic(
        'arp-scan',
        commandFailureMessage(err, 'arp-scan'),
      ),
    }
  }
}

async function runNmapPingScan(cidr: string) {
  try {
    const { stdout } = await execFileAsync('nmap', ['-sn', '-n', cidr], {
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
    })
    return {
      macByIp: parseNmapPingScanOutput(String(stdout)),
      diagnostic: unavailableToolDiagnostic(
        'nmap',
        'nmap returned no MAC addresses.',
      ),
    }
  } catch (err) {
    return {
      macByIp: new Map<string, string>(),
      diagnostic: unavailableToolDiagnostic(
        'nmap',
        commandFailureMessage(err, 'nmap'),
      ),
    }
  }
}

export function parseArpScanOutput(output: string) {
  const entries = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /^\s*((?:\d{1,3}\.){3}\d{1,3})\s+((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})\b/i,
    )
    const macAddress = normalizeMacAddress(match?.[2])
    if (match?.[1] && macAddress) entries.set(match[1], macAddress)
  }
  return entries
}

export function parseNmapPingScanOutput(output: string) {
  const entries = new Map<string, string>()
  let currentIp: string | null = null
  for (const line of output.split(/\r?\n/)) {
    const reportMatch =
      line.match(/^\s*Nmap scan report for\s+((?:\d{1,3}\.){3}\d{1,3})\s*$/i) ??
      line.match(
        /^\s*Nmap scan report for\s+.+\s+\(((?:\d{1,3}\.){3}\d{1,3})\)\s*$/i,
      )
    if (reportMatch?.[1]) {
      currentIp = reportMatch[1]
      continue
    }

    const macMatch = line.match(
      /^\s*MAC Address:\s+((?:[0-9a-f]{2}:){5}[0-9a-f]{2})\b/i,
    )
    const macAddress = normalizeMacAddress(macMatch?.[1])
    if (currentIp && macAddress) entries.set(currentIp, macAddress)
  }
  return entries
}

function discoveryMacScanMode(): DiscoveryMacScanMode {
  const raw = process.env.DISCOVERY_MAC_SCAN_MODE?.trim().toLowerCase()
  return DISCOVERY_MAC_SCAN_MODES.includes(raw as DiscoveryMacScanMode)
    ? (raw as DiscoveryMacScanMode)
    : 'auto'
}

function unavailableToolDiagnostic(
  tool: string,
  detail: string,
): DiscoveryScanDiagnostic {
  return {
    code: `${tool}-unavailable`,
    severity: 'warning',
    message: `${tool} did not provide MAC addresses.`,
    detail,
  }
}

function commandFailureMessage(err: unknown, command: string) {
  const error = err as { code?: string; message?: string; stderr?: string }
  if (error.code === 'ENOENT')
    return `${command} is not installed in this Rackpad runtime.`
  return (
    [error.stderr, error.message].filter(Boolean).join(' ').trim() ||
    `${command} failed.`
  )
}

function macUnavailableDiagnostic(
  reachableCount: number,
): DiscoveryScanDiagnostic {
  return {
    code: 'mac-unavailable',
    severity: 'warning',
    message: `No MAC addresses were visible for ${reachableCount} reachable host${reachableCount === 1 ? '' : 's'}.`,
    detail:
      'MAC discovery needs layer-2 visibility. Docker bridge networking, Docker Desktop, routed VLANs, VPNs, or missing NET_RAW/CAP_NET_RAW access can hide MAC addresses from Rackpad.',
  }
}

async function scanHost(ipAddress: string, macByIp: Map<string, string>) {
  const result = await runIcmpProbe(ipAddress)
  if (result.result !== 'online') return null

  const cachedMacAddress = macByIp.get(ipAddress)
  const [hostname, discoveredMacAddress] = await Promise.all([
    resolveHostname(ipAddress),
    cachedMacAddress
      ? Promise.resolve(cachedMacAddress)
      : lookupMacAddress(ipAddress),
  ])
  const macAddress = cachedMacAddress ?? discoveredMacAddress
  const deviceType = inferDeviceType(hostname)
  const displayName = hostname ? hostname.split('.')[0] : null
  const vendor = await lookupOuiVendor(macAddress)

  return {
    ipAddress,
    hostname,
    displayName,
    deviceType,
    placement: inferPlacement(deviceType),
    macAddress,
    vendor,
    source: 'icmp-scan',
    lastSeen: new Date().toISOString(),
  }
}

async function scanHosts(
  hosts: string[],
  macByIp: Map<string, string>,
  concurrency = 24,
) {
  const results: Array<Awaited<ReturnType<typeof scanHost>>> = []
  let index = 0

  async function worker() {
    while (index < hosts.length) {
      const current = hosts[index]
      index += 1
      const result = await scanHost(current, macByIp)
      if (result) results.push(result)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, hosts.length) }, () => worker()),
  )
  return results
}

export const discoveryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string; status?: string } }>(
    '/',
    async (req) => {
      let sql = 'SELECT * FROM discoveredDevices WHERE 1=1'
      const params: unknown[] = []

      if (req.query.labId) {
        sql += ' AND labId = ?'
        params.push(req.query.labId)
      }
      if (req.query.status) {
        const body = { status: req.query.status }
        const status = optionalEnum(body, 'status', DISCOVERY_STATUSES)
        if (status) {
          sql += ' AND status = ?'
          params.push(status)
        }
      }

      sql += ' ORDER BY lastScannedAt DESC, ipAddress ASC'
      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
      return rows.map(parseDiscoveredDevice)
    },
  )

  app.post('/scan', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const body = asObject(req.body)
    const labId = optionalString(body, 'labId', { maxLength: 80 })
    const cidr = optionalString(body, 'cidr', { maxLength: 80 })

    if (!labId) {
      throw new ValidationError('labId is required.')
    }
    if (!cidr) {
      throw new ValidationError('cidr is required.')
    }

    const lab = db.prepare('SELECT id FROM labs WHERE id = ?').get(labId)
    if (!lab) {
      return reply.status(404).send({ error: 'Lab not found.' })
    }

    const scannedAt = new Date().toISOString()
    const hosts = cidrHosts(cidr)
    const macScan = await collectSubnetMacAddresses(cidr)
    const reachableHosts = await scanHosts(hosts, macScan.macByIp)
    const macAddressCount = reachableHosts.filter(
      (record) => record?.macAddress,
    ).length
    const vendorCount = reachableHosts.filter((record) => record?.vendor).length
    const diagnostics = [...macScan.diagnostics]
    if (reachableHosts.length > 0 && macAddressCount === 0) {
      diagnostics.push(macUnavailableDiagnostic(reachableHosts.length))
    }

    const upsert = db.prepare(`
      INSERT INTO discoveredDevices
        (id, labId, ipAddress, hostname, displayName, deviceType, placement, macAddress, vendor, source, status, notes, importedDeviceId, lastSeen, lastScannedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(labId, ipAddress) DO UPDATE SET
        hostname = COALESCE(excluded.hostname, discoveredDevices.hostname),
        displayName = COALESCE(discoveredDevices.displayName, excluded.displayName),
        deviceType = COALESCE(discoveredDevices.deviceType, excluded.deviceType),
        placement = COALESCE(discoveredDevices.placement, excluded.placement),
        macAddress = COALESCE(discoveredDevices.macAddress, excluded.macAddress),
        vendor = COALESCE(discoveredDevices.vendor, excluded.vendor),
        source = excluded.source,
        lastSeen = excluded.lastSeen,
        lastScannedAt = excluded.lastScannedAt
    `)

    const persistScan = db.transaction(() => {
      for (const record of reachableHosts) {
        if (!record) continue
        upsert.run(
          createId('disc'),
          labId,
          record.ipAddress,
          record.hostname,
          record.displayName,
          record.deviceType,
          record.placement,
          record.macAddress,
          record.vendor,
          record.source,
          'new',
          null,
          null,
          record.lastSeen,
          scannedAt,
        )
      }
    })

    persistScan()

    const rows = db
      .prepare(
        `
      SELECT * FROM discoveredDevices
      WHERE labId = ? AND lastScannedAt = ?
      ORDER BY ipAddress ASC
    `,
      )
      .all(labId, scannedAt) as Record<string, unknown>[]

    return {
      scannedHostCount: hosts.length,
      discoveredCount: rows.length,
      macAddressCount,
      vendorCount,
      diagnostics,
      rows: rows.map(parseDiscoveredDevice),
    }
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = db
      .prepare('SELECT * FROM discoveredDevices WHERE id = ?')
      .get(req.params.id) as Record<string, unknown> | undefined
    if (!existing) {
      return reply.status(404).send({ error: 'Discovered device not found.' })
    }

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const hostname = optionalString(body, 'hostname', { maxLength: 200 })
    const displayName = optionalString(body, 'displayName', { maxLength: 200 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })
    const deviceType = optionalDeviceType(body)
    const placement = optionalEnum(body, 'placement', DEVICE_PLACEMENTS)
    const status = optionalEnum(body, 'status', DISCOVERY_STATUSES)
    const importedDeviceId = optionalString(body, 'importedDeviceId', {
      maxLength: 80,
    })
    const lastSeen = optionalString(body, 'lastSeen', { maxLength: 80 })

    if (lastSeen) ensureIsoDate(lastSeen, 'lastSeen')

    const stringFields = [
      ['hostname', hostname],
      ['displayName', displayName],
      ['notes', notes],
      ['lastSeen', lastSeen],
    ] as const

    for (const [key, value] of stringFields) {
      if (value !== undefined) {
        updates.push(`${key} = ?`)
        values.push(value)
      }
    }

    if (deviceType !== undefined) {
      updates.push('deviceType = ?')
      values.push(deviceType)
    }
    if (placement !== undefined) {
      updates.push('placement = ?')
      values.push(placement)
    }
    if (status !== undefined) {
      updates.push('status = ?')
      values.push(status)
    }
    if (importedDeviceId !== undefined) {
      if (importedDeviceId) {
        const importedDevice = db
          .prepare('SELECT id, labId FROM devices WHERE id = ?')
          .get(importedDeviceId) as { id: string; labId: string } | undefined
        if (!importedDevice) {
          throw new ValidationError('Imported device does not exist.')
        }
        if (importedDevice.labId !== String(existing.labId)) {
          throw new ValidationError(
            'Imported device must belong to the same lab.',
          )
        }
      }
      updates.push('importedDeviceId = ?')
      values.push(importedDeviceId)
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update.' })
    }

    values.push(req.params.id)
    db.prepare(
      `UPDATE discoveredDevices SET ${updates.join(', ')} WHERE id = ?`,
    ).run(...values)
    const linkedMacAddress =
      typeof existing.macAddress === 'string' ? existing.macAddress : ''
    if (importedDeviceId && linkedMacAddress) {
      db.prepare(
        `
        UPDATE devices
        SET macAddress = COALESCE(macAddress, ?)
        WHERE id = ?
      `,
      ).run(linkedMacAddress, importedDeviceId)
    }
    const row = db
      .prepare('SELECT * FROM discoveredDevices WHERE id = ?')
      .get(req.params.id) as Record<string, unknown>
    return parseDiscoveredDevice(row)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = db
      .prepare('SELECT id FROM discoveredDevices WHERE id = ?')
      .get(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'Discovered device not found.' })
    }

    db.prepare('DELETE FROM discoveredDevices WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })
}

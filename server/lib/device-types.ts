import { db } from '../db.js'
import { getJsonSetting, putJsonSetting } from './app-settings.js'
import { ValidationError } from './validation.js'

export const BUILT_IN_DEVICE_TYPES = [
  { id: 'switch', label: 'Switch' },
  { id: 'router', label: 'Router' },
  { id: 'firewall', label: 'Firewall' },
  { id: 'server', label: 'Server' },
  { id: 'rack_shelf', label: 'Rack shelf' },
  { id: 'ap', label: 'Access point' },
  { id: 'endpoint', label: 'Endpoint' },
  { id: 'vm', label: 'Virtual machine' },
  { id: 'container', label: 'Container' },
  { id: 'patch_panel', label: 'Patch panel' },
  { id: 'brush_panel', label: 'Brush panel' },
  { id: 'blanking_panel', label: 'Blanking panel' },
  { id: 'storage', label: 'Storage' },
  { id: 'pdu', label: 'PDU' },
  { id: 'ups', label: 'UPS' },
  { id: 'kvm', label: 'KVM' },
  { id: 'other', label: 'Other' },
] as const

export interface DeviceTypeDefinition {
  id: string
  label: string
  builtIn: boolean
  parentType?: string | null
  createdAt?: string
  updatedAt?: string
}

interface DeviceTypeSettings {
  custom: Array<{
    id: string
    label: string
    parentType?: string | null
    createdAt?: string
    updatedAt?: string
  }>
}

const SETTING_KEY = 'deviceTypes'
const DEVICE_TYPE_ID_PATTERN = /^[a-z0-9][a-z0-9_]{1,47}$/
const BUILT_IN_IDS = new Set<string>(BUILT_IN_DEVICE_TYPES.map((type) => type.id))

export function normalizeDeviceTypeId(value: string) {
  let normalized = ''
  let pendingSeparator = false

  const appendSeparator = () => {
    pendingSeparator = normalized.length > 0
  }
  const appendCharacter = (character: string) => {
    if (pendingSeparator && normalized.length > 0) normalized += '_'
    normalized += character
    pendingSeparator = false
  }
  const appendWord = (word: string) => {
    appendSeparator()
    for (const character of word) appendCharacter(character)
    appendSeparator()
  }

  for (const character of value.trim().toLowerCase()) {
    const code = character.charCodeAt(0)
    const isAlphaNumeric =
      (code >= 48 && code <= 57) || (code >= 97 && code <= 122)
    if (isAlphaNumeric) {
      appendCharacter(character)
    } else if (character === '&') {
      appendWord('and')
    } else if (character !== "'") {
      appendSeparator()
    }
    if (normalized.length >= 48) break
  }

  return normalized.slice(0, 48)
}

export function defaultDeviceTypeLabel(id: string) {
  return id
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function validateDeviceTypeId(id: string, key = 'deviceType') {
  const normalized = normalizeDeviceTypeId(id)
  if (!normalized || !DEVICE_TYPE_ID_PATTERN.test(normalized)) {
    throw new ValidationError(`${key} must contain at least two letters or numbers.`)
  }
  return normalized
}

function optionalParentType(value: unknown) {
  if (value == null || value === '') return null
  if (typeof value !== 'string') {
    throw new ValidationError('parentType must be a string.')
  }
  const parentType = validateDeviceTypeId(value, 'parentType')
  if (!BUILT_IN_IDS.has(parentType)) {
    throw new ValidationError('parentType must be a built-in device type.')
  }
  return parentType
}

function parseCustomDeviceTypes(value: unknown) {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const custom: DeviceTypeSettings['custom'] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string') continue
    const id = normalizeDeviceTypeId(record.id)
    if (!id || BUILT_IN_IDS.has(id) || seen.has(id)) continue
    const label = typeof record.label === 'string' && record.label.trim()
      ? record.label.trim().slice(0, 80)
      : defaultDeviceTypeLabel(id)
    const parentType =
      typeof record.parentType === 'string' && BUILT_IN_IDS.has(normalizeDeviceTypeId(record.parentType))
        ? normalizeDeviceTypeId(record.parentType)
        : null
    custom.push({
      id,
      label,
      parentType,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
    })
    seen.add(id)
  }
  return custom
}

function loadDeviceTypeSettings(): DeviceTypeSettings {
  const settings = getJsonSetting<DeviceTypeSettings>(SETTING_KEY, { custom: [] })
  return {
    custom: parseCustomDeviceTypes(settings.custom),
  }
}

function saveDeviceTypeSettings(settings: DeviceTypeSettings) {
  putJsonSetting(SETTING_KEY, {
    custom: parseCustomDeviceTypes(settings.custom),
  })
}

export function listDeviceTypes(): DeviceTypeDefinition[] {
  const custom = loadDeviceTypeSettings().custom
    .map((entry) => ({
      ...entry,
      builtIn: false,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))

  return [
    ...BUILT_IN_DEVICE_TYPES.map((entry) => ({ ...entry, builtIn: true })),
    ...custom,
  ]
}

export function isKnownDeviceType(id: string) {
  const normalized = normalizeDeviceTypeId(id)
  if (BUILT_IN_IDS.has(normalized)) return true
  if (loadDeviceTypeSettings().custom.some((entry) => entry.id === normalized)) return true
  return listObservedDeviceTypes().includes(normalized)
}

export function requiredDeviceType(body: Record<string, unknown>, key = 'deviceType') {
  const value = body[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${key} is required.`)
  }
  const normalized = validateDeviceTypeId(value, key)
  if (!isKnownDeviceType(normalized)) {
    throw new ValidationError(`${key} must be a built-in or custom device type.`)
  }
  return normalized
}

export function optionalDeviceType(body: Record<string, unknown>, key = 'deviceType') {
  if (!(key in body)) return undefined
  if (body[key] == null) return null
  if (typeof body[key] !== 'string') {
    throw new ValidationError(`${key} must be a string.`)
  }
  const normalized = validateDeviceTypeId(String(body[key]), key)
  if (!isKnownDeviceType(normalized)) {
    throw new ValidationError(`${key} must be a built-in or custom device type.`)
  }
  return normalized
}

export function createDeviceType(input: {
  id?: string | null
  label: string
  parentType?: string | null
}) {
  const label = input.label.trim()
  if (!label) {
    throw new ValidationError('Label is required.')
  }
  if (label.length > 80) {
    throw new ValidationError('Label must be 80 characters or fewer.')
  }

  const id = validateDeviceTypeId(input.id?.trim() || label, 'id')
  if (BUILT_IN_IDS.has(id)) {
    throw new ValidationError('That device type is already built in.', 409)
  }

  const settings = loadDeviceTypeSettings()
  if (settings.custom.some((entry) => entry.id === id)) {
    throw new ValidationError('That device type already exists.', 409)
  }

  const now = new Date().toISOString()
  const created = {
    id,
    label,
    parentType: optionalParentType(input.parentType),
    createdAt: now,
    updatedAt: now,
  }
  saveDeviceTypeSettings({
    custom: [...settings.custom, created],
  })

  return {
    ...created,
    builtIn: false,
  } satisfies DeviceTypeDefinition
}

export function listObservedDeviceTypes() {
  return (db.prepare(`
    SELECT DISTINCT deviceType AS id
    FROM devices
    WHERE deviceType IS NOT NULL AND TRIM(deviceType) != ''
    UNION
    SELECT DISTINCT deviceType AS id
    FROM discoveredDevices
    WHERE deviceType IS NOT NULL AND TRIM(deviceType) != ''
  `).all() as Array<{ id: string }>)
    .map((row) => normalizeDeviceTypeId(row.id))
    .filter((id) => id && !BUILT_IN_IDS.has(id))
}

export function listDeviceTypesWithObserved(): DeviceTypeDefinition[] {
  const listed = listDeviceTypes()
  const known = new Set(listed.map((entry) => entry.id))
  const observed = listObservedDeviceTypes()
    .filter((id) => !known.has(id))
    .map((id) => ({
      id,
      label: defaultDeviceTypeLabel(id),
      builtIn: false,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))

  return [...listed, ...observed]
}

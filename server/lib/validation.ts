import net from 'node:net'
import { canonicalizeIpv4Cidr } from './ip-cidr.js'

export class ValidationError extends Error {
  statusCode: number
  code?: string
  details?: Record<string, unknown>

  constructor(
    message: string,
    statusCode = 400,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ValidationError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export function asObject(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Request body must be a JSON object.')
  }
  return input as Record<string, unknown>
}

export function requiredString(
  body: Record<string, unknown>,
  key: string,
  options: { maxLength?: number } = {},
) {
  const value = body[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${label(key)} is required.`)
  }
  const trimmed = value.trim()
  if (options.maxLength && trimmed.length > options.maxLength) {
    throw new ValidationError(`${label(key)} must be ${options.maxLength} characters or fewer.`)
  }
  return trimmed
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
  options: { maxLength?: number; allowEmpty?: boolean } = {},
) {
  if (!(key in body)) return undefined
  const value = body[key]
  if (value == null) return null
  if (typeof value !== 'string') {
    throw new ValidationError(`${label(key)} must be a string.`)
  }
  const normalized = options.allowEmpty ? value.trim() : value.trim() || null
  if (normalized && options.maxLength && normalized.length > options.maxLength) {
    throw new ValidationError(`${label(key)} must be ${options.maxLength} characters or fewer.`)
  }
  return normalized
}

export function requiredInteger(
  body: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
) {
  const value = parseInteger(body[key], key)
  if (value == null) {
    throw new ValidationError(`${label(key)} is required.`)
  }
  return boundedInteger(value, key, options)
}

export function optionalInteger(
  body: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
) {
  if (!(key in body)) return undefined
  if (body[key] == null) return null
  const value = parseInteger(body[key], key)
  if (value == null) {
    throw new ValidationError(`${label(key)} must be an integer.`)
  }
  return boundedInteger(value, key, options)
}

export function optionalNumber(
  body: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
) {
  if (!(key in body)) return undefined
  if (body[key] == null) return null
  const value = parseNumber(body[key], key)
  return boundedNumber(value, key, options)
}

export function requiredEnum<T extends readonly string[]>(
  body: Record<string, unknown>,
  key: string,
  values: T,
) {
  const raw = requiredString(body, key)
  return enumValue(raw, key, values)
}

export function optionalEnum<T extends readonly string[]>(
  body: Record<string, unknown>,
  key: string,
  values: T,
) {
  if (!(key in body)) return undefined
  if (body[key] == null) return null
  if (typeof body[key] !== 'string') {
    throw new ValidationError(`${label(key)} must be a string.`)
  }
  return enumValue(String(body[key]).trim(), key, values)
}

export function optionalStringArray(
  body: Record<string, unknown>,
  key: string,
  options: { maxItems?: number } = {},
) {
  if (!(key in body)) return undefined
  const value = body[key]
  if (value == null) return null
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ValidationError(`${label(key)} must be an array of strings.`)
  }
  const normalized = value.map((item) => item.trim()).filter(Boolean)
  if (options.maxItems && normalized.length > options.maxItems) {
    throw new ValidationError(`${label(key)} must contain ${options.maxItems} items or fewer.`)
  }
  return normalized.length > 0 ? normalized : null
}

export function optionalBoolean(body: Record<string, unknown>, key: string) {
  if (!(key in body)) return undefined
  const value = body[key]
  if (value == null) return null
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${label(key)} must be true or false.`)
  }
  return value
}

export function ensureIpv4(ipAddress: string, key = 'ipAddress') {
  const octets = ipAddress.split('.')
  if (octets.length !== 4) {
    throw new ValidationError(`${label(key)} must be a valid IPv4 address.`)
  }
  for (const octet of octets) {
    if (!/^\d+$/.test(octet)) {
      throw new ValidationError(`${label(key)} must be a valid IPv4 address.`)
    }
    const value = Number.parseInt(octet, 10)
    if (value < 0 || value > 255) {
      throw new ValidationError(`${label(key)} must be a valid IPv4 address.`)
    }
  }
  return ipAddress
}

export function ensureHostTarget(value: string, key = 'target') {
  const target = value.trim()
  if (!target || target.startsWith('-') || /\s/.test(target)) {
    throw new ValidationError(`${label(key)} must be a valid host target.`)
  }

  if (/^[\d.]+$/.test(target)) {
    return ensureIpv4(target, key)
  }

  if (net.isIP(target) === 6) {
    return target
  }

  const hostname = target.endsWith('.') ? target.slice(0, -1) : target
  if (!hostname || hostname.length > 253) {
    throw new ValidationError(`${label(key)} must be a valid host target.`)
  }

  const labels = hostname.split('.')
  if (
    labels.some(
      (part) =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part),
    )
  ) {
    throw new ValidationError(`${label(key)} must be a valid host target.`)
  }

  return target
}

export function ensureCidr(cidr: string, key = 'cidr') {
  try {
    return canonicalizeIpv4Cidr(cidr)
  } catch {
    throw new ValidationError(`${label(key)} must be a valid CIDR block.`)
  }
}

export function ensureIsoDate(value: string, key = 'date') {
  if (!Number.isFinite(Date.parse(value))) {
    throw new ValidationError(`${label(key)} must be a valid ISO date string.`)
  }
  return value
}

export function parseLimit(value: string | undefined, fallback = 100, max = 500) {
  const parsed = Number.parseInt(value ?? `${fallback}`, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function parseInteger(value: unknown, key: string) {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10)
  }
  if (value == null) return null
  throw new ValidationError(`${label(key)} must be an integer.`)
}

function parseNumber(value: unknown, key: string) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  throw new ValidationError(`${label(key)} must be a number.`)
}

function boundedInteger(value: number, key: string, options: { min?: number; max?: number }) {
  if (options.min != null && value < options.min) {
    throw new ValidationError(`${label(key)} must be at least ${options.min}.`)
  }
  if (options.max != null && value > options.max) {
    throw new ValidationError(`${label(key)} must be at most ${options.max}.`)
  }
  return value
}

function boundedNumber(value: number, key: string, options: { min?: number; max?: number }) {
  if (options.min != null && value < options.min) {
    throw new ValidationError(`${label(key)} must be at least ${options.min}.`)
  }
  if (options.max != null && value > options.max) {
    throw new ValidationError(`${label(key)} must be at most ${options.max}.`)
  }
  return value
}

function enumValue<T extends readonly string[]>(value: string, key: string, values: T): T[number] {
  if (!values.includes(value)) {
    throw new ValidationError(`${label(key)} must be one of: ${values.join(', ')}.`)
  }
  return value as T[number]
}

function label(key: string) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (match) => match.toUpperCase())
}

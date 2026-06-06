import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const PREFIX = 'enc:v1:'
let derivedKey: Buffer | null = null

function getKey() {
  const secret = process.env.RACKPAD_SECRET_KEY?.trim()
  if (!secret) {
    throw new Error(
      'RACKPAD_SECRET_KEY must be set before storing SNMP credential secrets.',
    )
  }
  if (!derivedKey) {
    derivedKey = scryptSync(secret, 'rackpad-snmp-secrets-v1', 32)
  }
  return derivedKey
}

export function canEncryptSecrets() {
  return Boolean(process.env.RACKPAD_SECRET_KEY?.trim())
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`
}

export function decryptSecret(value: string) {
  if (!value.startsWith(PREFIX)) {
    throw new Error('Stored SNMP secret is missing encryption metadata.')
  }
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const encrypted = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

export function encryptOptionalSecret(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return encryptSecret(trimmed)
}

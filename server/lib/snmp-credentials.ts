import { db } from '../db.js'
import { createId } from './ids.js'
import { decryptSecret, encryptOptionalSecret } from './secret-crypto.js'
import type { SnmpV1V2Session, SnmpV3Session } from './snmp.js'

export const SNMP_CREDENTIAL_VERSIONS = ['1', '2c', '3'] as const
export type SnmpCredentialVersion = (typeof SNMP_CREDENTIAL_VERSIONS)[number]
export const SNMP_V3_AUTH_PROTOCOLS = ['MD5', 'SHA'] as const
export type SnmpV3AuthProtocol = (typeof SNMP_V3_AUTH_PROTOCOLS)[number]
export const SNMP_V3_PRIV_PROTOCOLS = ['none', 'AES128'] as const
export type SnmpV3PrivProtocol = (typeof SNMP_V3_PRIV_PROTOCOLS)[number]

export interface SnmpCredentialRow {
  id: string
  labId: string
  name: string
  version: SnmpCredentialVersion
  communityEnc?: string | null
  v3User?: string | null
  v3AuthProto?: string | null
  v3AuthPassEnc?: string | null
  v3PrivProto?: string | null
  v3PrivPassEnc?: string | null
  v3Context?: string | null
  createdAt: string
  updatedAt: string
}

export interface SnmpCredentialPublic {
  id: string
  labId: string
  name: string
  version: SnmpCredentialVersion
  hasCommunity: boolean
  v3User?: string | null
  v3AuthProto?: SnmpV3AuthProtocol | null
  v3PrivProto?: SnmpV3PrivProtocol | null
  v3Context?: string | null
  hasV3AuthPass: boolean
  hasV3PrivPass: boolean
  createdAt: string
  updatedAt: string
}

export interface SnmpCredentialSecrets {
  id: string
  labId: string
  name: string
  version: SnmpCredentialVersion
  community?: string | null
  v3User?: string | null
  v3AuthProto?: SnmpV3AuthProtocol | null
  v3AuthPassword?: string | null
  v3PrivProto?: SnmpV3PrivProtocol | null
  v3PrivPassword?: string | null
  v3Context?: string | null
}

function parseAuthProto(value: unknown): SnmpV3AuthProtocol | null {
  if (value === 'MD5' || value === 'SHA') return value
  return null
}

function parsePrivProto(value: unknown): SnmpV3PrivProtocol | null {
  if (value === 'none' || value === 'AES128') return value
  return null
}

export function parseSnmpCredentialPublic(row: Record<string, unknown>): SnmpCredentialPublic {
  return {
    id: String(row.id),
    labId: String(row.labId),
    name: String(row.name),
    version: String(row.version) as SnmpCredentialVersion,
    hasCommunity: Boolean(row.communityEnc),
    v3User: row.v3User ? String(row.v3User) : null,
    v3AuthProto: parseAuthProto(row.v3AuthProto),
    v3PrivProto: parsePrivProto(row.v3PrivProto),
    v3Context: row.v3Context ? String(row.v3Context) : null,
    hasV3AuthPass: Boolean(row.v3AuthPassEnc),
    hasV3PrivPass: Boolean(row.v3PrivPassEnc),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

export function listSnmpCredentials(labId?: string) {
  const rows = labId
    ? db
        .prepare('SELECT * FROM snmpCredentials WHERE labId = ? ORDER BY name, id')
        .all(labId)
    : db.prepare('SELECT * FROM snmpCredentials ORDER BY labId, name, id').all()
  return (rows as Record<string, unknown>[]).map(parseSnmpCredentialPublic)
}

export function getSnmpCredentialRow(id: string) {
  return db.prepare('SELECT * FROM snmpCredentials WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
}

export function loadSnmpCredentialSecrets(id: string, labId?: string): SnmpCredentialSecrets {
  const row = getSnmpCredentialRow(id)
  if (!row) {
    throw new Error('SNMP credential not found.')
  }
  if (labId && String(row.labId) !== labId) {
    throw new Error('SNMP credential does not belong to this lab.')
  }

  return {
    id: String(row.id),
    labId: String(row.labId),
    name: String(row.name),
    version: String(row.version) as SnmpCredentialVersion,
    community: row.communityEnc ? decryptSecret(String(row.communityEnc)) : null,
    v3User: row.v3User ? String(row.v3User) : null,
    v3AuthProto: parseAuthProto(row.v3AuthProto),
    v3AuthPassword: row.v3AuthPassEnc ? decryptSecret(String(row.v3AuthPassEnc)) : null,
    v3PrivProto: parsePrivProto(row.v3PrivProto),
    v3PrivPassword: row.v3PrivPassEnc ? decryptSecret(String(row.v3PrivPassEnc)) : null,
    v3Context: row.v3Context ? String(row.v3Context) : null,
  }
}

export function buildSnmpSessionFromCredential(
  credential: SnmpCredentialSecrets,
  target: {
    host: string
    port?: number
    timeoutMs?: number
  },
): SnmpV1V2Session | SnmpV3Session {
  const port = target.port ?? 161
  const timeoutMs = target.timeoutMs ?? 8000

  if (credential.version === '3') {
    if (!credential.v3User?.trim()) {
      throw new Error('SNMPv3 credentials require a username.')
    }
    const authProto = credential.v3AuthProto ?? 'SHA'
    const privProto = credential.v3PrivProto ?? 'none'
    if (!credential.v3AuthPassword?.trim()) {
      throw new Error('SNMPv3 credentials require an authentication password.')
    }
    if (privProto === 'AES128' && !credential.v3PrivPassword?.trim()) {
      throw new Error('SNMPv3 privacy requires a privacy password.')
    }
    return {
      host: target.host,
      port,
      timeoutMs,
      version: '3',
      user: credential.v3User.trim(),
      authProtocol: authProto,
      authPassword: credential.v3AuthPassword,
      privProtocol: privProto,
      privPassword: credential.v3PrivPassword ?? '',
      context: credential.v3Context?.trim() || '',
    }
  }

  return {
    host: target.host,
    port,
    timeoutMs,
    version: credential.version,
    community: credential.community?.trim() || 'public',
  }
}

export function createSnmpCredential(input: {
  labId: string
  name: string
  version: SnmpCredentialVersion
  community?: string | null
  v3User?: string | null
  v3AuthProto?: SnmpV3AuthProtocol | null
  v3AuthPassword?: string | null
  v3PrivProto?: SnmpV3PrivProtocol | null
  v3PrivPassword?: string | null
  v3Context?: string | null
}) {
  const now = new Date().toISOString()
  const id = createId('snmpc')
  db.prepare(`
    INSERT INTO snmpCredentials (
      id, labId, name, version,
      communityEnc, v3User, v3AuthProto, v3AuthPassEnc, v3PrivProto, v3PrivPassEnc, v3Context,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.labId,
    input.name,
    input.version,
    encryptOptionalSecret(input.community),
    input.v3User?.trim() || null,
    input.v3AuthProto ?? null,
    encryptOptionalSecret(input.v3AuthPassword),
    input.v3PrivProto ?? null,
    encryptOptionalSecret(input.v3PrivPassword),
    input.v3Context?.trim() || null,
    now,
    now,
  )
  return parseSnmpCredentialPublic(getSnmpCredentialRow(id)!)
}

export function updateSnmpCredential(
  id: string,
  input: Partial<{
    name: string
    version: SnmpCredentialVersion
    community: string | null
    v3User: string | null
    v3AuthProto: SnmpV3AuthProtocol | null
    v3AuthPassword: string | null
    v3PrivProto: SnmpV3PrivProtocol | null
    v3PrivPassword: string | null
    v3Context: string | null
    clearCommunity: boolean
    clearV3AuthPassword: boolean
    clearV3PrivPassword: boolean
  }>,
) {
  const existing = getSnmpCredentialRow(id)
  if (!existing) return null

  const nextName = input.name?.trim() ?? String(existing.name)
  const nextVersion = input.version ?? (String(existing.version) as SnmpCredentialVersion)
  const nextCommunity =
    input.clearCommunity
      ? null
      : input.community !== undefined
        ? encryptOptionalSecret(input.community)
        : (existing.communityEnc as string | null)
  const nextV3User =
    input.v3User !== undefined ? input.v3User?.trim() || null : (existing.v3User as string | null)
  const nextV3AuthProto =
    input.v3AuthProto !== undefined ? input.v3AuthProto : (existing.v3AuthProto as string | null)
  const nextV3AuthPass =
    input.clearV3AuthPassword
      ? null
      : input.v3AuthPassword !== undefined
        ? encryptOptionalSecret(input.v3AuthPassword)
        : (existing.v3AuthPassEnc as string | null)
  const nextV3PrivProto =
    input.v3PrivProto !== undefined ? input.v3PrivProto : (existing.v3PrivProto as string | null)
  const nextV3PrivPass =
    input.clearV3PrivPassword
      ? null
      : input.v3PrivPassword !== undefined
        ? encryptOptionalSecret(input.v3PrivPassword)
        : (existing.v3PrivPassEnc as string | null)
  const nextV3Context =
    input.v3Context !== undefined
      ? input.v3Context?.trim() || null
      : (existing.v3Context as string | null)
  const updatedAt = new Date().toISOString()

  db.prepare(`
    UPDATE snmpCredentials
    SET
      name = ?,
      version = ?,
      communityEnc = ?,
      v3User = ?,
      v3AuthProto = ?,
      v3AuthPassEnc = ?,
      v3PrivProto = ?,
      v3PrivPassEnc = ?,
      v3Context = ?,
      updatedAt = ?
    WHERE id = ?
  `).run(
    nextName,
    nextVersion,
    nextCommunity,
    nextV3User,
    nextV3AuthProto,
    nextV3AuthPass,
    nextV3PrivProto,
    nextV3PrivPass,
    nextV3Context,
    updatedAt,
    id,
  )

  return parseSnmpCredentialPublic(getSnmpCredentialRow(id)!)
}

export function deleteSnmpCredential(id: string) {
  const existing = getSnmpCredentialRow(id)
  if (!existing) return false
  db.prepare('UPDATE devices SET snmpCredentialId = NULL WHERE snmpCredentialId = ?').run(id)
  db.prepare('UPDATE deviceMonitors SET snmpCredentialId = NULL WHERE snmpCredentialId = ?').run(id)
  db.prepare('DELETE FROM snmpCredentials WHERE id = ?').run(id)
  return true
}

export async function testSnmpCredential(
  credential: SnmpCredentialSecrets,
  target: { host: string; port?: number; timeoutMs?: number },
) {
  const { snmpGet } = await import('./snmp.js')
  const session = buildSnmpSessionFromCredential(credential, target)
  const response = await snmpGet(session, '1.3.6.1.2.1.1.3.0')
  if (response.kind === 'exception') {
    throw new Error(
      `SNMP agent returned ${response.exception} for ${response.oid}.`,
    )
  }
  return {
    oid: response.oid,
    value: response.value,
    type: response.type,
    target: `${target.host}:${target.port ?? 161}`,
    version: credential.version,
  }
}

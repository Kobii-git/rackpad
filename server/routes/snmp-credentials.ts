import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth.js'
import {
  assertLabRead,
  assertLabWrite,
  resolveLabIdsForList,
} from '../lib/lab-access.js'
import { canEncryptSecrets } from '../lib/secret-crypto.js'
import {
  createSnmpCredential,
  deleteSnmpCredential,
  getSnmpCredentialRow,
  listSnmpCredentials,
  loadSnmpCredentialSecrets,
  SNMP_CREDENTIAL_VERSIONS,
  SNMP_V3_AUTH_PROTOCOLS,
  SNMP_V3_PRIV_PROTOCOLS,
  testSnmpCredential,
  updateSnmpCredential,
} from '../lib/snmp-credentials.js'
import {
  asObject,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalString,
  requiredString,
  ValidationError,
} from '../lib/validation.js'

export const snmpCredentialsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    const query = req.query as { labId?: string }
    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    if (query.labId) {
      if (!assertLabRead(req, reply, query.labId)) return
      return listSnmpCredentials(query.labId)
    }

    if (filter.labIds === null) {
      return listSnmpCredentials()
    }

    const allowed = new Set(filter.labIds)
    return listSnmpCredentials().filter((entry) => allowed.has(entry.labId))
  })

  app.post('/', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    if (!canEncryptSecrets()) {
      return reply.status(503).send({
        error: 'RACKPAD_SECRET_KEY must be configured before storing SNMP credentials.',
      })
    }

    const body = asObject(req.body)
    const labId = requiredString(body, 'labId', { maxLength: 80 })
    if (!assertLabWrite(req, reply, labId)) return

    const name = requiredString(body, 'name', { maxLength: 120 })
    const version = requiredEnum(body, 'version', SNMP_CREDENTIAL_VERSIONS)
    validateCredentialPayload(version, body)

    const created = createSnmpCredential({
      labId,
      name,
      version,
      community: optionalString(body, 'community', { maxLength: 120 }) ?? null,
      v3User: optionalString(body, 'v3User', { maxLength: 120 }) ?? null,
      v3AuthProto: optionalEnum(body, 'v3AuthProto', SNMP_V3_AUTH_PROTOCOLS) ?? null,
      v3AuthPassword: optionalString(body, 'v3AuthPassword', { maxLength: 200 }) ?? null,
      v3PrivProto: optionalEnum(body, 'v3PrivProto', SNMP_V3_PRIV_PROTOCOLS) ?? null,
      v3PrivPassword: optionalString(body, 'v3PrivPassword', { maxLength: 200 }) ?? null,
      v3Context: optionalString(body, 'v3Context', { maxLength: 120 }) ?? null,
    })

    return reply.status(201).send(created)
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    if (!canEncryptSecrets()) {
      return reply.status(503).send({
        error: 'RACKPAD_SECRET_KEY must be configured before storing SNMP credentials.',
      })
    }

    const existing = getSnmpCredentialRow(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'SNMP credential not found.' })
    }
    if (!assertLabWrite(req, reply, String(existing.labId))) return

    const body = asObject(req.body)
    const nextVersion = optionalEnum(body, 'version', SNMP_CREDENTIAL_VERSIONS)
    validateCredentialPayload(nextVersion ?? String(existing.version), body, true)
    const nextName = optionalString(body, 'name', { maxLength: 120 })

    const updated = updateSnmpCredential(req.params.id, {
      name: nextName ?? undefined,
      version: nextVersion ?? undefined,
      community:
        'community' in body ? optionalString(body, 'community', { maxLength: 120 }) : undefined,
      v3User: 'v3User' in body ? optionalString(body, 'v3User', { maxLength: 120 }) : undefined,
      v3AuthProto: optionalEnum(body, 'v3AuthProto', SNMP_V3_AUTH_PROTOCOLS),
      v3AuthPassword: optionalString(body, 'v3AuthPassword', { maxLength: 200 }),
      v3PrivProto: optionalEnum(body, 'v3PrivProto', SNMP_V3_PRIV_PROTOCOLS),
      v3PrivPassword: optionalString(body, 'v3PrivPassword', { maxLength: 200 }),
      v3Context: 'v3Context' in body ? optionalString(body, 'v3Context', { maxLength: 120 }) : undefined,
      clearCommunity: optionalBoolean(body, 'clearCommunity') ?? false,
      clearV3AuthPassword: optionalBoolean(body, 'clearV3AuthPassword') ?? false,
      clearV3PrivPassword: optionalBoolean(body, 'clearV3PrivPassword') ?? false,
    })

    return updated
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    const existing = getSnmpCredentialRow(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'SNMP credential not found.' })
    }
    if (!assertLabWrite(req, reply, String(existing.labId))) return

    deleteSnmpCredential(req.params.id)
    return reply.status(204).send()
  })

  app.post<{ Params: { id: string } }>('/:id/test', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    const existing = getSnmpCredentialRow(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'SNMP credential not found.' })
    }
    if (!assertLabWrite(req, reply, String(existing.labId))) return

    const body = asObject(req.body)
    const target = requiredString(body, 'target', { maxLength: 200 })
    const port = optionalInteger(body, 'port', { min: 1, max: 65535 }) ?? 161
    const timeoutMs = optionalInteger(body, 'timeoutMs', { min: 1000, max: 30_000 }) ?? 8000

    const credential = loadSnmpCredentialSecrets(req.params.id, String(existing.labId))
    try {
      const result = await testSnmpCredential(credential, { host: target, port, timeoutMs })
      return result
    } catch (error) {
      return reply.status(502).send({
        error: error instanceof Error ? error.message : 'SNMP test failed.',
      })
    }
  })
}

function requiredEnum<T extends readonly string[]>(
  body: Record<string, unknown>,
  key: string,
  values: T,
) {
  const value = requiredString(body, key, { maxLength: 40 })
  if (!values.includes(value as T[number])) {
    throw new ValidationError(`${key} is invalid.`)
  }
  return value as T[number]
}

function validateCredentialPayload(
  version: string,
  body: Record<string, unknown>,
  partial = false,
) {
  if (version === '3') {
    if (!partial && !optionalString(body, 'v3User', { maxLength: 120 })?.trim()) {
      throw new ValidationError('v3User is required for SNMPv3 credentials.')
    }
    if (!partial && !optionalString(body, 'v3AuthPassword', { maxLength: 200 })?.trim()) {
      throw new ValidationError('v3AuthPassword is required for SNMPv3 credentials.')
    }
    const privProto = optionalEnum(body, 'v3PrivProto', SNMP_V3_PRIV_PROTOCOLS)
    if (
      privProto === 'AES128' &&
      !partial &&
      !optionalString(body, 'v3PrivPassword', { maxLength: 200 })?.trim()
    ) {
      throw new ValidationError('v3PrivPassword is required when SNMPv3 privacy is enabled.')
    }
    return
  }

  if (!partial && !optionalString(body, 'community', { maxLength: 120 })?.trim()) {
    throw new ValidationError('community is required for SNMPv1/v2c credentials.')
  }
}

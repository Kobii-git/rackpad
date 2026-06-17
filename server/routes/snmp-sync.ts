import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { requireAdmin, requireAuth } from '../lib/auth.js'
import { assertLabWrite } from '../lib/lab-access.js'
import { getSnmpProfile, listSnmpProfiles } from '../lib/snmp-profiles/index.js'
import { resolveSnmpSessionForTarget } from '../lib/snmp-session.js'
import {
  applySnmpSyncPreview,
  buildSnmpSyncPreview,
  snmpInventorySyncEnabled,
} from '../lib/snmp-sync.js'
import { SNMP_VERSIONS } from '../lib/snmp.js'
import {
  asObject,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalString,
  requiredString,
  ValidationError,
} from '../lib/validation.js'
import type { SnmpSyncPolicy, SnmpSyncPreview } from '../lib/snmp-profiles/types.js'

function ensureInventorySyncEnabled(reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (snmpInventorySyncEnabled()) return true
  reply.status(503).send({
    error: 'SNMP inventory sync is disabled. Set SNMP_INVENTORY_SYNC=1 to enable it.',
  })
  return false
}

function getDeviceLabRow(deviceId: string) {
  return db
    .prepare('SELECT id, labId, managementIp, snmpCredentialId FROM devices WHERE id = ?')
    .get(deviceId) as
    | { id: string; labId: string; managementIp?: string | null; snmpCredentialId?: string | null }
    | undefined
}

function resolveSyncSession(body: Record<string, unknown>) {
  const deviceId = requiredString(body, 'deviceId', { maxLength: 80 })
  const device = getDeviceLabRow(deviceId)
  if (!device) {
    throw new ValidationError('Device not found.')
  }

  const target =
    optionalString(body, 'target', { maxLength: 200 }) ??
    (device.managementIp ? String(device.managementIp) : null)
  if (!target) {
    throw new ValidationError('SNMP target is required when the device has no management IP.')
  }

  const port = optionalInteger(body, 'port', { min: 1, max: 65535 }) ?? 161
  const timeoutMs = optionalInteger(body, 'timeoutMs', { min: 1000, max: 30_000 }) ?? 8000
  const snmpCredentialId =
    optionalString(body, 'snmpCredentialId', { maxLength: 80 }) ?? device.snmpCredentialId ?? null

  if (snmpCredentialId) {
    const credential = db
      .prepare('SELECT id FROM snmpCredentials WHERE id = ? AND labId = ?')
      .get(snmpCredentialId, device.labId) as { id: string } | undefined
    if (!credential) {
      throw new ValidationError('SNMP credential must belong to the selected lab.')
    }
  }

  const session = resolveSnmpSessionForTarget({
    deviceId: device.id,
    labId: device.labId,
    host: target,
    port,
    timeoutMs,
    snmpCredentialId,
    snmpVersion: optionalEnum(body, 'snmpVersion', SNMP_VERSIONS),
    snmpCommunity: optionalString(body, 'snmpCommunity', { maxLength: 120 }),
  })

  return { device, target, session }
}

export const snmpSyncRoutes: FastifyPluginAsync = async (app) => {
  app.get('/profiles', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    if (!ensureInventorySyncEnabled(reply)) return
    return listSnmpProfiles()
  })

  app.post('/preview', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    if (!ensureInventorySyncEnabled(reply)) return

    const body = asObject(req.body)
    const profileId = requiredString(body, 'profileId', { maxLength: 80 })
    const policy = optionalEnum(body, 'policy', ['merge', 'mirror'] as const) ?? 'merge'
    const profile = getSnmpProfile(profileId)
    if (!profile) {
      return reply.status(400).send({ error: 'Unknown SNMP profile.' })
    }

    const { device, target, session } = resolveSyncSession(body)
    if (!assertLabWrite(req, reply, device.labId)) return

    const collection = await profile.collect(session)
    const preview = buildSnmpSyncPreview({
      profileId,
      deviceId: device.id,
      labId: device.labId,
      target,
      policy,
      collection,
    })
    return preview
  })

  app.post('/apply', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    if (!ensureInventorySyncEnabled(reply)) return

    const body = asObject(req.body)
    const preview = body.preview as SnmpSyncPreview | undefined
    if (!preview || typeof preview !== 'object') {
      return reply.status(400).send({ error: 'Preview payload is required.' })
    }

    const device = getDeviceLabRow(String(preview.deviceId))
    if (!device) {
      return reply.status(404).send({ error: 'Device not found.' })
    }
    if (!assertLabWrite(req, reply, device.labId)) return

    const policy = optionalEnum(body, 'policy', ['merge', 'mirror'] as const) ?? preview.policy
    if (policy === 'mirror' && preview.policy !== 'mirror') {
      return reply.status(400).send({ error: 'Mirror apply requires a mirror preview.' })
    }

    const allowDeletes = optionalBoolean(body, 'allowDeletes') ?? false
    if (policy === 'mirror' && !allowDeletes && (preview.summary.vlanDeletes > 0 || preview.summary.subnetDeletes > 0)) {
      return reply.status(400).send({
        error: 'Mirror preview includes deletes. Re-run apply with allowDeletes=true to confirm.',
      })
    }

    const result = applySnmpSyncPreview({
      preview: { ...preview, policy: policy as SnmpSyncPolicy },
      allowDeletes,
      actor: req.authUser!.username,
    })
    return result
  })
}

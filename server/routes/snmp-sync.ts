import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { requireAdmin, requireAuth } from '../lib/auth.js'
import { assertLabWrite } from '../lib/lab-access.js'
import { resolveLabIdsForList } from '../lib/lab-access.js'
import { createId } from '../lib/ids.js'
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

function parseSchedule(row: Record<string, unknown>) {
  return { ...row, enabled: Number(row.enabled) === 1 }
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

  app.get('/schedules', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const filter = resolveLabIdsForList(req.authUser!, req.labAccess ?? [])
    if (!filter.ok) return reply.status(filter.status).send({ error: filter.error })
    const rows = db.prepare('SELECT * FROM snmpSyncSchedules ORDER BY labId, deviceId').all() as Array<Record<string, unknown>>
    return rows
      .filter((row) => filter.labIds === null || filter.labIds.includes(String(row.labId)))
      .map(parseSchedule)
  })

  app.post('/schedules', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const body = asObject(req.body)
    const deviceId = requiredString(body, 'deviceId', { maxLength: 80 })
    const device = getDeviceLabRow(deviceId)
    if (!device) return reply.status(404).send({ error: 'Device not found.' })
    const profileId = requiredString(body, 'profileId', { maxLength: 80 })
    if (!getSnmpProfile(profileId)) throw new ValidationError('Unknown SNMP profile.')
    const duplicate = db.prepare('SELECT id FROM snmpSyncSchedules WHERE deviceId = ?').get(deviceId)
    if (duplicate) throw new ValidationError('This device already has an SNMP sync schedule.', 409)
    const policy = optionalEnum(body, 'policy', ['merge', 'mirror'] as const) ?? 'merge'
    const intervalMs = optionalInteger(body, 'intervalMs', { min: 60_000, max: 31_536_000_000 }) ?? 86_400_000
    const enabled = optionalBoolean(body, 'enabled') ?? false
    const id = createId('sss')
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO snmpSyncSchedules
      (id, labId, deviceId, profileId, policy, intervalMs, enabled, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, device.labId, device.id, profileId, policy, intervalMs, enabled ? 1 : 0, now, now)
    return reply.status(201).send(parseSchedule(db.prepare('SELECT * FROM snmpSyncSchedules WHERE id = ?').get(id) as Record<string, unknown>))
  })

  app.patch<{ Params: { id: string } }>('/schedules/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const existing = db.prepare('SELECT * FROM snmpSyncSchedules WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!existing) return reply.status(404).send({ error: 'SNMP sync schedule not found.' })
    const body = asObject(req.body)
    const profileId = optionalString(body, 'profileId', { maxLength: 80 })
    if (profileId && !getSnmpProfile(profileId)) throw new ValidationError('Unknown SNMP profile.')
    const policy = optionalEnum(body, 'policy', ['merge', 'mirror'] as const)
    const intervalMs = optionalInteger(body, 'intervalMs', { min: 60_000, max: 31_536_000_000 })
    const enabled = optionalBoolean(body, 'enabled')
    db.prepare(`UPDATE snmpSyncSchedules SET profileId = ?, policy = ?, intervalMs = ?, enabled = ?, updatedAt = ? WHERE id = ?`).run(
      profileId ?? existing.profileId,
      policy ?? existing.policy,
      intervalMs ?? existing.intervalMs,
      enabled === undefined ? existing.enabled : enabled ? 1 : 0,
      new Date().toISOString(),
      req.params.id,
    )
    return parseSchedule(db.prepare('SELECT * FROM snmpSyncSchedules WHERE id = ?').get(req.params.id) as Record<string, unknown>)
  })

  app.delete<{ Params: { id: string } }>('/schedules/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const result = db.prepare('DELETE FROM snmpSyncSchedules WHERE id = ?').run(req.params.id)
    return result.changes ? reply.status(204).send() : reply.status(404).send({ error: 'SNMP sync schedule not found.' })
  })
}

export async function runSnmpSyncSchedule(scheduleId: string) {
  const schedule = db.prepare(`SELECT snmpSyncSchedules.*, devices.managementIp, devices.snmpCredentialId
    FROM snmpSyncSchedules JOIN devices ON devices.id = snmpSyncSchedules.deviceId
    WHERE snmpSyncSchedules.id = ?`).get(scheduleId) as Record<string, unknown> | undefined
  if (!schedule || !schedule.managementIp) throw new Error('Scheduled SNMP sync device has no management IP.')
  const profile = getSnmpProfile(String(schedule.profileId))
  if (!profile) throw new Error('Scheduled SNMP sync profile is unavailable.')
  const now = new Date().toISOString()
  try {
    const session = resolveSnmpSessionForTarget({
      deviceId: String(schedule.deviceId), labId: String(schedule.labId), host: String(schedule.managementIp),
      port: 161, timeoutMs: 8000,
      snmpCredentialId: schedule.snmpCredentialId ? String(schedule.snmpCredentialId) : null,
    })
    const collection = await profile.collect(session)
    const preview = buildSnmpSyncPreview({
      profileId: profile.id, deviceId: String(schedule.deviceId), labId: String(schedule.labId),
      target: String(schedule.managementIp), policy: schedule.policy as SnmpSyncPolicy, collection,
    })
    applySnmpSyncPreview({ preview, allowDeletes: false, actor: 'system' })
    db.prepare(`UPDATE snmpSyncSchedules SET lastRunAt = ?, lastResult = 'success', lastMessage = ?, updatedAt = ? WHERE id = ?`).run(now, 'Scheduled SNMP sync completed.', now, scheduleId)
  } catch (error) {
    db.prepare(`UPDATE snmpSyncSchedules SET lastRunAt = ?, lastResult = 'error', lastMessage = ?, updatedAt = ? WHERE id = ?`).run(now, error instanceof Error ? error.message.slice(0, 500) : 'Scheduled SNMP sync failed.', now, scheduleId)
    throw error
  }
}

let snmpScheduleHandle: NodeJS.Timeout | null = null

export function snmpSyncOperationalStatus() {
  const enabled = db.prepare('SELECT COUNT(*) AS count FROM snmpSyncSchedules WHERE enabled = 1').get() as { count: number }
  const failures = db.prepare("SELECT COUNT(*) AS count FROM snmpSyncSchedules WHERE enabled = 1 AND lastResult = 'error'").get() as { count: number }
  return { loopActive: snmpScheduleHandle != null, featureEnabled: snmpInventorySyncEnabled(), enabledSchedules: enabled.count, failingSchedules: failures.count }
}

export function startSnmpSyncScheduleLoop() {
  snmpScheduleHandle = setInterval(() => {
    if (!snmpInventorySyncEnabled()) return
    const schedules = db.prepare(`SELECT id, intervalMs, lastRunAt FROM snmpSyncSchedules WHERE enabled = 1`).all() as Array<{ id: string; intervalMs: number; lastRunAt: string | null }>
    for (const schedule of schedules) {
      if (!schedule.lastRunAt || Date.now() - Date.parse(schedule.lastRunAt) >= schedule.intervalMs) {
        void runSnmpSyncSchedule(schedule.id).catch(() => undefined)
      }
    }
  }, 60_000)
  snmpScheduleHandle.unref?.()
  return () => {
    if (snmpScheduleHandle) clearInterval(snmpScheduleHandle)
    snmpScheduleHandle = null
  }
}

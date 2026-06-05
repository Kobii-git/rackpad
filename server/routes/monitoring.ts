import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { requireAdmin, requireAuth } from '../lib/auth.js'
import { createId } from '../lib/ids.js'
import { listMonitors, MONITOR_TYPES, reconcileDeviceMonitorRollup, runDeviceChecks, runMonitorCheck, SNMP_VERSIONS } from '../lib/monitoring.js'
import {
  asObject,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalString,
  requiredString,
  ValidationError,
} from '../lib/validation.js'

export const monitoringRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const query = req.query as { deviceId?: string }
    return listMonitors(query.deviceId)
  })

  app.post('/', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const body = asObject(req.body)
    const deviceId = requiredString(body, 'deviceId', { maxLength: 80 })
    const device = db.prepare('SELECT id, managementIp FROM devices WHERE id = ?').get(deviceId) as
      | { id: string; managementIp?: string | null }
      | undefined
    if (!device) {
      return reply.status(404).send({ error: 'Device not found.' })
    }

    const existingCountRow = db.prepare('SELECT COUNT(*) as count, COALESCE(MAX(sortOrder), -1) as maxSortOrder FROM deviceMonitors WHERE deviceId = ?').get(deviceId) as {
      count: number
      maxSortOrder: number
    }
    const nextSortOrder = Number(existingCountRow.maxSortOrder ?? -1) + 1
    const defaultName = existingCountRow.count === 0 ? 'Management' : `Target ${existingCountRow.count + 1}`
    const name = optionalString(body, 'name', { maxLength: 80 }) ?? defaultName
    const type = optionalEnum(body, 'type', MONITOR_TYPES) ?? 'none'
    const target = optionalString(body, 'target', { maxLength: 200 })
    const path = optionalString(body, 'path', { maxLength: 200 })
    const port = optionalInteger(body, 'port', { min: 1, max: 65535 })
    const snmpVersion = optionalEnum(body, 'snmpVersion', SNMP_VERSIONS) ?? '2c'
    const snmpCommunity = optionalString(body, 'snmpCommunity', { maxLength: 120 }) ?? 'public'
    const snmpOid = optionalString(body, 'snmpOid', { maxLength: 160 })
    const snmpExpectedValue = optionalString(body, 'snmpExpectedValue', { maxLength: 200 })
    const intervalMs = optionalInteger(body, 'intervalMs', { min: 1000, max: 1000 * 60 * 60 * 24 })
    const requestedEnabled = optionalBoolean(body, 'enabled')
    const enabled = type === 'none' ? false : (requestedEnabled ?? true)
    const normalizedTarget = target ?? device.managementIp ?? null

    if (type !== 'none' && !normalizedTarget) {
      throw new ValidationError('Target is required when health checks are enabled.')
    }
    if (type === 'snmp' && !snmpOid) {
      throw new ValidationError('SNMP OID is required for SNMP health checks.')
    }
    validateSnmpOid(snmpOid)

    const id = createId('mon')
    db.prepare(`
      INSERT INTO deviceMonitors (
        id,
        deviceId,
        name,
        type,
        target,
        port,
        path,
        snmpVersion,
        snmpCommunity,
        snmpOid,
        snmpExpectedValue,
        intervalMs,
        enabled,
        sortOrder,
        lastCheckAt,
        lastResult,
        lastMessage
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
    `).run(
      id,
      deviceId,
      name,
      type,
      normalizedTarget,
      type === 'snmp' ? port ?? 161 : port ?? null,
      type === 'snmp' ? null : path ?? null,
      type === 'snmp' ? snmpVersion : null,
      type === 'snmp' ? snmpCommunity : null,
      type === 'snmp' ? snmpOid : null,
      type === 'snmp' ? snmpExpectedValue ?? null : null,
      intervalMs ?? null,
      enabled ? 1 : 0,
      nextSortOrder,
    )

    return listMonitors(deviceId).find((monitor) => monitor.id === id) ?? null
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const existing = db.prepare('SELECT * FROM deviceMonitors WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!existing) {
      return reply.status(404).send({ error: 'Device monitor not found.' })
    }

    const body = asObject(req.body)
    const current = existing
    const name = optionalString(body, 'name', { maxLength: 80 })
    const type = optionalEnum(body, 'type', MONITOR_TYPES)
    const target = optionalString(body, 'target', { maxLength: 200 })
    const path = optionalString(body, 'path', { maxLength: 200 })
    const port = optionalInteger(body, 'port', { min: 1, max: 65535 })
    const snmpVersion = optionalEnum(body, 'snmpVersion', SNMP_VERSIONS)
    const snmpCommunity = optionalString(body, 'snmpCommunity', { maxLength: 120 })
    const snmpOid = optionalString(body, 'snmpOid', { maxLength: 160 })
    const snmpExpectedValue = optionalString(body, 'snmpExpectedValue', { maxLength: 200 })
    const intervalMs = optionalInteger(body, 'intervalMs', { min: 1000, max: 1000 * 60 * 60 * 24 })
    const requestedEnabled = optionalBoolean(body, 'enabled')

    const nextType = (type ?? String(current.type)) as (typeof MONITOR_TYPES)[number]
    const nextTarget = target === undefined ? (current.target == null ? null : String(current.target)) : target
    const nextName = name === undefined ? (current.name ? String(current.name) : 'Primary') : (name ?? 'Primary')
    const nextPath = nextType === 'snmp'
      ? null
      : path === undefined
        ? (current.path == null ? null : String(current.path))
        : path
    const nextPort = port === undefined ? (current.port == null ? null : Number(current.port)) : port
    const nextSnmpVersion = nextType === 'snmp'
      ? snmpVersion === undefined
        ? (current.snmpVersion ? String(current.snmpVersion) as (typeof SNMP_VERSIONS)[number] : '2c')
        : snmpVersion ?? '2c'
      : null
    const nextSnmpCommunity = nextType === 'snmp'
      ? snmpCommunity === undefined
        ? (current.snmpCommunity == null ? 'public' : String(current.snmpCommunity))
        : snmpCommunity ?? 'public'
      : null
    const nextSnmpOid = nextType === 'snmp'
      ? snmpOid === undefined
        ? (current.snmpOid == null ? null : String(current.snmpOid))
        : snmpOid
      : null
    const nextSnmpExpectedValue = nextType === 'snmp'
      ? snmpExpectedValue === undefined
        ? (current.snmpExpectedValue == null ? null : String(current.snmpExpectedValue))
        : snmpExpectedValue
      : null
    const nextIntervalMs = intervalMs === undefined ? (current.intervalMs == null ? null : Number(current.intervalMs)) : intervalMs
    const nextEnabled = nextType === 'none'
      ? false
      : requestedEnabled === undefined
        ? Number(current.enabled ?? 0) === 1
        : Boolean(requestedEnabled)

    if (nextType !== 'none' && !nextTarget) {
      throw new ValidationError('Target is required when health checks are enabled.')
    }
    if (nextType === 'snmp' && !nextSnmpOid) {
      throw new ValidationError('SNMP OID is required for SNMP health checks.')
    }
    validateSnmpOid(nextSnmpOid)

    db.prepare(`
      UPDATE deviceMonitors
      SET
        name = ?,
        type = ?,
        target = ?,
        port = ?,
        path = ?,
        snmpVersion = ?,
        snmpCommunity = ?,
        snmpOid = ?,
        snmpExpectedValue = ?,
        intervalMs = ?,
        enabled = ?
      WHERE id = ?
    `).run(
      nextName,
      nextType,
      nextTarget,
      nextType === 'snmp' ? nextPort ?? 161 : nextPort ?? null,
      nextPath ?? null,
      nextSnmpVersion,
      nextSnmpCommunity,
      nextSnmpOid,
      nextSnmpExpectedValue,
      nextIntervalMs ?? null,
      nextEnabled ? 1 : 0,
      req.params.id,
    )
    reconcileDeviceMonitorRollup(String(current.deviceId))

    return listMonitors(String(current.deviceId)).find((monitor) => monitor.id === req.params.id) ?? null
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const existing = db.prepare('SELECT id, deviceId FROM deviceMonitors WHERE id = ?').get(req.params.id) as { id: string; deviceId: string } | undefined
    if (!existing) {
      return reply.status(404).send({ error: 'Device monitor not found.' })
    }

    db.prepare('DELETE FROM deviceMonitors WHERE id = ?').run(req.params.id)
    reconcileDeviceMonitorRollup(existing.deviceId)
    return reply.status(204).send()
  })

  app.post('/run', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const monitors = listMonitors().filter((monitor) => monitor.enabled && monitor.type !== 'none')
    const results = []
    for (const monitor of monitors) {
      const result = await runMonitorCheck(monitor.id)
      if (result) results.push(result)
    }
    return { results }
  })

  app.post<{ Params: { deviceId: string } }>('/run/:deviceId', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const results = await runDeviceChecks(req.params.deviceId)
    const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(req.params.deviceId)
    if (!device) {
      return reply.status(404).send({ error: 'Device not found.' })
    }
    return { results }
  })

  app.post<{ Params: { id: string } }>('/:id/run', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const result = await runMonitorCheck(req.params.id)
    if (!result) {
      return reply.status(404).send({ error: 'Device monitor not found.' })
    }
    return result
  })
}

function validateSnmpOid(value: string | null | undefined) {
  if (!value) return
  const parts = value.replace(/^\./, '').split('.')
  if (parts.length < 2 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new ValidationError('SNMP OID must be a dotted numeric object identifier.')
  }
  const [rootRaw, branchRaw] = parts
  const root = Number.parseInt(rootRaw, 10)
  const branch = Number.parseInt(branchRaw, 10)
  if (root < 0 || root > 2 || branch < 0 || (root < 2 && branch > 39)) {
    throw new ValidationError('SNMP OID root is invalid.')
  }
}

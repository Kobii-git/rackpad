import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { requireAuth } from '../lib/auth.js'
import {
  appendLabFilter,
  assertLabRead,
  assertLabWrite,
  assertLabWriteFromRow,
  resolveLabIdsForList,
} from '../lib/lab-access.js'
import { createId } from '../lib/ids.js'
import { listMonitors, MONITOR_TYPES, parseMonitor, reconcileDeviceMonitorRollup, runDeviceChecks, runMonitorCheck, SNMP_MATCH_MODES, SNMP_VERSIONS } from '../lib/monitoring.js'
import { discoverIfMibInterfaces, formatSnmpHighSpeedMbps, interfaceMonitorName } from '../lib/snmp-if-mib.js'
import { matchPortForInterface } from '../lib/snmp-match.js'
import { resolveSnmpSessionForTarget } from '../lib/snmp-session.js'
import { validateSnmpOid } from '../lib/snmp.js'
import {
  asObject,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalString,
  requiredString,
  ensureHostTarget,
  ValidationError,
} from '../lib/validation.js'

function getDeviceLabRow(deviceId: string) {
  return db.prepare('SELECT id, labId, managementIp, snmpCredentialId FROM devices WHERE id = ?').get(deviceId) as
    | { id: string; labId: string; managementIp?: string | null; snmpCredentialId?: string | null }
    | undefined
}

function getMonitorLabRow(monitorId: string) {
  return db.prepare(`
    SELECT deviceMonitors.id, devices.labId
    FROM deviceMonitors
    JOIN devices ON devices.id = deviceMonitors.deviceId
    WHERE deviceMonitors.id = ?
  `).get(monitorId) as { id: string; labId: string } | undefined
}

export const monitoringRoutes: FastifyPluginAsync = async (app) => {
  app.post('/snmp/discover-interfaces', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    const body = asObject(req.body)
    const { device, session: snmpSession } = resolveSnmpSession(body)
    if (!assertLabWrite(req, reply, device.labId)) return

    const interfaces = await discoverIfMibInterfaces(snmpSession)
    const devicePorts = db
      .prepare('SELECT id, name, snmpIfIndex FROM ports WHERE deviceId = ?')
      .all(device.id) as Array<{ id: string; name: string; snmpIfIndex?: number | null }>
    const enriched = interfaces.map((entry) => {
      const matchedPortId = matchPortForInterface(devicePorts, entry)
      const matchedPort = matchedPortId
        ? devicePorts.find((port) => port.id === matchedPortId)
        : null
      return {
        ...entry,
        matchedPortId,
        matchedPortName: matchedPort?.name ?? null,
      }
    })
    writeMonitorAudit(
      req.authUser!.username,
      'monitor.snmp.discover',
      device.id,
      `Discovered ${enriched.length} SNMP interface(s) on ${snmpSession.host}.`,
    )
    return {
      deviceId: device.id,
      target: snmpSession.host,
      interfaces: enriched,
    }
  })

  app.post('/snmp/import-interfaces', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    const body = asObject(req.body)
    const { device, session: snmpSession } = resolveSnmpSession(body)
    if (!assertLabWrite(req, reply, device.labId)) return

    const ifIndexes = parseIfIndexes(body)
    const skipExisting = optionalBoolean(body, 'skipExisting') ?? true
    const intervalMs = optionalInteger(body, 'intervalMs', { min: 60_000, max: 86_400_000 }) ?? 300_000
    const expectedOperStatus = optionalString(body, 'expectedOperStatus', { maxLength: 8 }) ?? '1'
    const snmpCredentialId =
      optionalString(body, 'snmpCredentialId', { maxLength: 80 }) ??
      device.snmpCredentialId ??
      null

    const discovered = await discoverIfMibInterfaces(snmpSession)
    const selected = ifIndexes?.length
      ? discovered.filter((entry) => ifIndexes.includes(entry.ifIndex))
      : discovered

    if (selected.length === 0) {
      return reply.status(400).send({ error: 'No SNMP interfaces matched the request.' })
    }

    const existingMonitors = listMonitors(device.id).filter((monitor) => monitor.type === 'snmp')
    const existingOids = new Set(existingMonitors.map((monitor) => monitor.snmpOid).filter(Boolean))
    const devicePorts = db
      .prepare('SELECT id, name, snmpIfIndex FROM ports WHERE deviceId = ?')
      .all(device.id) as Array<{ id: string; name: string; snmpIfIndex?: number | null }>

    const created: ReturnType<typeof parseMonitor>[] = []
    const skipped: number[] = []
    const linkedPorts: string[] = []

    const importMonitors = db.transaction(() => {
      for (const entry of selected) {
        if (skipExisting && existingOids.has(entry.operStatusOid)) {
          skipped.push(entry.ifIndex)
          continue
        }

        const matchedPortId = matchPortForInterface(devicePorts, entry)
        if (matchedPortId) {
          db.prepare('UPDATE ports SET snmpIfIndex = ? WHERE id = ?').run(entry.ifIndex, matchedPortId)
          const speedLabel =
            entry.highSpeedMbps != null
              ? formatSnmpHighSpeedMbps(entry.highSpeedMbps)
              : null
          if (speedLabel) {
            db.prepare(`
              UPDATE ports
              SET speed = ?
              WHERE id = ? AND (speed IS NULL OR TRIM(speed) = '')
            `).run(speedLabel, matchedPortId)
          }
          linkedPorts.push(matchedPortId)
        }

        const sortRow = db
          .prepare('SELECT COALESCE(MAX(sortOrder), -1) AS maxSortOrder FROM deviceMonitors WHERE deviceId = ?')
          .get(device.id) as { maxSortOrder: number }
        const id = createId('mon')
        db.prepare(`
          INSERT INTO deviceMonitors (
            id, deviceId, name, type, target, port, path,
            snmpVersion, snmpCommunity, snmpOid, snmpExpectedValue, snmpMatchMode,
            portId, snmpIfIndex, snmpCredentialId,
            intervalMs, enabled, sortOrder
          ) VALUES (?, ?, ?, 'snmp', ?, ?, NULL, ?, ?, ?, ?, 'equals', ?, ?, ?, ?, 1, ?)
        `).run(
          id,
          device.id,
          interfaceMonitorName(entry),
          snmpSession.host,
          snmpSession.port,
          snmpSession.version === '3' ? '3' : snmpSession.version,
          snmpSession.version === '3' ? null : snmpSession.community,
          entry.operStatusOid,
          expectedOperStatus,
          matchedPortId,
          entry.ifIndex,
          snmpCredentialId,
          intervalMs,
          Number(sortRow.maxSortOrder ?? -1) + 1,
        )
        const row = db.prepare('SELECT * FROM deviceMonitors WHERE id = ?').get(id) as Record<string, unknown>
        created.push(parseMonitor(row))
        existingOids.add(entry.operStatusOid)
      }
    })

    importMonitors()
    reconcileDeviceMonitorRollup(device.id)
    writeMonitorAudit(
      req.authUser!.username,
      'monitor.snmp.import',
      device.id,
      `Imported ${created.length} SNMP interface monitor(s) for ${device.id}.`,
    )

    return {
      created,
      skippedIfIndexes: skipped,
      createdCount: created.length,
      skippedCount: skipped.length,
      linkedPortIds: [...new Set(linkedPorts)],
    }
  })

  app.get('/', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const query = req.query as { deviceId?: string; labId?: string }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    if (query.deviceId) {
      const device = getDeviceLabRow(query.deviceId)
      if (!device) {
        return reply.status(404).send({ error: 'Device not found.' })
      }
      if (!assertLabRead(req, reply, device.labId)) return
      return listMonitors(query.deviceId)
    }

    let sql = `
      SELECT deviceMonitors.id
      FROM deviceMonitors
      JOIN devices ON devices.id = deviceMonitors.deviceId
      WHERE 1=1
    `
    const filtered = appendLabFilter(sql, [], filter.labIds, 'devices.labId')
    const rows = db.prepare(filtered.sql).all(...filtered.params) as Array<{ id: string }>
    const allowedIds = new Set(rows.map((row) => row.id))
    return listMonitors().filter((monitor) => allowedIds.has(monitor.id))
  })

  app.post('/', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const body = asObject(req.body)
    const deviceId = requiredString(body, 'deviceId', { maxLength: 80 })
    const device = getDeviceLabRow(deviceId)
    if (!device) {
      return reply.status(404).send({ error: 'Device not found.' })
    }
    if (!assertLabWrite(req, reply, device.labId)) return

    const existingCountRow = db.prepare('SELECT COUNT(*) as count, COALESCE(MAX(sortOrder), -1) as maxSortOrder FROM deviceMonitors WHERE deviceId = ?').get(deviceId) as {
      count: number
      maxSortOrder: number
    }
    const nextSortOrder = Number(existingCountRow.maxSortOrder ?? -1) + 1
    const defaultName = existingCountRow.count === 0 ? 'Management' : `Target ${existingCountRow.count + 1}`
    const name = optionalString(body, 'name', { maxLength: 80 }) ?? defaultName
    const type = optionalEnum(body, 'type', MONITOR_TYPES) ?? 'none'
    const targetInput = optionalString(body, 'target', { maxLength: 200 })
    const target = targetInput == null ? targetInput : ensureHostTarget(targetInput, 'target')
    const path = optionalString(body, 'path', { maxLength: 200 })
    const port = optionalInteger(body, 'port', { min: 1, max: 65535 })
    const snmpVersion = optionalEnum(body, 'snmpVersion', SNMP_VERSIONS) ?? '2c'
    const snmpCommunity = optionalString(body, 'snmpCommunity', { maxLength: 120 }) ?? 'public'
    const snmpOid = optionalString(body, 'snmpOid', { maxLength: 160 })
    const snmpExpectedValue = optionalString(body, 'snmpExpectedValue', { maxLength: 200 })
    const snmpMatchMode = optionalEnum(body, 'snmpMatchMode', SNMP_MATCH_MODES) ?? 'equals'
    const linkedPortId = optionalString(body, 'portId', { maxLength: 80 })
    const snmpIfIndex = optionalInteger(body, 'snmpIfIndex', { min: 0, max: 1_000_000 })
    const snmpCredentialId =
      optionalString(body, 'snmpCredentialId', { maxLength: 80 }) ?? device.snmpCredentialId ?? null
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
    const validatedPortId = validateMonitorPortId(deviceId, linkedPortId)
    const validatedCredentialId = validateMonitorCredentialId(device.labId, snmpCredentialId)

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
        snmpMatchMode,
        portId,
        snmpIfIndex,
        snmpCredentialId,
        intervalMs,
        enabled,
        sortOrder,
        lastCheckAt,
        lastResult,
        lastMessage
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
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
      type === 'snmp' ? snmpMatchMode : 'equals',
      type === 'snmp' ? validatedPortId : null,
      type === 'snmp' ? snmpIfIndex ?? null : null,
      type === 'snmp' ? validatedCredentialId : null,
      intervalMs ?? null,
      enabled ? 1 : 0,
      nextSortOrder,
    )

    return listMonitors(deviceId).find((monitor) => monitor.id === id) ?? null
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    const existing = db.prepare('SELECT * FROM deviceMonitors WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!existing) {
      return reply.status(404).send({ error: 'Device monitor not found.' })
    }
    const monitorLab = getMonitorLabRow(req.params.id)
    if (!assertLabWriteFromRow(req, reply, monitorLab)) return

    const body = asObject(req.body)
    const current = existing
    const name = optionalString(body, 'name', { maxLength: 80 })
    const type = optionalEnum(body, 'type', MONITOR_TYPES)
    const targetInput = optionalString(body, 'target', { maxLength: 200 })
    const target = targetInput == null ? targetInput : ensureHostTarget(targetInput, 'target')
    const path = optionalString(body, 'path', { maxLength: 200 })
    const port = optionalInteger(body, 'port', { min: 1, max: 65535 })
    const snmpVersion = optionalEnum(body, 'snmpVersion', SNMP_VERSIONS)
    const snmpCommunity = optionalString(body, 'snmpCommunity', { maxLength: 120 })
    const snmpOid = optionalString(body, 'snmpOid', { maxLength: 160 })
    const snmpExpectedValue = optionalString(body, 'snmpExpectedValue', { maxLength: 200 })
    const snmpMatchMode = optionalEnum(body, 'snmpMatchMode', SNMP_MATCH_MODES)
    const linkedPortId = optionalString(body, 'portId', { maxLength: 80 })
    const snmpIfIndex = optionalInteger(body, 'snmpIfIndex', { min: 0, max: 1_000_000 })
    const snmpCredentialId = optionalString(body, 'snmpCredentialId', { maxLength: 80 })
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
    const nextSnmpMatchMode = nextType === 'snmp'
      ? snmpMatchMode === undefined
        ? (current.snmpMatchMode ? String(current.snmpMatchMode) as (typeof SNMP_MATCH_MODES)[number] : 'equals')
        : snmpMatchMode ?? 'equals'
      : 'equals'
    const nextLinkedPortId = nextType === 'snmp'
      ? linkedPortId === undefined
        ? (current.portId == null ? null : String(current.portId))
        : validateMonitorPortId(String(current.deviceId), linkedPortId)
      : null
    const nextSnmpIfIndex = nextType === 'snmp'
      ? snmpIfIndex === undefined
        ? (current.snmpIfIndex == null ? null : Number(current.snmpIfIndex))
        : snmpIfIndex
      : null
    const monitorLabId = getMonitorLabRow(req.params.id)?.labId
    const nextSnmpCredentialId = nextType === 'snmp'
      ? snmpCredentialId === undefined
        ? (current.snmpCredentialId == null ? null : String(current.snmpCredentialId))
        : validateMonitorCredentialId(monitorLabId ?? '', snmpCredentialId)
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
        snmpMatchMode = ?,
        portId = ?,
        snmpIfIndex = ?,
        snmpCredentialId = ?,
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
      nextSnmpMatchMode,
      nextLinkedPortId,
      nextSnmpIfIndex,
      nextSnmpCredentialId,
      nextIntervalMs ?? null,
      nextEnabled ? 1 : 0,
      req.params.id,
    )
    reconcileDeviceMonitorRollup(String(current.deviceId))

    return listMonitors(String(current.deviceId)).find((monitor) => monitor.id === req.params.id) ?? null
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    const existing = db.prepare('SELECT id, deviceId FROM deviceMonitors WHERE id = ?').get(req.params.id) as { id: string; deviceId: string } | undefined
    if (!existing) {
      return reply.status(404).send({ error: 'Device monitor not found.' })
    }
    const monitorLab = getMonitorLabRow(req.params.id)
    if (!assertLabWriteFromRow(req, reply, monitorLab)) return

    db.prepare('DELETE FROM deviceMonitors WHERE id = ?').run(req.params.id)
    reconcileDeviceMonitorRollup(existing.deviceId)
    return reply.status(204).send()
  })

  app.post('/run', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [])
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    let sql = `
      SELECT deviceMonitors.id
      FROM deviceMonitors
      JOIN devices ON devices.id = deviceMonitors.deviceId
      WHERE 1=1
    `
    const filtered = appendLabFilter(sql, [], filter.labIds, 'devices.labId')
    const rows = db.prepare(filtered.sql).all(...filtered.params) as Array<{ id: string }>
    const allowedIds = new Set(rows.map((row) => row.id))
    const monitors = listMonitors().filter((monitor) => monitor.enabled && monitor.type !== 'none' && allowedIds.has(monitor.id))
    const results: Awaited<ReturnType<typeof runMonitorCheck>>[] = []
    for (const monitor of monitors) {
      const result = await runMonitorCheck(monitor.id)
      if (result) results.push(result)
    }
    return { results }
  })

  app.post<{ Params: { deviceId: string } }>('/run/:deviceId', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const device = getDeviceLabRow(req.params.deviceId)
    if (!device) {
      return reply.status(404).send({ error: 'Device not found.' })
    }
    if (!assertLabWrite(req, reply, device.labId)) return
    const results = await runDeviceChecks(req.params.deviceId)
    return { results }
  })

  app.post<{ Params: { id: string } }>('/:id/run', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const monitorLab = getMonitorLabRow(req.params.id)
    if (!assertLabWriteFromRow(req, reply, monitorLab)) return
    const result = await runMonitorCheck(req.params.id)
    if (!result) {
      return reply.status(404).send({ error: 'Device monitor not found.' })
    }
    return result
  })
}

function parseIfIndexes(body: Record<string, unknown>) {
  if (!('ifIndexes' in body)) return undefined
  const raw = body.ifIndexes
  if (!Array.isArray(raw)) {
    throw new ValidationError('ifIndexes must be an array.')
  }
  if (raw.length > 512) {
    throw new ValidationError('ifIndexes is too large.')
  }
  return raw.map((value) => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new ValidationError('ifIndexes must contain non-negative integers.')
    }
    return parsed
  })
}

function resolveSnmpSession(body: Record<string, unknown>) {
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
  validateMonitorCredentialId(device.labId, snmpCredentialId)

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

  return { device, session }
}

function validateMonitorCredentialId(labId: string, credentialId: string | null | undefined) {
  if (!credentialId) return null
  const row = db
    .prepare('SELECT id FROM snmpCredentials WHERE id = ? AND labId = ?')
    .get(credentialId, labId) as { id: string } | undefined
  if (!row) {
    throw new ValidationError('SNMP credential must belong to the selected lab.')
  }
  return credentialId
}

function validateMonitorPortId(deviceId: string, portId: string | null | undefined) {
  if (!portId) return null
  const row = db
    .prepare('SELECT id FROM ports WHERE id = ? AND deviceId = ?')
    .get(portId, deviceId) as { id: string } | undefined
  if (!row) {
    throw new ValidationError('Port must belong to the selected device.')
  }
  return portId
}

function writeMonitorAudit(
  actor: string,
  action: string,
  entityId: string,
  summary: string,
) {
  db.prepare(`
    INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    createId('a'),
    new Date().toISOString(),
    actor,
    action,
    'Device',
    entityId,
    summary,
  )
}

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import {
  appendLabFilter,
  assertLabReadFromRow,
  assertLabWrite,
  assertLabWriteFromRow,
  resolveLabIdsForList,
} from '../lib/lab-access.js'
import { createId } from '../lib/ids.js'
import {
  asObject,
  optionalString,
  requiredEnum,
  requiredString,
} from '../lib/validation.js'

const SERVICE_TYPES = [
  'dhcp',
  'dns',
  'vpn',
  'ntp',
  'snmp',
  'syslog',
  'http',
  'https',
  'database',
  'app',
  'custom',
] as const

function parseService(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    deviceId: String(row.deviceId),
    name: String(row.name),
    serviceType: String(row.serviceType),
    ipAssignmentId: row.ipAssignmentId ? String(row.ipAssignmentId) : null,
    portId: row.portId ? String(row.portId) : null,
    vlanId: row.vlanId ? String(row.vlanId) : null,
    monitorId: row.monitorId ? String(row.monitorId) : null,
    url: row.url ? String(row.url) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

function getService(id: string) {
  return db.prepare('SELECT * FROM deviceServices WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
}

function getServiceLabRow(id: string) {
  return db.prepare(`
    SELECT deviceServices.id, devices.labId
    FROM deviceServices
    JOIN devices ON devices.id = deviceServices.deviceId
    WHERE deviceServices.id = ?
  `).get(id) as { id: string; labId: string } | undefined
}

function getDeviceLabRow(deviceId: string) {
  return db.prepare('SELECT id, labId FROM devices WHERE id = ?').get(deviceId) as
    | { id: string; labId: string }
    | undefined
}

export const deviceServicesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { deviceId?: string; labId?: string } }>('/', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    let sql = `
      SELECT deviceServices.*
      FROM deviceServices
      JOIN devices ON devices.id = deviceServices.deviceId
      WHERE 1=1
    `
    const params: unknown[] = []
    if (req.query.deviceId) {
      sql += ' AND deviceServices.deviceId = ?'
      params.push(req.query.deviceId)
    }
    const filtered = appendLabFilter(sql, params, filter.labIds, 'devices.labId')
    const rows = db.prepare(`${filtered.sql} ORDER BY deviceServices.deviceId, deviceServices.serviceType, deviceServices.name, deviceServices.id`).all(...filtered.params)
    return (rows as Record<string, unknown>[]).map(parseService)
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db.prepare(`
      SELECT deviceServices.*, devices.labId
      FROM deviceServices
      JOIN devices ON devices.id = deviceServices.deviceId
      WHERE deviceServices.id = ?
    `).get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabReadFromRow(req, reply, row)) return
    return parseService(row!)
  })

  app.post('/', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('svc')
    const deviceId = requiredString(body, 'deviceId', { maxLength: 80 })
    const device = getDeviceLabRow(deviceId)
    if (!device) return reply.status(404).send({ error: 'Device not found.' })
    if (!assertLabWrite(req, reply, device.labId)) return
    const name = requiredString(body, 'name', { maxLength: 120 })
    const serviceType = requiredEnum(body, 'serviceType', SERVICE_TYPES)
    const ipAssignmentId = optionalString(body, 'ipAssignmentId', { maxLength: 80 })
    const portId = optionalString(body, 'portId', { maxLength: 80 })
    const vlanId = optionalString(body, 'vlanId', { maxLength: 80 })
    const monitorId = optionalString(body, 'monitorId', { maxLength: 80 })
    const url = optionalString(body, 'url', { maxLength: 500 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO deviceServices
        (id, deviceId, name, serviceType, ipAssignmentId, portId, vlanId, monitorId, url, notes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      deviceId,
      name,
      serviceType,
      ipAssignmentId ?? null,
      portId ?? null,
      vlanId ?? null,
      monitorId ?? null,
      url ?? null,
      notes ?? null,
      now,
      now,
    )

    return reply.status(201).send(parseService(getService(id)!))
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = getServiceLabRow(req.params.id)
    if (!assertLabWriteFromRow(req, reply, existing)) return

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const stringFields = [
      ['deviceId', 80],
      ['name', 120],
      ['ipAssignmentId', 80],
      ['portId', 80],
      ['vlanId', 80],
      ['monitorId', 80],
      ['url', 500],
      ['notes', 2000],
    ] as const

    if ('serviceType' in body) {
      updates.push('serviceType = ?')
      values.push(requiredEnum(body, 'serviceType', SERVICE_TYPES))
    }

    for (const [key, maxLength] of stringFields) {
      const value = optionalString(body, key, { maxLength })
      if (value !== undefined) {
        if (key === 'name' && !value) {
          return reply.status(400).send({ error: 'name cannot be empty.' })
        }
        if (key === 'deviceId' && value) {
          const nextDevice = getDeviceLabRow(value)
          if (!nextDevice) return reply.status(404).send({ error: 'Device not found.' })
          if (!assertLabWrite(req, reply, nextDevice.labId)) return
        }
        updates.push(`${key} = ?`)
        values.push(value)
      }
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update.' })
    }

    updates.push('updatedAt = ?')
    values.push(new Date().toISOString(), req.params.id)
    db.prepare(`UPDATE deviceServices SET ${updates.join(', ')} WHERE id = ?`).run(...values)

    return parseService(getService(req.params.id)!)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = getServiceLabRow(req.params.id)
    if (!assertLabWriteFromRow(req, reply, existing)) return
    db.prepare('DELETE FROM deviceServices WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })
}

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
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

export const deviceServicesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { deviceId?: string } }>('/', async (req) => {
    const rows = req.query.deviceId
      ? db.prepare('SELECT * FROM deviceServices WHERE deviceId = ? ORDER BY serviceType, name, id').all(req.query.deviceId)
      : db.prepare('SELECT * FROM deviceServices ORDER BY deviceId, serviceType, name, id').all()
    return (rows as Record<string, unknown>[]).map(parseService)
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = getService(req.params.id)
    if (!row) return reply.status(404).send({ error: 'Device service not found.' })
    return parseService(row)
  })

  app.post('/', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('svc')
    const deviceId = requiredString(body, 'deviceId', { maxLength: 80 })
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
    if (!getService(req.params.id)) {
      return reply.status(404).send({ error: 'Device service not found.' })
    }

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
    if (!getService(req.params.id)) {
      return reply.status(404).send({ error: 'Device service not found.' })
    }
    db.prepare('DELETE FROM deviceServices WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })
}

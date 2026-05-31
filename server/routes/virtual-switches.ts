import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { createId } from '../lib/ids.js'
import { asObject, optionalBoolean, optionalEnum, optionalString, requiredString, ValidationError } from '../lib/validation.js'

const VIRTUAL_SWITCH_KINDS = ['external', 'internal', 'private'] as const

type DeviceContext = {
  id: string
  labId: string
  hostname: string
  deviceType: string
  placement: string | null
  parentDeviceId: string | null
}

function parseVirtualSwitch(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    hostDeviceId: String(row.hostDeviceId),
    name: String(row.name),
    kind: row.kind ? String(row.kind) : 'external',
    membersShareHostIp: Boolean(row.membersShareHostIp),
    notes: row.notes ? String(row.notes) : null,
  }
}

function getDeviceContext(deviceId: string) {
  return db.prepare(`
    SELECT id, labId, hostname, deviceType, placement, parentDeviceId
    FROM devices
    WHERE id = ?
  `).get(deviceId) as DeviceContext | undefined
}

function getVirtualSwitchRow(id: string) {
  return db.prepare('SELECT * FROM virtualSwitches WHERE id = ?').get(id) as Record<string, unknown> | undefined
}

function requireHostDevice(deviceId: string) {
  const device = getDeviceContext(deviceId)
  if (!device) {
    throw new ValidationError('Selected host device does not exist.')
  }
  if (device.deviceType === 'vm' || device.deviceType === 'container' || device.placement === 'virtual') {
    throw new ValidationError('Virtual switches must be attached to a physical host or parent device.')
  }
  return device
}

export function ensurePortVirtualSwitchMembership(portDeviceId: string, virtualSwitchId: string) {
  const virtualSwitch = getVirtualSwitchRow(virtualSwitchId)
  if (!virtualSwitch) {
    throw new ValidationError('Selected virtual switch does not exist.')
  }

  const portDevice = getDeviceContext(portDeviceId)
  if (!portDevice) {
    throw new ValidationError('Selected port device does not exist.')
  }

  const hostDeviceId = String(virtualSwitch.hostDeviceId)
  if (portDevice.id === hostDeviceId || portDevice.parentDeviceId === hostDeviceId) {
    return hostDeviceId
  }

  throw new ValidationError('Ports can only join a virtual switch on their host device or on VMs linked to that host.')
}

export const virtualSwitchesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string; hostDeviceId?: string } }>('/', async (req) => {
    let sql = `
      SELECT vs.*
      FROM virtualSwitches vs
      JOIN devices host ON host.id = vs.hostDeviceId
      WHERE 1 = 1
    `
    const params: unknown[] = []

    if (req.query.labId) {
      sql += ' AND host.labId = ?'
      params.push(req.query.labId)
    }

    if (req.query.hostDeviceId) {
      sql += ' AND vs.hostDeviceId = ?'
      params.push(req.query.hostDeviceId)
    }

    sql += ' ORDER BY host.hostname, vs.name, vs.id'

    return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(parseVirtualSwitch)
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = getVirtualSwitchRow(req.params.id)
    if (!row) {
      return reply.status(404).send({ error: 'Virtual switch not found.' })
    }
    return parseVirtualSwitch(row)
  })

  app.post('/', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('vsw')
    const hostDeviceId = requiredString(body, 'hostDeviceId', { maxLength: 80 })
    const name = requiredString(body, 'name', { maxLength: 120 })
    const kind = optionalEnum(body, 'kind', VIRTUAL_SWITCH_KINDS) ?? 'external'
    const membersShareHostIp = optionalBoolean(body, 'membersShareHostIp') ?? false
    const notes = optionalString(body, 'notes', { maxLength: 2000 })

    requireHostDevice(hostDeviceId)

    db.prepare(`
      INSERT INTO virtualSwitches (id, hostDeviceId, name, kind, membersShareHostIp, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, hostDeviceId, name, kind, membersShareHostIp ? 1 : 0, notes ?? null)

    return reply.status(201).send(parseVirtualSwitch(getVirtualSwitchRow(id)!))
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = getVirtualSwitchRow(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'Virtual switch not found.' })
    }

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const name = optionalString(body, 'name', { maxLength: 120 })
    const kind = optionalEnum(body, 'kind', VIRTUAL_SWITCH_KINDS)
    const membersShareHostIp = optionalBoolean(body, 'membersShareHostIp')
    const notes = optionalString(body, 'notes', { maxLength: 2000 })

    if (name !== undefined) {
      if (!name) {
        return reply.status(400).send({ error: 'name cannot be empty.' })
      }
      updates.push('name = ?')
      values.push(name)
    }

    if (kind !== undefined) {
      updates.push('kind = ?')
      values.push(kind ?? 'external')
    }

    if (membersShareHostIp !== undefined) {
      updates.push('membersShareHostIp = ?')
      values.push(membersShareHostIp ? 1 : 0)
    }

    if (notes !== undefined) {
      updates.push('notes = ?')
      values.push(notes)
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update.' })
    }

    values.push(req.params.id)
    db.prepare(`UPDATE virtualSwitches SET ${updates.join(', ')} WHERE id = ?`).run(...values)

    return parseVirtualSwitch(getVirtualSwitchRow(req.params.id)!)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = getVirtualSwitchRow(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'Virtual switch not found.' })
    }

    db.prepare('DELETE FROM virtualSwitches WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })
}

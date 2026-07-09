import type { FastifyPluginAsync } from 'fastify'
import { db, parseRow } from '../db.js'
import {
  appendLabFilter,
  assertGlobalAdmin,
  assertLabReadFromRow,
  assertLabWrite,
  assertLabWriteFromRow,
  resolveLabIdsForList,
} from '../lib/lab-access.js'
import { BUILT_IN_PORT_TEMPLATES, listPortTemplates } from '../lib/port-templates.js'
import { ensurePortVirtualSwitchMembership } from './virtual-switches.js'
import { requiredDeviceType } from '../lib/device-types.js'
import { createId } from '../lib/ids.js'
import {
  asObject,
  optionalEnum,
  optionalInteger,
  optionalString,
  optionalStringArray,
  requiredEnum,
  requiredString,
  ValidationError,
} from '../lib/validation.js'

const PORT_KINDS = ['rj45', 'sfp', 'sfp_plus', 'qsfp', 'fiber', 'power', 'console', 'usb', 'virtual', 'wifi'] as const
const LINK_STATES = ['up', 'down', 'disabled', 'unknown'] as const
const PORT_FACES = ['front', 'rear'] as const
const PORT_MODES = ['access', 'trunk'] as const

function normalizeMacAddress(value: string | null | undefined) {
  const raw = value?.trim()
  if (!raw) return null
  const compact = raw.replace(/[^a-fA-F0-9]/g, '').toLowerCase()
  if (compact.length !== 12) {
    throw new ValidationError('MAC address must contain 12 hexadecimal characters.')
  }
  return compact.match(/.{2}/g)?.join(':') ?? null
}

function parseTemplatePorts(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('ports must be a non-empty array.')
  }

  return value.map((entry, index) => {
    const port = asObject(entry)
    const name = requiredString(port, 'name', { maxLength: 120 })
    const kind = requiredEnum(port, 'kind', PORT_KINDS)
    const speed = optionalString(port, 'speed', { maxLength: 20 })
    const mode = optionalEnum(port, 'mode', PORT_MODES) ?? 'access'
    const allowedVlanIds = normalizeAllowedVlanIds(optionalStringArray(port, 'allowedVlanIds', { maxItems: 128 }))
    const face = optionalEnum(port, 'face', PORT_FACES) ?? 'front'

    return {
      name,
      position: index + 1,
      kind,
      speed: speed ?? undefined,
      mode,
      allowedVlanIds: mode === 'trunk' ? allowedVlanIds ?? [] : [],
      face,
    }
  })
}

function parsePortRow(row: Record<string, unknown>) {
  return parseRow(row, ['allowedVlanIds']) as Record<string, unknown>
}

function normalizeAllowedVlanIds(value: string[] | null | undefined) {
  if (!value) return null
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]
}

function parseTemplateDeviceTypes(body: Record<string, unknown>) {
  const deviceTypes = optionalStringArray(body, 'deviceTypes', { maxItems: 64 })
  if (!deviceTypes || deviceTypes.length === 0) {
    throw new ValidationError('deviceTypes must contain at least one device type.')
  }
  return [...new Set(deviceTypes.map((deviceType) => requiredDeviceType({ deviceType })))]
}

function getDeviceLabRow(deviceId: string) {
  return db.prepare('SELECT id, labId FROM devices WHERE id = ?').get(deviceId) as
    | { id: string; labId: string }
    | undefined
}

function getVlanLabRow(vlanId: string) {
  return db.prepare('SELECT id, labId FROM vlans WHERE id = ?').get(vlanId) as
    | { id: string; labId: string }
    | undefined
}

function normalizePortVlanId(labId: string, vlanId: string | null | undefined, label = 'Selected VLAN') {
  if (!vlanId) return null
  const vlan = getVlanLabRow(vlanId)
  if (!vlan) throw new ValidationError(`${label} does not exist.`)
  if (vlan.labId !== labId) throw new ValidationError(`${label} must belong to the same lab.`)
  return vlan.id
}

function ensureAllowedVlanIdsBelongToLab(labId: string, vlanIds: string[] | null | undefined) {
  if (!vlanIds) return null
  return vlanIds.map((vlanId) => normalizePortVlanId(labId, vlanId, `Allowed VLAN ${vlanId}`))
}

function getPortLabRow(portId: string) {
  return db.prepare(`
    SELECT ports.id, devices.labId, ports.portRole, ports.aggregatePortId
    FROM ports
    JOIN devices ON devices.id = ports.deviceId
    WHERE ports.id = ?
  `).get(portId) as
    | { id: string; labId: string; portRole: string | null; aggregatePortId: string | null }
    | undefined
}

export const portsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/templates', async () => {
    return listPortTemplates()
  })

  app.post('/templates', async (req, reply) => {
    if (!assertGlobalAdmin(req, reply)) return
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('pt')
    const name = requiredString(body, 'name', { maxLength: 120 })
    const description = requiredString(body, 'description', { maxLength: 500 })
    const deviceTypes = parseTemplateDeviceTypes(body)

    const ports = parseTemplatePorts(body.ports)
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO portTemplates (id, name, description, deviceTypes, ports, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description, JSON.stringify(deviceTypes), JSON.stringify(ports), now, now)

    return reply.status(201).send(listPortTemplates().find((template) => template.id === id) ?? null)
  })

  app.patch<{ Params: { id: string } }>('/templates/:id', async (req, reply) => {
    if (!assertGlobalAdmin(req, reply)) return
    if (BUILT_IN_PORT_TEMPLATES.some((template) => template.id === req.params.id)) {
      return reply.status(403).send({ error: 'Built-in templates cannot be modified.' })
    }

    const existing = db.prepare('SELECT id FROM portTemplates WHERE id = ?').get(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'Port template not found.' })
    }

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const name = optionalString(body, 'name', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const deviceTypes = 'deviceTypes' in body ? parseTemplateDeviceTypes(body) : undefined

    if (name !== undefined) {
      if (!name) return reply.status(400).send({ error: 'name cannot be empty.' })
      updates.push('name = ?')
      values.push(name)
    }
    if (description !== undefined) {
      if (!description) return reply.status(400).send({ error: 'description cannot be empty.' })
      updates.push('description = ?')
      values.push(description)
    }
    if (deviceTypes !== undefined) {
      updates.push('deviceTypes = ?')
      values.push(JSON.stringify(deviceTypes))
    }
    if ('ports' in body) {
      const ports = parseTemplatePorts(body.ports)
      updates.push('ports = ?')
      values.push(JSON.stringify(ports))
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update' })
    }

    updates.push('updatedAt = ?')
    values.push(new Date().toISOString(), req.params.id)
    db.prepare(`UPDATE portTemplates SET ${updates.join(', ')} WHERE id = ?`).run(...values)

    return listPortTemplates().find((template) => template.id === req.params.id) ?? null
  })

  app.delete<{ Params: { id: string } }>('/templates/:id', async (req, reply) => {
    if (!assertGlobalAdmin(req, reply)) return
    if (BUILT_IN_PORT_TEMPLATES.some((template) => template.id === req.params.id)) {
      return reply.status(403).send({ error: 'Built-in templates cannot be deleted.' })
    }

    const existing = db.prepare('SELECT id FROM portTemplates WHERE id = ?').get(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'Port template not found.' })
    }

    db.prepare('DELETE FROM portTemplates WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })

  app.get<{ Querystring: { deviceId?: string; labId?: string } }>('/', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    let sql = `
      SELECT ports.*
      FROM ports
      JOIN devices ON devices.id = ports.deviceId
      WHERE 1=1
    `
    const params: unknown[] = []
    if (req.query.deviceId) {
      sql += ' AND ports.deviceId = ?'
      params.push(req.query.deviceId)
    }
    const filtered = appendLabFilter(sql, params, filter.labIds, 'devices.labId')
    const rows = db.prepare(`${filtered.sql} ORDER BY ports.deviceId, ports.position`).all(...filtered.params) as Record<string, unknown>[]
    return rows.map(parsePortRow)
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db.prepare(`
      SELECT ports.*, devices.labId
      FROM ports
      JOIN devices ON devices.id = ports.deviceId
      WHERE ports.id = ?
    `).get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabReadFromRow(req, reply, row)) return
    return parsePortRow(row!)
  })

  app.post('/', async (req, reply) => {
    const body = asObject(req.body)
    const deviceId = requiredString(body, 'deviceId', { maxLength: 80 })
    const name = requiredString(body, 'name', { maxLength: 120 })
    const kind = requiredEnum(body, 'kind', PORT_KINDS)
    const speed = optionalString(body, 'speed', { maxLength: 20 })
    const linkState = optionalEnum(body, 'linkState', LINK_STATES) ?? 'down'
    const mode = optionalEnum(body, 'mode', PORT_MODES) ?? 'access'
    const vlanId = optionalString(body, 'vlanId', { maxLength: 80 })
    const virtualSwitchId = optionalString(body, 'virtualSwitchId', { maxLength: 80 })
    const allowedVlanIds = normalizeAllowedVlanIds(optionalStringArray(body, 'allowedVlanIds', { maxItems: 128 }))
    const description = optionalString(body, 'description', { maxLength: 500 })
    const face = optionalEnum(body, 'face', PORT_FACES) ?? 'front'
    const requestedPosition = optionalInteger(body, 'position', { min: 1, max: 500 })
    const macAddress = normalizeMacAddress(optionalString(body, 'macAddress', { maxLength: 32 }))

    const device = getDeviceLabRow(deviceId)
    if (!device) {
      return reply.status(404).send({ error: 'Device not found.' })
    }
    if (!assertLabWrite(req, reply, device.labId)) return
    if (virtualSwitchId) {
      ensurePortVirtualSwitchMembership(deviceId, virtualSwitchId)
    }
    const normalizedVlanId = normalizePortVlanId(device.labId, vlanId)
    const normalizedAllowedVlanIds =
      mode === 'trunk' ? ensureAllowedVlanIdsBelongToLab(device.labId, allowedVlanIds) : null

    const row = db.prepare('SELECT MAX(position) AS maxPosition FROM ports WHERE deviceId = ?').get(deviceId) as { maxPosition?: number | null }
    const position = requestedPosition ?? ((row.maxPosition ?? 0) + 1)
    const id = createId('p')

    db.prepare(`
      INSERT INTO ports (id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face, virtualSwitchId, macAddress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      deviceId,
      name,
      position,
      kind,
      speed ?? null,
      linkState,
      mode,
      normalizedVlanId,
      mode === 'trunk' && normalizedAllowedVlanIds ? JSON.stringify(normalizedAllowedVlanIds) : null,
      description ?? null,
      face,
      virtualSwitchId ?? null,
      macAddress,
    )

    const created = db.prepare('SELECT * FROM ports WHERE id = ?').get(id) as Record<string, unknown>
    return reply.status(201).send(parsePortRow(created))
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = db.prepare(`
      SELECT ports.*, devices.labId
      FROM ports
      JOIN devices ON devices.id = ports.deviceId
      WHERE ports.id = ?
    `).get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, existing)) return
    const current = parsePortRow(existing!) as Record<string, unknown>

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const name = optionalString(body, 'name', { maxLength: 120 })
    const speed = optionalString(body, 'speed', { maxLength: 20 })
    const vlanId = optionalString(body, 'vlanId', { maxLength: 80 })
    const virtualSwitchId = optionalString(body, 'virtualSwitchId', { maxLength: 80 })
    const hasAllowedVlanIds = 'allowedVlanIds' in body
    const allowedVlanIds = normalizeAllowedVlanIds(optionalStringArray(body, 'allowedVlanIds', { maxItems: 128 }))
    const description = optionalString(body, 'description', { maxLength: 500 })
    const nextMode = 'mode' in body
      ? requiredEnum(body, 'mode', PORT_MODES)
      : (String(current.mode ?? 'access') as (typeof PORT_MODES)[number])

    if (virtualSwitchId) {
      ensurePortVirtualSwitchMembership(String(current.deviceId), virtualSwitchId)
    }
    const labId = String(current.labId)
    const normalizedVlanId =
      vlanId !== undefined ? normalizePortVlanId(labId, vlanId) : undefined
    const currentAllowedVlanIds = Array.isArray(current.allowedVlanIds)
      ? current.allowedVlanIds.map((entry) => String(entry))
      : []
    const nextAllowedVlanIds =
      ('mode' in body || hasAllowedVlanIds) && nextMode === 'trunk'
        ? ensureAllowedVlanIdsBelongToLab(
            labId,
            (hasAllowedVlanIds ? allowedVlanIds : null) ?? currentAllowedVlanIds,
          )
        : null

    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (speed !== undefined) { updates.push('speed = ?'); values.push(speed) }
    if (vlanId !== undefined) { updates.push('vlanId = ?'); values.push(normalizedVlanId) }
    if (virtualSwitchId !== undefined) { updates.push('virtualSwitchId = ?'); values.push(virtualSwitchId) }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }
    if ('macAddress' in body) {
      updates.push('macAddress = ?')
      values.push(normalizeMacAddress(optionalString(body, 'macAddress', { maxLength: 32 })))
    }

    if ('kind' in body) { updates.push('kind = ?'); values.push(requiredEnum(body, 'kind', PORT_KINDS)) }
    if ('linkState' in body) { updates.push('linkState = ?'); values.push(requiredEnum(body, 'linkState', LINK_STATES)) }
    if ('face' in body) { updates.push('face = ?'); values.push(requiredEnum(body, 'face', PORT_FACES)) }
    if ('mode' in body) { updates.push('mode = ?'); values.push(nextMode) }
    if ('mode' in body || hasAllowedVlanIds) {
      const persistedAllowed =
        nextMode === 'trunk'
          ? JSON.stringify(nextAllowedVlanIds ?? [])
          : null
      updates.push('allowedVlanIds = ?')
      values.push(persistedAllowed)
    }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields to update' })

    values.push(req.params.id)
    db.prepare(`UPDATE ports SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const updated = db.prepare('SELECT * FROM ports WHERE id = ?').get(req.params.id) as Record<string, unknown>
    return parsePortRow(updated)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const port = getPortLabRow(req.params.id)
    if (!assertLabWriteFromRow(req, reply, port)) return

    if (port?.portRole === 'aggregate') {
      return reply.status(409).send({ error: 'Use the aggregate delete flow to remove this bond.' })
    }
    if (port?.aggregatePortId) {
      return reply.status(409).send({ error: 'Remove or delete the bond before deleting member ports.' })
    }

    const peers = db.prepare(`
      SELECT CASE WHEN fromPortId = ? THEN toPortId ELSE fromPortId END AS peerPortId
      FROM portLinks
      WHERE fromPortId = ? OR toPortId = ?
    `).all(req.params.id, req.params.id, req.params.id) as Array<{ peerPortId: string }>

    const removePort = db.transaction(() => {
      db.prepare('DELETE FROM ports WHERE id = ?').run(req.params.id)
      for (const peer of peers) {
        db.prepare("UPDATE ports SET linkState = 'down' WHERE id = ?").run(peer.peerPortId)
      }
    })

    removePort()
    return reply.status(204).send()
  })
}

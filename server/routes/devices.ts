import type { FastifyPluginAsync } from 'fastify'
import { db, parseRow } from '../db.js'
import { requiredDeviceType } from '../lib/device-types.js'
import { createId } from '../lib/ids.js'
import {
  createPortsFromTemplate,
  getPortTemplate,
} from '../lib/port-templates.js'
import { validateRackPlacement } from '../lib/rack-placement.js'
import {
  asObject,
  ensureIpv4,
  ensureIsoDate,
  optionalEnum,
  optionalInteger,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requiredEnum,
  requiredString,
  ValidationError,
} from '../lib/validation.js'

const DEVICE_STATUSES = [
  'online',
  'offline',
  'warning',
  'unknown',
  'maintenance',
] as const
const DEVICE_PLACEMENTS = [
  'rack',
  'room',
  'wireless',
  'virtual',
  'shelf',
] as const
const DEVICE_FACES = ['front', 'rear'] as const
const JSON_COLS = ['tags'] as const

function parseDevice(row: Record<string, unknown>) {
  return parseRow(row, [...JSON_COLS])
}

function derivePlacement(input: {
  deviceType: string
  placement?: (typeof DEVICE_PLACEMENTS)[number] | null
  rackId?: string | null
  startU?: number | null
  heightU?: number | null
}) {
  if (input.placement) return input.placement
  if (input.rackId || input.startU != null || input.heightU != null)
    return 'rack'
  if (input.deviceType === 'vm') return 'virtual'
  if (input.deviceType === 'ap') return 'wireless'
  if (input.deviceType === 'rack_shelf') return 'rack'
  return 'room'
}

type ParentDeviceRow = {
  id: string
  labId: string
  hostname: string
  deviceType: string
  rackId: string | null
  face: (typeof DEVICE_FACES)[number] | null
}

function normalizePlacement(input: {
  deviceId?: string
  deviceType: string
  placement?: (typeof DEVICE_PLACEMENTS)[number] | null
  rackId?: string | null
  startU?: number | null
  heightU?: number | null
  face?: (typeof DEVICE_FACES)[number] | null
  parentDevice?: ParentDeviceRow | null
}) {
  const placement = derivePlacement(input)

  if (placement === 'shelf') {
    const parent = input.parentDevice
    if (!parent) {
      throw new ValidationError(
        'A rack shelf / tray must be selected for shelf-mounted gear.',
      )
    }
    if (parent.deviceType !== 'rack_shelf') {
      throw new ValidationError(
        'Shelf-mounted gear can only be attached to a rack shelf / tray.',
      )
    }
    if (!parent.rackId) {
      throw new ValidationError(
        'Selected rack shelf / tray is not mounted in a rack.',
      )
    }

    return {
      placement,
      rackId: parent.rackId,
      startU: null,
      heightU: null,
      face: parent.face ?? null,
    }
  }

  if (placement !== 'rack') {
    return {
      placement,
      rackId: null,
      startU: null,
      heightU: null,
      face: null,
    }
  }

  const resolved = validateRackPlacement({
    deviceId: input.deviceId,
    rackId: input.rackId ?? null,
    startU: input.startU ?? null,
    heightU: input.heightU ?? null,
    face: input.face ?? null,
  })

  return {
    placement,
    rackId: resolved.rackId,
    startU: resolved.startU,
    heightU: resolved.heightU,
    face: resolved.face,
  }
}

function resolveParentDevice(
  parentDeviceId: string | null | undefined,
  labId: string,
  deviceId?: string,
) {
  if (!parentDeviceId) return null
  if (deviceId && parentDeviceId === deviceId) {
    throw new ValidationError('A device cannot be its own parent.')
  }

  const parent = db
    .prepare(
      'SELECT id, labId, hostname, deviceType, rackId, face FROM devices WHERE id = ?',
    )
    .get(parentDeviceId) as ParentDeviceRow | undefined

  if (!parent) {
    throw new ValidationError('Selected parent device does not exist.')
  }
  if (parent.labId !== labId) {
    throw new ValidationError('Parent device must belong to the same lab.')
  }

  return parent
}

function validateRoom(roomId: string | null | undefined, labId: string) {
  if (!roomId) return null
  const room = db
    .prepare('SELECT labId FROM rooms WHERE id = ?')
    .get(roomId) as { labId: string } | undefined
  if (!room) {
    throw new ValidationError('Selected room does not exist.')
  }
  if (room.labId !== labId) {
    throw new ValidationError('Selected room must belong to the same lab.')
  }
  return roomId
}

function normalizeMacAddress(value: string | null | undefined) {
  const raw = value?.trim()
  if (!raw) return null
  const compact = raw.replace(/[^a-fA-F0-9]/g, '').toLowerCase()
  if (compact.length !== 12) {
    throw new ValidationError(
      'MAC address must contain 12 hexadecimal characters.',
    )
  }
  return compact.match(/.{2}/g)?.join(':') ?? null
}

export const devicesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { rackId?: string; labId?: string } }>(
    '/',
    async (req) => {
      let sql = 'SELECT * FROM devices WHERE 1=1'
      const params: unknown[] = []
      if (req.query.rackId) {
        sql += ' AND rackId = ?'
        params.push(req.query.rackId)
      }
      if (req.query.labId) {
        sql += ' AND labId = ?'
        params.push(req.query.labId)
      }
      sql += ' ORDER BY hostname'
      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
      return rows.map(parseDevice)
    },
  )

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db
      .prepare('SELECT * FROM devices WHERE id = ?')
      .get(req.params.id) as Record<string, unknown> | undefined
    if (!row) return reply.status(404).send({ error: 'Device not found' })
    return parseDevice(row)
  })

  app.post('/', async (req, reply) => {
    const body = asObject(req.body)
    const labId = requiredString(body, 'labId', { maxLength: 80 })
    const hostname = requiredString(body, 'hostname', { maxLength: 120 })
    const deviceType = requiredDeviceType(body)
    const displayName = optionalString(body, 'displayName', { maxLength: 120 })
    const manufacturer = optionalString(body, 'manufacturer', {
      maxLength: 120,
    })
    const model = optionalString(body, 'model', { maxLength: 120 })
    const serial = optionalString(body, 'serial', { maxLength: 120 })
    const managementIp = optionalString(body, 'managementIp', {
      maxLength: 60,
    })
    const macAddress = normalizeMacAddress(
      optionalString(body, 'macAddress', { maxLength: 32 }),
    )
    const status = optionalEnum(body, 'status', DEVICE_STATUSES) ?? 'unknown'
    const placement = optionalEnum(body, 'placement', DEVICE_PLACEMENTS)
    const parentDeviceId = optionalString(body, 'parentDeviceId', {
      maxLength: 80,
    })
    const roomId = validateRoom(
      optionalString(body, 'roomId', { maxLength: 80 }),
      labId,
    )
    const cpuCores = optionalInteger(body, 'cpuCores', { min: 1, max: 4096 })
    const memoryGb = optionalNumber(body, 'memoryGb', {
      min: 0.1,
      max: 1024 * 1024,
    })
    const storageGb = optionalNumber(body, 'storageGb', {
      min: 0,
      max: 1024 * 1024 * 10,
    })
    const specs = optionalString(body, 'specs', { maxLength: 4000 })
    const rackId = optionalString(body, 'rackId', { maxLength: 80 })
    const startU = optionalInteger(body, 'startU', { min: 1, max: 100 })
    const heightU = optionalInteger(body, 'heightU', { min: 1, max: 20 })
    const face = optionalEnum(body, 'face', DEVICE_FACES)
    const tags = optionalStringArray(body, 'tags', { maxItems: 30 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })
    const lastSeen = optionalString(body, 'lastSeen', { maxLength: 80 })
    const portTemplateId = optionalString(body, 'portTemplateId', {
      maxLength: 80,
    })

    if (managementIp) ensureIpv4(managementIp, 'managementIp')
    if (lastSeen) ensureIsoDate(lastSeen, 'lastSeen')

    const parentDevice = resolveParentDevice(parentDeviceId, labId)
    const normalizedPlacement = normalizePlacement({
      deviceType,
      placement,
      rackId,
      startU,
      heightU,
      face,
      parentDevice,
    })
    const normalizedParentDeviceId = parentDevice?.id ?? null

    const template = portTemplateId ? getPortTemplate(portTemplateId) : null
    if (portTemplateId && !template) {
      throw new ValidationError('Selected port template does not exist.')
    }

    const id = createId('d')
    const insertDevice = db.prepare(`
      INSERT INTO devices
        (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model,
         serial, managementIp, macAddress, status, placement, parentDeviceId, roomId, cpuCores, memoryGb, storageGb, specs,
         startU, heightU, face, tags, notes, lastSeen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const insertPort = db.prepare(`
      INSERT INTO ports (id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face, virtualSwitchId)
      VALUES (@id, @deviceId, @name, @position, @kind, @speed, @linkState, @mode, @vlanId, @allowedVlanIds, @description, @face, @virtualSwitchId)
    `)

    const createDevice = db.transaction(() => {
      insertDevice.run(
        id,
        labId,
        normalizedPlacement.rackId,
        hostname,
        displayName ?? null,
        deviceType,
        manufacturer ?? null,
        model ?? null,
        serial ?? null,
        managementIp ?? null,
        macAddress,
        status,
        normalizedPlacement.placement,
        normalizedParentDeviceId,
        roomId,
        cpuCores ?? null,
        memoryGb ?? null,
        storageGb ?? null,
        specs ?? null,
        normalizedPlacement.startU,
        normalizedPlacement.heightU,
        normalizedPlacement.face,
        tags ? JSON.stringify(tags) : null,
        notes ?? null,
        lastSeen ?? null,
      )

      for (const port of template
        ? createPortsFromTemplate(id, template.id)
        : []) {
        insertPort.run(port)
      }
    })

    createDevice()

    const row = db
      .prepare('SELECT * FROM devices WHERE id = ?')
      .get(id) as Record<string, unknown>
    return reply.status(201).send(parseDevice(row))
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = db
      .prepare('SELECT * FROM devices WHERE id = ?')
      .get(req.params.id) as Record<string, unknown> | undefined
    if (!existing) return reply.status(404).send({ error: 'Device not found' })

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const nextDeviceType =
      'deviceType' in body
        ? requiredDeviceType(body)
        : String(existing.deviceType)
    const rackId = optionalString(body, 'rackId', { maxLength: 80 })
    const startU = optionalInteger(body, 'startU', { min: 1, max: 100 })
    const heightU = optionalInteger(body, 'heightU', { min: 1, max: 20 })
    const face = optionalEnum(body, 'face', DEVICE_FACES)
    const placement = optionalEnum(body, 'placement', DEVICE_PLACEMENTS)
    const parentDeviceId = optionalString(body, 'parentDeviceId', {
      maxLength: 80,
    })
    const roomId = optionalString(body, 'roomId', { maxLength: 80 })

    if (
      rackId !== undefined ||
      startU !== undefined ||
      heightU !== undefined ||
      face !== undefined ||
      placement !== undefined ||
      parentDeviceId !== undefined ||
      'deviceType' in body
    ) {
      const parentDevice = resolveParentDevice(
        parentDeviceId === undefined
          ? existing.parentDeviceId
            ? String(existing.parentDeviceId)
            : null
          : parentDeviceId,
        String(existing.labId),
        req.params.id,
      )
      const normalizedPlacement = normalizePlacement({
        deviceId: req.params.id,
        deviceType: nextDeviceType,
        placement:
          placement === undefined
            ? existing.placement
              ? (String(
                  existing.placement,
                ) as (typeof DEVICE_PLACEMENTS)[number])
              : null
            : placement,
        rackId:
          rackId === undefined
            ? existing.rackId
              ? String(existing.rackId)
              : null
            : rackId,
        startU:
          startU === undefined
            ? existing.startU == null
              ? null
              : Number(existing.startU)
            : startU,
        heightU:
          heightU === undefined
            ? existing.heightU == null
              ? null
              : Number(existing.heightU)
            : heightU,
        face:
          face === undefined
            ? existing.face
              ? (String(existing.face) as (typeof DEVICE_FACES)[number])
              : null
            : face,
        parentDevice,
      })
      const normalizedParentDeviceId = parentDevice?.id ?? null

      updates.push(
        'placement = ?',
        'parentDeviceId = ?',
        'rackId = ?',
        'startU = ?',
        'heightU = ?',
        'face = ?',
      )
      values.push(
        normalizedPlacement.placement,
        normalizedParentDeviceId,
        normalizedPlacement.rackId,
        normalizedPlacement.startU,
        normalizedPlacement.heightU,
        normalizedPlacement.face,
      )
    }

    if (roomId !== undefined) {
      updates.push('roomId = ?')
      values.push(validateRoom(roomId, String(existing.labId)))
    }

    if ('macAddress' in body) {
      const macAddress = normalizeMacAddress(
        optionalString(body, 'macAddress', { maxLength: 32 }),
      )
      updates.push('macAddress = ?')
      values.push(macAddress)
    }

    const simpleStringKeys = [
      ['hostname', 120],
      ['displayName', 120],
      ['manufacturer', 120],
      ['model', 120],
      ['serial', 120],
      ['managementIp', 60],
      ['specs', 4000],
      ['notes', 2000],
      ['lastSeen', 80],
    ] as const

    for (const [key, maxLength] of simpleStringKeys) {
      const value = optionalString(body, key, { maxLength })
      if (value !== undefined) {
        if (key === 'managementIp' && value) ensureIpv4(value, key)
        if (key === 'lastSeen' && value) ensureIsoDate(value, key)
        updates.push(`${key} = ?`)
        values.push(value)
      }
    }

    if ('deviceType' in body) {
      updates.push('deviceType = ?')
      values.push(nextDeviceType)
    }

    if ('status' in body) {
      updates.push('status = ?')
      values.push(requiredEnum(body, 'status', DEVICE_STATUSES))
    }

    const cpuCores = optionalInteger(body, 'cpuCores', { min: 1, max: 4096 })
    if (cpuCores !== undefined) {
      updates.push('cpuCores = ?')
      values.push(cpuCores)
    }

    const memoryGb = optionalNumber(body, 'memoryGb', {
      min: 0.1,
      max: 1024 * 1024,
    })
    if (memoryGb !== undefined) {
      updates.push('memoryGb = ?')
      values.push(memoryGb)
    }

    const storageGb = optionalNumber(body, 'storageGb', {
      min: 0,
      max: 1024 * 1024 * 10,
    })
    if (storageGb !== undefined) {
      updates.push('storageGb = ?')
      values.push(storageGb)
    }

    const tags = optionalStringArray(body, 'tags', { maxItems: 30 })
    if (tags !== undefined) {
      updates.push('tags = ?')
      values.push(tags ? JSON.stringify(tags) : null)
    }

    const portTemplateId = optionalString(body, 'portTemplateId', {
      maxLength: 80,
    })
    if (portTemplateId) {
      const hasPorts = db
        .prepare('SELECT COUNT(*) AS count FROM ports WHERE deviceId = ?')
        .get(req.params.id) as { count: number }
      if (hasPorts.count > 0) {
        return reply.status(409).send({
          error:
            'This device already has ports. Port templates can only be applied to empty devices.',
        })
      }
      const template = getPortTemplate(portTemplateId)
      if (!template) {
        throw new ValidationError('Selected port template does not exist.')
      }
      const insertPort = db.prepare(`
        INSERT INTO ports (id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face, virtualSwitchId)
        VALUES (@id, @deviceId, @name, @position, @kind, @speed, @linkState, @mode, @vlanId, @allowedVlanIds, @description, @face, @virtualSwitchId)
      `)
      const applyPorts = db.transaction(() => {
        for (const port of createPortsFromTemplate(
          req.params.id,
          template.id,
        )) {
          insertPort.run(port)
        }
      })
      applyPorts()
    }

    if (updates.length > 0) {
      values.push(req.params.id)
      db.prepare(`UPDATE devices SET ${updates.join(', ')} WHERE id = ?`).run(
        ...values,
      )
    } else if (!portTemplateId) {
      return reply.status(400).send({ error: 'No valid fields to update' })
    }

    const row = db
      .prepare('SELECT * FROM devices WHERE id = ?')
      .get(req.params.id) as Record<string, unknown>
    return parseDevice(row)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db
      .prepare('SELECT id FROM devices WHERE id = ?')
      .get(req.params.id)
    if (!row) return reply.status(404).send({ error: 'Device not found' })

    const portIds = (
      db
        .prepare('SELECT id FROM ports WHERE deviceId = ?')
        .all(req.params.id) as Array<{ id: string }>
    ).map((port) => port.id)

    const deleteDevice = db.transaction(
      (deviceId: string, devicePortIds: string[]) => {
        if (devicePortIds.length > 0) {
          const placeholders = devicePortIds.map(() => '?').join(', ')
          db.prepare(
            `DELETE FROM ipAssignments WHERE deviceId = ? OR portId IN (${placeholders})`,
          ).run(deviceId, ...devicePortIds)
        } else {
          db.prepare('DELETE FROM ipAssignments WHERE deviceId = ?').run(
            deviceId,
          )
        }

        db.prepare('DELETE FROM devices WHERE id = ?').run(deviceId)
      },
    )

    deleteDevice(req.params.id, portIds)
    return reply.status(204).send()
  })
}

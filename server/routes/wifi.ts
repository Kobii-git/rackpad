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
  ensureIpv4,
  ensureIsoDate,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalString,
  optionalStringArray,
  requiredEnum,
  requiredString,
  ValidationError,
} from '../lib/validation.js'

const WIFI_BANDS = ['2.4ghz', '5ghz', '6ghz'] as const
const DEVICE_TYPES = [
  'switch',
  'router',
  'firewall',
  'server',
  'rack_shelf',
  'ap',
  'endpoint',
  'vm',
  'container',
  'patch_panel',
  'brush_panel',
  'blanking_panel',
  'storage',
  'pdu',
  'ups',
  'kvm',
  'other',
] as const
const DEVICE_PLACEMENTS = ['rack', 'room', 'wireless', 'virtual', 'shelf'] as const

function parseWifiController(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    labId: String(row.labId),
    deviceId: row.deviceId ? String(row.deviceId) : null,
    name: String(row.name),
    vendor: row.vendor ? String(row.vendor) : null,
    model: row.model ? String(row.model) : null,
    managementIp: row.managementIp ? String(row.managementIp) : null,
    notes: row.notes ? String(row.notes) : null,
  }
}

function parseWifiSsid(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    labId: String(row.labId),
    name: String(row.name),
    purpose: row.purpose ? String(row.purpose) : null,
    security: row.security ? String(row.security) : null,
    hidden: Number(row.hidden ?? 0) === 1,
    vlanId: row.vlanId ? String(row.vlanId) : null,
    color: row.color ? String(row.color) : null,
  }
}

function parseWifiAccessPoint(row: Record<string, unknown>) {
  return {
    deviceId: String(row.deviceId),
    controllerId: row.controllerId ? String(row.controllerId) : null,
    location: row.location ? String(row.location) : null,
    firmwareVersion: row.firmwareVersion ? String(row.firmwareVersion) : null,
    notes: row.notes ? String(row.notes) : null,
  }
}

function parseWifiRadio(row: Record<string, unknown>, ssidIds: string[]) {
  return {
    id: String(row.id),
    apDeviceId: String(row.apDeviceId),
    slotName: String(row.slotName),
    band: String(row.band),
    channel: String(row.channel),
    channelWidth: row.channelWidth ? String(row.channelWidth) : null,
    txPower: row.txPower ? String(row.txPower) : null,
    ssidIds,
    notes: row.notes ? String(row.notes) : null,
  }
}

function parseWifiClientAssociation(row: Record<string, unknown>) {
  return {
    clientDeviceId: String(row.clientDeviceId),
    apDeviceId: String(row.apDeviceId),
    radioId: row.radioId ? String(row.radioId) : null,
    ssidId: row.ssidId ? String(row.ssidId) : null,
    band: row.band ? String(row.band) : null,
    channel: row.channel ? String(row.channel) : null,
    signalDbm: row.signalDbm == null ? null : Number(row.signalDbm),
    lastSeen: row.lastSeen ? String(row.lastSeen) : null,
    lastRoamAt: row.lastRoamAt ? String(row.lastRoamAt) : null,
    notes: row.notes ? String(row.notes) : null,
  }
}

function loadRadioSsidMap(radioIds: string[]) {
  const map = new Map<string, string[]>()
  if (radioIds.length === 0) return map

  const placeholders = radioIds.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT radioId, ssidId
    FROM wifiRadioSsids
    WHERE radioId IN (${placeholders})
    ORDER BY radioId, ssidId
  `).all(...radioIds) as Array<{ radioId: string; ssidId: string }>

  for (const row of rows) {
    const bucket = map.get(row.radioId)
    if (bucket) {
      bucket.push(row.ssidId)
    } else {
      map.set(row.radioId, [row.ssidId])
    }
  }

  return map
}

function getLab(labId: string) {
  return db.prepare('SELECT id FROM labs WHERE id = ?').get(labId) as { id: string } | undefined
}

function getVlan(vlanId: string) {
  return db.prepare('SELECT id, labId FROM vlans WHERE id = ?').get(vlanId) as { id: string; labId: string } | undefined
}

function getController(controllerId: string) {
  return db.prepare('SELECT * FROM wifiControllers WHERE id = ?').get(controllerId) as Record<string, unknown> | undefined
}

function getSsid(ssidId: string) {
  return db.prepare('SELECT * FROM wifiSsids WHERE id = ?').get(ssidId) as Record<string, unknown> | undefined
}

function getDevice(deviceId: string) {
  return db.prepare(`
    SELECT id, labId, deviceType, placement, hostname
    FROM devices
    WHERE id = ?
  `).get(deviceId) as
    | {
        id: string
        labId: string
        deviceType: (typeof DEVICE_TYPES)[number]
        placement: (typeof DEVICE_PLACEMENTS)[number] | null
        hostname: string
      }
    | undefined
}

function getRadio(radioId: string) {
  return db.prepare('SELECT * FROM wifiRadios WHERE id = ?').get(radioId) as Record<string, unknown> | undefined
}

function requireApDevice(deviceId: string, labId?: string) {
  const device = getDevice(deviceId)
  if (!device) throw new ValidationError('Selected access point does not exist.')
  if (device.deviceType !== 'ap') throw new ValidationError('Selected device must be an access point.')
  if (labId && device.labId !== labId) throw new ValidationError('Access point must belong to the same lab.')
  return device
}

function requireClientDevice(deviceId: string, labId?: string) {
  const device = getDevice(deviceId)
  if (!device) throw new ValidationError('Selected client device does not exist.')
  if (device.deviceType === 'ap') throw new ValidationError('Access points cannot be linked as wireless clients.')
  if (labId && device.labId !== labId) throw new ValidationError('Wireless client must belong to the same lab.')
  return device
}

function resolveControllerReference(controllerId: string | null | undefined, labId: string) {
  if (!controllerId) return null
  const controller = getController(controllerId)
  if (!controller) throw new ValidationError('Selected controller does not exist.')
  if (String(controller.labId) !== labId) throw new ValidationError('Controller must belong to the same lab.')
  return String(controller.id)
}

function resolveSsidReference(ssidId: string | null | undefined, labId: string) {
  if (!ssidId) return null
  const ssid = getSsid(ssidId)
  if (!ssid) throw new ValidationError('Selected SSID does not exist.')
  if (String(ssid.labId) !== labId) throw new ValidationError('SSID must belong to the same lab.')
  return String(ssid.id)
}

function validateRadioSsidIds(ssidIds: string[] | null | undefined, labId: string) {
  if (!ssidIds) return []
  const uniqueIds = Array.from(new Set(ssidIds.filter(Boolean)))
  for (const ssidId of uniqueIds) {
    resolveSsidReference(ssidId, labId)
  }
  return uniqueIds
}

function normalizeAccessPointMetadata(deviceId: string) {
  const existing = db.prepare('SELECT * FROM wifiAccessPoints WHERE deviceId = ?').get(deviceId) as Record<string, unknown> | undefined
  return parseWifiAccessPoint(existing ?? { deviceId, controllerId: null, location: null, firmwareVersion: null, notes: null })
}

function upsertRadioSsids(radioId: string, ssidIds: string[]) {
  db.prepare('DELETE FROM wifiRadioSsids WHERE radioId = ?').run(radioId)
  const insert = db.prepare('INSERT INTO wifiRadioSsids (radioId, ssidId) VALUES (?, ?)')
  for (const ssidId of ssidIds) {
    insert.run(radioId, ssidId)
  }
}

export const wifiRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string } }>('/controllers', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    const { sql, params } = appendLabFilter('SELECT * FROM wifiControllers WHERE 1=1', [], filter.labIds)
    const rows = db.prepare(`${sql} ORDER BY name, id`).all(...params) as Record<string, unknown>[]
    return rows.map(parseWifiController)
  })

  app.post('/controllers', async (req, reply) => {
    const body = asObject(req.body)
    const labId = requiredString(body, 'labId', { maxLength: 80 })
    if (!assertLabWrite(req, reply, labId)) return
    const name = requiredString(body, 'name', { maxLength: 120 })
    const deviceId = optionalString(body, 'deviceId', { maxLength: 80 })
    const vendor = optionalString(body, 'vendor', { maxLength: 120 })
    const model = optionalString(body, 'model', { maxLength: 120 })
    const managementIp = optionalString(body, 'managementIp', { maxLength: 60 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })

    if (!getLab(labId)) {
      return reply.status(404).send({ error: 'Lab not found.' })
    }
    if (managementIp) ensureIpv4(managementIp, 'managementIp')

    let normalizedDeviceId: string | null = null
    if (deviceId) {
      const device = getDevice(deviceId)
      if (!device) throw new ValidationError('Linked controller device does not exist.')
      if (device.labId !== labId) throw new ValidationError('Linked controller device must belong to the same lab.')
      normalizedDeviceId = device.id
    }

    const id = createId('wctrl')
    db.prepare(`
      INSERT INTO wifiControllers (id, labId, deviceId, name, vendor, model, managementIp, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, labId, normalizedDeviceId, name, vendor ?? null, model ?? null, managementIp ?? null, notes ?? null)

    const row = db.prepare('SELECT * FROM wifiControllers WHERE id = ?').get(id) as Record<string, unknown>
    return reply.status(201).send(parseWifiController(row))
  })

  app.patch<{ Params: { id: string } }>('/controllers/:id', async (req, reply) => {
    const existing = getController(req.params.id)
    if (!assertLabWriteFromRow(req, reply, existing)) return
    const controller = existing!

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []
    const labId = String(controller.labId)

    const name = optionalString(body, 'name', { maxLength: 120 })
    const deviceId = optionalString(body, 'deviceId', { maxLength: 80 })
    const vendor = optionalString(body, 'vendor', { maxLength: 120 })
    const model = optionalString(body, 'model', { maxLength: 120 })
    const managementIp = optionalString(body, 'managementIp', { maxLength: 60 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })

    if (name !== undefined) {
      updates.push('name = ?')
      values.push(name)
    }
    if (vendor !== undefined) {
      updates.push('vendor = ?')
      values.push(vendor)
    }
    if (model !== undefined) {
      updates.push('model = ?')
      values.push(model)
    }
    if (managementIp !== undefined) {
      if (managementIp) ensureIpv4(managementIp, 'managementIp')
      updates.push('managementIp = ?')
      values.push(managementIp)
    }
    if (notes !== undefined) {
      updates.push('notes = ?')
      values.push(notes)
    }
    if (deviceId !== undefined) {
      const normalizedDeviceId = deviceId
        ? (() => {
            const device = getDevice(deviceId)
            if (!device) throw new ValidationError('Linked controller device does not exist.')
            if (device.labId !== labId) throw new ValidationError('Linked controller device must belong to the same lab.')
            return device.id
          })()
        : null
      updates.push('deviceId = ?')
      values.push(normalizedDeviceId)
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update.' })
    }

    values.push(req.params.id)
    db.prepare(`UPDATE wifiControllers SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM wifiControllers WHERE id = ?').get(req.params.id) as Record<string, unknown>
    return parseWifiController(row)
  })

  app.delete<{ Params: { id: string } }>('/controllers/:id', async (req, reply) => {
    const existing = getController(req.params.id)
    if (!assertLabWriteFromRow(req, reply, existing)) return
    db.prepare('DELETE FROM wifiControllers WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })

  app.get<{ Querystring: { labId?: string } }>('/ssids', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    const { sql, params } = appendLabFilter('SELECT * FROM wifiSsids WHERE 1=1', [], filter.labIds)
    const rows = db.prepare(`${sql} ORDER BY name, id`).all(...params) as Record<string, unknown>[]
    return rows.map(parseWifiSsid)
  })

  app.post('/ssids', async (req, reply) => {
    const body = asObject(req.body)
    const labId = requiredString(body, 'labId', { maxLength: 80 })
    if (!assertLabWrite(req, reply, labId)) return
    const name = requiredString(body, 'name', { maxLength: 120 })
    const purpose = optionalString(body, 'purpose', { maxLength: 500 })
    const security = optionalString(body, 'security', { maxLength: 120 })
    const vlanId = optionalString(body, 'vlanId', { maxLength: 80 })
    const color = optionalString(body, 'color', { maxLength: 20 })
    const hidden = optionalBoolean(body, 'hidden') ?? false

    if (!getLab(labId)) {
      return reply.status(404).send({ error: 'Lab not found.' })
    }

    let normalizedVlanId: string | null = null
    if (vlanId) {
      const vlan = getVlan(vlanId)
      if (!vlan) throw new ValidationError('Selected VLAN does not exist.')
      if (vlan.labId !== labId) throw new ValidationError('SSID VLAN must belong to the same lab.')
      normalizedVlanId = vlan.id
    }

    const id = createId('wssid')
    db.prepare(`
      INSERT INTO wifiSsids (id, labId, name, purpose, security, hidden, vlanId, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, labId, name, purpose ?? null, security ?? null, hidden ? 1 : 0, normalizedVlanId, color ?? null)

    const row = db.prepare('SELECT * FROM wifiSsids WHERE id = ?').get(id) as Record<string, unknown>
    return reply.status(201).send(parseWifiSsid(row))
  })

  app.patch<{ Params: { id: string } }>('/ssids/:id', async (req, reply) => {
    const existing = getSsid(req.params.id)
    if (!assertLabWriteFromRow(req, reply, existing)) return
    const ssid = existing!

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []
    const labId = String(ssid.labId)

    const name = optionalString(body, 'name', { maxLength: 120 })
    const purpose = optionalString(body, 'purpose', { maxLength: 500 })
    const security = optionalString(body, 'security', { maxLength: 120 })
    const vlanId = optionalString(body, 'vlanId', { maxLength: 80 })
    const color = optionalString(body, 'color', { maxLength: 20 })
    const hidden = optionalBoolean(body, 'hidden')

    if (name !== undefined) {
      updates.push('name = ?')
      values.push(name)
    }
    if (purpose !== undefined) {
      updates.push('purpose = ?')
      values.push(purpose)
    }
    if (security !== undefined) {
      updates.push('security = ?')
      values.push(security)
    }
    if (color !== undefined) {
      updates.push('color = ?')
      values.push(color)
    }
    if (hidden !== undefined) {
      updates.push('hidden = ?')
      values.push(hidden ? 1 : 0)
    }
    if (vlanId !== undefined) {
      const normalizedVlanId = vlanId
        ? (() => {
            const vlan = getVlan(vlanId)
            if (!vlan) throw new ValidationError('Selected VLAN does not exist.')
            if (vlan.labId !== labId) throw new ValidationError('SSID VLAN must belong to the same lab.')
            return vlan.id
          })()
        : null
      updates.push('vlanId = ?')
      values.push(normalizedVlanId)
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update.' })
    }

    values.push(req.params.id)
    db.prepare(`UPDATE wifiSsids SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM wifiSsids WHERE id = ?').get(req.params.id) as Record<string, unknown>
    return parseWifiSsid(row)
  })

  app.delete<{ Params: { id: string } }>('/ssids/:id', async (req, reply) => {
    const existing = getSsid(req.params.id)
    if (!assertLabWriteFromRow(req, reply, existing)) return
    db.prepare('DELETE FROM wifiSsids WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })

  app.get<{ Querystring: { labId?: string } }>('/access-points', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    let sql = `
      SELECT
        d.id AS deviceId,
        a.controllerId,
        a.location,
        a.firmwareVersion,
        a.notes
      FROM devices d
      LEFT JOIN wifiAccessPoints a ON a.deviceId = d.id
      WHERE d.deviceType = 'ap'
    `
    const params: unknown[] = []
    const filtered = appendLabFilter(sql, params, filter.labIds, 'd.labId')
    const rows = db.prepare(`${filtered.sql} ORDER BY d.hostname, d.id`).all(...filtered.params) as Record<string, unknown>[]
    return rows.map(parseWifiAccessPoint)
  })

  app.put<{ Params: { deviceId: string } }>('/access-points/:deviceId', async (req, reply) => {
    const body = asObject(req.body)
    const apDevice = requireApDevice(req.params.deviceId)
    if (!assertLabWrite(req, reply, apDevice.labId)) return
    const controllerId = optionalString(body, 'controllerId', { maxLength: 80 })
    const location = optionalString(body, 'location', { maxLength: 200 })
    const firmwareVersion = optionalString(body, 'firmwareVersion', { maxLength: 120 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })

    const normalizedControllerId = resolveControllerReference(controllerId, apDevice.labId)

    db.prepare(`
      INSERT INTO wifiAccessPoints (deviceId, controllerId, location, firmwareVersion, notes)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(deviceId) DO UPDATE SET
        controllerId = excluded.controllerId,
        location = excluded.location,
        firmwareVersion = excluded.firmwareVersion,
        notes = excluded.notes
    `).run(req.params.deviceId, normalizedControllerId, location ?? null, firmwareVersion ?? null, notes ?? null)

    return reply.send(normalizeAccessPointMetadata(req.params.deviceId))
  })

  app.get<{ Querystring: { labId?: string; apDeviceId?: string } }>('/radios', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    let sql = `
      SELECT r.*
      FROM wifiRadios r
      JOIN devices d ON d.id = r.apDeviceId
      WHERE 1=1
    `
    const params: unknown[] = []
    if (req.query.apDeviceId) {
      sql += ' AND r.apDeviceId = ?'
      params.push(req.query.apDeviceId)
    }
    const filtered = appendLabFilter(sql, params, filter.labIds, 'd.labId')
    const rows = db.prepare(`${filtered.sql} ORDER BY r.apDeviceId, r.band, r.slotName, r.id`).all(...filtered.params) as Record<string, unknown>[]
    const ssidMap = loadRadioSsidMap(rows.map((row) => String(row.id)))
    return rows.map((row) => parseWifiRadio(row, ssidMap.get(String(row.id)) ?? []))
  })

  app.post('/radios', async (req, reply) => {
    const body = asObject(req.body)
    const apDeviceId = requiredString(body, 'apDeviceId', { maxLength: 80 })
    const slotName = requiredString(body, 'slotName', { maxLength: 80 })
    const band = requiredEnum(body, 'band', WIFI_BANDS)
    const channel = requiredString(body, 'channel', { maxLength: 40 })
    const channelWidth = optionalString(body, 'channelWidth', { maxLength: 40 })
    const txPower = optionalString(body, 'txPower', { maxLength: 60 })
    const ssidIds = optionalStringArray(body, 'ssidIds', { maxItems: 20 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })

    const apDevice = requireApDevice(apDeviceId)
    if (!assertLabWrite(req, reply, apDevice.labId)) return
    const normalizedSsidIds = validateRadioSsidIds(ssidIds, apDevice.labId)
    const id = createId('wradio')

    const createRadio = db.transaction(() => {
      db.prepare(`
        INSERT INTO wifiRadios (id, apDeviceId, slotName, band, channel, channelWidth, txPower, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, apDevice.id, slotName, band, channel, channelWidth ?? null, txPower ?? null, notes ?? null)
      upsertRadioSsids(id, normalizedSsidIds)
    })

    createRadio()

    const row = db.prepare('SELECT * FROM wifiRadios WHERE id = ?').get(id) as Record<string, unknown>
    return reply.status(201).send(parseWifiRadio(row, normalizedSsidIds))
  })

  app.patch<{ Params: { id: string } }>('/radios/:id', async (req, reply) => {
    const existing = getRadio(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'WiFi radio not found.' })
    }

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []
    const apDevice = requireApDevice(String(existing.apDeviceId))
    if (!assertLabWrite(req, reply, apDevice.labId)) return

    const slotName = optionalString(body, 'slotName', { maxLength: 80 })
    const band = optionalEnum(body, 'band', WIFI_BANDS)
    const channel = optionalString(body, 'channel', { maxLength: 40 })
    const channelWidth = optionalString(body, 'channelWidth', { maxLength: 40 })
    const txPower = optionalString(body, 'txPower', { maxLength: 60 })
    const ssidIds = optionalStringArray(body, 'ssidIds', { maxItems: 20 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })

    if (slotName !== undefined) {
      updates.push('slotName = ?')
      values.push(slotName)
    }
    if (band !== undefined) {
      updates.push('band = ?')
      values.push(band)
    }
    if (channel !== undefined) {
      updates.push('channel = ?')
      values.push(channel)
    }
    if (channelWidth !== undefined) {
      updates.push('channelWidth = ?')
      values.push(channelWidth)
    }
    if (txPower !== undefined) {
      updates.push('txPower = ?')
      values.push(txPower)
    }
    if (notes !== undefined) {
      updates.push('notes = ?')
      values.push(notes)
    }

    const normalizedSsidIds = ssidIds === undefined ? null : validateRadioSsidIds(ssidIds, apDevice.labId)

    if (updates.length === 0 && normalizedSsidIds == null) {
      return reply.status(400).send({ error: 'No valid fields to update.' })
    }

    const updateRadio = db.transaction(() => {
      if (updates.length > 0) {
        values.push(req.params.id)
        db.prepare(`UPDATE wifiRadios SET ${updates.join(', ')} WHERE id = ?`).run(...values)
      }
      if (normalizedSsidIds != null) {
        upsertRadioSsids(req.params.id, normalizedSsidIds)
      }
    })

    updateRadio()

    const row = db.prepare('SELECT * FROM wifiRadios WHERE id = ?').get(req.params.id) as Record<string, unknown>
    const radioSsidIds = normalizedSsidIds ?? (loadRadioSsidMap([req.params.id]).get(req.params.id) ?? [])
    return parseWifiRadio(row, radioSsidIds)
  })

  app.delete<{ Params: { id: string } }>('/radios/:id', async (req, reply) => {
    const existing = getRadio(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'WiFi radio not found.' })
    }
    const apDevice = requireApDevice(String(existing.apDeviceId))
    if (!assertLabWrite(req, reply, apDevice.labId)) return
    db.prepare('DELETE FROM wifiRadios WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })

  app.get<{ Querystring: { labId?: string; apDeviceId?: string } }>('/associations', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    let sql = `
      SELECT a.*
      FROM wifiClientAssociations a
      JOIN devices d ON d.id = a.clientDeviceId
      WHERE 1=1
    `
    const params: unknown[] = []
    if (req.query.apDeviceId) {
      sql += ' AND a.apDeviceId = ?'
      params.push(req.query.apDeviceId)
    }
    const filtered = appendLabFilter(sql, params, filter.labIds, 'd.labId')
    const rows = db.prepare(`${filtered.sql} ORDER BY a.apDeviceId, a.clientDeviceId`).all(...filtered.params) as Record<string, unknown>[]
    return rows.map(parseWifiClientAssociation)
  })

  app.put<{ Params: { clientDeviceId: string } }>('/associations/:clientDeviceId', async (req, reply) => {
    const body = asObject(req.body)
    const clientDevice = requireClientDevice(req.params.clientDeviceId)
    if (!assertLabWrite(req, reply, clientDevice.labId)) return
    const apDeviceId = requiredString(body, 'apDeviceId', { maxLength: 80 })
    const radioId = optionalString(body, 'radioId', { maxLength: 80 })
    const ssidId = optionalString(body, 'ssidId', { maxLength: 80 })
    const band = optionalEnum(body, 'band', WIFI_BANDS)
    const channel = optionalString(body, 'channel', { maxLength: 40 })
    const signalDbm = optionalInteger(body, 'signalDbm', { min: -130, max: 0 })
    const lastSeen = optionalString(body, 'lastSeen', { maxLength: 80 })
    const lastRoamAt = optionalString(body, 'lastRoamAt', { maxLength: 80 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })

    if (lastSeen) ensureIsoDate(lastSeen, 'lastSeen')
    if (lastRoamAt) ensureIsoDate(lastRoamAt, 'lastRoamAt')

    const apDevice = requireApDevice(apDeviceId, clientDevice.labId)
    const normalizedSsidId = resolveSsidReference(ssidId, clientDevice.labId)

    let normalizedRadioId: string | null = null
    let normalizedBand = band ?? null
    let normalizedChannel = channel ?? null

    if (radioId) {
      const radio = getRadio(radioId)
      if (!radio) throw new ValidationError('Selected WiFi radio does not exist.')
      if (String(radio.apDeviceId) !== apDevice.id) {
        throw new ValidationError('Selected radio must belong to the chosen access point.')
      }
      normalizedRadioId = String(radio.id)
      normalizedBand = normalizedBand ?? (String(radio.band) as (typeof WIFI_BANDS)[number])
      normalizedChannel = normalizedChannel ?? String(radio.channel)

      if (normalizedSsidId) {
        const mapping = db.prepare(`
          SELECT 1
          FROM wifiRadioSsids
          WHERE radioId = ? AND ssidId = ?
        `).get(normalizedRadioId, normalizedSsidId)
        if (!mapping) {
          throw new ValidationError('Selected radio is not configured to broadcast the chosen SSID.')
        }
      }
    }

    db.transaction(() => {
      db.prepare(`
        INSERT INTO wifiClientAssociations
          (clientDeviceId, apDeviceId, radioId, ssidId, band, channel, signalDbm, lastSeen, lastRoamAt, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clientDeviceId) DO UPDATE SET
          apDeviceId = excluded.apDeviceId,
          radioId = excluded.radioId,
          ssidId = excluded.ssidId,
          band = excluded.band,
          channel = excluded.channel,
          signalDbm = excluded.signalDbm,
          lastSeen = excluded.lastSeen,
          lastRoamAt = excluded.lastRoamAt,
          notes = excluded.notes
      `).run(
        clientDevice.id,
        apDevice.id,
        normalizedRadioId,
        normalizedSsidId,
        normalizedBand,
        normalizedChannel,
        signalDbm ?? null,
        lastSeen ?? null,
        lastRoamAt ?? null,
        notes ?? null,
      )

      db.prepare(`
        UPDATE devices
        SET placement = 'wireless', parentDeviceId = ?
        WHERE id = ?
      `).run(apDevice.id, clientDevice.id)
    })()

    const row = db.prepare('SELECT * FROM wifiClientAssociations WHERE clientDeviceId = ?').get(clientDevice.id) as Record<string, unknown>
    return reply.send(parseWifiClientAssociation(row))
  })

  app.delete<{ Params: { clientDeviceId: string } }>('/associations/:clientDeviceId', async (req, reply) => {
    const existing = db.prepare(`
      SELECT wifiClientAssociations.*, devices.labId
      FROM wifiClientAssociations
      JOIN devices ON devices.id = wifiClientAssociations.clientDeviceId
      WHERE wifiClientAssociations.clientDeviceId = ?
    `).get(req.params.clientDeviceId) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, existing)) return
    const association = existing!

    db.transaction(() => {
      db.prepare('DELETE FROM wifiClientAssociations WHERE clientDeviceId = ?').run(req.params.clientDeviceId)
      db.prepare(`
        UPDATE devices
        SET parentDeviceId = NULL
        WHERE id = ? AND parentDeviceId = ?
      `).run(req.params.clientDeviceId, association.apDeviceId)
    })()

    return reply.status(204).send()
  })
}

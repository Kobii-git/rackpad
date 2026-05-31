import type { FastifyPluginAsync } from 'fastify'
import { db, parseRow } from '../db.js'
import { createId } from '../lib/ids.js'
import {
  asObject,
  ensureCidr,
  ensureIpv4,
  optionalString,
  optionalStringArray,
  optionalEnum,
  requiredEnum,
  requiredString,
  ValidationError,
} from '../lib/validation.js'

const IP_ZONE_KINDS = ['static', 'dhcp', 'reserved', 'infrastructure'] as const
const ASSIGNMENT_TYPES = ['device', 'interface', 'vm', 'container', 'reserved', 'infrastructure'] as const
const ALLOCATION_MODES = ['static', 'dhcp-reservation'] as const
const TECHNICAL_ASSIGNMENT_TYPES = new Set<string>(['reserved', 'infrastructure'])
const HOST_ASSIGNMENT_TYPES = new Set<string>(['device', 'interface', 'vm', 'container'])

function parseScope(row: Record<string, unknown>) {
  return parseRow(row, ['dnsServers'])
}

function ipv4ToInt(ipAddress: string) {
  return ipAddress
    .split('.')
    .map((octet) => Number.parseInt(octet, 10))
    .reduce((value, octet) => (value << 8) + octet, 0) >>> 0
}

function subnetContainsIp(cidr: string, ipAddress: string) {
  const [networkAddress, prefixRaw] = cidr.split('/')
  const prefix = Number.parseInt(prefixRaw ?? '', 10)
  const hostBits = 32 - prefix
  const network = ipv4ToInt(networkAddress)
  const target = ipv4ToInt(ipAddress)
  const broadcast = hostBits === 0 ? network : network + (2 ** hostBits - 1)
  return target >= network && target <= broadcast
}

function ipInRange(ipAddress: string, startIp: string, endIp: string) {
  const target = ipv4ToInt(ipAddress)
  return target >= ipv4ToInt(startIp) && target <= ipv4ToInt(endIp)
}

function assertAssignmentSubnet(subnetId: string, ipAddress: string) {
  const subnet = db.prepare('SELECT cidr FROM subnets WHERE id = ?').get(subnetId) as { cidr?: string } | undefined
  if (!subnet?.cidr) {
    throw new Error('Subnet not found.')
  }
  if (!subnetContainsIp(subnet.cidr, ipAddress)) {
    throw new Error(`IP ${ipAddress} does not belong to subnet ${subnet.cidr}.`)
  }
}

function dhcpScopeForIp(subnetId: string, ipAddress: string) {
  return (db.prepare('SELECT * FROM dhcpScopes WHERE subnetId = ?').all(subnetId) as Array<{
    id: string
    name: string
    startIp: string
    endIp: string
    gateway: string | null
    dnsServers: string | null
  }>).find((scope) => ipInRange(ipAddress, scope.startIp, scope.endIp))
}

function dhcpTechnicalRole(subnetId: string, ipAddress: string) {
  const scopes = db.prepare('SELECT name, gateway, dnsServers FROM dhcpScopes WHERE subnetId = ?').all(subnetId) as Array<{
    name: string
    gateway: string | null
    dnsServers: string | null
  }>

  for (const scope of scopes) {
    if (scope.gateway === ipAddress) {
      return { role: 'gateway', reason: `${scope.name} gateway` }
    }
    if (!scope.dnsServers) continue
    try {
      const dnsServers = JSON.parse(scope.dnsServers) as unknown
      if (Array.isArray(dnsServers) && dnsServers.some((entry) => String(entry) === ipAddress)) {
        return { role: 'dns', reason: `${scope.name} DNS server` }
      }
    } catch {
      // Ignore malformed legacy DNS JSON.
    }
  }

  return null
}

function validateAssignmentSemantics(input: {
  existingId?: string
  subnetId: string
  ipAddress: string
  assignmentType: (typeof ASSIGNMENT_TYPES)[number]
  allocationMode: (typeof ALLOCATION_MODES)[number]
  dhcpScopeId?: string | null
}) {
  assertAssignmentSubnet(input.subnetId, input.ipAddress)

  const technical = dhcpTechnicalRole(input.subnetId, input.ipAddress)
  if (technical && !TECHNICAL_ASSIGNMENT_TYPES.has(input.assignmentType)) {
    throw new ValidationError(
      `${input.ipAddress} is ${technical.reason}; keep it as reserved or infrastructure instead of assigning it as a normal endpoint.`,
    )
  }

  const existingTechnical = db.prepare(`
    SELECT assignmentType
    FROM ipAssignments
    WHERE subnetId = ?
      AND ipAddress = ?
      AND id != ?
      AND assignmentType IN ('reserved', 'infrastructure')
  `).get(input.subnetId, input.ipAddress, input.existingId ?? '') as { assignmentType?: string } | undefined
  if (existingTechnical && !TECHNICAL_ASSIGNMENT_TYPES.has(input.assignmentType)) {
    throw new ValidationError(
      `${input.ipAddress} is already documented as ${existingTechnical.assignmentType}; edit that technical assignment instead of overwriting it.`,
    )
  }

  const containingScope = dhcpScopeForIp(input.subnetId, input.ipAddress)
  if (input.allocationMode === 'dhcp-reservation') {
    if (!input.dhcpScopeId) {
      throw new ValidationError('DHCP reservation assignments must reference a DHCP scope.')
    }
    const scope = db.prepare('SELECT subnetId, startIp, endIp FROM dhcpScopes WHERE id = ?').get(input.dhcpScopeId) as
      | { subnetId: string; startIp: string; endIp: string }
      | undefined
    if (!scope || scope.subnetId !== input.subnetId) {
      throw new ValidationError('Selected DHCP scope does not belong to this subnet.')
    }
    if (!ipInRange(input.ipAddress, scope.startIp, scope.endIp)) {
      throw new ValidationError('DHCP reservation IP must be inside the selected DHCP scope.')
    }
  } else if (input.dhcpScopeId) {
    throw new ValidationError('Static assignments cannot reference a DHCP scope.')
  } else if (containingScope && HOST_ASSIGNMENT_TYPES.has(input.assignmentType)) {
    throw new ValidationError(
      'Device, interface, VM, and container IPs inside a DHCP scope must be marked as DHCP reservations.',
    )
  }
}

export const ipamRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string } }>('/subnets', async (req) => {
    if (req.query.labId) {
      return db.prepare('SELECT * FROM subnets WHERE labId = ? ORDER BY cidr').all(req.query.labId)
    }
    return db.prepare('SELECT * FROM subnets ORDER BY cidr').all()
  })

  app.get<{ Params: { id: string } }>('/subnets/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM subnets WHERE id = ?').get(req.params.id)
    if (!row) return reply.status(404).send({ error: 'Subnet not found' })
    return row
  })

  app.post('/subnets', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('s')
    const labId = requiredString(body, 'labId', { maxLength: 80 })
    const cidr = ensureCidr(requiredString(body, 'cidr', { maxLength: 40 }))
    const name = requiredString(body, 'name', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const vlanId = optionalString(body, 'vlanId', { maxLength: 80 })
    db.prepare(
      'INSERT INTO subnets (id, labId, cidr, name, description, vlanId) VALUES (?,?,?,?,?,?)'
    ).run(id, labId, cidr, name, description ?? null, vlanId ?? null)
    return reply.status(201).send(db.prepare('SELECT * FROM subnets WHERE id = ?').get(id))
  })

  app.patch<{ Params: { id: string } }>('/subnets/:id', async (req, reply) => {
    const existing = db.prepare('SELECT id FROM subnets WHERE id = ?').get(req.params.id)
    if (!existing) return reply.status(404).send({ error: 'Subnet not found' })
    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const cidr = optionalString(body, 'cidr', { maxLength: 40 })
    const name = optionalString(body, 'name', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const vlanId = optionalString(body, 'vlanId', { maxLength: 80 })

    if (cidr !== undefined) {
      // cidr is a NOT NULL column — reject explicit null/empty rather than letting the DB fail
      if (!cidr) return reply.status(400).send({ error: 'cidr cannot be empty.' })
      updates.push('cidr = ?')
      values.push(ensureCidr(cidr))
    }
    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }
    if (vlanId !== undefined) { updates.push('vlanId = ?'); values.push(vlanId) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields' })
    values.push(req.params.id)
    db.prepare(`UPDATE subnets SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM subnets WHERE id = ?').get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/subnets/:id', async (req, reply) => {
    if (!db.prepare('SELECT id FROM subnets WHERE id = ?').get(req.params.id)) {
      return reply.status(404).send({ error: 'Subnet not found' })
    }
    db.prepare('DELETE FROM subnets WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })

  // ORDER BY added for consistency with all other list endpoints
  app.get<{ Querystring: { subnetId?: string } }>('/dhcp-scopes', async (req) => {
    const rows = req.query.subnetId
      ? db.prepare('SELECT * FROM dhcpScopes WHERE subnetId = ? ORDER BY name').all(req.query.subnetId)
      : db.prepare('SELECT * FROM dhcpScopes ORDER BY subnetId, name').all()
    return (rows as Record<string, unknown>[]).map(parseScope)
  })

  app.post('/dhcp-scopes', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('sc')
    const subnetId = requiredString(body, 'subnetId', { maxLength: 80 })
    const name = requiredString(body, 'name', { maxLength: 120 })
    const startIp = ensureIpv4(requiredString(body, 'startIp', { maxLength: 40 }), 'startIp')
    const endIp = ensureIpv4(requiredString(body, 'endIp', { maxLength: 40 }), 'endIp')
    const gateway = optionalString(body, 'gateway', { maxLength: 40 })
    const dnsServers = optionalStringArray(body, 'dnsServers', { maxItems: 5 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    db.prepare(
      'INSERT INTO dhcpScopes (id, subnetId, name, startIp, endIp, gateway, dnsServers, description) VALUES (?,?,?,?,?,?,?,?)'
    ).run(id, subnetId, name, startIp, endIp,
      gateway ? ensureIpv4(gateway, 'gateway') : null,
      dnsServers ? JSON.stringify(dnsServers.map((entry) => ensureIpv4(entry, 'dnsServers'))) : null,
      description ?? null)
    const row = db.prepare('SELECT * FROM dhcpScopes WHERE id = ?').get(id) as Record<string, unknown>
    return reply.status(201).send(parseScope(row))
  })

  app.patch<{ Params: { id: string } }>('/dhcp-scopes/:id', async (req, reply) => {
    const existing = db.prepare('SELECT id FROM dhcpScopes WHERE id = ?').get(req.params.id)
    if (!existing) return reply.status(404).send({ error: 'DHCP scope not found' })
    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const name = optionalString(body, 'name', { maxLength: 120 })
    const startIp = optionalString(body, 'startIp', { maxLength: 40 })
    const endIp = optionalString(body, 'endIp', { maxLength: 40 })
    const gateway = optionalString(body, 'gateway', { maxLength: 40 })
    const dnsServers = optionalStringArray(body, 'dnsServers', { maxItems: 5 })
    const description = optionalString(body, 'description', { maxLength: 500 })

    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (startIp !== undefined) {
      // startIp is NOT NULL — reject explicit null/empty before the DB sees it
      if (!startIp) return reply.status(400).send({ error: 'startIp cannot be empty.' })
      updates.push('startIp = ?')
      values.push(ensureIpv4(startIp, 'startIp'))
    }
    if (endIp !== undefined) {
      // endIp is NOT NULL — same guard
      if (!endIp) return reply.status(400).send({ error: 'endIp cannot be empty.' })
      updates.push('endIp = ?')
      values.push(ensureIpv4(endIp, 'endIp'))
    }
    if (gateway !== undefined) { updates.push('gateway = ?'); values.push(gateway ? ensureIpv4(gateway, 'gateway') : null) }
    if (dnsServers !== undefined) { updates.push('dnsServers = ?'); values.push(dnsServers ? JSON.stringify(dnsServers.map((entry) => ensureIpv4(entry, 'dnsServers'))) : null) }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields' })
    values.push(req.params.id)
    db.prepare(`UPDATE dhcpScopes SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM dhcpScopes WHERE id = ?').get(req.params.id) as Record<string, unknown>
    return parseScope(row)
  })

  app.delete<{ Params: { id: string } }>('/dhcp-scopes/:id', async (req, reply) => {
    if (!db.prepare('SELECT id FROM dhcpScopes WHERE id = ?').get(req.params.id)) {
      return reply.status(404).send({ error: 'DHCP scope not found' })
    }
    db.prepare('DELETE FROM dhcpScopes WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })

  app.get<{ Querystring: { subnetId?: string } }>('/ip-zones', async (req) => {
    if (req.query.subnetId) {
      return db.prepare('SELECT * FROM ipZones WHERE subnetId = ? ORDER BY startIp').all(req.query.subnetId)
    }
    return db.prepare('SELECT * FROM ipZones ORDER BY subnetId, startIp').all()
  })

  app.post('/ip-zones', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('iz')
    const subnetId = requiredString(body, 'subnetId', { maxLength: 80 })
    const kind = requiredEnum(body, 'kind', IP_ZONE_KINDS)
    const startIp = ensureIpv4(requiredString(body, 'startIp', { maxLength: 40 }), 'startIp')
    const endIp = ensureIpv4(requiredString(body, 'endIp', { maxLength: 40 }), 'endIp')
    const description = optionalString(body, 'description', { maxLength: 500 })
    db.prepare(
      'INSERT INTO ipZones (id, subnetId, kind, startIp, endIp, description) VALUES (?,?,?,?,?,?)'
    ).run(id, subnetId, kind, startIp, endIp, description ?? null)
    return reply.status(201).send(db.prepare('SELECT * FROM ipZones WHERE id = ?').get(id))
  })

  app.patch<{ Params: { id: string } }>('/ip-zones/:id', async (req, reply) => {
    const existing = db.prepare('SELECT id FROM ipZones WHERE id = ?').get(req.params.id)
    if (!existing) return reply.status(404).send({ error: 'IP zone not found' })
    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const startIp = optionalString(body, 'startIp', { maxLength: 40 })
    const endIp = optionalString(body, 'endIp', { maxLength: 40 })
    const description = optionalString(body, 'description', { maxLength: 500 })

    if ('kind' in body) { updates.push('kind = ?'); values.push(requiredEnum(body, 'kind', IP_ZONE_KINDS)) }
    if (startIp !== undefined) {
      if (!startIp) return reply.status(400).send({ error: 'startIp cannot be empty.' })
      updates.push('startIp = ?')
      values.push(ensureIpv4(startIp, 'startIp'))
    }
    if (endIp !== undefined) {
      if (!endIp) return reply.status(400).send({ error: 'endIp cannot be empty.' })
      updates.push('endIp = ?')
      values.push(ensureIpv4(endIp, 'endIp'))
    }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields' })
    values.push(req.params.id)
    db.prepare(`UPDATE ipZones SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM ipZones WHERE id = ?').get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/ip-zones/:id', async (req, reply) => {
    if (!db.prepare('SELECT id FROM ipZones WHERE id = ?').get(req.params.id)) {
      return reply.status(404).send({ error: 'IP zone not found' })
    }
    db.prepare('DELETE FROM ipZones WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })

  app.get<{ Querystring: { subnetId?: string; deviceId?: string } }>('/ip-assignments', async (req) => {
    let sql = 'SELECT * FROM ipAssignments WHERE 1=1'
    const params: unknown[] = []
    if (req.query.subnetId) { sql += ' AND subnetId = ?'; params.push(req.query.subnetId) }
    if (req.query.deviceId) { sql += ' AND deviceId = ?'; params.push(req.query.deviceId) }
    sql += ' ORDER BY ipAddress'
    return db.prepare(sql).all(...params)
  })

  app.get<{ Params: { id: string } }>('/ip-assignments/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM ipAssignments WHERE id = ?').get(req.params.id)
    if (!row) return reply.status(404).send({ error: 'IP assignment not found' })
    return row
  })

  app.post('/ip-assignments', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('ip')
    const subnetId = requiredString(body, 'subnetId', { maxLength: 80 })
    const ipAddress = ensureIpv4(requiredString(body, 'ipAddress', { maxLength: 40 }))
    const assignmentType = requiredEnum(body, 'assignmentType', ASSIGNMENT_TYPES)
    const deviceId = optionalString(body, 'deviceId', { maxLength: 80 })
    const portId = optionalString(body, 'portId', { maxLength: 80 })
    const vmId = optionalString(body, 'vmId', { maxLength: 80 })
    const containerId = optionalString(body, 'containerId', { maxLength: 80 })
    const hostname = optionalString(body, 'hostname', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const dhcpScopeId = optionalString(body, 'dhcpScopeId', { maxLength: 80 })
    const allocationMode = optionalEnum(body, 'allocationMode', ALLOCATION_MODES) ?? (dhcpScopeId ? 'dhcp-reservation' : 'static')
    try {
      validateAssignmentSemantics({
        subnetId,
        ipAddress,
        assignmentType,
        allocationMode,
        dhcpScopeId,
      })
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid subnet assignment.' })
    }
    db.prepare(
      'INSERT INTO ipAssignments (id, subnetId, ipAddress, assignmentType, allocationMode, dhcpScopeId, deviceId, portId, vmId, containerId, hostname, description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(id, subnetId, ipAddress, assignmentType,
      allocationMode, dhcpScopeId ?? null,
      deviceId ?? null, portId ?? null, vmId ?? null, containerId ?? null,
      hostname ?? null, description ?? null)
    return reply.status(201).send(db.prepare('SELECT * FROM ipAssignments WHERE id = ?').get(id))
  })

  app.patch<{ Params: { id: string } }>('/ip-assignments/:id', async (req, reply) => {
    const existing = db.prepare('SELECT * FROM ipAssignments WHERE id = ?').get(req.params.id) as
      | { subnetId: string; ipAddress: string; assignmentType: (typeof ASSIGNMENT_TYPES)[number]; allocationMode?: string | null; dhcpScopeId?: string | null }
      | undefined
    if (!existing) return reply.status(404).send({ error: 'IP assignment not found' })
    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const subnetId = optionalString(body, 'subnetId', { maxLength: 80 })
    const ipAddress = optionalString(body, 'ipAddress', { maxLength: 40 })
    const deviceId = optionalString(body, 'deviceId', { maxLength: 80 })
    const portId = optionalString(body, 'portId', { maxLength: 80 })
    const vmId = optionalString(body, 'vmId', { maxLength: 80 })
    const containerId = optionalString(body, 'containerId', { maxLength: 80 })
    const hostname = optionalString(body, 'hostname', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const dhcpScopeId = optionalString(body, 'dhcpScopeId', { maxLength: 80 })
    const allocationMode = optionalEnum(body, 'allocationMode', ALLOCATION_MODES)
    const assignmentType = 'assignmentType' in body
      ? requiredEnum(body, 'assignmentType', ASSIGNMENT_TYPES)
      : existing.assignmentType

    const effectiveSubnetId = subnetId ?? existing.subnetId
    const effectiveIpAddress = ipAddress ?? existing.ipAddress
    const effectiveAllocationMode =
      allocationMode ??
      (existing.allocationMode === 'dhcp-reservation' ? 'dhcp-reservation' : 'static')
    const effectiveDhcpScopeId =
      dhcpScopeId !== undefined
        ? dhcpScopeId
        : existing.dhcpScopeId
          ? String(existing.dhcpScopeId)
          : null

    if (subnetId !== undefined || ipAddress !== undefined || allocationMode !== undefined || dhcpScopeId !== undefined || 'assignmentType' in body) {
      if (ipAddress !== undefined && !ipAddress) {
        return reply.status(400).send({ error: 'ipAddress cannot be empty.' })
      }
      try {
        validateAssignmentSemantics({
          existingId: req.params.id,
          assignmentType,
          allocationMode: effectiveAllocationMode,
          dhcpScopeId: effectiveDhcpScopeId,
          subnetId: effectiveSubnetId,
          ipAddress: ipAddress !== undefined ? ensureIpv4(ipAddress) : effectiveIpAddress,
        })
      } catch (error) {
        return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid subnet assignment.' })
      }
    }

    if (subnetId !== undefined) { updates.push('subnetId = ?'); values.push(subnetId) }
    if (ipAddress !== undefined) { updates.push('ipAddress = ?'); values.push(ensureIpv4(ipAddress)) }
    if ('assignmentType' in body) { updates.push('assignmentType = ?'); values.push(assignmentType) }
    if (allocationMode !== undefined) { updates.push('allocationMode = ?'); values.push(allocationMode ?? 'static') }
    if (dhcpScopeId !== undefined) { updates.push('dhcpScopeId = ?'); values.push(dhcpScopeId) }
    if (deviceId !== undefined) { updates.push('deviceId = ?'); values.push(deviceId) }
    if (portId !== undefined) { updates.push('portId = ?'); values.push(portId) }
    if (vmId !== undefined) { updates.push('vmId = ?'); values.push(vmId) }
    if (containerId !== undefined) { updates.push('containerId = ?'); values.push(containerId) }
    if (hostname !== undefined) { updates.push('hostname = ?'); values.push(hostname) }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields' })
    values.push(req.params.id)
    db.prepare(`UPDATE ipAssignments SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM ipAssignments WHERE id = ?').get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/ip-assignments/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM ipAssignments WHERE id = ?').get(req.params.id) as
      | { deviceId?: string | null; ipAddress: string }
      | undefined
    if (!row) {
      return reply.status(404).send({ error: 'IP assignment not found' })
    }

    const deleteAssignment = db.transaction((assignmentId: string, deviceId: string | null | undefined, ipAddress: string) => {
      if (deviceId) {
        db.prepare(
          'UPDATE devices SET managementIp = NULL WHERE id = ? AND managementIp = ?'
        ).run(deviceId, ipAddress)
      }
      db.prepare('DELETE FROM ipAssignments WHERE id = ?').run(assignmentId)
    })

    deleteAssignment(req.params.id, row.deviceId, row.ipAddress)
    return reply.status(204).send()
  })
}

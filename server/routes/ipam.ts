import type { FastifyPluginAsync } from 'fastify'
import { db, parseRow } from '../db.js'
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
  ensureCidr,
  ensureIpv4,
  optionalString,
  optionalStringArray,
  optionalEnum,
  requiredEnum,
  requiredInteger,
  requiredString,
  ValidationError,
} from '../lib/validation.js'
import { cidrContainsIp, ipToInt } from '../lib/ip-cidr.js'

const IP_ZONE_KINDS = ['static', 'dhcp', 'reserved', 'infrastructure'] as const
const ASSIGNMENT_TYPES = ['device', 'interface', 'vm', 'container', 'reserved', 'infrastructure'] as const
const ALLOCATION_MODES = ['static', 'dhcp-reservation'] as const
const TECHNICAL_ASSIGNMENT_TYPES = new Set<string>(['reserved', 'infrastructure'])
const TECHNICAL_OVERLAY_ASSIGNMENT_TYPES = new Set<string>([
  'interface',
  'reserved',
  'infrastructure',
])
const HOST_ASSIGNMENT_TYPES = new Set<string>(['device', 'interface', 'vm', 'container'])

function parseScope(row: Record<string, unknown>) {
  return parseRow(row, ['dnsServers'])
}

function parseSubnet(row: Record<string, unknown>) {
  return parseRow(row, ['dnsServers'])
}

function stringifyDnsServers(value: string[] | null | undefined) {
  return value ? JSON.stringify(value.map((entry) => ensureIpv4(entry, 'dnsServers'))) : null
}

function ipInRange(ipAddress: string, startIp: string, endIp: string) {
  const target = ipToInt(ipAddress)
  return target >= ipToInt(startIp) && target <= ipToInt(endIp)
}

function ensureIpRange(startIp: string, endIp: string, label: string) {
  if (ipToInt(startIp) > ipToInt(endIp)) {
    throw new ValidationError(`${label} start IP must be before or equal to end IP.`)
  }
}

function ensureIpBelongsToSubnet(cidr: string, ipAddress: string, key: string) {
  if (!cidrContainsIp(cidr, ipAddress)) {
    throw new ValidationError(`${key} must belong to subnet ${cidr}.`)
  }
}

function ensureGatewayBelongsToSubnet(cidr: string, gateway: string | null | undefined, key = 'gateway') {
  if (!gateway) return null
  const ipAddress = ensureIpv4(gateway, key)
  ensureIpBelongsToSubnet(cidr, ipAddress, key)
  return ipAddress
}

function ensureIpRangeBelongsToSubnet(
  cidr: string,
  startIp: string,
  endIp: string,
  label: string,
  startKey: string,
  endKey: string,
) {
  ensureIpRange(startIp, endIp, label)
  ensureIpBelongsToSubnet(cidr, startIp, startKey)
  ensureIpBelongsToSubnet(cidr, endIp, endKey)
}

function ensureDhcpScopeBelongsToSubnet(cidr: string, startIp: string, endIp: string) {
  ensureIpRangeBelongsToSubnet(cidr, startIp, endIp, 'DHCP', 'DHCP start IP', 'DHCP end IP')
}

function ensureIpZoneBelongsToSubnet(cidr: string, startIp: string, endIp: string) {
  ensureIpRangeBelongsToSubnet(cidr, startIp, endIp, 'IP zone', 'Zone start IP', 'Zone end IP')
}

function getVlanLabRow(vlanId: string) {
  return db.prepare('SELECT id, labId FROM vlans WHERE id = ?').get(vlanId) as
    | { id: string; labId: string }
    | undefined
}

function normalizeSubnetVlanId(labId: string, vlanId: string | null | undefined) {
  if (!vlanId) return null
  const vlan = getVlanLabRow(vlanId)
  if (!vlan) throw new ValidationError('Selected VLAN does not exist.')
  if (vlan.labId !== labId) throw new ValidationError('Subnet VLAN must belong to the same lab.')
  return vlan.id
}

function validateSubnetChildrenForCidr(subnetId: string, cidr: string) {
  const assignments = db.prepare(`
    SELECT ipAddress
    FROM ipAssignments
    WHERE subnetId = ?
    ORDER BY ipAddress
  `).all(subnetId) as Array<{ ipAddress: string }>
  for (const assignment of assignments) {
    ensureIpBelongsToSubnet(cidr, assignment.ipAddress, `Existing assignment ${assignment.ipAddress}`)
  }

  const scopes = db.prepare(`
    SELECT name, startIp, endIp, gateway
    FROM dhcpScopes
    WHERE subnetId = ?
    ORDER BY name
  `).all(subnetId) as Array<{
    name: string
    startIp: string
    endIp: string
    gateway: string | null
  }>
  for (const scope of scopes) {
    ensureIpRangeBelongsToSubnet(
      cidr,
      scope.startIp,
      scope.endIp,
      `Existing DHCP scope ${scope.name}`,
      `Existing DHCP scope ${scope.name} start IP`,
      `Existing DHCP scope ${scope.name} end IP`,
    )
    if (scope.gateway) {
      ensureGatewayBelongsToSubnet(cidr, scope.gateway, `Existing DHCP scope ${scope.name} gateway`)
    }
  }

  const zones = db.prepare(`
    SELECT kind, startIp, endIp
    FROM ipZones
    WHERE subnetId = ?
    ORDER BY startIp
  `).all(subnetId) as Array<{
    kind: string
    startIp: string
    endIp: string
  }>
  for (const zone of zones) {
    ensureIpRangeBelongsToSubnet(
      cidr,
      zone.startIp,
      zone.endIp,
      `Existing ${zone.kind} IP zone`,
      `Existing ${zone.kind} IP zone start IP`,
      `Existing ${zone.kind} IP zone end IP`,
    )
  }
}

function assertAssignmentSubnet(subnetId: string, ipAddress: string) {
  const subnet = db.prepare('SELECT cidr FROM subnets WHERE id = ?').get(subnetId) as { cidr?: string } | undefined
  if (!subnet?.cidr) {
    throw new Error('Subnet not found.')
  }
  if (!cidrContainsIp(subnet.cidr, ipAddress)) {
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

function dhcpZonesForSubnet(subnetId: string) {
  return db.prepare(`
    SELECT startIp, endIp
    FROM ipZones
    WHERE subnetId = ?
      AND kind = 'dhcp'
    ORDER BY startIp
  `).all(subnetId) as Array<{ startIp: string; endIp: string }>
}

function ipZonesForIp(subnetId: string, ipAddress: string) {
  return (db.prepare(`
    SELECT kind, startIp, endIp
    FROM ipZones
    WHERE subnetId = ?
    ORDER BY startIp
  `).all(subnetId) as Array<{
    kind: (typeof IP_ZONE_KINDS)[number]
    startIp: string
    endIp: string
  }>).filter((zone) => ipInRange(ipAddress, zone.startIp, zone.endIp))
}

function dhcpTechnicalRole(subnetId: string, ipAddress: string) {
  const subnet = db.prepare('SELECT name, gateway, dnsServers FROM subnets WHERE id = ?').get(subnetId) as
    | { name: string; gateway: string | null; dnsServers: string | null }
    | undefined
  if (subnet?.gateway === ipAddress) {
    return { role: 'gateway', reason: `${subnet.name} gateway` }
  }
  if (subnet?.dnsServers) {
    try {
      const dnsServers = JSON.parse(subnet.dnsServers) as unknown
      if (Array.isArray(dnsServers) && dnsServers.some((entry) => String(entry) === ipAddress)) {
        return { role: 'dns', reason: `${subnet.name} DNS server` }
      }
    } catch {
      // Ignore malformed legacy DNS JSON.
    }
  }

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
  if (technical && !TECHNICAL_OVERLAY_ASSIGNMENT_TYPES.has(input.assignmentType)) {
    throw new ValidationError(
      `${input.ipAddress} is ${technical.reason}; document it as an interface, reserved, or infrastructure address instead of assigning it as a normal endpoint.`,
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
  const containingZones = ipZonesForIp(input.subnetId, input.ipAddress)
  const inStaticZone = containingZones.some((zone) => zone.kind === 'static')
  const inDhcpZone = containingZones.some((zone) => zone.kind === 'dhcp')
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
    const dhcpZones = dhcpZonesForSubnet(input.subnetId)
    if ((dhcpZones.length > 0 || containingZones.length > 0) && !inDhcpZone) {
      throw new ValidationError('DHCP reservation IP must be inside a DHCP IP zone.')
    }
  } else if (input.dhcpScopeId) {
    throw new ValidationError('Static assignments cannot reference a DHCP scope.')
  } else if (containingScope && !inStaticZone && HOST_ASSIGNMENT_TYPES.has(input.assignmentType)) {
    throw new ValidationError(
      'Device, interface, VM, and container IPs inside a DHCP scope must be marked as DHCP reservations.',
    )
  }
}

function getSubnetLabRow(subnetId: string) {
  return db.prepare('SELECT id, labId, cidr FROM subnets WHERE id = ?').get(subnetId) as
    | { id: string; labId: string; cidr: string }
    | undefined
}

function getAssignmentLabRow(assignmentId: string) {
  return db.prepare(`
    SELECT ipAssignments.id, subnets.labId
    FROM ipAssignments
    JOIN subnets ON subnets.id = ipAssignments.subnetId
    WHERE ipAssignments.id = ?
  `).get(assignmentId) as { id: string; labId: string } | undefined
}

export const ipamRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string } }>('/subnets', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    const { sql, params } = appendLabFilter('SELECT * FROM subnets', [], filter.labIds)
    return (db.prepare(`${sql} ORDER BY cidr`).all(...params) as Record<string, unknown>[]).map(parseSubnet)
  })

  app.get<{ Params: { id: string } }>('/subnets/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM subnets WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabReadFromRow(req, reply, row)) return
    if (!row) return
    return parseSubnet(row)
  })

  app.post('/subnets', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('s')
    const labId = requiredString(body, 'labId', { maxLength: 80 })
    if (!assertLabWrite(req, reply, labId)) return
    const cidr = ensureCidr(requiredString(body, 'cidr', { maxLength: 40 }))
    const name = requiredString(body, 'name', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const gateway = optionalString(body, 'gateway', { maxLength: 40 })
    const dnsServers = optionalStringArray(body, 'dnsServers', { maxItems: 5 })
    const vlanId = optionalString(body, 'vlanId', { maxLength: 80 })
    const subnetGateway = ensureGatewayBelongsToSubnet(cidr, gateway, 'gateway')
    const normalizedVlanId = normalizeSubnetVlanId(labId, vlanId)
    db.prepare(
      'INSERT INTO subnets (id, labId, cidr, name, description, gateway, dnsServers, vlanId) VALUES (?,?,?,?,?,?,?,?)'
    ).run(
      id,
      labId,
      cidr,
      name,
      description ?? null,
      subnetGateway,
      stringifyDnsServers(dnsServers),
      normalizedVlanId,
    )
    const row = db.prepare('SELECT * FROM subnets WHERE id = ?').get(id) as Record<string, unknown>
    return reply.status(201).send(parseSubnet(row))
  })

  app.patch<{ Params: { id: string } }>('/subnets/:id', async (req, reply) => {
    const existing = db.prepare('SELECT * FROM subnets WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, existing)) return
    const subnet = existing! as { id: string; labId: string; cidr: string; gateway: string | null }
    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const cidr = optionalString(body, 'cidr', { maxLength: 40 })
    const name = optionalString(body, 'name', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const gateway = optionalString(body, 'gateway', { maxLength: 40 })
    const dnsServers = optionalStringArray(body, 'dnsServers', { maxItems: 5 })
    const vlanId = optionalString(body, 'vlanId', { maxLength: 80 })

    let nextCidr = subnet.cidr
    let nextGateway = subnet.gateway ?? null
    let normalizedVlanId: string | null | undefined

    if (cidr !== undefined) {
      // cidr is a NOT NULL column — reject explicit null/empty rather than letting the DB fail
      if (!cidr) return reply.status(400).send({ error: 'cidr cannot be empty.' })
      nextCidr = ensureCidr(cidr)
    }
    if (gateway !== undefined) {
      nextGateway = ensureGatewayBelongsToSubnet(nextCidr, gateway, 'gateway')
    } else if (cidr !== undefined && nextGateway) {
      ensureGatewayBelongsToSubnet(nextCidr, nextGateway, 'gateway')
    }
    if (cidr !== undefined) {
      validateSubnetChildrenForCidr(req.params.id, nextCidr)
    }
    if (vlanId !== undefined) {
      normalizedVlanId = normalizeSubnetVlanId(subnet.labId, vlanId)
    }

    if (cidr !== undefined) {
      updates.push('cidr = ?')
      values.push(nextCidr)
    }
    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }
    if (gateway !== undefined) { updates.push('gateway = ?'); values.push(nextGateway) }
    if (dnsServers !== undefined) { updates.push('dnsServers = ?'); values.push(stringifyDnsServers(dnsServers)) }
    if (vlanId !== undefined) { updates.push('vlanId = ?'); values.push(normalizedVlanId) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields' })
    values.push(req.params.id)
    db.prepare(`UPDATE subnets SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM subnets WHERE id = ?').get(req.params.id) as Record<string, unknown>
    return parseSubnet(row)
  })

  app.delete<{ Params: { id: string } }>('/subnets/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM subnets WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, row)) return
    db.prepare('DELETE FROM subnets WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })

  app.post('/networks', async (req, reply) => {
    const body = asObject(req.body)
    const labId = requiredString(body, 'labId', { maxLength: 80 })
    if (!assertLabWrite(req, reply, labId)) return

    const vlanBody = body.vlan == null ? null : asObject(body.vlan)
    const subnetBody = asObject(body.subnet)
    const dhcpBody = body.dhcpScope == null ? null : asObject(body.dhcpScope)
    const zoneBodies = body.zones == null ? [] : body.zones
    if (!Array.isArray(zoneBodies)) {
      throw new ValidationError('zones must be an array.')
    }

    const vlanDraft = vlanBody
      ? {
          id: optionalString(vlanBody, 'id', { maxLength: 80 }) ?? createId('v'),
          vlanId: requiredInteger(vlanBody, 'vlanId', { min: 1, max: 4094 }),
          name: requiredString(vlanBody, 'name', { maxLength: 120 }),
          description: optionalString(vlanBody, 'description', { maxLength: 500 }),
          color: optionalString(vlanBody, 'color', { maxLength: 30 }),
        }
      : null

    const subnetDraft = {
      id: optionalString(subnetBody, 'id', { maxLength: 80 }) ?? createId('s'),
      cidr: ensureCidr(requiredString(subnetBody, 'cidr', { maxLength: 40 })),
      name: requiredString(subnetBody, 'name', { maxLength: 120 }),
      description: optionalString(subnetBody, 'description', { maxLength: 500 }),
      gateway: optionalString(subnetBody, 'gateway', { maxLength: 40 }),
      dnsServers: optionalStringArray(subnetBody, 'dnsServers', { maxItems: 5 }),
    }
    const subnetGateway = ensureGatewayBelongsToSubnet(subnetDraft.cidr, subnetDraft.gateway, 'gateway')

    const dhcpDraft = dhcpBody
      ? {
          id: optionalString(dhcpBody, 'id', { maxLength: 80 }) ?? createId('sc'),
          name: requiredString(dhcpBody, 'name', { maxLength: 120 }),
          startIp: ensureIpv4(requiredString(dhcpBody, 'startIp', { maxLength: 40 }), 'startIp'),
          endIp: ensureIpv4(requiredString(dhcpBody, 'endIp', { maxLength: 40 }), 'endIp'),
          gateway: optionalString(dhcpBody, 'gateway', { maxLength: 40 }),
          dnsServers: optionalStringArray(dhcpBody, 'dnsServers', { maxItems: 5 }),
          description: optionalString(dhcpBody, 'description', { maxLength: 500 }),
        }
      : null
    if (dhcpDraft) {
      ensureDhcpScopeBelongsToSubnet(subnetDraft.cidr, dhcpDraft.startIp, dhcpDraft.endIp)
    }

    const zoneDrafts = zoneBodies.map((entry) => {
      const zoneBody = asObject(entry)
      const startIp = ensureIpv4(requiredString(zoneBody, 'startIp', { maxLength: 40 }), 'startIp')
      const endIp = ensureIpv4(requiredString(zoneBody, 'endIp', { maxLength: 40 }), 'endIp')
      ensureIpZoneBelongsToSubnet(subnetDraft.cidr, startIp, endIp)
      return {
        id: optionalString(zoneBody, 'id', { maxLength: 80 }) ?? createId('iz'),
        kind: requiredEnum(zoneBody, 'kind', IP_ZONE_KINDS),
        startIp,
        endIp,
        description: optionalString(zoneBody, 'description', { maxLength: 500 }),
      }
    })

    const createNetwork = db.transaction(() => {
      let vlan: Record<string, unknown> | null = null
      if (vlanDraft) {
        db.prepare(
          'INSERT INTO vlans (id, labId, vlanId, name, description, color) VALUES (?,?,?,?,?,?)',
        ).run(
          vlanDraft.id,
          labId,
          vlanDraft.vlanId,
          vlanDraft.name,
          vlanDraft.description ?? null,
          vlanDraft.color ?? null,
        )
        vlan = db.prepare('SELECT * FROM vlans WHERE id = ?').get(vlanDraft.id) as Record<string, unknown>
      }

      db.prepare(
        'INSERT INTO subnets (id, labId, cidr, name, description, gateway, dnsServers, vlanId) VALUES (?,?,?,?,?,?,?,?)',
      ).run(
        subnetDraft.id,
        labId,
        subnetDraft.cidr,
        subnetDraft.name,
        subnetDraft.description ?? null,
        subnetGateway,
        stringifyDnsServers(subnetDraft.dnsServers),
        vlanDraft?.id ?? null,
      )
      const subnet = parseSubnet(db.prepare('SELECT * FROM subnets WHERE id = ?').get(subnetDraft.id) as Record<string, unknown>)

      let dhcpScope: Record<string, unknown> | null = null
      if (dhcpDraft) {
        const scopeGateway = ensureGatewayBelongsToSubnet(subnetDraft.cidr, dhcpDraft.gateway, 'gateway')
        db.prepare(
          'INSERT INTO dhcpScopes (id, subnetId, name, startIp, endIp, gateway, dnsServers, description) VALUES (?,?,?,?,?,?,?,?)',
        ).run(
          dhcpDraft.id,
          subnetDraft.id,
          dhcpDraft.name,
          dhcpDraft.startIp,
          dhcpDraft.endIp,
          scopeGateway,
          stringifyDnsServers(dhcpDraft.dnsServers),
          dhcpDraft.description ?? null,
        )
        dhcpScope = parseScope(db.prepare('SELECT * FROM dhcpScopes WHERE id = ?').get(dhcpDraft.id) as Record<string, unknown>)
      }

      const ipZones = zoneDrafts.map((zone) => {
        db.prepare(
          'INSERT INTO ipZones (id, subnetId, kind, startIp, endIp, description) VALUES (?,?,?,?,?,?)',
        ).run(zone.id, subnetDraft.id, zone.kind, zone.startIp, zone.endIp, zone.description ?? null)
        return db.prepare('SELECT * FROM ipZones WHERE id = ?').get(zone.id) as Record<string, unknown>
      })

      return { vlan, subnet, dhcpScope, ipZones }
    })

    return reply.status(201).send(createNetwork())
  })

  // ORDER BY added for consistency with all other list endpoints
  app.get<{ Querystring: { subnetId?: string; labId?: string } }>('/dhcp-scopes', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    let sql = `
      SELECT dhcpScopes.*
      FROM dhcpScopes
      JOIN subnets ON subnets.id = dhcpScopes.subnetId
      WHERE 1=1
    `
    const params: unknown[] = []
    if (req.query.subnetId) {
      sql += ' AND dhcpScopes.subnetId = ?'
      params.push(req.query.subnetId)
    }
    const filtered = appendLabFilter(sql, params, filter.labIds, 'subnets.labId')
    const rows = db.prepare(`${filtered.sql} ORDER BY dhcpScopes.subnetId, dhcpScopes.name`).all(...filtered.params)
    return (rows as Record<string, unknown>[]).map(parseScope)
  })

  app.post('/dhcp-scopes', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('sc')
    const subnetId = requiredString(body, 'subnetId', { maxLength: 80 })
    const subnet = getSubnetLabRow(subnetId)
    if (!subnet) return reply.status(404).send({ error: 'Subnet not found.' })
    if (!assertLabWrite(req, reply, subnet.labId)) return
    const name = requiredString(body, 'name', { maxLength: 120 })
    const startIp = ensureIpv4(requiredString(body, 'startIp', { maxLength: 40 }), 'startIp')
    const endIp = ensureIpv4(requiredString(body, 'endIp', { maxLength: 40 }), 'endIp')
    const gateway = optionalString(body, 'gateway', { maxLength: 40 })
    const dnsServers = optionalStringArray(body, 'dnsServers', { maxItems: 5 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    ensureDhcpScopeBelongsToSubnet(subnet.cidr, startIp, endIp)
    const scopeGateway = ensureGatewayBelongsToSubnet(subnet.cidr, gateway, 'gateway')
    db.prepare(
      'INSERT INTO dhcpScopes (id, subnetId, name, startIp, endIp, gateway, dnsServers, description) VALUES (?,?,?,?,?,?,?,?)'
    ).run(id, subnetId, name, startIp, endIp,
      scopeGateway,
      stringifyDnsServers(dnsServers),
      description ?? null)
    const row = db.prepare('SELECT * FROM dhcpScopes WHERE id = ?').get(id) as Record<string, unknown>
    return reply.status(201).send(parseScope(row))
  })

  app.patch<{ Params: { id: string } }>('/dhcp-scopes/:id', async (req, reply) => {
    const existing = db.prepare(`
      SELECT dhcpScopes.*, subnets.labId, subnets.cidr AS subnetCidr
      FROM dhcpScopes
      JOIN subnets ON subnets.id = dhcpScopes.subnetId
      WHERE dhcpScopes.id = ?
    `).get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, existing)) return
    const scope = existing! as { startIp: string; endIp: string; subnetCidr: string }
    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const name = optionalString(body, 'name', { maxLength: 120 })
    const startIp = optionalString(body, 'startIp', { maxLength: 40 })
    const endIp = optionalString(body, 'endIp', { maxLength: 40 })
    const gateway = optionalString(body, 'gateway', { maxLength: 40 })
    const dnsServers = optionalStringArray(body, 'dnsServers', { maxItems: 5 })
    const description = optionalString(body, 'description', { maxLength: 500 })

    let nextStartIp = scope.startIp
    let nextEndIp = scope.endIp
    let nextGateway: string | null | undefined

    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (startIp !== undefined) {
      // startIp is NOT NULL — reject explicit null/empty before the DB sees it
      if (!startIp) return reply.status(400).send({ error: 'startIp cannot be empty.' })
      nextStartIp = ensureIpv4(startIp, 'startIp')
      updates.push('startIp = ?')
      values.push(nextStartIp)
    }
    if (endIp !== undefined) {
      // endIp is NOT NULL — same guard
      if (!endIp) return reply.status(400).send({ error: 'endIp cannot be empty.' })
      nextEndIp = ensureIpv4(endIp, 'endIp')
      updates.push('endIp = ?')
      values.push(nextEndIp)
    }
    if (startIp !== undefined || endIp !== undefined) {
      ensureDhcpScopeBelongsToSubnet(scope.subnetCidr, nextStartIp, nextEndIp)
    }
    if (gateway !== undefined) {
      nextGateway = ensureGatewayBelongsToSubnet(scope.subnetCidr, gateway, 'gateway')
      updates.push('gateway = ?')
      values.push(nextGateway)
    }
    if (dnsServers !== undefined) { updates.push('dnsServers = ?'); values.push(stringifyDnsServers(dnsServers)) }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields' })
    values.push(req.params.id)
    db.prepare(`UPDATE dhcpScopes SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM dhcpScopes WHERE id = ?').get(req.params.id) as Record<string, unknown>
    return parseScope(row)
  })

  app.delete<{ Params: { id: string } }>('/dhcp-scopes/:id', async (req, reply) => {
    const row = db.prepare(`
      SELECT dhcpScopes.id, subnets.labId
      FROM dhcpScopes
      JOIN subnets ON subnets.id = dhcpScopes.subnetId
      WHERE dhcpScopes.id = ?
    `).get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, row)) return
    db.prepare('DELETE FROM dhcpScopes WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })

  app.get<{ Querystring: { subnetId?: string; labId?: string } }>('/ip-zones', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    let sql = `
      SELECT ipZones.*
      FROM ipZones
      JOIN subnets ON subnets.id = ipZones.subnetId
      WHERE 1=1
    `
    const params: unknown[] = []
    if (req.query.subnetId) {
      sql += ' AND ipZones.subnetId = ?'
      params.push(req.query.subnetId)
    }
    const filtered = appendLabFilter(sql, params, filter.labIds, 'subnets.labId')
    return db.prepare(`${filtered.sql} ORDER BY ipZones.subnetId, ipZones.startIp`).all(...filtered.params)
  })

  app.post('/ip-zones', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('iz')
    const subnetId = requiredString(body, 'subnetId', { maxLength: 80 })
    const subnet = getSubnetLabRow(subnetId)
    if (!subnet) return reply.status(404).send({ error: 'Subnet not found.' })
    if (!assertLabWrite(req, reply, subnet.labId)) return
    const kind = requiredEnum(body, 'kind', IP_ZONE_KINDS)
    const startIp = ensureIpv4(requiredString(body, 'startIp', { maxLength: 40 }), 'startIp')
    const endIp = ensureIpv4(requiredString(body, 'endIp', { maxLength: 40 }), 'endIp')
    const description = optionalString(body, 'description', { maxLength: 500 })
    ensureIpZoneBelongsToSubnet(subnet.cidr, startIp, endIp)
    db.prepare(
      'INSERT INTO ipZones (id, subnetId, kind, startIp, endIp, description) VALUES (?,?,?,?,?,?)'
    ).run(id, subnetId, kind, startIp, endIp, description ?? null)
    return reply.status(201).send(db.prepare('SELECT * FROM ipZones WHERE id = ?').get(id))
  })

  app.patch<{ Params: { id: string } }>('/ip-zones/:id', async (req, reply) => {
    const existing = db.prepare(`
      SELECT ipZones.*, subnets.labId, subnets.cidr AS subnetCidr
      FROM ipZones
      JOIN subnets ON subnets.id = ipZones.subnetId
      WHERE ipZones.id = ?
    `).get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, existing)) return
    const zone = existing! as { startIp: string; endIp: string; subnetCidr: string }
    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const startIp = optionalString(body, 'startIp', { maxLength: 40 })
    const endIp = optionalString(body, 'endIp', { maxLength: 40 })
    const description = optionalString(body, 'description', { maxLength: 500 })

    let nextStartIp = zone.startIp
    let nextEndIp = zone.endIp

    if ('kind' in body) { updates.push('kind = ?'); values.push(requiredEnum(body, 'kind', IP_ZONE_KINDS)) }
    if (startIp !== undefined) {
      if (!startIp) return reply.status(400).send({ error: 'startIp cannot be empty.' })
      nextStartIp = ensureIpv4(startIp, 'startIp')
      updates.push('startIp = ?')
      values.push(nextStartIp)
    }
    if (endIp !== undefined) {
      if (!endIp) return reply.status(400).send({ error: 'endIp cannot be empty.' })
      nextEndIp = ensureIpv4(endIp, 'endIp')
      updates.push('endIp = ?')
      values.push(nextEndIp)
    }
    if (startIp !== undefined || endIp !== undefined) {
      ensureIpZoneBelongsToSubnet(zone.subnetCidr, nextStartIp, nextEndIp)
    }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields' })
    values.push(req.params.id)
    db.prepare(`UPDATE ipZones SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM ipZones WHERE id = ?').get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/ip-zones/:id', async (req, reply) => {
    const row = db.prepare(`
      SELECT ipZones.id, subnets.labId
      FROM ipZones
      JOIN subnets ON subnets.id = ipZones.subnetId
      WHERE ipZones.id = ?
    `).get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, row)) return
    db.prepare('DELETE FROM ipZones WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })

  app.get<{ Querystring: { subnetId?: string; deviceId?: string; labId?: string } }>('/ip-assignments', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    let sql = `
      SELECT ipAssignments.*
      FROM ipAssignments
      JOIN subnets ON subnets.id = ipAssignments.subnetId
      WHERE 1=1
    `
    const params: unknown[] = []
    if (req.query.subnetId) { sql += ' AND ipAssignments.subnetId = ?'; params.push(req.query.subnetId) }
    if (req.query.deviceId) { sql += ' AND ipAssignments.deviceId = ?'; params.push(req.query.deviceId) }
    const filtered = appendLabFilter(sql, params, filter.labIds, 'subnets.labId')
    return db.prepare(`${filtered.sql} ORDER BY ipAssignments.ipAddress`).all(...filtered.params)
  })

  app.get<{ Params: { id: string } }>('/ip-assignments/:id', async (req, reply) => {
    const row = db.prepare(`
      SELECT ipAssignments.*, subnets.labId
      FROM ipAssignments
      JOIN subnets ON subnets.id = ipAssignments.subnetId
      WHERE ipAssignments.id = ?
    `).get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabReadFromRow(req, reply, row)) return
    return row
  })

  app.post('/ip-assignments', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('ip')
    const subnetId = requiredString(body, 'subnetId', { maxLength: 80 })
    const subnet = getSubnetLabRow(subnetId)
    if (!subnet) return reply.status(404).send({ error: 'Subnet not found.' })
    if (!assertLabWrite(req, reply, subnet.labId)) return
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
    const existing = db.prepare(`
      SELECT ipAssignments.*, subnets.labId
      FROM ipAssignments
      JOIN subnets ON subnets.id = ipAssignments.subnetId
      WHERE ipAssignments.id = ?
    `).get(req.params.id) as
      | ({ subnetId: string; ipAddress: string; assignmentType: (typeof ASSIGNMENT_TYPES)[number]; allocationMode?: string | null; dhcpScopeId?: string | null } & Record<string, unknown>)
      | undefined
    if (!assertLabWriteFromRow(req, reply, existing)) return
    const assignment = existing!
    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const subnetId = optionalString(body, 'subnetId', { maxLength: 80 })
    if (subnetId) {
      const nextSubnet = getSubnetLabRow(subnetId)
      if (!nextSubnet) return reply.status(404).send({ error: 'Subnet not found.' })
      if (!assertLabWrite(req, reply, nextSubnet.labId)) return
    }
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
      : assignment.assignmentType

    const effectiveSubnetId = subnetId ?? assignment.subnetId
    const effectiveIpAddress = ipAddress ?? assignment.ipAddress
    const effectiveAllocationMode =
      allocationMode ??
      (assignment.allocationMode === 'dhcp-reservation' ? 'dhcp-reservation' : 'static')
    const effectiveDhcpScopeId =
      dhcpScopeId !== undefined
        ? dhcpScopeId
        : assignment.dhcpScopeId
          ? String(assignment.dhcpScopeId)
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
    const row = getAssignmentLabRow(req.params.id)
    if (!assertLabWriteFromRow(req, reply, row)) return

    const assignment = db.prepare('SELECT deviceId, ipAddress FROM ipAssignments WHERE id = ?').get(req.params.id) as
      | { deviceId?: string | null; ipAddress: string }
      | undefined

    const deleteAssignment = db.transaction((assignmentId: string, deviceId: string | null | undefined, ipAddress: string) => {
      if (deviceId) {
        db.prepare(
          'UPDATE devices SET managementIp = NULL WHERE id = ? AND managementIp = ?'
        ).run(deviceId, ipAddress)
      }
      db.prepare('DELETE FROM ipAssignments WHERE id = ?').run(assignmentId)
    })

    deleteAssignment(req.params.id, assignment?.deviceId, assignment?.ipAddress ?? '')
    return reply.status(204).send()
  })
}

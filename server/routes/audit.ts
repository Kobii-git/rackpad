import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { createId } from '../lib/ids.js'
import { requireAuth } from '../lib/auth.js'
import { canReadLab, canWriteLab } from '../lib/lab-access.js'
import { asObject, parseLimit, requiredString } from '../lib/validation.js'

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { entityId?: string; entityType?: string; limit?: string } }>('/', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    if (req.authUser.role !== 'admin') {
      if (!req.query.entityId || !req.query.entityType) {
        return []
      }
      const labIds = getAuditEntityLabIds(req.query.entityType, req.query.entityId)
      const canRead = labIds.some((labId) => canReadLab(req.authUser!, labId, req.labAccess ?? []))
      if (!canRead) {
        return reply.status(403).send({ error: 'You do not have access to this audit entry.' })
      }
    }

    let sql = 'SELECT * FROM auditLog WHERE 1=1'
    const params: unknown[] = []
    if (req.query.entityId) { sql += ' AND entityId = ?'; params.push(req.query.entityId) }
    if (req.query.entityType) { sql += ' AND entityType = ?'; params.push(req.query.entityType) }
    sql += ' ORDER BY ts DESC'
    sql += ` LIMIT ${parseLimit(req.query.limit, 100, 500)}`
    return db.prepare(sql).all(...params)
  })

  app.post('/', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const body = asObject(req.body)
    const id = createId('a')
    const ts = new Date().toISOString()
    const action = requiredString(body, 'action', { maxLength: 120 })
    const entityType = requiredString(body, 'entityType', { maxLength: 120 })
    const entityId = requiredString(body, 'entityId', { maxLength: 120 })
    const summary = requiredString(body, 'summary', { maxLength: 500 })
    const user = req.authUser.username

    if (req.authUser.role !== 'admin') {
      const labIds = getAuditEntityLabIds(entityType, entityId)
      const canWrite = labIds.some((labId) => canWriteLab(req.authUser!, labId, req.labAccess ?? []))
      if (!canWrite) {
        return reply.status(403).send({ error: 'You do not have write access to this audit entity.' })
      }
    }

    db.prepare(
      'INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary) VALUES (?,?,?,?,?,?,?)'
    ).run(id, ts, user, action, entityType, entityId, summary)
    return reply.status(201).send(db.prepare('SELECT * FROM auditLog WHERE id = ?').get(id))
  })
}

function getAuditEntityLabIds(entityType: string, entityId: string) {
  const type = entityType.trim()
  const id = entityId.trim()
  if (!type || !id) return []

  switch (type) {
    case 'Lab':
      return hasLab(id) ? [id] : []
    case 'Rack':
      return queryLabIds('SELECT labId FROM racks WHERE id = ?', id)
    case 'Room':
      return queryLabIds('SELECT labId FROM rooms WHERE id = ?', id)
    case 'Device':
      return queryLabIds('SELECT labId FROM devices WHERE id = ?', id)
    case 'Port':
      return queryLabIds(`
        SELECT devices.labId
        FROM ports
        JOIN devices ON devices.id = ports.deviceId
        WHERE ports.id = ?
      `, id)
    case 'PortLink':
      return queryLabIds(`
        SELECT devices.labId
        FROM portLinks
        JOIN ports ON ports.id = portLinks.fromPortId
        JOIN devices ON devices.id = ports.deviceId
        WHERE portLinks.id = ?
      `, id)
    case 'VirtualSwitch':
      return queryLabIds(`
        SELECT devices.labId
        FROM virtualSwitches
        JOIN devices ON devices.id = virtualSwitches.hostDeviceId
        WHERE virtualSwitches.id = ?
      `, id)
    case 'Vlan':
      return queryLabIds('SELECT labId FROM vlans WHERE id = ?', id)
    case 'VlanRange':
      return queryLabIds('SELECT labId FROM vlanRanges WHERE id = ?', id)
    case 'Subnet':
      return queryLabIds('SELECT labId FROM subnets WHERE id = ?', id)
    case 'DhcpScope':
      return queryLabIds(`
        SELECT subnets.labId
        FROM dhcpScopes
        JOIN subnets ON subnets.id = dhcpScopes.subnetId
        WHERE dhcpScopes.id = ?
      `, id)
    case 'IpZone':
      return queryLabIds(`
        SELECT subnets.labId
        FROM ipZones
        JOIN subnets ON subnets.id = ipZones.subnetId
        WHERE ipZones.id = ?
      `, id)
    case 'IpAssignment':
      return queryLabIds(`
        SELECT subnets.labId
        FROM ipAssignments
        JOIN subnets ON subnets.id = ipAssignments.subnetId
        WHERE ipAssignments.id = ?
      `, id)
    case 'DeviceMonitor':
      return queryLabIds(`
        SELECT devices.labId
        FROM deviceMonitors
        JOIN devices ON devices.id = deviceMonitors.deviceId
        WHERE deviceMonitors.id = ?
      `, id)
    case 'DiscoveredDevice':
      return queryLabIds('SELECT labId FROM discoveredDevices WHERE id = ?', id)
    case 'DocumentationPage':
      return queryLabIds('SELECT labId FROM documentationPages WHERE id = ?', id)
    case 'DeviceImage':
      return queryLabIds(`
        SELECT devices.labId
        FROM deviceImages
        JOIN devices ON devices.id = deviceImages.deviceId
        WHERE deviceImages.id = ?
      `, id)
    case 'DeviceService':
      return queryLabIds(`
        SELECT devices.labId
        FROM deviceServices
        JOIN devices ON devices.id = deviceServices.deviceId
        WHERE deviceServices.id = ?
      `, id)
    case 'ReferenceImage':
      return queryLabIds('SELECT labId FROM referenceImages WHERE id = ?', id)
    case 'WifiController':
      return queryLabIds('SELECT labId FROM wifiControllers WHERE id = ?', id)
    case 'WifiSsid':
      return queryLabIds('SELECT labId FROM wifiSsids WHERE id = ?', id)
    case 'WifiAccessPoint':
      return queryLabIds(`
        SELECT devices.labId
        FROM wifiAccessPoints
        JOIN devices ON devices.id = wifiAccessPoints.deviceId
        WHERE wifiAccessPoints.deviceId = ?
      `, id)
    case 'WifiRadio':
      return queryLabIds(`
        SELECT devices.labId
        FROM wifiRadios
        JOIN devices ON devices.id = wifiRadios.apDeviceId
        WHERE wifiRadios.id = ?
      `, id)
    case 'WifiClientAssociation':
      return queryLabIds(`
        SELECT devices.labId
        FROM wifiClientAssociations
        JOIN devices ON devices.id = wifiClientAssociations.clientDeviceId
        WHERE wifiClientAssociations.clientDeviceId = ?
      `, id)
    default:
      return []
  }
}

function hasLab(labId: string) {
  const row = db.prepare('SELECT id FROM labs WHERE id = ?').get(labId)
  return Boolean(row)
}

function queryLabIds(sql: string, id: string) {
  const rows = db.prepare(sql).all(id) as Array<{ labId?: string | null }>
  return [...new Set(rows.map((row) => row.labId).filter((labId): labId is string => Boolean(labId)))]
}

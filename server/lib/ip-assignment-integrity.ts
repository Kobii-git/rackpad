import { db } from '../db.js'
import { ValidationError } from './validation.js'

export type AssignmentReferenceField =
  | 'deviceId'
  | 'portId'
  | 'vmId'
  | 'containerId'

export interface AssignmentIntegrity {
  state: 'ok' | 'cross-lab-reference' | 'missing-reference' | 'reference-mismatch'
  fields: AssignmentReferenceField[]
}

type AssignmentReferences = {
  deviceId?: string | null
  portId?: string | null
  vmId?: string | null
  containerId?: string | null
}

type DeviceRow = { id: string; labId: string }
type PortRow = { id: string; deviceId: string; labId: string }

function deviceById(id: string) {
  return db.prepare('SELECT id, labId FROM devices WHERE id = ?').get(id) as
    | DeviceRow
    | undefined
}

function portById(id: string) {
  return db.prepare(`
    SELECT ports.id, ports.deviceId, devices.labId
    FROM ports
    JOIN devices ON devices.id = ports.deviceId
    WHERE ports.id = ?
  `).get(id) as PortRow | undefined
}

function crossLab(message: string, field: AssignmentReferenceField, targetId: string) {
  throw new ValidationError(message, 422, 'CROSS_LAB_REFERENCE', {
    field,
    targetId,
  })
}

export function validateAssignmentReferences(
  subnetId: string,
  references: AssignmentReferences,
) {
  const subnet = db.prepare('SELECT id, labId FROM subnets WHERE id = ?').get(subnetId) as
    | { id: string; labId: string }
    | undefined
  if (!subnet) throw new ValidationError('Subnet not found.', 404)

  if (references.deviceId) {
    const device = deviceById(references.deviceId)
    if (!device) throw new ValidationError('Selected device does not exist.', 422)
    if (device.labId !== subnet.labId) {
      crossLab('Selected device must belong to the subnet lab.', 'deviceId', device.id)
    }
  }

  if (references.portId) {
    const port = portById(references.portId)
    if (!port) throw new ValidationError('Selected port does not exist.', 422)
    if (port.labId !== subnet.labId) {
      crossLab('Selected port must belong to the subnet lab.', 'portId', port.id)
    }
    if (references.deviceId && port.deviceId !== references.deviceId) {
      throw new ValidationError('Selected port must belong to the selected device.', 422)
    }
  }

  for (const field of ['vmId', 'containerId'] as const) {
    const targetId = references[field]
    if (!targetId) continue
    const device = deviceById(targetId)
    if (device && device.labId !== subnet.labId) {
      crossLab(
        `Selected ${field === 'vmId' ? 'VM' : 'container'} must belong to the subnet lab.`,
        field,
        targetId,
      )
    }
  }

  return subnet.labId
}

export function inspectAssignmentReferences(
  subnetLabId: string,
  references: AssignmentReferences,
): AssignmentIntegrity {
  const crossLabFields: AssignmentReferenceField[] = []
  const missingFields: AssignmentReferenceField[] = []
  const mismatchFields: AssignmentReferenceField[] = []

  if (references.deviceId) {
    const device = deviceById(references.deviceId)
    if (!device) missingFields.push('deviceId')
    else if (device.labId !== subnetLabId) crossLabFields.push('deviceId')
  }
  if (references.portId) {
    const port = portById(references.portId)
    if (!port) missingFields.push('portId')
    else if (port.labId !== subnetLabId) crossLabFields.push('portId')
    else if (references.deviceId && port.deviceId !== references.deviceId) {
      mismatchFields.push('portId')
    }
  }
  for (const field of ['vmId', 'containerId'] as const) {
    const targetId = references[field]
    if (!targetId) continue
    const device = deviceById(targetId)
    if (device && device.labId !== subnetLabId) crossLabFields.push(field)
  }

  if (crossLabFields.length > 0) {
    return {
      state: 'cross-lab-reference',
      fields: [...new Set([...crossLabFields, ...mismatchFields, ...missingFields])],
    }
  }
  if (mismatchFields.length > 0) {
    return {
      state: 'reference-mismatch',
      fields: [...new Set([...mismatchFields, ...missingFields])],
    }
  }
  if (missingFields.length > 0) {
    return { state: 'missing-reference', fields: missingFields }
  }
  return { state: 'ok', fields: [] }
}

export function serializeAssignmentWithIntegrity<T extends Record<string, unknown>>(
  row: T,
  subnetLabId: string,
  isAdmin: boolean,
) {
  const integrity = inspectAssignmentReferences(subnetLabId, {
    deviceId: row.deviceId ? String(row.deviceId) : null,
    portId: row.portId ? String(row.portId) : null,
    vmId: row.vmId ? String(row.vmId) : null,
    containerId: row.containerId ? String(row.containerId) : null,
  })
  const result: Record<string, unknown> = { ...row, integrity }
  if (!isAdmin && integrity.state !== 'ok') {
    for (const field of integrity.fields) result[field] = null
  }
  return result
}

export function listAssignmentIntegrityIssues() {
  const rows = db.prepare(`
    SELECT ipAssignments.*, subnets.labId AS subnetLabId
    FROM ipAssignments
    JOIN subnets ON subnets.id = ipAssignments.subnetId
    ORDER BY subnets.labId, ipAssignments.ipAddress, ipAssignments.id
  `).all() as Array<Record<string, unknown> & { subnetLabId: string }>

  return rows.flatMap((row) => {
    const integrity = inspectAssignmentReferences(String(row.subnetLabId), {
      deviceId: row.deviceId ? String(row.deviceId) : null,
      portId: row.portId ? String(row.portId) : null,
      vmId: row.vmId ? String(row.vmId) : null,
      containerId: row.containerId ? String(row.containerId) : null,
    })
    if (integrity.state === 'ok') return []
    return [{
      id: String(row.id),
      subnetId: String(row.subnetId),
      subnetLabId: String(row.subnetLabId),
      ipAddress: String(row.ipAddress),
      integrity,
      references: {
        deviceId: row.deviceId ? String(row.deviceId) : null,
        portId: row.portId ? String(row.portId) : null,
        vmId: row.vmId ? String(row.vmId) : null,
        containerId: row.containerId ? String(row.containerId) : null,
      },
    }]
  })
}

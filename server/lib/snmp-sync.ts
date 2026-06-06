import { db } from '../db.js'
import { createId } from './ids.js'
import type {
  SnmpCollectedDhcpScope,
  SnmpProfileCollection,
  SnmpSyncApplyResult,
  SnmpSyncPolicy,
  SnmpSyncPreview,
  SnmpSyncSubnetDiff,
  SnmpSyncVlanDiff,
} from './snmp-profiles/types.js'

interface ExistingVlan {
  id: string
  vlanId: number
  name: string
}

interface ExistingSubnet {
  id: string
  cidr: string
  name: string
  vlanId?: string | null
}

export function buildSnmpSyncPreview(input: {
  profileId: string
  deviceId: string
  labId: string
  target: string
  policy: SnmpSyncPolicy
  collection: SnmpProfileCollection
  collectedAt?: string
}): SnmpSyncPreview {
  const existingVlans = db
    .prepare('SELECT id, vlanId, name FROM vlans WHERE labId = ?')
    .all(input.labId) as ExistingVlan[]
  const existingSubnets = db
    .prepare('SELECT id, cidr, name, vlanId FROM subnets WHERE labId = ?')
    .all(input.labId) as ExistingSubnet[]

  const vlanByNumber = new Map(existingVlans.map((vlan) => [Number(vlan.vlanId), vlan]))
  const subnetByCidr = new Map(
    existingSubnets.map((subnet) => [normalizeCidr(subnet.cidr), subnet]),
  )
  const rackpadVlanById = new Map(existingVlans.map((vlan) => [vlan.id, vlan]))

  const vlans: SnmpSyncVlanDiff[] = []
  const seenVlanNumbers = new Set<number>()

  for (const collected of input.collection.vlans) {
    seenVlanNumbers.add(collected.vlanNumber)
    const existing = vlanByNumber.get(collected.vlanNumber)
    if (!existing) {
      vlans.push({
        action: 'create',
        vlanNumber: collected.vlanNumber,
        name: collected.name,
      })
      continue
    }

    const changes: string[] = []
    if (existing.name.trim() !== collected.name.trim()) {
      changes.push(`name: ${existing.name} -> ${collected.name}`)
    }

    if (changes.length === 0) {
      vlans.push({
        action: 'unchanged',
        vlanNumber: collected.vlanNumber,
        name: collected.name,
        existingId: existing.id,
        existingName: existing.name,
      })
      continue
    }

    vlans.push({
      action: input.policy === 'mirror' ? 'update' : 'unchanged',
      vlanNumber: collected.vlanNumber,
      name: collected.name,
      existingId: existing.id,
      existingName: existing.name,
      changes,
    })
  }

  if (input.policy === 'mirror') {
    for (const existing of existingVlans) {
      if (seenVlanNumbers.has(Number(existing.vlanId))) continue
      vlans.push({
        action: 'delete',
        vlanNumber: Number(existing.vlanId),
        name: existing.name,
        existingId: existing.id,
        existingName: existing.name,
        blockedReason: vlanDeleteBlockedReason(existing.id),
      })
    }
  }

  const subnets: SnmpSyncSubnetDiff[] = []
  const seenCidrs = new Set<string>()

  for (const collected of input.collection.subnets) {
    const cidr = normalizeCidr(collected.cidr)
    seenCidrs.add(cidr)
    const existing = subnetByCidr.get(cidr)
    const linkedVlanId =
      collected.vlanNumber != null
        ? vlanByNumber.get(collected.vlanNumber)?.id ?? null
        : null

    if (!existing) {
      subnets.push({
        action: 'create',
        cidr,
        name: collected.name,
        vlanNumber: collected.vlanNumber ?? null,
      })
      continue
    }

    const changes: string[] = []
    if (existing.name.trim() !== collected.name.trim()) {
      changes.push(`name: ${existing.name} -> ${collected.name}`)
    }
    if (linkedVlanId && existing.vlanId !== linkedVlanId) {
      const fromName =
        existing.vlanId != null
          ? rackpadVlanById.get(existing.vlanId)?.name ?? existing.vlanId
          : 'none'
      const toName =
        vlanByNumber.get(collected.vlanNumber!)?.name ?? String(collected.vlanNumber)
      changes.push(`vlan: ${fromName} -> ${toName}`)
    }

    if (changes.length === 0) {
      subnets.push({
        action: 'unchanged',
        cidr,
        name: collected.name,
        vlanNumber: collected.vlanNumber ?? null,
        existingId: existing.id,
        existingName: existing.name,
      })
      continue
    }

    subnets.push({
      action: input.policy === 'mirror' ? 'update' : 'unchanged',
      cidr,
      name: collected.name,
      vlanNumber: collected.vlanNumber ?? null,
      existingId: existing.id,
      existingName: existing.name,
      changes,
    })
  }

  if (input.policy === 'mirror') {
    for (const existing of existingSubnets) {
      const cidr = normalizeCidr(existing.cidr)
      if (seenCidrs.has(cidr)) continue
      subnets.push({
        action: 'delete',
        cidr,
        name: existing.name,
        existingId: existing.id,
        existingName: existing.name,
        blockedReason: subnetDeleteBlockedReason(existing.id),
      })
    }
  }

  const warnings: string[] = []
  if (input.collection.vlans.length === 0 && input.collection.subnets.length === 0) {
    warnings.push('SNMP walk returned no VLAN or subnet inventory for this profile.')
  }
  if (input.collection.dhcpScopes.length > 0) {
    warnings.push('DHCP scopes were detected only as preview metadata; apply does not modify DHCP in v1.')
  }

  return {
    profileId: input.profileId,
    deviceId: input.deviceId,
    labId: input.labId,
    target: input.target,
    collectedAt: input.collectedAt ?? new Date().toISOString(),
    policy: input.policy,
    vlans,
    subnets,
    dhcp: buildDhcpPreview(input.collection.dhcpScopes),
    summary: summarizeDiff(vlans, subnets),
    warnings,
  }
}

export function applySnmpSyncPreview(input: {
  preview: SnmpSyncPreview
  allowDeletes?: boolean
  actor: string
}): SnmpSyncApplyResult {
  const result: SnmpSyncApplyResult = {
    profileId: input.preview.profileId,
    deviceId: input.preview.deviceId,
    labId: input.preview.labId,
    policy: input.preview.policy,
    createdVlanIds: [],
    updatedVlanIds: [],
    deletedVlanIds: [],
    createdSubnetIds: [],
    updatedSubnetIds: [],
    deletedSubnetIds: [],
    skippedDeletes: 0,
    warnings: [...input.preview.warnings],
  }

  const vlanIdByNumber = new Map<number, string>(
    (
      db
        .prepare('SELECT id, vlanId FROM vlans WHERE labId = ?')
        .all(input.preview.labId) as Array<{ id: string; vlanId: number }>
    ).map((row) => [Number(row.vlanId), row.id]),
  )

  const apply = db.transaction(() => {
    for (const diff of input.preview.vlans) {
      if (input.preview.policy === 'merge' && diff.action !== 'create') continue
      if (diff.action === 'create') {
        const id = createId('v')
        db.prepare(`
          INSERT INTO vlans (id, labId, vlanId, name, description, color)
          VALUES (?, ?, ?, ?, NULL, NULL)
        `).run(id, input.preview.labId, diff.vlanNumber, diff.name)
        vlanIdByNumber.set(diff.vlanNumber, id)
        result.createdVlanIds.push(id)
        writeSyncAudit(input.actor, 'snmp.sync.vlan.create', id, `Created VLAN ${diff.vlanNumber} (${diff.name}).`)
        continue
      }

      if (diff.action === 'update' && diff.existingId) {
        db.prepare('UPDATE vlans SET name = ? WHERE id = ?').run(diff.name, diff.existingId)
        result.updatedVlanIds.push(diff.existingId)
        writeSyncAudit(
          input.actor,
          'snmp.sync.vlan.update',
          diff.existingId,
          `Updated VLAN ${diff.vlanNumber} name to ${diff.name}.`,
        )
        continue
      }

      if (diff.action === 'delete' && diff.existingId) {
        if (!input.allowDeletes || diff.blockedReason) {
          result.skippedDeletes += 1
          continue
        }
        db.prepare('DELETE FROM vlans WHERE id = ?').run(diff.existingId)
        result.deletedVlanIds.push(diff.existingId)
        writeSyncAudit(
          input.actor,
          'snmp.sync.vlan.delete',
          diff.existingId,
          `Deleted VLAN ${diff.vlanNumber} (${diff.existingName ?? diff.name}).`,
        )
      }
    }

    for (const diff of input.preview.subnets) {
      if (input.preview.policy === 'merge' && diff.action !== 'create') continue
      if (diff.action === 'create') {
        const id = createId('s')
        const linkedVlanId =
          diff.vlanNumber != null ? vlanIdByNumber.get(diff.vlanNumber) ?? null : null
        db.prepare(`
          INSERT INTO subnets (id, labId, cidr, name, description, vlanId)
          VALUES (?, ?, ?, ?, NULL, ?)
        `).run(id, input.preview.labId, diff.cidr, diff.name, linkedVlanId)
        result.createdSubnetIds.push(id)
        writeSyncAudit(input.actor, 'snmp.sync.subnet.create', id, `Created subnet ${diff.cidr}.`)
        continue
      }

      if (diff.action === 'update' && diff.existingId) {
        const linkedVlanId =
          diff.vlanNumber != null ? vlanIdByNumber.get(diff.vlanNumber) ?? null : null
        db.prepare(`
          UPDATE subnets
          SET name = ?, vlanId = COALESCE(?, vlanId)
          WHERE id = ?
        `).run(diff.name, linkedVlanId, diff.existingId)
        result.updatedSubnetIds.push(diff.existingId)
        writeSyncAudit(
          input.actor,
          'snmp.sync.subnet.update',
          diff.existingId,
          `Updated subnet ${diff.cidr}.`,
        )
        continue
      }

      if (diff.action === 'delete' && diff.existingId) {
        if (!input.allowDeletes || diff.blockedReason) {
          result.skippedDeletes += 1
          continue
        }
        db.prepare('DELETE FROM subnets WHERE id = ?').run(diff.existingId)
        result.deletedSubnetIds.push(diff.existingId)
        writeSyncAudit(
          input.actor,
          'snmp.sync.subnet.delete',
          diff.existingId,
          `Deleted subnet ${diff.cidr}.`,
        )
      }
    }
  })

  apply()
  writeSyncAudit(
    input.actor,
    'snmp.sync.apply',
    input.preview.deviceId,
    `SNMP sync (${input.preview.profileId}, ${input.preview.policy}) created ${result.createdVlanIds.length} VLAN(s) and ${result.createdSubnetIds.length} subnet(s).`,
  )
  return result
}

function buildDhcpPreview(scopes: SnmpCollectedDhcpScope[]) {
  if (scopes.length === 0) {
    return {
      supported: false,
      message: 'DHCP scope sync is preview-only in v1. No scopes were collected for this profile.',
      scopes: [],
    }
  }
  return {
    supported: false,
    message: 'DHCP scope sync is preview-only in v1. Review scopes below; apply will not modify DHCP.',
    scopes,
  }
}

function summarizeDiff(vlans: SnmpSyncVlanDiff[], subnets: SnmpSyncSubnetDiff[]) {
  return {
    vlanCreates: vlans.filter((entry) => entry.action === 'create').length,
    vlanUpdates: vlans.filter((entry) => entry.action === 'update').length,
    vlanDeletes: vlans.filter((entry) => entry.action === 'delete').length,
    subnetCreates: subnets.filter((entry) => entry.action === 'create').length,
    subnetUpdates: subnets.filter((entry) => entry.action === 'update').length,
    subnetDeletes: subnets.filter((entry) => entry.action === 'delete').length,
  }
}

function vlanDeleteBlockedReason(vlanRecordId: string) {
  const portCount = db
    .prepare('SELECT COUNT(*) AS count FROM ports WHERE vlanId = ?')
    .get(vlanRecordId) as { count: number }
  if (Number(portCount.count) > 0) {
    return 'VLAN is referenced by ports.'
  }
  const subnetCount = db
    .prepare('SELECT COUNT(*) AS count FROM subnets WHERE vlanId = ?')
    .get(vlanRecordId) as { count: number }
  if (Number(subnetCount.count) > 0) {
    return 'VLAN is linked to subnets.'
  }
  return null
}

function subnetDeleteBlockedReason(subnetId: string) {
  const assignmentCount = db
    .prepare('SELECT COUNT(*) AS count FROM ipAssignments WHERE subnetId = ?')
    .get(subnetId) as { count: number }
  if (Number(assignmentCount.count) > 0) {
    return 'Subnet has IP assignments.'
  }
  const scopeCount = db
    .prepare('SELECT COUNT(*) AS count FROM dhcpScopes WHERE subnetId = ?')
    .get(subnetId) as { count: number }
  if (Number(scopeCount.count) > 0) {
    return 'Subnet has DHCP scopes.'
  }
  return null
}

function normalizeCidr(cidr: string) {
  return cidr.trim()
}

function writeSyncAudit(
  actor: string,
  action: string,
  entityId: string,
  summary: string,
) {
  db.prepare(`
    INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
    VALUES (?, ?, ?, ?, 'SnmpSync', ?, ?)
  `).run(createId('a'), new Date().toISOString(), actor, action, entityId, summary)
}

export function snmpInventorySyncEnabled() {
  const raw = process.env.SNMP_INVENTORY_SYNC?.trim().toLowerCase()
  if (!raw) return false
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

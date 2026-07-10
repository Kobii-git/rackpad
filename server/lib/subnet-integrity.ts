import { db } from '../db.js'
import { canonicalizeIpv4Cidr, cidrOverlaps } from './ip-cidr.js'
import { ValidationError } from './validation.js'

export type SubnetIntegrityState = 'ok' | 'legacy-overlap' | 'invalid-cidr'

export interface SubnetConflictSummary {
  id: string
  cidr: string
  name: string
}

export interface SubnetIntegrity {
  state: SubnetIntegrityState
  canonicalCidr: string | null
  conflicts: SubnetConflictSummary[]
}

type SubnetRow = {
  id: string
  labId: string
  cidr: string
  name: string
}

function labSubnets(labId: string) {
  return db.prepare(
    'SELECT id, labId, cidr, name FROM subnets WHERE labId = ? ORDER BY cidr, id',
  ).all(labId) as SubnetRow[]
}

export function getSubnetIntegrity(input: SubnetRow): SubnetIntegrity {
  let canonicalCidr: string
  try {
    canonicalCidr = canonicalizeIpv4Cidr(input.cidr)
  } catch {
    return { state: 'invalid-cidr', canonicalCidr: null, conflicts: [] }
  }

  const conflicts: SubnetConflictSummary[] = []
  for (const candidate of labSubnets(input.labId)) {
    if (candidate.id === input.id) continue
    try {
      if (!cidrOverlaps(canonicalCidr, canonicalizeIpv4Cidr(candidate.cidr))) continue
    } catch {
      continue
    }
    conflicts.push({ id: candidate.id, cidr: candidate.cidr, name: candidate.name })
  }

  return {
    state: conflicts.length > 0 ? 'legacy-overlap' : 'ok',
    canonicalCidr,
    conflicts,
  }
}

export function enrichSubnetIntegrity<T extends Record<string, unknown>>(row: T) {
  const integrity = getSubnetIntegrity({
    id: String(row.id),
    labId: String(row.labId),
    cidr: String(row.cidr),
    name: String(row.name),
  })
  return { ...row, integrity }
}

export function assertSubnetCidrAvailable(
  labId: string,
  cidr: string,
  excludeId?: string,
) {
  const canonicalCidr = canonicalizeIpv4Cidr(cidr)
  const conflicts = labSubnets(labId)
    .filter((subnet) => subnet.id !== excludeId)
    .filter((subnet) => {
      try {
        return cidrOverlaps(canonicalCidr, canonicalizeIpv4Cidr(subnet.cidr))
      } catch {
        return false
      }
    })
    .map(({ id, cidr: conflictingCidr, name }) => ({ id, cidr: conflictingCidr, name }))

  if (conflicts.length > 0) {
    throw new ValidationError(
      `Subnet ${canonicalCidr} overlaps an existing subnet in this lab.`,
      409,
      'SUBNET_OVERLAP',
      { canonicalCidr, conflicts },
    )
  }
  return canonicalCidr
}

export function assertSubnetIntegrityHealthy(subnetId: string) {
  const subnet = db.prepare(
    'SELECT id, labId, cidr, name FROM subnets WHERE id = ?',
  ).get(subnetId) as SubnetRow | undefined
  if (!subnet) throw new ValidationError('Subnet not found.', 404)
  const integrity = getSubnetIntegrity(subnet)
  if (integrity.state !== 'ok') {
    throw new ValidationError(
      'This subnet has an unresolved integrity conflict and is read-only until an administrator repairs it.',
      409,
      'SUBNET_INTEGRITY_CONFLICT',
      { integrity },
    )
  }
  return subnet
}

export function assertSubnetChildMutationAllowed(
  subnetId: string,
  isAdmin: boolean,
) {
  const subnet = db.prepare(
    'SELECT id, labId, cidr, name FROM subnets WHERE id = ?',
  ).get(subnetId) as SubnetRow | undefined
  if (!subnet) throw new ValidationError('Subnet not found.', 404)
  const integrity = getSubnetIntegrity(subnet)
  if (integrity.state !== 'ok' && !isAdmin) {
    throw new ValidationError(
      'Only an administrator can change existing records on a subnet with an unresolved integrity conflict.',
      403,
      'SUBNET_INTEGRITY_CONFLICT',
      { integrity },
    )
  }
  return subnet
}

export function normalizeSafeSubnetCidrs() {
  const rows = db.prepare(
    'SELECT id, labId, cidr, name FROM subnets ORDER BY labId, cidr, id',
  ).all() as SubnetRow[]
  const byLab = new Map<string, SubnetRow[]>()
  for (const row of rows) {
    const list = byLab.get(row.labId) ?? []
    list.push(row)
    byLab.set(row.labId, list)
  }

  const updates: Array<{ id: string; cidr: string }> = []
  for (const labRows of byLab.values()) {
    const parsed = labRows.map((row) => {
      try {
        return { row, canonical: canonicalizeIpv4Cidr(row.cidr) }
      } catch {
        return { row, canonical: null }
      }
    })
    for (const entry of parsed) {
      if (!entry.canonical) continue
      const overlaps = parsed.some((candidate) =>
        candidate.row.id !== entry.row.id &&
        candidate.canonical != null &&
        cidrOverlaps(entry.canonical!, candidate.canonical),
      )
      if (!overlaps && entry.row.cidr !== entry.canonical) {
        updates.push({ id: entry.row.id, cidr: entry.canonical })
      }
    }
  }

  const apply = db.transaction(() => {
    const update = db.prepare('UPDATE subnets SET cidr = ? WHERE id = ?')
    for (const row of updates) update.run(row.cidr, row.id)
  })
  apply()
  return updates.length
}

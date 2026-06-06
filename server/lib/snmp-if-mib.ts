import {
  buildInterfaceOperStatusOid,
  oidSuffixIndex,
  snmpWalkColumn,
  type SnmpSession,
} from './snmp.js'

const IF_DESCR = '1.3.6.1.2.1.2.2.1.2'
const IF_OPER_STATUS = '1.3.6.1.2.1.2.2.1.8'
const IF_NAME = '1.3.6.1.2.1.31.1.1.1.1'
const IF_ALIAS = '1.3.6.1.2.1.31.1.1.1.18'
const IF_HIGHSPEED = '1.3.6.1.2.1.31.1.1.1.15'

export interface DiscoveredSnmpInterface {
  ifIndex: number
  descr: string
  name?: string | null
  alias?: string | null
  operStatus?: number | null
  operStatusLabel?: string | null
  operStatusOid: string
  highSpeedMbps?: number | null
}

export function formatSnmpHighSpeedMbps(mbps: number): string | null {
  if (!Number.isFinite(mbps) || mbps <= 0) return null
  if (mbps >= 1_000_000) {
    const t = mbps / 1_000_000
    return Number.isInteger(t) ? `${t}T` : `${trimSpeed(t)}T`
  }
  if (mbps >= 1000) {
    const g = mbps / 1000
    return Number.isInteger(g) ? `${g}G` : `${trimSpeed(g)}G`
  }
  return Number.isInteger(mbps) ? `${mbps}M` : `${trimSpeed(mbps)}M`
}

function trimSpeed(value: number) {
  return value
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1')
}

const OPER_STATUS_LABELS: Record<number, string> = {
  1: 'up',
  2: 'down',
  3: 'testing',
  4: 'unknown',
  5: 'dormant',
  6: 'notPresent',
  7: 'lowerLayerDown',
}

export async function discoverIfMibInterfaces(
  session: SnmpSession,
): Promise<DiscoveredSnmpInterface[]> {
  const [descrRows, operRows, nameRows, aliasRows, highSpeedRows] =
    await Promise.all([
      snmpWalkColumn(session, IF_DESCR).catch(() => []),
      snmpWalkColumn(session, IF_OPER_STATUS).catch(() => []),
      snmpWalkColumn(session, IF_NAME).catch(() => []),
      snmpWalkColumn(session, IF_ALIAS).catch(() => []),
      snmpWalkColumn(session, IF_HIGHSPEED).catch(() => []),
    ])

  const byIndex = new Map<number, DiscoveredSnmpInterface>()

  for (const row of descrRows) {
    const ifIndex = oidSuffixIndex(row.oid, IF_DESCR)
    if (ifIndex == null) continue
    byIndex.set(ifIndex, {
      ifIndex,
      descr: row.value,
      operStatusOid: buildInterfaceOperStatusOid(ifIndex),
    })
  }

  for (const row of operRows) {
    const ifIndex = oidSuffixIndex(row.oid, IF_OPER_STATUS)
    if (ifIndex == null) continue
    const operStatus = Number.parseInt(row.value, 10)
    const existing = byIndex.get(ifIndex) ?? {
      ifIndex,
      descr: `ifIndex ${ifIndex}`,
      operStatusOid: buildInterfaceOperStatusOid(ifIndex),
    }
    existing.operStatus = Number.isFinite(operStatus) ? operStatus : null
    existing.operStatusLabel =
      existing.operStatus == null
        ? null
        : (OPER_STATUS_LABELS[existing.operStatus] ?? String(existing.operStatus))
    byIndex.set(ifIndex, existing)
  }

  for (const row of nameRows) {
    const ifIndex = oidSuffixIndex(row.oid, IF_NAME)
    if (ifIndex == null) continue
    const existing = byIndex.get(ifIndex)
    if (!existing) continue
    existing.name = row.value
    byIndex.set(ifIndex, existing)
  }

  for (const row of aliasRows) {
    const ifIndex = oidSuffixIndex(row.oid, IF_ALIAS)
    if (ifIndex == null) continue
    const existing = byIndex.get(ifIndex)
    if (!existing) continue
    existing.alias = row.value
    byIndex.set(ifIndex, existing)
  }

  for (const row of highSpeedRows) {
    const ifIndex = oidSuffixIndex(row.oid, IF_HIGHSPEED)
    if (ifIndex == null) continue
    const highSpeedMbps = Number.parseInt(row.value, 10)
    const existing = byIndex.get(ifIndex)
    if (!existing) continue
    existing.highSpeedMbps = Number.isFinite(highSpeedMbps) ? highSpeedMbps : null
    byIndex.set(ifIndex, existing)
  }

  return [...byIndex.values()].sort((a, b) => a.ifIndex - b.ifIndex)
}

export function interfaceMonitorName(entry: DiscoveredSnmpInterface) {
  const label = entry.name?.trim() || entry.alias?.trim() || entry.descr.trim()
  return label ? `${label} (ifIndex ${entry.ifIndex})` : `ifIndex ${entry.ifIndex}`
}

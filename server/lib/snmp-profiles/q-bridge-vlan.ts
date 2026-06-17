import { snmpWalkColumn, type SnmpSession } from '../snmp.js'
import type { SnmpCollectedVlan, SnmpProfileCollection, SnmpProfileDefinition } from './types.js'

const DOT1Q_VLAN_STATIC_NAME = '1.3.6.1.2.1.17.7.1.4.3.1.1'

export function parseDot1qVlanStaticNames(
  rows: Array<{ oid: string; value: string }>,
): SnmpCollectedVlan[] {
  const byNumber = new Map<number, SnmpCollectedVlan>()

  for (const row of rows) {
    const vlanNumber = parseDot1qVlanStaticIndex(row.oid, DOT1Q_VLAN_STATIC_NAME)
    if (vlanNumber == null || vlanNumber < 1 || vlanNumber > 4094) continue
    const name = row.value.trim() || `VLAN ${vlanNumber}`
    byNumber.set(vlanNumber, { vlanNumber, name })
  }

  return [...byNumber.values()].sort((a, b) => a.vlanNumber - b.vlanNumber)
}

export function parseDot1qVlanStaticIndex(oid: string, columnOid: string) {
  const normalized = oid.replace(/^\./, '')
  const prefix = columnOid.replace(/^\./, '')
  if (!normalized.startsWith(`${prefix}.`)) return null
  const suffix = normalized.slice(prefix.length + 1)
  const parts = suffix.split('.')
  const vlanIndex = Number.parseInt(parts.at(-1) ?? '', 10)
  return Number.isFinite(vlanIndex) ? vlanIndex : null
}

export async function collectQBridgeVlans(session: SnmpSession): Promise<SnmpProfileCollection> {
  const rows = await snmpWalkColumn(session, DOT1Q_VLAN_STATIC_NAME).catch(() => [])
  return {
    vlans: parseDot1qVlanStaticNames(rows),
    subnets: [],
    dhcpScopes: [],
  }
}

export const qBridgeVlanProfile: SnmpProfileDefinition = {
  id: 'q-bridge-vlans',
  label: 'Q-BRIDGE VLANs',
  vendor: 'Standard (Q-BRIDGE-MIB)',
  description:
    'Reads dot1qVlanStaticName from Q-BRIDGE-MIB for VLAN inventory on managed switches.',
  deviceTypes: ['switch', 'router', 'firewall'],
  collects: ['vlans'],
  collect: collectQBridgeVlans,
}

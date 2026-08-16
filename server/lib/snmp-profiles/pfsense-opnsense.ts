import type { SnmpSession } from '../snmp.js'
import { collectIpAdEntSubnets } from './ip-adent-subnets.js'
import { collectQBridgeVlans } from './q-bridge-vlan.js'
import type { SnmpProfileCollection, SnmpProfileDefinition } from './types.js'

export async function collectPfsenseOpnsense(
  session: SnmpSession,
): Promise<SnmpProfileCollection> {
  const [vlans, subnets] = await Promise.all([
    collectQBridgeVlans(session),
    collectIpAdEntSubnets(session),
  ])
  return {
    vlans: vlans.vlans,
    subnets: subnets.subnets,
    dhcpScopes: [],
  }
}

export const pfsenseOpnsenseProfile: SnmpProfileDefinition = {
  id: 'pfsense-opnsense',
  label: 'pfSense / OPNsense inventory',
  vendor: 'Netgate / Deciso',
  description:
    'Collects the standard VLAN and interface subnet MIBs exposed by pfSense and OPNsense while retaining the generic profiles as fallback.',
  deviceTypes: ['firewall', 'router'],
  collects: ['vlans', 'subnets'],
  collect: collectPfsenseOpnsense,
}

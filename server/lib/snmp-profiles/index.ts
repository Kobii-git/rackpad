import { collectIpAdEntSubnets, ipAdEntSubnetsProfile } from './ip-adent-subnets.js'
import { collectQBridgeVlans, qBridgeVlanProfile } from './q-bridge-vlan.js'
import type { SnmpProfileDefinition, SnmpProfileCollection } from './types.js'
import type { SnmpSession } from '../snmp.js'

export * from './types.js'
export { parseDot1qVlanStaticNames, parseDot1qVlanStaticIndex } from './q-bridge-vlan.js'
export { parseIpAdEntSubnets } from './ip-adent-subnets.js'

const PROFILES: SnmpProfileDefinition[] = [
  qBridgeVlanProfile,
  ipAdEntSubnetsProfile,
  {
    id: 'standard-l2-l3',
    label: 'Standard L2 + L3 inventory',
    vendor: 'Standard (Q-BRIDGE + IP-MIB)',
    description:
      'Combines Q-BRIDGE VLAN names with IP-MIB interface subnets for a single preview/apply pass.',
    deviceTypes: ['switch', 'router', 'firewall'],
    collects: ['vlans', 'subnets'],
    collect: async (session: SnmpSession): Promise<SnmpProfileCollection> => {
      const [vlans, subnets] = await Promise.all([
        collectQBridgeVlans(session),
        collectIpAdEntSubnets(session),
      ])
      return {
        vlans: vlans.vlans,
        subnets: subnets.subnets,
        dhcpScopes: [],
      }
    },
  },
]

const profileById = new Map(PROFILES.map((profile) => [profile.id, profile]))

export function listSnmpProfiles() {
  return PROFILES.map(({ collect: _collect, ...profile }) => profile)
}

export function getSnmpProfile(profileId: string) {
  return profileById.get(profileId) ?? null
}

export async function collectSnmpProfile(profileId: string, session: SnmpSession) {
  const profile = getSnmpProfile(profileId)
  if (!profile) {
    throw new Error(`Unknown SNMP profile: ${profileId}`)
  }
  return profile.collect(session)
}

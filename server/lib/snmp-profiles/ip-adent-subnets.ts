import { buildIpv4Cidr, oidSuffixToIpv4 } from '../ip-cidr.js'
import { snmpWalkColumn, type SnmpSession } from '../snmp.js'
import type { SnmpCollectedSubnet, SnmpProfileCollection, SnmpProfileDefinition } from './types.js'

const IP_ADENT_ADDR = '1.3.6.1.2.1.4.20.1.1'
const IP_ADENT_NETMASK = '1.3.6.1.2.1.4.20.1.3'

export function parseIpAdEntSubnets(input: {
  addressRows: Array<{ oid: string; value: string }>
  maskRows: Array<{ oid: string; value: string }>
}): SnmpCollectedSubnet[] {
  const masksByIp = new Map<string, string>()
  for (const row of input.maskRows) {
    const ip = oidSuffixToIpv4(row.oid, IP_ADENT_NETMASK)
    if (!ip) continue
    masksByIp.set(ip, row.value.trim())
  }

  const byCidr = new Map<string, SnmpCollectedSubnet>()
  for (const row of input.addressRows) {
    const ip = oidSuffixToIpv4(row.oid, IP_ADENT_ADDR) ?? row.value.trim()
    if (!ip || ip.startsWith('127.') || ip === '0.0.0.0') continue
    const mask = masksByIp.get(ip)
    if (!mask) continue
    const cidr = buildIpv4Cidr(ip, mask)
    if (!cidr) continue
    if (cidr.endsWith('/32') && (ip.startsWith('169.254.') || ip.endsWith('.0'))) {
      continue
    }
    byCidr.set(cidr, {
      cidr,
      name: `SNMP ${cidr}`,
    })
  }

  return [...byCidr.values()].sort((a, b) => a.cidr.localeCompare(b.cidr))
}

export async function collectIpAdEntSubnets(session: SnmpSession): Promise<SnmpProfileCollection> {
  const [addressRows, maskRows] = await Promise.all([
    snmpWalkColumn(session, IP_ADENT_ADDR).catch(() => []),
    snmpWalkColumn(session, IP_ADENT_NETMASK).catch(() => []),
  ])

  return {
    vlans: [],
    subnets: parseIpAdEntSubnets({ addressRows, maskRows }),
    dhcpScopes: [],
  }
}

export const ipAdEntSubnetsProfile: SnmpProfileDefinition = {
  id: 'ip-adent-subnets',
  label: 'IP-MIB interface subnets',
  vendor: 'Standard (IP-MIB)',
  description:
    'Builds subnet CIDR blocks from ipAdEntAddr and ipAdEntNetMask on routers, firewalls, and L3 switches.',
  deviceTypes: ['router', 'firewall', 'switch', 'server'],
  collects: ['subnets'],
  collect: collectIpAdEntSubnets,
}

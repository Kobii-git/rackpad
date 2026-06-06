import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDot1qVlanStaticNames } from '../lib/snmp-profiles/q-bridge-vlan.js'
import { parseIpAdEntSubnets } from '../lib/snmp-profiles/ip-adent-subnets.js'
import { buildIpv4Cidr } from '../lib/ip-cidr.js'

test('parseDot1qVlanStaticNames maps Q-BRIDGE static VLAN rows', () => {
  const vlans = parseDot1qVlanStaticNames([
    { oid: '1.3.6.1.2.1.17.7.1.4.3.1.1.0.10', value: 'Lab-Users' },
    { oid: '1.3.6.1.2.1.17.7.1.4.3.1.1.0.20', value: 'Servers' },
  ])
  assert.deepEqual(vlans, [
    { vlanNumber: 10, name: 'Lab-Users' },
    { vlanNumber: 20, name: 'Servers' },
  ])
})

test('parseIpAdEntSubnets builds unique CIDR blocks from IP-MIB rows', () => {
  const subnets = parseIpAdEntSubnets({
    addressRows: [
      { oid: '1.3.6.1.2.1.4.20.1.1.192.168.10.1', value: '192.168.10.1' },
      { oid: '1.3.6.1.2.1.4.20.1.1.10.0.0.1', value: '10.0.0.1' },
    ],
    maskRows: [
      { oid: '1.3.6.1.2.1.4.20.1.3.192.168.10.1', value: '255.255.255.0' },
      { oid: '1.3.6.1.2.1.4.20.1.3.10.0.0.1', value: '255.255.0.0' },
    ],
  })
  assert.deepEqual(
    subnets.map((subnet) => subnet.cidr),
    ['10.0.0.0/16', '192.168.10.0/24'],
  )
})

test('buildIpv4Cidr normalizes interface addresses to network CIDR', () => {
  assert.equal(buildIpv4Cidr('192.168.1.10', '255.255.255.0'), '192.168.1.0/24')
})

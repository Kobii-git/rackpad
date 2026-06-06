import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractIfIndex,
  parseSnmpTrapPacket,
  SNMP_TRAP_LINK_DOWN_OID,
  SNMP_TRAP_LINK_UP_OID,
  trapOidToLinkResult,
} from '../lib/snmp-trap-parser.js'
import { buildSnmpV2TrapPacket } from '../lib/snmp-trap-build.js'

test('parseSnmpTrapPacket extracts trap OID and ifIndex from SNMPv2 traps', () => {
  const packet = buildSnmpV2TrapPacket({
    trapOid: SNMP_TRAP_LINK_DOWN_OID,
    ifIndex: 7,
  })
  const parsed = parseSnmpTrapPacket(packet)
  assert.equal(parsed.snmpVersion, '2c')
  assert.equal(parsed.trapOid, SNMP_TRAP_LINK_DOWN_OID)
  assert.equal(parsed.ifIndex, 7)
  assert.equal(trapOidToLinkResult(parsed.trapOid), 'offline')
})

test('trapOidToLinkResult maps linkUp traps to online', () => {
  assert.equal(trapOidToLinkResult(SNMP_TRAP_LINK_UP_OID), 'online')
  assert.equal(trapOidToLinkResult(SNMP_TRAP_LINK_DOWN_OID), 'offline')
  assert.equal(extractIfIndex([{ oid: '1.3.6.1.2.1.2.2.1.1.12', value: '12' }]), 12)
})

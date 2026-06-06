import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatSnmpHighSpeedMbps } from '../lib/snmp-if-mib.js'

test('formatSnmpHighSpeedMbps maps IF-MIB megabit values to port labels', () => {
  assert.equal(formatSnmpHighSpeedMbps(100), '100M')
  assert.equal(formatSnmpHighSpeedMbps(1000), '1G')
  assert.equal(formatSnmpHighSpeedMbps(10000), '10G')
  assert.equal(formatSnmpHighSpeedMbps(0), null)
})

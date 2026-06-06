import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, test } from 'node:test'

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'rackpad-snmp-sync-test-'))
process.env.DATABASE_PATH = path.join(tempDir, 'rackpad-test.db')
process.env.NODE_ENV = 'test'
process.env.RACKPAD_SECRET_KEY = 'rackpad-test-secret-key'

const { db } = await import('../db.js')
const { buildSnmpSyncPreview, applySnmpSyncPreview } = await import('../lib/snmp-sync.js')

after(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  db.prepare('DELETE FROM ipAssignments').run()
  db.prepare('DELETE FROM dhcpScopes').run()
  db.prepare('DELETE FROM subnets').run()
  db.prepare('DELETE FROM vlans').run()
  db.prepare(`
    INSERT OR IGNORE INTO labs (id, name, description, location)
    VALUES ('lab_home', 'Home Lab', NULL, NULL)
  `).run()
})

test('buildSnmpSyncPreview merge proposes creates only', () => {
  db.prepare(`
    INSERT INTO vlans (id, labId, vlanId, name, description, color)
    VALUES ('v_existing', 'lab_home', 10, 'Old Name', NULL, NULL)
  `).run()

  const preview = buildSnmpSyncPreview({
    profileId: 'standard-l2-l3',
    deviceId: 'dev_test',
    labId: 'lab_home',
    target: '10.0.0.1',
    policy: 'merge',
    collection: {
      vlans: [
        { vlanNumber: 10, name: 'Users' },
        { vlanNumber: 20, name: 'Servers' },
      ],
      subnets: [{ cidr: '192.168.20.0/24', name: 'SNMP 192.168.20.0/24' }],
      dhcpScopes: [],
    },
  })

  assert.equal(preview.summary.vlanCreates, 1)
  assert.equal(preview.summary.vlanUpdates, 0)
  assert.equal(preview.summary.vlanDeletes, 0)
  assert.equal(preview.summary.subnetCreates, 1)
  assert.equal(
    preview.vlans.find((entry) => entry.vlanNumber === 10)?.action,
    'unchanged',
  )
})

test('buildSnmpSyncPreview mirror marks missing inventory as delete with blockers', () => {
  db.prepare(`
    INSERT INTO vlans (id, labId, vlanId, name, description, color)
    VALUES ('v_keep', 'lab_home', 99, 'Legacy', NULL, NULL)
  `).run()
  db.prepare(`
    INSERT INTO subnets (id, labId, cidr, name, description, vlanId)
    VALUES ('s_keep', 'lab_home', '10.10.0.0/24', 'Legacy subnet', NULL, NULL)
  `).run()
  db.prepare(`
    INSERT INTO ipAssignments (id, subnetId, ipAddress, assignmentType)
    VALUES ('ip1', 's_keep', '10.10.0.10', 'static')
  `).run()

  const preview = buildSnmpSyncPreview({
    profileId: 'standard-l2-l3',
    deviceId: 'dev_test',
    labId: 'lab_home',
    target: '10.0.0.1',
    policy: 'mirror',
    collection: {
      vlans: [],
      subnets: [],
      dhcpScopes: [],
    },
  })

  const vlanDelete = preview.vlans.find((entry) => entry.vlanNumber === 99)
  const subnetDelete = preview.subnets.find((entry) => entry.cidr === '10.10.0.0/24')
  assert.equal(vlanDelete?.action, 'delete')
  assert.equal(subnetDelete?.action, 'delete')
  assert.equal(subnetDelete?.blockedReason, 'Subnet has IP assignments.')
})

test('applySnmpSyncPreview merge creates inventory and skips deletes', () => {
  const preview = buildSnmpSyncPreview({
    profileId: 'standard-l2-l3',
    deviceId: 'dev_test',
    labId: 'lab_home',
    target: '10.0.0.1',
    policy: 'merge',
    collection: {
      vlans: [{ vlanNumber: 30, name: 'Guest' }],
      subnets: [{ cidr: '172.16.30.0/24', name: 'Guest subnet' }],
      dhcpScopes: [],
    },
  })

  const result = applySnmpSyncPreview({
    preview,
    actor: 'admin',
  })

  assert.equal(result.createdVlanIds.length, 1)
  assert.equal(result.createdSubnetIds.length, 1)
  assert.equal(result.skippedDeletes, 0)

  const vlan = db
    .prepare('SELECT name FROM vlans WHERE labId = ? AND vlanId = ?')
    .get('lab_home', 30) as { name: string }
  assert.equal(vlan.name, 'Guest')
})

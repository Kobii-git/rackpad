import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { decryptSecret } from '../lib/secret-crypto.js'

const testKey = 'synthetic-migration-key'
function initialize(file: string, key = testKey) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "const { db } = await import('./server/db.ts'); db.close()"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_PATH: file, RACKPAD_SECRET_KEY: key, NODE_ENV: 'test' }, encoding: 'utf8',
  })
}
function legacyFixture(file: string) {
  assert.equal(initialize(file).status, 0)
  const db = new Database(file)
  db.exec(`
    ALTER TABLE deviceMonitors DROP COLUMN snmpCommunityEnc;
    ALTER TABLE oidcIdentities DROP COLUMN roleRecheckRequired;
    UPDATE schemaVersion SET version = 49;
    INSERT INTO labs (id, name) VALUES ('lab_test', 'Synthetic lab');
    INSERT INTO devices (id, labId, hostname, deviceType) VALUES ('device_test', 'lab_test', 'test-switch', 'switch');
    INSERT INTO deviceMonitors (id, deviceId, type, target, snmpCommunity) VALUES ('monitor_test', 'device_test', 'snmp', '10.0.0.50', 'synthetic-private-community');
    INSERT INTO users (id, username, displayName, passwordHash, role, createdAt) VALUES ('local', 'local', 'Local', 'synthetic', 'admin', '2026-01-01');
    INSERT INTO users (id, username, displayName, passwordHash, role, createdAt) VALUES ('oidc', 'oidc', 'OIDC', 'oidc:synthetic', 'admin', '2026-01-01');
    INSERT INTO oidcIdentities (issuer, subject, userId, createdAt, updatedAt) VALUES ('https://idp.example.test', 'subject', 'oidc', '2026-01-01', '2026-01-01');
    INSERT INTO userSessions (id, userId, tokenHash, createdAt, expiresAt) VALUES ('local_session', 'local', 'synthetic-local-hash', '2026-01-01', '2027-01-01');
    INSERT INTO userSessions (id, userId, tokenHash, createdAt, expiresAt) VALUES ('oidc_session', 'oidc', 'synthetic-oidc-hash', '2026-01-01', '2027-01-01');
    INSERT INTO snmpCredentials (id, labId, name, version, createdAt, updatedAt) VALUES ('credential_test', 'lab_test', 'Synthetic', '2c', '2026-01-01', '2026-01-01');
    UPDATE devices SET snmpCredentialId = 'credential_test';
    INSERT INTO snmpTrapSources (id, labId, deviceId, sourceIp, community, credentialId) VALUES ('source_test', 'lab_test', 'device_test', '10.0.0.50', 'synthetic-observed', 'credential_test');
  `)
  db.close()
}

test('migration 50 encrypts legacy communities, revokes only OIDC sessions, and clears learned source trust', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rackpad-migration-'))
  const file = path.join(directory, 'legacy.db')
  try {
    legacyFixture(file)
    const result = initialize(file)
    assert.equal(result.status, 0, result.stderr)
    const db = new Database(file, { readonly: true })
    try {
      assert.equal((db.prepare('SELECT version FROM schemaVersion').get() as { version: number }).version, 50)
      const monitor = db.prepare('SELECT snmpCommunity, snmpCommunityEnc FROM deviceMonitors').get() as { snmpCommunity: null; snmpCommunityEnc: string }
      assert.equal(monitor.snmpCommunity, null)
      process.env.RACKPAD_SECRET_KEY = testKey
      assert.equal(decryptSecret(monitor.snmpCommunityEnc), 'synthetic-private-community')
      assert.deepEqual(db.prepare('SELECT id FROM userSessions').all(), [{ id: 'local_session' }])
      assert.deepEqual(db.prepare('SELECT roleRecheckRequired FROM oidcIdentities').get(), { roleRecheckRequired: 1 })
      assert.deepEqual(db.prepare('SELECT community, credentialId FROM snmpTrapSources').get(), { community: null, credentialId: null })
      assert.deepEqual(db.prepare('SELECT snmpCredentialId FROM devices').get(), { snmpCredentialId: 'credential_test' })
    } finally { db.close() }
    assert.equal(initialize(file).status, 0, 'restart must not rerun migration')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('a missing key rolls back both schema and data changes before startup', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rackpad-migration-failure-'))
  const file = path.join(directory, 'legacy.db')
  try {
    legacyFixture(file)
    const result = initialize(file, '')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /RACKPAD_SECRET_KEY/)
    assert.ok(!result.stderr.includes('synthetic-private-community'))
    const db = new Database(file, { readonly: true })
    try {
      assert.deepEqual(db.prepare('SELECT version FROM schemaVersion').get(), { version: 49 })
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM userSessions').get() as { n: number }).n, 2)
      assert.equal((db.prepare('SELECT snmpCommunity FROM deviceMonitors').get() as { snmpCommunity: string }).snmpCommunity, 'synthetic-private-community')
      assert.ok(!(db.prepare('PRAGMA table_info(deviceMonitors)').all() as { name: string }[]).some((column) => column.name === 'snmpCommunityEnc'))
      assert.deepEqual(db.prepare('SELECT credentialId FROM snmpTrapSources').get(), { credentialId: 'credential_test' })
    } finally { db.close() }
    assert.equal(initialize(file).status, 0, 'operator can supply the key and retry')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

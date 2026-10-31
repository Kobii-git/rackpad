import { CURRENT_SCHEMA_VERSION } from "../schema-version.js";
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { validateRackpadSqliteDatabase } from '../lib/native-backup-validation.js'

test('schema56 upgrade is atomic, creates no historical events, and resumes persisted encrypted delivery after restart', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rackpad-notification-migration-'))
  const file = path.join(directory, 'fixture.db')
  const snapshot = path.join(directory, 'before.db')
  const child = (script = "const {db}=await import('./server/db.ts');db.close()") => execFileSync(process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    { env: { ...process.env, DATABASE_PATH: file, NODE_ENV: 'test', RACKPAD_SECRET_KEY: 'synthetic-restart-key' }, encoding: 'utf8' })
  try {
    child()
    const legacy = new Database(file)
    legacy.exec(`DROP TRIGGER external_binding_delete; DROP TRIGGER external_binding_update; DROP TRIGGER external_binding_detach; DROP TRIGGER external_device_lab; DROP TABLE externalMonitorMappings; DROP TABLE integrationRecordBindings; DROP TABLE integrationLatestReadings; ALTER TABLE integrationConnections DROP COLUMN healthPollingEnabled; ALTER TABLE integrationConnections DROP COLUMN healthIntervalSeconds; ALTER TABLE integrationConnections DROP COLUMN healthLastCheckedAt; ALTER TABLE integrationConnections DROP COLUMN healthLastError; DROP TRIGGER floorplan_background_revision; DROP TRIGGER floorplan_marker_insert; DROP TRIGGER floorplan_marker_update; DROP TRIGGER floorplan_marker_delete; DROP TRIGGER floorplan_device_room; DROP TRIGGER floorplan_rack_room; DROP TABLE roomFloorplanMarkers; DROP TABLE roomFloorplans; DROP TRIGGER device_reference_immutable; DROP TRIGGER cable_reference_immutable; DROP INDEX idx_devices_publicReference; DROP INDEX idx_portLinks_publicReference; ALTER TABLE devices DROP COLUMN publicReference; ALTER TABLE portLinks DROP COLUMN publicReference; ALTER TABLE auditLog DROP COLUMN labIds; DROP INDEX IF EXISTS idx_auditLog_entity; ALTER TABLE deviceMonitors DROP COLUMN lastAlertAttemptAt;
      ALTER TABLE deviceMonitors DROP COLUMN pendingAlertAt; ALTER TABLE deviceMonitors DROP COLUMN pendingAlertKind;
      UPDATE schemaVersion SET version=56;
      INSERT INTO labs(id,name) VALUES('lab','Fixture');
      INSERT INTO devices(id,labId,hostname,deviceType) VALUES('device','lab','fixture','server');
      INSERT INTO deviceMonitors(id,deviceId,type,enabled,lastResult,lastAlertAt) VALUES('monitor','device','http',1,'offline','2026-10-23T10:00:00.000Z');
      CREATE TRIGGER migration_failure BEFORE UPDATE ON schemaVersion WHEN NEW.version=57 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`)
    assert.equal(validateRackpadSqliteDatabase(legacy, 'Legacy'), 56)
    legacy.close()
    assert.throws(() => child())
    const failed = new Database(file)
    assert.equal((failed.prepare('SELECT version FROM schemaVersion').get() as { version: number }).version, 56)
    assert.ok(!(failed.prepare('PRAGMA table_info(deviceMonitors)').all() as { name: string }[]).some(column => column.name === 'pendingAlertKind'))
    failed.exec('DROP TRIGGER migration_failure'); failed.close()
    copyFileSync(file, snapshot)
    child(); child()
    const migrated = new Database(file)
    assert.equal(validateRackpadSqliteDatabase(migrated, 'Migrated'), CURRENT_SCHEMA_VERSION)
    assert.deepEqual(migrated.prepare('SELECT pendingAlertKind,pendingAlertAt,lastAlertAttemptAt FROM deviceMonitors').get(),
      { pendingAlertKind: null, pendingAlertAt: null, lastAlertAttemptAt: null })
    migrated.close()
    child(`const {db}=await import('./server/db.ts');const {saveAlertSettings}=await import('./server/lib/alerts.ts');
      saveAlertSettings({enabled:true,ntfyTopicUrl:'https://ntfy.example.test/topic',ntfyToken:'synthetic-restart-token'});
      db.prepare("UPDATE deviceMonitors SET pendingAlertKind='down',pendingAlertAt='2026-10-23T11:00:00.000Z',lastAlertAttemptAt='2026-10-23T11:00:00.000Z'").run();db.close();`)
    const native = new Database(file, { readonly: true })
    assert.equal(validateRackpadSqliteDatabase(native, 'Native'), CURRENT_SCHEMA_VERSION)
    const settings = JSON.parse((native.prepare("SELECT value FROM appSettings WHERE key='alertSettings'").get() as { value: string }).value)
    assert.ok(settings.ntfyTokenEnc.startsWith('enc:v1:'))
    assert.ok(!settings.ntfyTokenEnc.includes('synthetic-restart-token'))
    native.close()
    const result = child(`const {db}=await import('./server/db.ts');const {sendMonitorTransitionAlert}=await import('./server/lib/alerts.ts');
      const {setNetworkHostLookupForTests,setPinnedRequestTransportForTests}=await import('./server/lib/net-guard.ts');
      setNetworkHostLookupForTests(async()=>[{address:'10.20.30.40',family:4}]);
      setPinnedRequestTransportForTests(async(_url,_resolved,options)=>{if(options.headers.Authorization!=='Bearer synthetic-restart-token')throw new Error('fixture auth mismatch');return {statusCode:200,bodyText:''}});
      const result=await sendMonitorTransitionAlert('offline',null,{monitorId:'monitor',deviceId:'device',hostname:'fixture',monitorType:'http',result:'offline',message:'fixture',checkedAt:'2026-10-23T11:02:00.000Z'});
      if(!result?.delivered)throw new Error('fixture delivery failed');
      process.stdout.write(JSON.stringify(db.prepare('SELECT pendingAlertKind,lastAlertAt FROM deviceMonitors').get()));db.close();`)
    assert.deepEqual(JSON.parse(result), { pendingAlertKind: null, lastAlertAt: '2026-10-23T11:02:00.000Z' })
    const corrupt = new Database(file)
    corrupt.exec("PRAGMA ignore_check_constraints=ON; UPDATE deviceMonitors SET pendingAlertKind='down',pendingAlertAt='not-a-timestamp'")
    assert.throws(() => validateRackpadSqliteDatabase(corrupt, 'Corrupt'), /pending notification/)
    corrupt.close()
    const rollback = new Database(snapshot)
    assert.equal(validateRackpadSqliteDatabase(rollback, 'Rollback'), 56)
    assert.equal((rollback.prepare('SELECT lastAlertAt FROM deviceMonitors').get() as { lastAlertAt: string }).lastAlertAt, '2026-10-23T10:00:00.000Z')
    rollback.close()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

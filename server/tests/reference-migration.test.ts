import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { validateRackpadSqliteDatabase } from "../lib/native-backup-validation.js";
import { CURRENT_SCHEMA_VERSION } from "../schema-version.js";

test("schema58 references upgrade is atomic, has no backfill, and supports paired rollback", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "rackpad-reference-migration-"),
  );
  const file = path.join(directory, "fixture.db"),
    before = path.join(directory, "before.db");
  const migrate = () =>
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "const {db}=await import('./server/db.ts');db.close()",
      ],
      {
        env: { ...process.env, NODE_ENV: "test", DATABASE_PATH: file },
        stdio: "pipe",
      },
    );
  try {
    migrate();
    const old = new Database(file);
    old.exec(`ALTER TABLE integrationConnections DROP COLUMN options; DROP TRIGGER external_binding_delete; DROP TRIGGER external_binding_update; DROP TRIGGER external_binding_detach; DROP TRIGGER external_device_lab; DROP TABLE externalMonitorMappings; DROP TABLE integrationRecordBindings; DROP TABLE integrationLatestReadings; ALTER TABLE integrationConnections DROP COLUMN healthPollingEnabled; ALTER TABLE integrationConnections DROP COLUMN healthIntervalSeconds; ALTER TABLE integrationConnections DROP COLUMN healthLastCheckedAt; ALTER TABLE integrationConnections DROP COLUMN healthLastError; DROP TRIGGER floorplan_background_revision; DROP TRIGGER floorplan_marker_insert; DROP TRIGGER floorplan_marker_update; DROP TRIGGER floorplan_marker_delete; DROP TRIGGER floorplan_device_room; DROP TRIGGER floorplan_rack_room; DROP TABLE roomFloorplanMarkers; DROP TABLE roomFloorplans; DROP TRIGGER device_reference_immutable; DROP TRIGGER cable_reference_immutable; DROP INDEX idx_devices_publicReference; DROP INDEX idx_portLinks_publicReference; ALTER TABLE devices DROP COLUMN publicReference; ALTER TABLE portLinks DROP COLUMN publicReference;
      UPDATE schemaVersion SET version=58; INSERT INTO labs(id,name) VALUES('lab','Fixture'); INSERT INTO devices(id,labId,hostname,deviceType) VALUES('one','lab','one','server'),('two','lab','two','server');
      INSERT INTO ports(id,deviceId,name,position,kind) VALUES('p1','one','one',1,'rj45'),('p2','two','two',1,'rj45'); INSERT INTO portLinks(id,fromPortId,toPortId) VALUES('c1','p1','p2');
      CREATE TRIGGER fixture_reference_failure BEFORE UPDATE ON schemaVersion WHEN NEW.version=59 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`);
    assert.equal(validateRackpadSqliteDatabase(old, "Previous"), 58);
    old.close();
    assert.throws(migrate);
    const failed = new Database(file);
    assert.deepEqual(
      failed.prepare("SELECT version FROM schemaVersion").get(),
      { version: 58 },
    );
    assert.ok(
      !(
        failed.prepare("PRAGMA table_info(devices)").all() as Array<{
          name: string;
        }>
      ).some((row) => row.name === "publicReference"),
    );
    failed.exec("DROP TRIGGER fixture_reference_failure");
    failed.close();
    copyFileSync(file, before);
    migrate();
    migrate();
    const current = new Database(file);
    assert.equal(
      validateRackpadSqliteDatabase(current, "Current"),
      CURRENT_SCHEMA_VERSION,
    );
    assert.deepEqual(
      current.prepare("SELECT publicReference FROM devices").all(),
      [{ publicReference: null }, { publicReference: null }],
    );
    assert.deepEqual(
      current.prepare("SELECT publicReference FROM portLinks").all(),
      [{ publicReference: null }],
    );
    current.close();
    const rollback = new Database(before);
    assert.equal(validateRackpadSqliteDatabase(rollback, "Rollback"), 58);
    rollback.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

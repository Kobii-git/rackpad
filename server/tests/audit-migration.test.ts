import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { CURRENT_SCHEMA_VERSION } from "../schema-version.js";
import { validateRackpadSqliteDatabase } from "../lib/native-backup-validation.js";

test("schema57 audit upgrade is atomic, retains unknown history, survives restart and paired rollback", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "rackpad-audit-migration-"),
  );
  const file = path.join(directory, "fixture.db"),
    snapshot = path.join(directory, "before.db");
  const child = () =>
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
        env: { ...process.env, DATABASE_PATH: file, NODE_ENV: "test" },
        encoding: "utf8",
        stdio: "pipe",
      },
    );
  try {
    child();
    const old = new Database(file);
    old.exec(`ALTER TABLE integrationConnections DROP COLUMN options; DROP TRIGGER external_binding_delete; DROP TRIGGER external_binding_update; DROP TRIGGER external_binding_detach; DROP TRIGGER external_device_lab; DROP TABLE externalMonitorMappings; DROP TABLE integrationRecordBindings; DROP TABLE integrationLatestReadings; ALTER TABLE integrationConnections DROP COLUMN healthPollingEnabled; ALTER TABLE integrationConnections DROP COLUMN healthIntervalSeconds; ALTER TABLE integrationConnections DROP COLUMN healthLastCheckedAt; ALTER TABLE integrationConnections DROP COLUMN healthLastError; DROP TRIGGER floorplan_background_revision; DROP TRIGGER floorplan_marker_insert; DROP TRIGGER floorplan_marker_update; DROP TRIGGER floorplan_marker_delete; DROP TRIGGER floorplan_device_room; DROP TRIGGER floorplan_rack_room; DROP TABLE roomFloorplanMarkers; DROP TABLE roomFloorplans; DROP TRIGGER device_reference_immutable; DROP TRIGGER cable_reference_immutable; DROP INDEX idx_devices_publicReference; DROP INDEX idx_portLinks_publicReference; ALTER TABLE devices DROP COLUMN publicReference; ALTER TABLE portLinks DROP COLUMN publicReference; ALTER TABLE auditLog DROP COLUMN labIds; DROP INDEX idx_auditLog_entity; UPDATE schemaVersion SET version=57;
      INSERT INTO labs(id,name) VALUES('lab','Fixture');
      INSERT INTO devices(id,labId,hostname,deviceType) VALUES('device','lab','fixture','server');
      INSERT INTO auditLog(id,ts,user,action,entityType,entityId,summary) VALUES
      ('known','2026-10-30T10:00:00Z','fixture','device.create','Device','device','Known'),
      ('unknown','2026-10-30T10:00:00Z','fixture','device.delete','Device','gone','Unknown');
      CREATE TRIGGER fixture_migration_failure BEFORE UPDATE ON schemaVersion WHEN NEW.version=58 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`);
    assert.equal(validateRackpadSqliteDatabase(old, "Legacy"), 57);
    old.close();
    assert.throws(child);
    const failed = new Database(file);
    assert.equal(
      (
        failed.prepare("SELECT version FROM schemaVersion").get() as {
          version: number;
        }
      ).version,
      57,
    );
    assert.ok(
      !(
        failed.prepare("PRAGMA table_info(auditLog)").all() as Array<{
          name: string;
        }>
      ).some((row) => row.name === "labIds"),
    );
    failed.exec("DROP TRIGGER fixture_migration_failure");
    failed.close();
    copyFileSync(file, snapshot);
    child();
    child();
    const current = new Database(file);
    assert.equal(validateRackpadSqliteDatabase(current, "Current"), CURRENT_SCHEMA_VERSION);
    assert.deepEqual(
      current.prepare("SELECT id,labIds FROM auditLog ORDER BY id").all(),
      [
        { id: "known", labIds: '["lab"]' },
        { id: "unknown", labIds: null },
      ],
    );
    current.prepare("DELETE FROM devices WHERE id='device'").run();
    assert.equal(validateRackpadSqliteDatabase(current, "Native"), CURRENT_SCHEMA_VERSION);
    assert.equal(
      (
        current
          .prepare("SELECT labIds FROM auditLog WHERE id='known'")
          .get() as { labIds: string }
      ).labIds,
      '["lab"]',
    );
    current.prepare("UPDATE auditLog SET labIds='[12]' WHERE id='known'").run();
    assert.throws(
      () => validateRackpadSqliteDatabase(current, "Invalid"),
      /audit lab scope/,
    );
    current.close();
    const rollback = new Database(snapshot);
    assert.equal(validateRackpadSqliteDatabase(rollback, "Rollback"), 57);
    assert.ok(
      rollback.prepare("SELECT id FROM devices WHERE id='device'").get(),
    );
    rollback.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

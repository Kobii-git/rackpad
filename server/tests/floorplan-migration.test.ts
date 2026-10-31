import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { validateRackpadSqliteDatabase } from "../lib/native-backup-validation.js";
import { CURRENT_SCHEMA_VERSION } from "../schema-version.js";

test("schema59 floorplan migration is atomic and makes no implicit background or marker assignments", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "rackpad-floorplan-migration-"),
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
    old.exec(`ALTER TABLE integrationConnections DROP COLUMN options; DROP TRIGGER external_binding_delete; DROP TRIGGER external_binding_update; DROP TRIGGER external_binding_detach; DROP TRIGGER external_device_lab; DROP TABLE externalMonitorMappings; DROP TABLE integrationRecordBindings; DROP TABLE integrationLatestReadings; ALTER TABLE integrationConnections DROP COLUMN healthPollingEnabled; ALTER TABLE integrationConnections DROP COLUMN healthIntervalSeconds; ALTER TABLE integrationConnections DROP COLUMN healthLastCheckedAt; ALTER TABLE integrationConnections DROP COLUMN healthLastError; DROP TRIGGER floorplan_background_revision; DROP TRIGGER floorplan_marker_insert; DROP TRIGGER floorplan_marker_update; DROP TRIGGER floorplan_marker_delete; DROP TRIGGER floorplan_device_room; DROP TRIGGER floorplan_rack_room; DROP TABLE roomFloorplanMarkers; DROP TABLE roomFloorplans;
      UPDATE schemaVersion SET version=59; INSERT INTO labs(id,name) VALUES('lab','Fixture'); INSERT INTO rooms(id,labId,name) VALUES('room','lab','Room'); INSERT INTO devices(id,labId,hostname,deviceType,roomId) VALUES('one','lab','one','server','room');
      CREATE TRIGGER fixture_floorplan_failure BEFORE UPDATE ON schemaVersion WHEN NEW.version=60 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`);
    assert.equal(validateRackpadSqliteDatabase(old, "Previous"), 59);
    old.close();
    assert.throws(migrate);
    const failed = new Database(file);
    assert.deepEqual(
      failed.prepare("SELECT version FROM schemaVersion").get(),
      { version: 59 },
    );
    assert.equal(
      failed
        .prepare("SELECT name FROM sqlite_master WHERE name='roomFloorplans'")
        .get(),
      undefined,
    );
    failed.exec("DROP TRIGGER fixture_floorplan_failure");
    failed.close();
    copyFileSync(file, before);
    migrate();
    migrate();
    const current = new Database(file);
    assert.equal(
      validateRackpadSqliteDatabase(current, "Current"),
      CURRENT_SCHEMA_VERSION,
    );
    assert.deepEqual(current.prepare("SELECT * FROM roomFloorplans").all(), []);
    assert.deepEqual(
      current.prepare("SELECT * FROM roomFloorplanMarkers").all(),
      [],
    );
    assert.equal(
      (
        current.prepare("SELECT hostname FROM devices").get() as {
          hostname: string;
        }
      ).hostname,
      "one",
    );
    current.close();
    const rollback = new Database(before);
    assert.equal(validateRackpadSqliteDatabase(rollback, "Rollback"), 59);
    rollback.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

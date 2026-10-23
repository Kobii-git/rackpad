import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { validateRackpadSqliteDatabase } from "../lib/native-backup-validation.js";
import { CURRENT_SCHEMA_VERSION } from "../schema-version.js";

test("service endpoint schema55 upgrade, atomic failure, native validation and snapshot rollback", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rackpad-service-migration-"));
  const file = path.join(dir, "fixture.db");
  const snapshot = path.join(dir, "before.db");
  const migrate = () =>
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "const {db}=await import('./server/db.ts'); db.close()",
      ],
      {
        env: { ...process.env, DATABASE_PATH: file, NODE_ENV: "test" },
        stdio: "pipe",
      },
    );
  try {
    migrate();
    const old = new Database(file);
    old.exec("UPDATE schemaVersion SET version=55");
    assert.throws(
      () => validateRackpadSqliteDatabase(old, "Forged"),
      /inconsistent legacy service endpoint/,
    );
    old.exec(`ALTER TABLE deviceServices DROP COLUMN transportProtocol; ALTER TABLE deviceServices DROP COLUMN networkPort;
      INSERT INTO labs(id,name) VALUES ('lab','Lab');
      INSERT INTO devices(id,labId,hostname,deviceType) VALUES ('device','lab','Device','server');
      INSERT INTO deviceServices(id,deviceId,name,serviceType,createdAt,updatedAt) VALUES ('service','device','Web','http','now','now');`);
    assert.equal(validateRackpadSqliteDatabase(old, "Old"), 55);
    const before = old.prepare("SELECT * FROM deviceServices").get();
    old.exec(
      "CREATE TRIGGER fail_service_migration BEFORE UPDATE ON schemaVersion WHEN NEW.version=56 BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    old.close();
    assert.throws(migrate);
    const failed = new Database(file);
    assert.equal(
      (
        failed.prepare("SELECT version FROM schemaVersion").get() as {
          version: number;
        }
      ).version,
      55,
    );
    assert.deepEqual(
      failed.prepare("SELECT * FROM deviceServices").get(),
      before,
    );
    failed.exec("DROP TRIGGER fail_service_migration");
    failed.close();
    copyFileSync(file, snapshot);
    migrate();
    migrate();
    const current = new Database(file);
    assert.equal(
      validateRackpadSqliteDatabase(current, "Current"),
      CURRENT_SCHEMA_VERSION,
    );
    assert.deepEqual(
      current
        .prepare("SELECT networkPort,transportProtocol FROM deviceServices")
        .get(),
      { networkPort: null, transportProtocol: null },
    );
    for (const sql of [
      "networkPort=0,transportProtocol='tcp'",
      "networkPort=65536,transportProtocol='tcp'",
      "networkPort=1.5,transportProtocol='tcp'",
      "networkPort=53,transportProtocol=NULL",
      "networkPort=NULL,transportProtocol='udp'",
    ])
      assert.throws(() => current.exec(`UPDATE deviceServices SET ${sql}`));
    current.exec(
      "UPDATE deviceServices SET networkPort=53,transportProtocol='udp'",
    );
    assert.equal(
      validateRackpadSqliteDatabase(current, "Valid"),
      CURRENT_SCHEMA_VERSION,
    );
    current.exec(
      "PRAGMA ignore_check_constraints=ON; UPDATE deviceServices SET networkPort=0",
    );
    assert.throws(
      () => validateRackpadSqliteDatabase(current, "Corrupt"),
      /invalid service network endpoint|integrity check/,
    );
    current.close();
    const restored = new Database(snapshot);
    assert.equal(validateRackpadSqliteDatabase(restored, "Rollback"), 55);
    assert.deepEqual(
      restored.prepare("SELECT * FROM deviceServices").get(),
      before,
    );
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

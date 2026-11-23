import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { validateRackpadSqliteDatabase } from "../lib/native-backup-validation.js";
import { CURRENT_SCHEMA_VERSION } from "../schema-version.js";

test("schema61 integration options migration is atomic and defaults to encrypted transport", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "rackpad-integration-options-migration-"),
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
    old.exec(`ALTER TABLE integrationConnections DROP COLUMN options;
      UPDATE schemaVersion SET version=61; INSERT INTO labs(id,name) VALUES('lab','Fixture'); INSERT INTO rooms(id,labId,name) VALUES('room','lab','Room'); INSERT INTO devices(id,labId,hostname,deviceType,roomId) VALUES('one','lab','one','server','room'); INSERT INTO integrationConnections(id,labId,provider,name,baseUrl,authKind,createdAt,updatedAt) VALUES('old','lab','uptime-kuma','Kuma','https://kuma.example','api-key','2026-10-30T00:00:00Z','2026-10-30T00:00:00Z');
      CREATE TRIGGER fixture_integration_options_failure BEFORE UPDATE ON schemaVersion WHEN NEW.version=62 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`);
    assert.equal(validateRackpadSqliteDatabase(old, "Previous"), 61);
    old.close();
    assert.throws(migrate);
    const failed = new Database(file);
    assert.deepEqual(
      failed.prepare("SELECT version FROM schemaVersion").get(),
      { version: 61 },
    );
    assert.equal((failed.prepare("PRAGMA table_info(integrationConnections)").all() as Array<{name:string}>).some(column=>column.name==="options"),false);
    failed.exec("DROP TRIGGER fixture_integration_options_failure");
    failed.close();
    copyFileSync(file, before);
    migrate();
    migrate();
    const current = new Database(file);
    assert.equal(
      validateRackpadSqliteDatabase(current, "Current"),
      CURRENT_SCHEMA_VERSION,
    );
    assert.deepEqual(current.prepare("SELECT options,healthPollingEnabled FROM integrationConnections WHERE id='old'").get(),{options:"{}",healthPollingEnabled:0});
    assert.deepEqual(
      current.prepare("SELECT * FROM integrationLatestReadings").all(),
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
    assert.equal(validateRackpadSqliteDatabase(rollback, "Rollback"), 61);
    rollback.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

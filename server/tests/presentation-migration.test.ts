import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { validateRackpadSqliteDatabase } from "../lib/native-backup-validation.js";
import { CURRENT_SCHEMA_VERSION } from "../schema-version.js";

test("schema 54 presentation upgrade preserves inventory and native recovery", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "rackpad-presentation-migration-"),
  );
  const file = path.join(directory, "fixture.db");
  const migrate = () =>
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "const {db} = await import('./server/db.ts'); db.close();",
      ],
      {
        env: {
          ...process.env,
          DATABASE_PATH: file,
          NODE_ENV: "test",
          RACKPAD_SECRET_KEY: "synthetic-migration-key",
        },
        stdio: "pipe",
      },
    );
  try {
    migrate();
    const legacy = new Database(file);
    legacy.prepare("UPDATE schemaVersion SET version=54").run();
    assert.throws(
      () => validateRackpadSqliteDatabase(legacy, "Forged fixture"),
      /inconsistent legacy presentation/,
    );
    legacy.exec(`ALTER TABLE deviceServices DROP COLUMN transportProtocol; ALTER TABLE deviceServices DROP COLUMN networkPort; ALTER TABLE rooms DROP COLUMN headerColor;
      ALTER TABLE racks DROP COLUMN headerColor;
      ALTER TABLE devices DROP COLUMN labelPosition;
      UPDATE schemaVersion SET version=54;
      INSERT INTO labs(id,name) VALUES ('lab','Lab');
      INSERT INTO rooms(id,labId,name) VALUES ('room','lab','Room');
      INSERT INTO racks(id,labId,name,totalU,roomId) VALUES ('rack','lab','Rack',12,'room');
      INSERT INTO devices(id,labId,hostname,deviceType) VALUES ('device','lab','Device','server');`);
    assert.equal(validateRackpadSqliteDatabase(legacy, "Legacy fixture"), 54);
    const before = legacy.prepare("SELECT * FROM devices").get() as Record<
      string,
      unknown
    >;
    legacy.exec(
      "CREATE TRIGGER fail_presentation_migration BEFORE UPDATE ON schemaVersion WHEN NEW.version=55 BEGIN SELECT RAISE(ABORT,'synthetic migration failure'); END",
    );
    legacy.close();
    assert.throws(migrate);
    const failed = new Database(file);
    try {
      assert.deepEqual(
        failed.prepare("SELECT version FROM schemaVersion").get(),
        { version: 54 },
      );
      assert.deepEqual(failed.prepare("SELECT * FROM devices").get(), before);
      for (const [table, field] of [
        ["rooms", "headerColor"],
        ["racks", "headerColor"],
        ["devices", "labelPosition"],
      ]) {
        const columns = failed
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name: string }>;
        assert.equal(
          columns.some((column) => column.name === field),
          false,
        );
      }
      failed.exec("DROP TRIGGER fail_presentation_migration");
    } finally {
      failed.close();
    }
    migrate();
    migrate();
    const database = new Database(file);
    try {
      assert.equal(
        validateRackpadSqliteDatabase(database, "Upgraded fixture"),
        CURRENT_SCHEMA_VERSION,
      );
      const after = database.prepare("SELECT * FROM devices").get() as Record<
        string,
        unknown
      >;
      for (const [key, value] of Object.entries(before))
        assert.deepEqual(after[key], value);
      assert.equal(after.labelPosition, "upper-right");
      assert.deepEqual(
        database.prepare("SELECT headerColor FROM rooms").get(),
        { headerColor: null },
      );
      assert.deepEqual(
        database.prepare("SELECT headerColor FROM racks").get(),
        { headerColor: null },
      );
      database.exec(
        "UPDATE rooms SET headerColor='#123456'; UPDATE racks SET headerColor='#ffffff'; UPDATE devices SET labelPosition='upper-left';",
      );
      assert.equal(
        validateRackpadSqliteDatabase(database, "Colored fixture"),
        CURRENT_SCHEMA_VERSION,
      );
      assert.throws(
        () => database.exec("UPDATE rooms SET headerColor='red'"),
        /CHECK/,
      );
      assert.throws(
        () => database.exec("UPDATE devices SET labelPosition='bottom'"),
        /CHECK/,
      );
      database.pragma("ignore_check_constraints=ON");
      database.exec("UPDATE racks SET headerColor='red'");
      assert.throws(
        () => validateRackpadSqliteDatabase(database, "Invalid fixture"),
        /presentation/,
      );
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  restoreNativeBackup,
  validateNativeRestoreDatabase,
} from "../cli/restore-native-backup.js";
import { CURRENT_SCHEMA_VERSION } from "../schema-version.js";

const schemaTemplateDirectory = temporaryRestoreDirectory();
const schemaTemplateFile = path.join(schemaTemplateDirectory, "template.db");
process.env.DATABASE_PATH = schemaTemplateFile;
const { db: schemaTemplateDatabase } = await import("../db.js");
schemaTemplateDatabase.exec("CREATE TABLE marker (value TEXT NOT NULL);");
schemaTemplateDatabase.close();

after(() => {
  rmSync(schemaTemplateDirectory, { recursive: true, force: true });
});

function fixture(
  file: string,
  value: string,
  version = CURRENT_SCHEMA_VERSION,
) {
  copyFileSync(schemaTemplateFile, file);
  const database = new Database(file);
  database
    .prepare(
      "UPDATE schemaVersion SET version = ?, updatedAt = ? WHERE id = 1",
    )
    .run(version, new Date().toISOString());
  database.prepare("INSERT INTO marker (value) VALUES (?)").run(value);
  database.close();
}

function marker(file: string) {
  const database = new Database(file, { readonly: true });
  try {
    return (
      database.prepare("SELECT value FROM marker").get() as { value: string }
    ).value;
  } finally {
    database.close();
  }
}

function temporaryRestoreDirectory() {
  return mkdtempSync(path.join(os.tmpdir(), "rackpad-native-restore-"));
}

test("offline native restore validates, preserves mode, and creates a safety snapshot", async () => {
  const directory = temporaryRestoreDirectory();
  const active = path.join(directory, "active.db");
  const source = path.join(directory, "source.db");
  try {
    fixture(active, "before");
    fixture(source, "after");
    chmodSync(active, 0o640);

    const safety = await restoreNativeBackup({ source, active });

    assert.equal(marker(active), "after");
    assert.equal(statSync(active).mode & 0o777, 0o640);
    assert.equal(marker(safety), "before");
    assert.equal(statSync(safety).mode & 0o777, 0o640);
    validateNativeRestoreDatabase(safety);
    assert.equal(
      readdirSync(directory).some((name) => name.startsWith(".rackpad-")),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("offline native restore includes committed WAL data in the replacement", async () => {
  const directory = temporaryRestoreDirectory();
  const active = path.join(directory, "active.db");
  const source = path.join(directory, "source.db");
  let sourceDatabase: Database.Database | null = null;
  try {
    fixture(active, "before");
    fixture(source, "source-before");
    sourceDatabase = new Database(source);
    sourceDatabase.pragma("journal_mode = WAL");
    sourceDatabase.pragma("wal_checkpoint(TRUNCATE)");
    sourceDatabase
      .prepare("UPDATE marker SET value = ?")
      .run("source-after");

    await restoreNativeBackup({ source, active });

    assert.equal(marker(active), "source-after");
  } finally {
    sourceDatabase?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("offline native restore rejects corrupt, unsupported, symlink, and active sources", async (t) => {
  await t.test("corrupt database", async () => {
    const directory = temporaryRestoreDirectory();
    try {
      const active = path.join(directory, "active.db");
      const source = path.join(directory, "corrupt.db");
      fixture(active, "before");
      writeFileSync(source, "not sqlite");
      await assert.rejects(
        restoreNativeBackup({ source, active }),
        /not a valid Rackpad SQLite database|integrity validation/,
      );
      assert.equal(marker(active), "before");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  await t.test("newer schema", async () => {
    const directory = temporaryRestoreDirectory();
    try {
      const active = path.join(directory, "active.db");
      const source = path.join(directory, "newer.db");
      fixture(active, "before");
      fixture(source, "after", CURRENT_SCHEMA_VERSION + 1);
      await assert.rejects(
        restoreNativeBackup({ source, active }),
        /schema is not supported/,
      );
      assert.equal(marker(active), "before");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  await t.test("incomplete Rackpad schema", async () => {
    const directory = temporaryRestoreDirectory();
    try {
      const active = path.join(directory, "active.db");
      const source = path.join(directory, "incomplete.db");
      fixture(active, "before");
      const incomplete = new Database(source);
      incomplete.exec(
        "CREATE TABLE schemaVersion (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, updatedAt TEXT NOT NULL);",
      );
      incomplete
        .prepare(
          "INSERT INTO schemaVersion (id, version, updatedAt) VALUES (1, ?, ?)",
        )
        .run(CURRENT_SCHEMA_VERSION, new Date().toISOString());
      incomplete.close();

      await assert.rejects(
        restoreNativeBackup({ source, active }),
        /missing required Rackpad schema/,
      );
      assert.equal(marker(active), "before");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  await t.test("foreign-key violation", async () => {
    const directory = temporaryRestoreDirectory();
    try {
      const active = path.join(directory, "active.db");
      const source = path.join(directory, "foreign-key.db");
      fixture(active, "before");
      fixture(source, "after");
      const invalid = new Database(source);
      invalid.pragma("foreign_keys = OFF");
      invalid
        .prepare(
          "INSERT INTO racks (id, labId, name, totalU) VALUES (?, ?, ?, ?)",
        )
        .run("rack_orphan", "lab_missing", "Orphan rack", 42);
      invalid.close();

      await assert.rejects(
        restoreNativeBackup({ source, active }),
        /foreign-key validation/,
      );
      assert.equal(marker(active), "before");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  await t.test("symlink source", async () => {
    const directory = temporaryRestoreDirectory();
    try {
      const active = path.join(directory, "active.db");
      const source = path.join(directory, "source.db");
      const link = path.join(directory, "source-link.db");
      fixture(active, "before");
      fixture(source, "after");
      symlinkSync(source, link);
      await assert.rejects(
        restoreNativeBackup({ source: link, active }),
        /regular file, not a symlink/,
      );
      assert.equal(marker(active), "before");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  await t.test("active database as source", async () => {
    const directory = temporaryRestoreDirectory();
    try {
      const active = path.join(directory, "active.db");
      fixture(active, "before");
      await assert.rejects(
        restoreNativeBackup({ source: active, active }),
        /cannot be the active database/,
      );
      assert.equal(marker(active), "before");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("offline native restore leaves the active database and safety snapshot recoverable when replacement fails", async () => {
  const directory = temporaryRestoreDirectory();
  const active = path.join(directory, "active.db");
  const source = path.join(directory, "source.db");
  try {
    fixture(active, "before");
    fixture(source, "after");
    const beforeBytes = readFileSync(active);

    await assert.rejects(
      restoreNativeBackup({
        source,
        active,
        beforeReplace: () => {
          throw new Error("forced replacement failure");
        },
      }),
      /forced replacement failure/,
    );

    assert.deepEqual(readFileSync(active), beforeBytes);
    assert.equal(marker(active), "before");
    const safety = readdirSync(directory).find((name) =>
      name.startsWith("rackpad-pre-restore-"),
    );
    assert.ok(safety);
    assert.equal(marker(path.join(directory, safety)), "before");
    assert.equal(
      readdirSync(directory).some((name) => name.startsWith(".rackpad-")),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

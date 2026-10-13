import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { openDatabase } from "../lib/open-database.js";

test("database startup retains WAL, foreign keys and persistent writes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rackpad-open-database-"));
  const filename = path.join(directory, "fixture.db");
  try {
    const connection = openDatabase(filename);
    try {
      assert.equal(connection.pragma("journal_mode", { simple: true }), "wal");
      assert.equal(connection.pragma("foreign_keys", { simple: true }), 1);
      connection.exec("CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES ('retained')");
    } finally { connection.close(); }
    const reopened = openDatabase(filename);
    try {
      assert.deepEqual(reopened.prepare("SELECT value FROM fixture").get(), { value: "retained" });
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("missing database directory reports a path-free hint and preserves the library error", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "rackpad-open-database-"));
  const output = t.mock.method(console, "error", () => undefined);
  try {
    assert.throws(() => openDatabase(path.join(directory, "private-location", "fixture.db")), {
      name: "TypeError",
      message: "Cannot open database because the directory does not exist",
    });
    assert.equal(output.mock.calls.length, 1);
    const hint = String(output.mock.calls[0].arguments[0]);
    assert.match(hint, /INSTALL\.md#bind-mounts-and-container-users/);
    assert.match(hint, /PUID\/PGID do not change it/);
    assert(!hint.includes(directory));
    assert(!hint.includes("private-location"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("database corruption retains its original error without a permissions hint", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "rackpad-open-database-"));
  const filename = path.join(directory, "fixture.db");
  const output = t.mock.method(console, "error", () => undefined);
  try {
    writeFileSync(filename, "not a SQLite database".repeat(100));
    assert.throws(() => openDatabase(filename), { code: "SQLITE_NOTADB" });
    assert.equal(output.mock.calls.length, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("SQLite open failures keep their error code and receive the access hint", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "rackpad-open-database-"));
  const output = t.mock.method(console, "error", () => undefined);
  try {
    // An existing directory cannot be used as a SQLite database file.
    assert.throws(() => openDatabase(directory), { code: "SQLITE_CANTOPEN" });
    assert.equal(output.mock.calls.length, 1);
    assert.match(String(output.mock.calls[0].arguments[0]), /Database access failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("actual database module fails before startup with the access hint", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rackpad-open-database-"));
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      "await import('./server/db.ts')"], {
      cwd: new URL("../../", import.meta.url),
      env: { ...process.env, DATABASE_PATH: path.join(directory, "missing", "fixture.db") },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[rackpad\] Database access failed\./);
    assert.match(result.stderr, /TypeError: Cannot open database because the directory does not exist/);
    assert(!result.stderr.includes(directory));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

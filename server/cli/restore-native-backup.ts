import {
  chmodSync,
  chownSync,
  lstatSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Stats } from "node:fs";
import Database from "better-sqlite3";
import {
  RackpadSqliteValidationError,
  validateRackpadSqliteDatabase,
} from "../lib/native-backup-validation.js";

function fail(message: string): never {
  throw new Error(message);
}

export function parseNativeRestoreSource(argv: string[]) {
  const index = argv.findIndex(
    (value) => value === "--source" || value === "-s",
  );
  if (index < 0 || !argv[index + 1]) fail("--source is required.");
  return path.resolve(argv[index + 1]);
}

export function validateNativeRestoreDatabase(file: string) {
  let database: Database.Database | null = null;
  try {
    database = new Database(file, { readonly: true, fileMustExist: true });
    validateRackpadSqliteDatabase(database, "Source database");
  } catch (error) {
    if (error instanceof RackpadSqliteValidationError) throw error;
    fail("Source database is not a valid Rackpad SQLite database.");
  } finally {
    database?.close();
  }
}

async function createSelfContainedSnapshot(source: string, destination: string) {
  const sourceDatabase = new Database(source, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await sourceDatabase.backup(destination);
  } finally {
    sourceDatabase.close();
  }
}

function removeSqliteSidecars(file: string) {
  rmSync(`${file}-wal`, { force: true });
  rmSync(`${file}-shm`, { force: true });
}

function finalizeSelfContainedSnapshot(file: string) {
  const database = new Database(file, { fileMustExist: true });
  try {
    validateRackpadSqliteDatabase(database, "Restore snapshot");
    database.pragma("wal_checkpoint(TRUNCATE)");
    database.pragma("journal_mode = DELETE");
  } finally {
    database.close();
  }
  removeSqliteSidecars(file);
}

function preserveOwnershipAndMode(
  file: string,
  sourceStat: Stats,
) {
  chmodSync(file, sourceStat.mode);
  try {
    chownSync(file, sourceStat.uid, sourceStat.gid);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      !["EPERM", "EACCES", "ENOSYS", "EINVAL"].includes(String(error.code))
    ) {
      throw error;
    }
  }
}

export async function restoreNativeBackup({
  source,
  active,
  beforeReplace,
}: {
  source: string;
  active: string;
  beforeReplace?: () => void;
}) {
  const resolvedSource = path.resolve(source);
  const resolvedActive = path.resolve(active);
  const sourceStat = lstatSync(resolvedSource);
  const activeStat = lstatSync(resolvedActive);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    fail("Source must be a regular file, not a symlink.");
  }
  if (!activeStat.isFile() || activeStat.isSymbolicLink()) {
    fail("Active database must be a regular file, not a symlink.");
  }
  if (
    realpathSync(resolvedSource) === realpathSync(resolvedActive) ||
    (sourceStat.dev === activeStat.dev && sourceStat.ino === activeStat.ino)
  ) {
    fail("Source database cannot be the active database.");
  }
  validateNativeRestoreDatabase(resolvedSource);

  const directory = path.dirname(resolvedActive);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safety = path.join(directory, `rackpad-pre-restore-${stamp}.db`);
  const safetyTemporary = path.join(
    directory,
    `.rackpad-safety-${process.pid}-${Date.now()}.tmp`,
  );
  const replacement = path.join(
    directory,
    `.rackpad-restore-${process.pid}-${Date.now()}.tmp`,
  );
  const activeDatabase = new Database(resolvedActive, { fileMustExist: true });
  let transactionOpen = false;
  try {
    activeDatabase.pragma("busy_timeout = 1000");
    activeDatabase.pragma("wal_checkpoint(TRUNCATE)");
    await activeDatabase.backup(safetyTemporary);
    finalizeSelfContainedSnapshot(safetyTemporary);
    preserveOwnershipAndMode(safetyTemporary, activeStat);
    renameSync(safetyTemporary, safety);

    activeDatabase.exec("BEGIN EXCLUSIVE");
    transactionOpen = true;
    await createSelfContainedSnapshot(resolvedSource, replacement);
    finalizeSelfContainedSnapshot(replacement);
    preserveOwnershipAndMode(replacement, activeStat);
    beforeReplace?.();
    activeDatabase.exec("ROLLBACK");
    transactionOpen = false;
    activeDatabase.close();

    removeSqliteSidecars(resolvedActive);
    renameSync(replacement, resolvedActive);
    return safety;
  } catch (error) {
    if (transactionOpen) {
      try {
        activeDatabase.exec("ROLLBACK");
      } catch {
        // The connection may already have closed after a replacement failure.
      }
    }
    if (activeDatabase.open) activeDatabase.close();
    rmSync(safetyTemporary, { force: true });
    rmSync(replacement, { force: true });
    removeSqliteSidecars(safetyTemporary);
    removeSqliteSidecars(replacement);
    throw error;
  }
}

async function main() {
  const source = parseNativeRestoreSource(process.argv.slice(2));
  const active = path.resolve(
    process.env.DATABASE_PATH ?? path.resolve("rackpad.db"),
  );
  const safety = await restoreNativeBackup({ source, active });
  console.log(`Native restore complete. Safety copy: ${safety}`);
  console.log(
    "Restart Rackpad manually. Restore the safety copy to roll back if needed.",
  );
}

const invokedAsScript =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  void main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Native restore failed.",
    );
    console.error("Rackpad must be stopped before running this command.");
    process.exitCode = 1;
  });
}

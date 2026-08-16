import {
  accessSync,
  chmodSync,
  constants,
  createReadStream,
  existsSync,
  lstatSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { db } from "../db.js";
import { writeAuditLogEntry } from "./audit-log.js";
import { validateRackpadSqliteDatabase } from "./native-backup-validation.js";

const BACKUP_NAME =
  /^rackpad-native-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.db$/;
const SETTINGS_KEY = "nativeBackupSettings";
export const DEFAULT_NATIVE_BACKUP_SETTINGS = {
  enabled: false,
  intervalHours: 24,
  retentionCount: 7,
};
const schedulerState = {
  running: false,
  lastSuccessAt: null as string | null,
  lastFailureAt: null as string | null,
  lastError: null as string | null,
  scheduleBaselineInitialized: false,
  scheduleBaselineAt: null as string | null,
};

export function resetNativeBackupSchedulerStateForTests() {
  schedulerState.running = false;
  schedulerState.lastSuccessAt = null;
  schedulerState.lastFailureAt = null;
  schedulerState.lastError = null;
  schedulerState.scheduleBaselineInitialized = false;
  schedulerState.scheduleBaselineAt = null;
}

export class NativeBackupBusyError extends Error {
  constructor() {
    super("A native backup is already running.");
    this.name = "NativeBackupBusyError";
  }
}

export function nativeBackupRoot() {
  const value = process.env.RACKPAD_NATIVE_BACKUP_DIR?.trim();
  return value ? path.resolve(value) : null;
}

function requireRoot() {
  const root = nativeBackupRoot();
  if (!root) throw new Error("Native backup directory is not configured.");
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Native backup directory must be a real directory.");
  }
  accessSync(root, constants.R_OK | constants.W_OK);
  return root;
}

export function loadNativeBackupSettings() {
  const row = db
    .prepare("SELECT value FROM appSettings WHERE key = ?")
    .get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return { ...DEFAULT_NATIVE_BACKUP_SETTINGS };
  try {
    const parsed = JSON.parse(row.value) as Partial<
      typeof DEFAULT_NATIVE_BACKUP_SETTINGS
    >;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
      intervalHours:
        Number.isInteger(parsed.intervalHours) &&
        Number(parsed.intervalHours) >= 1 &&
        Number(parsed.intervalHours) <= 8760
          ? Number(parsed.intervalHours)
          : DEFAULT_NATIVE_BACKUP_SETTINGS.intervalHours,
      retentionCount:
        Number.isInteger(parsed.retentionCount) &&
        Number(parsed.retentionCount) >= 1 &&
        Number(parsed.retentionCount) <= 365
          ? Number(parsed.retentionCount)
          : DEFAULT_NATIVE_BACKUP_SETTINGS.retentionCount,
    };
  } catch {
    return { ...DEFAULT_NATIVE_BACKUP_SETTINGS };
  }
}

export function saveNativeBackupSettings(
  settings: typeof DEFAULT_NATIVE_BACKUP_SETTINGS,
) {
  db.prepare(
    `INSERT INTO appSettings (key, value, updatedAt) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
  ).run(SETTINGS_KEY, JSON.stringify(settings), new Date().toISOString());
  return settings;
}

export function validateNativeBackupSnapshot(file: string) {
  const snapshot = new Database(file, { fileMustExist: true });
  try {
    validateRackpadSqliteDatabase(snapshot, "Native snapshot");
    snapshot.pragma("journal_mode = DELETE");
  } finally {
    snapshot.close();
  }
}

export function listNativeBackups() {
  const root = nativeBackupRoot();
  if (!root) return [];
  try {
    return readdirSync(requireRoot())
      .filter((name) => BACKUP_NAME.test(name))
      .flatMap((name) => {
        const file = path.join(root, name);
        const stat = lstatSync(file);
        return stat.isFile() && !stat.isSymbolicLink()
          ? [{ name, size: stat.size, createdAt: stat.mtime.toISOString() }]
          : [];
      })
      .sort((left, right) => right.name.localeCompare(left.name));
  } catch {
    return [];
  }
}

function newestValidNativeBackup() {
  for (const backup of listNativeBackups()) {
    try {
      validateNativeBackupSnapshot(resolveNativeBackup(backup.name));
      return backup;
    } catch {
      // Ignore invalid snapshots when determining the schedule baseline.
    }
  }
  return null;
}

export function resolveNativeBackup(name: string) {
  if (!BACKUP_NAME.test(name)) throw new Error("Invalid native backup name.");
  const root = requireRoot();
  const file = path.join(root, name);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Native backup not found.");
  return file;
}

export async function createNativeBackup(actor = "system") {
  if (schedulerState.running) throw new NativeBackupBusyError();
  const root = requireRoot();
  schedulerState.running = true;
  let createdAt = Date.now();
  let timestamp = new Date(createdAt).toISOString().replace(/[:.]/g, "-");
  while (existsSync(path.join(root, `rackpad-native-${timestamp}.db`))) {
    createdAt += 1;
    timestamp = new Date(createdAt).toISOString().replace(/[:.]/g, "-");
  }
  const name = `rackpad-native-${timestamp}.db`;
  const destination = path.join(root, name);
  const temporary = path.join(
    root,
    `.rackpad-native-${process.pid}-${Date.now()}.tmp`,
  );
  try {
    await db.backup(temporary);
    chmodSync(temporary, 0o600);
    validateNativeBackupSnapshot(temporary);
    renameSync(temporary, destination);
    const settings = loadNativeBackupSettings();
    for (const expired of listNativeBackups().slice(settings.retentionCount)) {
      rmSync(resolveNativeBackup(expired.name));
    }
    schedulerState.lastSuccessAt = new Date().toISOString();
    schedulerState.scheduleBaselineInitialized = true;
    schedulerState.scheduleBaselineAt = schedulerState.lastSuccessAt;
    schedulerState.lastError = null;
    writeAuditLogEntry({
      user: actor,
      action: "admin.native_backup.create",
      entityType: "NativeBackup",
      entityId: name,
      summary: "Created a native database snapshot.",
    });
    return listNativeBackups().find((entry) => entry.name === name)!;
  } catch (error) {
    rmSync(temporary, { force: true });
    schedulerState.lastFailureAt = new Date().toISOString();
    schedulerState.lastError =
      error instanceof Error ? error.message : "Native backup failed.";
    writeAuditLogEntry({
      user: actor,
      action: "admin.native_backup.failure",
      entityType: "NativeBackup",
      entityId: "native-backup",
      summary: "Native database snapshot creation failed.",
    });
    throw error;
  } finally {
    schedulerState.running = false;
  }
}

export function deleteNativeBackup(name: string) {
  rmSync(resolveNativeBackup(name));
}

export function nativeBackupReadStream(name: string) {
  return createReadStream(resolveNativeBackup(name));
}

export function nativeBackupStatus() {
  let configurationError: string | null = null;
  const configured = (() => {
    try {
      return requireRoot() != null;
    } catch (error) {
      configurationError =
        error instanceof Error
          ? error.message
          : "Native backup directory is not available.";
      return false;
    }
  })();
  return {
    configured,
    configurationError,
    settings: loadNativeBackupSettings(),
    scheduler: {
      running: schedulerState.running,
      lastSuccessAt: schedulerState.lastSuccessAt,
      lastFailureAt: schedulerState.lastFailureAt,
      lastError: schedulerState.lastError,
    },
  };
}

export function initializeNativeBackupScheduleBaseline(now = Date.now()) {
  if (schedulerState.scheduleBaselineInitialized) return;
  if (!nativeBackupRoot()) {
    schedulerState.scheduleBaselineInitialized = true;
    return;
  }
  try {
    requireRoot();
    const latest = newestValidNativeBackup();
    schedulerState.scheduleBaselineAt = latest?.createdAt ?? null;
    schedulerState.lastSuccessAt ??= latest?.createdAt ?? null;
    schedulerState.scheduleBaselineInitialized = true;
  } catch (error) {
    schedulerState.lastFailureAt = new Date(now).toISOString();
    schedulerState.lastError =
      error instanceof Error ? error.message : "Native backup schedule failed.";
  }
}

export async function runNativeBackupScheduleTick(now = Date.now()) {
  const settings = loadNativeBackupSettings();
  if (!nativeBackupRoot() || schedulerState.running) {
    return false;
  }
  initializeNativeBackupScheduleBaseline(now);
  if (!settings.enabled || !schedulerState.scheduleBaselineInitialized) {
    return false;
  }
  const lastSuccess = schedulerState.lastSuccessAt
    ? Date.parse(schedulerState.lastSuccessAt)
    : 0;
  const persistedBaseline = schedulerState.scheduleBaselineAt
    ? Date.parse(schedulerState.scheduleBaselineAt)
    : 0;
  const baseline = Math.max(lastSuccess, persistedBaseline);
  if (baseline && now - baseline < settings.intervalHours * 60 * 60 * 1000) {
    return false;
  }
  await createNativeBackup();
  return true;
}

export function startNativeBackupScheduleLoop() {
  initializeNativeBackupScheduleBaseline();
  const handle = setInterval(() => {
    void runNativeBackupScheduleTick().catch(() => undefined);
  }, 60_000);
  handle.unref?.();
  return () => clearInterval(handle);
}

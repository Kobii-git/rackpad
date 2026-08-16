import { db } from "../../db.js";
import { createId } from "../ids.js";
import { ValidationError } from "../validation.js";
import type { IntegrationAutoSyncMode } from "./types.js";

export interface IntegrationSyncSchedule {
  id: string;
  connectionId: string;
  name: string;
  enabled: boolean;
  mode: IntegrationAutoSyncMode;
  cron: string;
  labIds: string[];
  failureCount: number;
  pausedUntil: string | null;
  lastRunAt: string | null;
  lastRunStatus: "ok" | "error" | "drift" | null;
  lastRunMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseMode(value: unknown): IntegrationAutoSyncMode {
  if (value === "mirror" || value === "skip") return value;
  // Pre-v43 rows could still say "overwrite"; that behavior is now "skip".
  if (value === "overwrite") return "skip";
  return "merge";
}

function parseRunStatus(value: unknown): "ok" | "error" | "drift" | null {
  if (value === "ok" || value === "error" || value === "drift") return value;
  return null;
}

function parseLabIds(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((entry) => String(entry)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function parseIntegrationSyncSchedule(
  row: Record<string, unknown>,
): IntegrationSyncSchedule {
  return {
    id: String(row.id),
    connectionId: String(row.connectionId),
    name: String(row.name),
    enabled: Boolean(row.enabled),
    mode: parseMode(row.mode),
    cron: String(row.cron),
    labIds: parseLabIds(row.labIds),
    failureCount: Number(row.failureCount ?? 0),
    pausedUntil: row.pausedUntil ? String(row.pausedUntil) : null,
    lastRunAt: row.lastRunAt ? String(row.lastRunAt) : null,
    lastRunStatus: parseRunStatus(row.lastRunStatus),
    lastRunMessage: row.lastRunMessage ? String(row.lastRunMessage) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export function listIntegrationSyncSchedules(connectionId?: string) {
  const rows = connectionId
    ? db
        .prepare(
          "SELECT * FROM integrationSyncSchedules WHERE connectionId = ? ORDER BY name, id",
        )
        .all(connectionId)
    : db
        .prepare(
          "SELECT * FROM integrationSyncSchedules ORDER BY connectionId, name, id",
        )
        .all();
  return (rows as Record<string, unknown>[]).map(parseIntegrationSyncSchedule);
}

export function getIntegrationSyncScheduleRow(id: string) {
  return db
    .prepare("SELECT * FROM integrationSyncSchedules WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
}

export function createIntegrationSyncSchedule(input: {
  connectionId: string;
  name: string;
  enabled?: boolean;
  mode: IntegrationAutoSyncMode;
  cron: string;
  labIds: string[];
}) {
  const now = new Date().toISOString();
  const id = createId("intsch");
  db.prepare(
    `
    INSERT INTO integrationSyncSchedules (
      id, connectionId, name, enabled, mode, cron, labIds,
      failureCount, pausedUntil, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
  `,
  ).run(
    id,
    input.connectionId,
    input.name.trim(),
    input.enabled === false ? 0 : 1,
    input.mode,
    input.cron.trim(),
    input.labIds.length > 0
      ? JSON.stringify([...new Set(input.labIds.filter(Boolean))])
      : null,
    now,
    now,
  );
  return parseIntegrationSyncSchedule(getIntegrationSyncScheduleRow(id)!);
}

export function updateIntegrationSyncSchedule(
  id: string,
  input: Partial<{
    name: string;
    enabled: boolean;
    mode: IntegrationAutoSyncMode;
    cron: string;
    labIds: string[];
  }>,
) {
  const existing = getIntegrationSyncScheduleRow(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  // Reconfiguring clears the failure backoff so fixes take effect at once.
  db.prepare(
    `
    UPDATE integrationSyncSchedules
    SET name = ?, enabled = ?, mode = ?, cron = ?, labIds = ?,
        failureCount = 0, pausedUntil = NULL, updatedAt = ?
    WHERE id = ?
  `,
  ).run(
    input.name?.trim() ?? String(existing.name),
    input.enabled !== undefined
      ? input.enabled
        ? 1
        : 0
      : (existing.enabled as number),
    input.mode ?? parseMode(existing.mode),
    input.cron?.trim() ?? String(existing.cron),
    input.labIds !== undefined
      ? input.labIds.length > 0
        ? JSON.stringify([...new Set(input.labIds.filter(Boolean))])
        : null
      : ((existing.labIds as string | null) ?? null),
    now,
    id,
  );
  return parseIntegrationSyncSchedule(getIntegrationSyncScheduleRow(id)!);
}

export function deleteIntegrationSyncSchedule(id: string) {
  const existing = getIntegrationSyncScheduleRow(id);
  if (!existing) return false;
  db.prepare("DELETE FROM integrationSyncSchedules WHERE id = ?").run(id);
  return true;
}

export function loadIntegrationSyncSchedule(id: string) {
  const row = getIntegrationSyncScheduleRow(id);
  if (!row) {
    throw new ValidationError("Sync schedule not found.", 404);
  }
  return parseIntegrationSyncSchedule(row);
}

export function recordIntegrationSyncScheduleResult(
  id: string,
  input: {
    status: "ok" | "error" | "drift";
    message: string;
    failureCount: number;
    pausedUntil: string | null;
  },
) {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE integrationSyncSchedules
    SET lastRunAt = ?, lastRunStatus = ?, lastRunMessage = ?,
        failureCount = ?, pausedUntil = ?, updatedAt = ?
    WHERE id = ?
  `,
  ).run(
    now,
    input.status,
    input.message,
    input.failureCount,
    input.pausedUntil,
    now,
    id,
  );
}

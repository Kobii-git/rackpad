import { db } from "../../db.js";
import { createId } from "../ids.js";
import { decryptSecret, encryptOptionalSecret } from "../secret-crypto.js";
import { ValidationError } from "../validation.js";
import {
  INTEGRATION_PROVIDER_INFO,
  type IntegrationAuthKind,
  type IntegrationAutoSyncMode,
  type IntegrationConnectionPublic,
  type IntegrationConnectionSecrets,
  type IntegrationConnectionStatus,
  type IntegrationProvider,
} from "./types.js";

export function normalizeIntegrationBaseUrl(value: string) {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError(
      "Connection URL must be a valid http(s) URL, for example https://192.168.1.2:8443.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Connection URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new ValidationError("Connection URL must not contain credentials.");
  }
  url.search = "";
  url.hash = "";
  let normalized = url.toString();
  while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}

function parseSummary(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parseStatus(value: unknown): IntegrationConnectionStatus {
  if (value === "ok" || value === "error") return value;
  return "unknown";
}

function parseAutoSyncMode(value: unknown): IntegrationAutoSyncMode {
  if (value === "overwrite" || value === "skip") return value;
  return "merge";
}

function parseAutoSyncStatus(value: unknown): "ok" | "error" | "drift" | null {
  if (value === "ok" || value === "error" || value === "drift") return value;
  return null;
}

function parseLabIds(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry)).filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

export function parseIntegrationConnectionPublic(
  row: Record<string, unknown>,
): IntegrationConnectionPublic {
  return {
    id: String(row.id),
    labId: String(row.labId),
    provider: String(row.provider) as IntegrationProvider,
    name: String(row.name),
    baseUrl: String(row.baseUrl),
    authKind: String(row.authKind) as IntegrationAuthKind,
    authId: row.authId ? String(row.authId) : null,
    hasSecret: Boolean(row.authSecretEnc),
    siteRef: row.siteRef ? String(row.siteRef) : null,
    verifyTls: Boolean(row.verifyTls),
    enabled: Boolean(row.enabled),
    syncVlans: Boolean(row.syncVlans),
    syncSubnets: Boolean(row.syncSubnets),
    syncDhcp: Boolean(row.syncDhcp),
    lastStatus: parseStatus(row.lastStatus),
    lastCheckedAt: row.lastCheckedAt ? String(row.lastCheckedAt) : null,
    lastError: row.lastError ? String(row.lastError) : null,
    lastSummary: parseSummary(row.lastSummary),
    autoSyncEnabled: Boolean(row.autoSyncEnabled),
    autoSyncMode: parseAutoSyncMode(row.autoSyncMode),
    autoSyncCron: row.autoSyncCron ? String(row.autoSyncCron) : null,
    autoSyncLabIds: parseLabIds(row.autoSyncLabIds),
    autoSyncFailureCount: Number(row.autoSyncFailureCount ?? 0),
    autoSyncPausedUntil: row.autoSyncPausedUntil
      ? String(row.autoSyncPausedUntil)
      : null,
    lastAutoSyncAt: row.lastAutoSyncAt ? String(row.lastAutoSyncAt) : null,
    lastAutoSyncStatus: parseAutoSyncStatus(row.lastAutoSyncStatus),
    lastAutoSyncMessage: row.lastAutoSyncMessage
      ? String(row.lastAutoSyncMessage)
      : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export function listIntegrationConnections(labId?: string) {
  const rows = labId
    ? db
        .prepare(
          "SELECT * FROM integrationConnections WHERE labId = ? ORDER BY provider, name, id",
        )
        .all(labId)
    : db
        .prepare(
          "SELECT * FROM integrationConnections ORDER BY labId, provider, name, id",
        )
        .all();
  return (rows as Record<string, unknown>[]).map(
    parseIntegrationConnectionPublic,
  );
}

export function getIntegrationConnectionRow(id: string) {
  return db
    .prepare("SELECT * FROM integrationConnections WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
}

export function loadIntegrationConnectionSecrets(
  id: string,
  labId?: string,
): IntegrationConnectionSecrets {
  const row = getIntegrationConnectionRow(id);
  if (!row) {
    throw new ValidationError("Integration connection not found.", 404);
  }
  if (labId && String(row.labId) !== labId) {
    throw new ValidationError(
      "Integration connection does not belong to this lab.",
      403,
    );
  }

  return {
    id: String(row.id),
    labId: String(row.labId),
    provider: String(row.provider) as IntegrationProvider,
    name: String(row.name),
    baseUrl: String(row.baseUrl),
    authKind: String(row.authKind) as IntegrationAuthKind,
    authId: row.authId ? String(row.authId) : null,
    authSecret: row.authSecretEnc
      ? decryptSecret(String(row.authSecretEnc))
      : null,
    siteRef: row.siteRef ? String(row.siteRef) : null,
    verifyTls: Boolean(row.verifyTls),
    enabled: Boolean(row.enabled),
    syncVlans: Boolean(row.syncVlans),
    syncSubnets: Boolean(row.syncSubnets),
    syncDhcp: Boolean(row.syncDhcp),
    autoSyncEnabled: Boolean(row.autoSyncEnabled),
    autoSyncMode: parseAutoSyncMode(row.autoSyncMode),
    autoSyncCron: row.autoSyncCron ? String(row.autoSyncCron) : null,
    autoSyncLabIds: parseLabIds(row.autoSyncLabIds),
    autoSyncFailureCount: Number(row.autoSyncFailureCount ?? 0),
    autoSyncPausedUntil: row.autoSyncPausedUntil
      ? String(row.autoSyncPausedUntil)
      : null,
  };
}

function assertProviderAuthKind(
  provider: IntegrationProvider,
  authKind: IntegrationAuthKind,
) {
  if (!INTEGRATION_PROVIDER_INFO[provider].authKinds.includes(authKind)) {
    throw new ValidationError(
      `authKind ${authKind} is not supported for ${INTEGRATION_PROVIDER_INFO[provider].label}.`,
    );
  }
}

export function createIntegrationConnection(input: {
  labId: string;
  provider: IntegrationProvider;
  name: string;
  baseUrl: string;
  authKind: IntegrationAuthKind;
  authId?: string | null;
  authSecret?: string | null;
  siteRef?: string | null;
  verifyTls?: boolean;
  enabled?: boolean;
  syncVlans?: boolean;
  syncSubnets?: boolean;
  syncDhcp?: boolean;
}) {
  assertProviderAuthKind(input.provider, input.authKind);
  const baseUrl = normalizeIntegrationBaseUrl(input.baseUrl);
  const now = new Date().toISOString();
  const id = createId("intg");
  db.prepare(
    `
    INSERT INTO integrationConnections (
      id, labId, provider, name, baseUrl, authKind, authId, authSecretEnc,
      siteRef, verifyTls, enabled, syncVlans, syncSubnets, syncDhcp,
      lastStatus, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)
  `,
  ).run(
    id,
    input.labId,
    input.provider,
    input.name.trim(),
    baseUrl,
    input.authKind,
    input.authId?.trim() || null,
    encryptOptionalSecret(input.authSecret),
    input.siteRef?.trim() || null,
    input.verifyTls === false ? 0 : 1,
    input.enabled === false ? 0 : 1,
    input.syncVlans === false ? 0 : 1,
    input.syncSubnets === false ? 0 : 1,
    input.syncDhcp === false ? 0 : 1,
    now,
    now,
  );
  return parseIntegrationConnectionPublic(getIntegrationConnectionRow(id)!);
}

export function updateIntegrationConnection(
  id: string,
  input: Partial<{
    name: string;
    baseUrl: string;
    authKind: IntegrationAuthKind;
    authId: string | null;
    authSecret: string | null;
    siteRef: string | null;
    verifyTls: boolean;
    enabled: boolean;
    syncVlans: boolean;
    syncSubnets: boolean;
    syncDhcp: boolean;
    clearSecret: boolean;
    autoSyncEnabled: boolean;
    autoSyncMode: IntegrationAutoSyncMode;
    autoSyncCron: string | null;
    autoSyncLabIds: string[];
  }>,
) {
  const existing = getIntegrationConnectionRow(id);
  if (!existing) return null;

  const provider = String(existing.provider) as IntegrationProvider;
  const nextAuthKind =
    input.authKind ?? (String(existing.authKind) as IntegrationAuthKind);
  assertProviderAuthKind(provider, nextAuthKind);

  const nextName = input.name?.trim() ?? String(existing.name);
  const nextBaseUrl =
    input.baseUrl !== undefined
      ? normalizeIntegrationBaseUrl(input.baseUrl)
      : String(existing.baseUrl);
  const nextAuthId =
    input.authId !== undefined
      ? input.authId?.trim() || null
      : (existing.authId as string | null);
  const nextSecret = input.clearSecret
    ? null
    : input.authSecret !== undefined
      ? encryptOptionalSecret(input.authSecret)
      : (existing.authSecretEnc as string | null);
  const nextSiteRef =
    input.siteRef !== undefined
      ? input.siteRef?.trim() || null
      : (existing.siteRef as string | null);
  const nextVerifyTls =
    input.verifyTls !== undefined
      ? input.verifyTls
        ? 1
        : 0
      : (existing.verifyTls as number);
  const nextEnabled =
    input.enabled !== undefined
      ? input.enabled
        ? 1
        : 0
      : (existing.enabled as number);
  const nextSyncVlans =
    input.syncVlans !== undefined
      ? input.syncVlans
        ? 1
        : 0
      : (existing.syncVlans as number);
  const nextSyncSubnets =
    input.syncSubnets !== undefined
      ? input.syncSubnets
        ? 1
        : 0
      : (existing.syncSubnets as number);
  const nextSyncDhcp =
    input.syncDhcp !== undefined
      ? input.syncDhcp
        ? 1
        : 0
      : (existing.syncDhcp as number);
  const nextAutoSyncEnabled =
    input.autoSyncEnabled !== undefined
      ? input.autoSyncEnabled
        ? 1
        : 0
      : ((existing.autoSyncEnabled as number) ?? 0);
  const nextAutoSyncMode =
    input.autoSyncMode ?? parseAutoSyncMode(existing.autoSyncMode);
  const nextAutoSyncCron =
    input.autoSyncCron !== undefined
      ? input.autoSyncCron?.trim() || null
      : ((existing.autoSyncCron as string | null) ?? null);
  const nextAutoSyncLabIds =
    input.autoSyncLabIds !== undefined
      ? JSON.stringify([...new Set(input.autoSyncLabIds.filter(Boolean))])
      : ((existing.autoSyncLabIds as string | null) ?? null);
  // Reconfiguring auto-sync clears any failure backoff so fixes take
  // effect immediately.
  const autoSyncTouched =
    input.autoSyncEnabled !== undefined ||
    input.autoSyncMode !== undefined ||
    input.autoSyncCron !== undefined ||
    input.autoSyncLabIds !== undefined;

  db.prepare(
    `
    UPDATE integrationConnections
    SET
      name = ?,
      baseUrl = ?,
      authKind = ?,
      authId = ?,
      authSecretEnc = ?,
      siteRef = ?,
      verifyTls = ?,
      enabled = ?,
      syncVlans = ?,
      syncSubnets = ?,
      syncDhcp = ?,
      autoSyncEnabled = ?,
      autoSyncMode = ?,
      autoSyncCron = ?,
      autoSyncLabIds = ?,
      autoSyncFailureCount = CASE WHEN ? THEN 0 ELSE autoSyncFailureCount END,
      autoSyncPausedUntil = CASE WHEN ? THEN NULL ELSE autoSyncPausedUntil END,
      updatedAt = ?
    WHERE id = ?
  `,
  ).run(
    nextName,
    nextBaseUrl,
    nextAuthKind,
    nextAuthId,
    nextSecret,
    nextSiteRef,
    nextVerifyTls,
    nextEnabled,
    nextSyncVlans,
    nextSyncSubnets,
    nextSyncDhcp,
    nextAutoSyncEnabled,
    nextAutoSyncMode,
    nextAutoSyncCron,
    nextAutoSyncLabIds,
    autoSyncTouched ? 1 : 0,
    autoSyncTouched ? 1 : 0,
    new Date().toISOString(),
    id,
  );

  return parseIntegrationConnectionPublic(getIntegrationConnectionRow(id)!);
}

export function recordIntegrationAutoSyncResult(
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
    UPDATE integrationConnections
    SET lastAutoSyncAt = ?, lastAutoSyncStatus = ?, lastAutoSyncMessage = ?,
        autoSyncFailureCount = ?, autoSyncPausedUntil = ?, updatedAt = ?
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

export function deleteIntegrationConnection(id: string) {
  const existing = getIntegrationConnectionRow(id);
  if (!existing) return false;
  db.prepare("DELETE FROM integrationConnections WHERE id = ?").run(id);
  return true;
}

export function recordIntegrationConnectionStatus(
  id: string,
  input: {
    status: IntegrationConnectionStatus;
    error?: string | null;
    summary?: Record<string, unknown> | null;
  },
) {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE integrationConnections
    SET lastStatus = ?, lastCheckedAt = ?, lastError = ?, lastSummary = ?, updatedAt = ?
    WHERE id = ?
  `,
  ).run(
    input.status,
    now,
    input.error ?? null,
    input.summary ? JSON.stringify(input.summary) : null,
    now,
    id,
  );
  const row = getIntegrationConnectionRow(id);
  return row ? parseIntegrationConnectionPublic(row) : null;
}

import { createHash, randomBytes } from "node:crypto";
import { ValidationError } from "../validation.js";

export const INTEGRATION_PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;

export type IntegrationPreviewTokenKind =
  | "network-preview"
  | "device-snapshot";

export interface IntegrationPreviewTokenScope {
  actorId: string;
  connectionId: string;
  labId: string;
  connectionRevision: string;
}

interface IntegrationPreviewTokenEntry<T> {
  kind: IntegrationPreviewTokenKind;
  scope: IntegrationPreviewTokenScope;
  payload: T;
  expiresAt: number;
}

const tokens = new Map<string, IntegrationPreviewTokenEntry<unknown>>();

function purgeExpired(now: number) {
  for (const [token, entry] of tokens) {
    if (entry.expiresAt <= now) tokens.delete(token);
  }
}

function scopeMatches(
  actual: IntegrationPreviewTokenScope,
  expected: IntegrationPreviewTokenScope,
) {
  return (
    actual.actorId === expected.actorId &&
    actual.connectionId === expected.connectionId &&
    actual.labId === expected.labId &&
    actual.connectionRevision === expected.connectionRevision
  );
}

export function integrationPreviewConnectionRevision(
  row: Record<string, unknown>,
) {
  const fields = [
    "id",
    "labId",
    "provider",
    "baseUrl",
    "authKind",
    "authId",
    "authSecretEnc",
    "siteRef",
    "scopeRefs",
    "verifyTls",
    "enabled",
    "syncVlans",
    "syncSubnets",
    "syncDhcp",
    "syncSwitches",
    "syncGateways",
    "syncAccessPoints",
    "syncHosts",
    "syncGuests",
    "syncWifi",
  ];
  return createHash("sha256")
    .update(JSON.stringify(fields.map((field) => row[field] ?? null)))
    .digest("hex");
}

export function issueIntegrationPreviewToken<T>(
  kind: IntegrationPreviewTokenKind,
  scope: IntegrationPreviewTokenScope,
  payload: T,
  now = Date.now(),
) {
  purgeExpired(now);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + INTEGRATION_PREVIEW_TOKEN_TTL_MS;
  tokens.set(token, { kind, scope: { ...scope }, payload, expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function consumeIntegrationPreviewToken<T>(
  token: string,
  kind: IntegrationPreviewTokenKind,
  scope: IntegrationPreviewTokenScope,
  now = Date.now(),
) {
  purgeExpired(now);
  const entry = tokens.get(token);
  if (!entry) {
    throw new ValidationError(
      "The integration preview has expired or was already applied. Pull inventory again.",
      409,
      "INTEGRATION_PREVIEW_EXPIRED",
    );
  }
  if (entry.kind !== kind || !scopeMatches(entry.scope, scope)) {
    throw new ValidationError(
      "The integration preview does not match this user, connection, or lab.",
      400,
      "INTEGRATION_PREVIEW_MISMATCH",
    );
  }
  tokens.delete(token);
  return entry.payload as T;
}

export function resetIntegrationPreviewTokensForTests() {
  tokens.clear();
}

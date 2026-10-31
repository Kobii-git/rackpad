import { ValidationError } from "../validation.js";

export const EXTERNAL_HEALTH = [
  "healthy",
  "degraded",
  "unhealthy",
  "unknown",
] as const;
export type ExternalHealth = (typeof EXTERNAL_HEALTH)[number];
export const EXTERNAL_COLLECTION_ERRORS = [
  "authentication",
  "rate_limited",
  "unavailable",
  "timeout",
  "invalid_response",
  "incompatible",
  "tls",
  "blocked_target",
  "missing",
  "refresh_required",
  "configuration_changed",
] as const;
export type ExternalCollectionError =
  (typeof EXTERNAL_COLLECTION_ERRORS)[number];
export interface ExternalReading {
  providerRecordId: string;
  recordName: string;
  key: string;
  label: string;
  value: number | string | boolean | null;
  unit: string | null;
  health: ExternalHealth;
  observedAt: string;
}
export interface ExternalHealthCollection {
  readings: ExternalReading[];
  warnings: string[];
}
export interface ExternalCollectionContext {
  isCurrent?: () => boolean;
}
export const MAX_EXTERNAL_READINGS = 10000;
export function validateExternalReadings(input: unknown): ExternalReading[] {
  if (!Array.isArray(input) || input.length > MAX_EXTERNAL_READINGS)
    throw new ExternalProviderError("invalid_response");
  const keys = new Set<string>();
  return input.map((value) => {
    if (!value || typeof value !== "object")
      throw new ExternalProviderError("invalid_response");
    const row = value as Record<string, unknown>;
    for (const key of [
      "providerRecordId",
      "recordName",
      "key",
      "label",
    ] as const)
      if (
        typeof row[key] !== "string" ||
        !row[key] ||
        row[key].length > (key === "providerRecordId" ? 200 : 160) ||
        [...row[key]].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        throw new ExternalProviderError("invalid_response");
    if (
      row.unit !== null &&
      (typeof row.unit !== "string" || row.unit.length > 40)
    )
      throw new ExternalProviderError("invalid_response");
    if (
      !(EXTERNAL_HEALTH as readonly unknown[]).includes(row.health) ||
      (row.value !== null &&
        typeof row.value !== "boolean" &&
        typeof row.value !== "string" &&
        typeof row.value !== "number") ||
      (typeof row.value === "number" && !Number.isFinite(row.value)) ||
      (typeof row.value === "string" && row.value.length > 1024) ||
      typeof row.observedAt !== "string" ||
      !Number.isFinite(Date.parse(row.observedAt))
    )
      throw new ExternalProviderError("invalid_response");
    const observedAt = new Date(row.observedAt as string).toISOString();
    if (Date.parse(observedAt) > Date.now() + 300000)
      throw new ExternalProviderError("invalid_response");
    const identity = JSON.stringify([row.providerRecordId, row.key]);
    if (keys.has(identity)) throw new ExternalProviderError("invalid_response");
    keys.add(identity);
    return { ...row, observedAt } as unknown as ExternalReading;
  });
}
const messages: Record<ExternalCollectionError, string> = {
  authentication:
    "Provider authentication failed. Check the read-only credentials.",
  rate_limited: "Provider rate limit reached. Try again later.",
  unavailable:
    "Provider collection failed. Previous readings are retained as unknown.",
  timeout: "Provider collection timed out.",
  invalid_response:
    "Provider returned an invalid or oversized reading response.",
  incompatible:
    "Provider capabilities are incompatible with this read-only adapter.",
  tls: "Provider TLS verification failed. Check the certificate and endpoint name.",
  blocked_target: "Provider endpoint resolves to a blocked address.",
  missing: "Reading is missing from the latest collection.",
  refresh_required:
    "Refresh provider readings before using restored observations.",
  configuration_changed: "Connection configuration changed. Refresh readings.",
};
export class ExternalProviderError extends ValidationError {
  constructor(
    public readonly category: ExternalCollectionError,
    message = messages[category],
  ) {
    super(message, 502, `EXTERNAL_${category.toUpperCase()}`);
  }
}
export function externalErrorCategory(error: unknown): ExternalCollectionError {
  if (error instanceof ExternalProviderError) return error.category;
  // Inspect only for classification. Provider/transport text is never persisted.
  const message = error instanceof Error ? error.message : "";
  if (/reserved|routable|blocked/i.test(message)) return "blocked_target";
  if (/certificate|tls|ssl/i.test(message)) return "tls";
  if (/timeout|timed out|deadline/i.test(message)) return "timeout";
  return "unavailable";
}

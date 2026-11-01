import { db } from "../../db.js";
import { ValidationError } from "../validation.js";
import { getIntegrationClient } from "./index.js";
import {
  getIntegrationConnectionRow,
  loadIntegrationConnectionSecrets,
} from "./connections.js";
import {
  beginExternalHealthWork,
  externalHealthWorkGeneration,
  invalidateExternalHealthWork,
} from "./external-health-epoch.js";
import {
  externalConfigurationRevision,
  recordExternalCollectionFailure,
  requireFreshExternalReadings,
  storeExternalReadings,
} from "./external-health.js";
import {
  externalErrorCategory,
  ExternalProviderError,
} from "./external-health-types.js";

const active = new Set<string>();
export async function refreshExternalHealth(connectionId: string) {
  if (active.has(connectionId))
    throw new ValidationError(
      "A provider collection is already running.",
      409,
      "EXTERNAL_COLLECTION_BUSY",
    );
  const row = getIntegrationConnectionRow(connectionId);
  if (!row || !row.enabled)
    throw new ValidationError(
      "Enable the connection before collecting readings.",
      409,
    );
  const client = getIntegrationClient(
    row.provider as Parameters<typeof getIntegrationClient>[0],
  );
  if (!client?.fetchReadings)
    throw new ValidationError(
      "This provider does not support external readings.",
      400,
    );
  const revision = externalConfigurationRevision(row),
    work = beginExternalHealthWork(connectionId);
  const current = () => {
    if (!work.current()) return false;
    const latest = getIntegrationConnectionRow(connectionId);
    return Boolean(
      latest &&
      latest.enabled &&
      externalConfigurationRevision(latest) === revision,
    );
  };
  active.add(connectionId);
  try {
    const collection = await client.fetchReadings(
      loadIntegrationConnectionSecrets(connectionId),
      { isCurrent: current },
    );
    if (!current()) return { applied: false, warnings: [] };
    storeExternalReadings(connectionId, collection.readings);
    return { applied: true, warnings: collection.warnings.slice(0, 100) };
  } catch (error) {
    if (!current()) return { applied: false, warnings: [] };
    const category = externalErrorCategory(error);
    recordExternalCollectionFailure(connectionId, category);
    throw new ExternalProviderError(category);
  } finally {
    work.finish();
    active.delete(connectionId);
  }
}
const lastAttempt = new Map<string, number>();
export async function runExternalHealthPollingTick(now = Date.now()) {
  const generation = externalHealthWorkGeneration();
  const rows = db
    .prepare(
      "SELECT id,healthIntervalSeconds FROM integrationConnections WHERE enabled=1 AND healthPollingEnabled=1",
    )
    .all() as Array<{ id: string; healthIntervalSeconds: number }>;
  const ids = new Set(rows.map((row) => row.id));
  for (const id of lastAttempt.keys()) if (!ids.has(id)) lastAttempt.delete(id);
  for (const candidate of rows) {
    if (generation !== externalHealthWorkGeneration()) return;
    const row = getIntegrationConnectionRow(candidate.id);
    if (!row?.enabled || !row.healthPollingEnabled || !getIntegrationClient(row.provider as Parameters<typeof getIntegrationClient>[0])?.fetchReadings) continue;
    if (
      active.has(String(row.id)) ||
      now - (lastAttempt.get(String(row.id)) ?? -Infinity) <
        Number(row.healthIntervalSeconds) * 1000
    )
      continue;
    lastAttempt.set(String(row.id), now);
    try {
      await refreshExternalHealth(String(row.id));
    } catch {
      /* Sanitized collection status is stored; retry on the configured interval. */
    }
  }
}
export function startExternalHealthPollingLoop() {
  requireFreshExternalReadings();
  lastAttempt.clear();
  let stopped = false,
    running = false;
  const handle = setInterval(() => {
    if (stopped || running) return;
    running = true;
    void runExternalHealthPollingTick()
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  }, 1000);
  handle.unref?.();
  return () => {
    stopped = true;
    clearInterval(handle);
    lastAttempt.clear();
    invalidateExternalHealthWork();
  };
}

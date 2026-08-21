import { getIntegrationClient } from "./index.js";
import {
  listIntegrationConnections,
  loadIntegrationConnectionSecrets,
  recordIntegrationConnectionStatus,
} from "./connections.js";

export interface IntegrationStatusSyncResult {
  connections: number;
  ok: number;
  failed: number;
  skipped: number;
  errors: string[];
}

// Periodically re-runs each enabled connection's lightweight test call so
// the Integrations panel shows live reachability without anyone clicking
// Test. Status only — inventory preview/apply stays a manual, review-first
// action.
export async function syncIntegrationConnectionStatuses(
  labId?: string,
): Promise<IntegrationStatusSyncResult> {
  const result: IntegrationStatusSyncResult = {
    connections: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (const connection of listIntegrationConnections(labId)) {
    if (!connection.enabled) {
      result.skipped += 1;
      continue;
    }
    const client = getIntegrationClient(connection.provider);
    if (!client || !connection.hasSecret) {
      result.skipped += 1;
      continue;
    }

    result.connections += 1;
    try {
      const secrets = loadIntegrationConnectionSecrets(connection.id);
      const test = await client.test(secrets);
      recordIntegrationConnectionStatus(connection.id, {
        status: "ok",
        error: null,
        summary: {
          product: test.product,
          version: test.version,
          ...test.summary,
        },
      });
      result.ok += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connection test failed.";
      recordIntegrationConnectionStatus(connection.id, {
        status: "error",
        error: message,
      });
      result.failed += 1;
      result.errors.push(`${connection.name}: ${message}`);
    }
  }

  return result;
}

let statusSyncHandle: NodeJS.Timeout | null = null;
let statusSyncRunning = false;

export function startIntegrationStatusSyncLoop(intervalMs: number) {
  if (intervalMs <= 0) return () => {};
  if (statusSyncHandle) clearInterval(statusSyncHandle);

  statusSyncHandle = setInterval(() => {
    if (statusSyncRunning) return;
    statusSyncRunning = true;
    void syncIntegrationConnectionStatuses()
      .catch((error) => {
        console.error(
          "[rackpad] Integration status sync failed:",
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        statusSyncRunning = false;
      });
  }, intervalMs);
  statusSyncHandle.unref?.();

  return () => {
    if (statusSyncHandle) clearInterval(statusSyncHandle);
    statusSyncHandle = null;
  };
}

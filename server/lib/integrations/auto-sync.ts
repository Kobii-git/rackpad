import { db } from "../../db.js";
import { getIntegrationClient } from "./index.js";
import {
  listIntegrationConnections,
  loadIntegrationConnectionSecrets,
  recordIntegrationAutoSyncResult,
} from "./connections.js";
import {
  applyIntegrationNetworkPreview,
  buildIntegrationNetworkPreview,
} from "./network-sync.js";
import { cronMatches, parseCronExpression } from "./cron.js";
import type { IntegrationConnectionSecrets } from "./types.js";

const AUTO_SYNC_ACTOR = "integration-auto-sync";
// Exponential backoff after consecutive failures keeps a broken controller
// from being hammered every schedule tick: 5m, 10m, 20m, ... capped at 6h.
const BACKOFF_BASE_MS = 5 * 60 * 1000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

export interface IntegrationAutoSyncRunResult {
  connectionId: string;
  status: "ok" | "error" | "drift";
  message: string;
}

function labExists(labId: string) {
  return Boolean(db.prepare("SELECT id FROM labs WHERE id = ?").get(labId));
}

function targetLabIds(connection: IntegrationConnectionSecrets) {
  const ids =
    connection.autoSyncLabIds.length > 0
      ? connection.autoSyncLabIds
      : [connection.labId];
  return [...new Set(ids)];
}

function previewChangeCount(summary: {
  vlanCreates: number;
  vlanUpdates: number;
  subnetCreates: number;
  subnetUpdates: number;
}) {
  return (
    summary.vlanCreates +
    summary.vlanUpdates +
    summary.subnetCreates +
    summary.subnetUpdates
  );
}

export async function runIntegrationAutoSync(
  connectionId: string,
): Promise<IntegrationAutoSyncRunResult> {
  const connection = loadIntegrationConnectionSecrets(connectionId);
  const client = getIntegrationClient(connection.provider);

  try {
    if (!client) {
      throw new Error("No client is available for this provider.");
    }
    if (!connection.authSecret) {
      throw new Error("The connection has no stored secret.");
    }

    const inventory = await client.fetchInventory(connection);
    const labMessages: string[] = [];
    let driftDetected = false;

    for (const labId of targetLabIds(connection)) {
      if (!labExists(labId)) {
        labMessages.push(`${labId}: lab no longer exists, skipped`);
        continue;
      }
      // merge previews only surface missing records; overwrite and skip use
      // the mirror diff so updates are visible (skip never applies it, and
      // deletes are excluded from the drift count to avoid flagging records
      // owned by other sources).
      const preview = buildIntegrationNetworkPreview({
        connection: { ...connection, labId },
        collection: inventory.collection,
        policy: connection.autoSyncMode === "merge" ? "merge" : "mirror",
      });
      const changes = previewChangeCount(preview.summary);

      if (connection.autoSyncMode === "skip") {
        if (changes > 0) {
          driftDetected = true;
          labMessages.push(
            `${labId}: drift detected (+${preview.summary.vlanCreates} VLANs, +${preview.summary.subnetCreates} subnets, ${preview.summary.vlanUpdates + preview.summary.subnetUpdates} update(s)); skip mode wrote nothing`,
          );
        } else {
          labMessages.push(`${labId}: in sync`);
        }
        continue;
      }

      if (changes === 0) {
        labMessages.push(`${labId}: in sync`);
        continue;
      }

      // Deletes are never part of auto-sync: overwrite applies the mirror
      // policy with allowDeletes off, so removals stay a manual decision.
      const result = applyIntegrationNetworkPreview({
        preview,
        allowDeletes: false,
        actor: AUTO_SYNC_ACTOR,
      });
      labMessages.push(
        `${labId}: +${result.createdVlanIds.length} VLAN(s), +${result.createdSubnetIds.length} subnet(s), ${result.updatedVlanIds.length + result.updatedSubnetIds.length} update(s)`,
      );
    }

    const status = driftDetected ? "drift" : "ok";
    const message = labMessages.join(" | ") || "No target labs configured.";
    recordIntegrationAutoSyncResult(connectionId, {
      status,
      message,
      failureCount: 0,
      pausedUntil: null,
    });
    return { connectionId, status, message };
  } catch (error) {
    const failureCount = connection.autoSyncFailureCount + 1;
    const backoffMs = Math.min(
      BACKOFF_BASE_MS * 2 ** (failureCount - 1),
      BACKOFF_CAP_MS,
    );
    const pausedUntil = new Date(Date.now() + backoffMs).toISOString();
    const reason = error instanceof Error ? error.message : "Auto-sync failed.";
    const message = `${reason} Retrying after ${Math.round(backoffMs / 60000)} minute(s) (failure ${failureCount}).`;
    recordIntegrationAutoSyncResult(connectionId, {
      status: "error",
      message,
      failureCount,
      pausedUntil,
    });
    return { connectionId, status: "error", message };
  }
}

// Scans the minutes since the previous tick (bounded) so a slow event loop
// or drifted timer cannot silently skip a scheduled run.
export function findDueIntegrationAutoSyncs(
  now: Date,
  previousTick: Date | null,
) {
  const due: string[] = [];
  const windowStart = previousTick
    ? Math.max(previousTick.getTime(), now.getTime() - 5 * 60 * 1000)
    : now.getTime() - 60 * 1000;

  for (const connection of listIntegrationConnections()) {
    if (!connection.enabled || !connection.autoSyncEnabled) continue;
    if (!connection.autoSyncCron) continue;
    if (
      connection.autoSyncPausedUntil &&
      new Date(connection.autoSyncPausedUntil).getTime() > now.getTime()
    ) {
      continue;
    }

    let schedule;
    try {
      schedule = parseCronExpression(connection.autoSyncCron);
    } catch {
      continue;
    }

    const lastRun = connection.lastAutoSyncAt
      ? new Date(connection.lastAutoSyncAt).getTime()
      : 0;
    for (
      let minute = Math.floor(windowStart / 60000) * 60000 + 60000;
      minute <= Math.floor(now.getTime() / 60000) * 60000;
      minute += 60000
    ) {
      const candidate = new Date(minute);
      if (cronMatches(schedule, candidate) && lastRun < minute) {
        due.push(connection.id);
        break;
      }
    }
  }
  return due;
}

export async function runDueIntegrationAutoSyncs(
  now: Date,
  previousTick: Date | null,
): Promise<IntegrationAutoSyncRunResult[]> {
  const results: IntegrationAutoSyncRunResult[] = [];
  // Sequential on purpose: one slow or broken controller must not fan out
  // into parallel load, and SQLite writes stay uncontended.
  for (const connectionId of findDueIntegrationAutoSyncs(now, previousTick)) {
    results.push(await runIntegrationAutoSync(connectionId));
  }
  return results;
}

let autoSyncHandle: NodeJS.Timeout | null = null;
let autoSyncRunning = false;
let previousTick: Date | null = null;

export function startIntegrationAutoSyncLoop(tickMs = 60_000) {
  if (tickMs <= 0) return () => {};
  if (autoSyncHandle) clearInterval(autoSyncHandle);

  autoSyncHandle = setInterval(() => {
    if (autoSyncRunning) return;
    autoSyncRunning = true;
    const now = new Date();
    void runDueIntegrationAutoSyncs(now, previousTick)
      .catch((error) => {
        console.error(
          "[rackpad] Integration auto-sync failed:",
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        previousTick = now;
        autoSyncRunning = false;
      });
  }, tickMs);
  autoSyncHandle.unref?.();

  return () => {
    if (autoSyncHandle) clearInterval(autoSyncHandle);
    autoSyncHandle = null;
    previousTick = null;
  };
}

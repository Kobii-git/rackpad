import { db } from "../../db.js";
import { getIntegrationClient } from "./index.js";
import { loadIntegrationConnectionSecrets } from "./connections.js";
import {
  listIntegrationSyncSchedules,
  loadIntegrationSyncSchedule,
  recordIntegrationSyncScheduleResult,
} from "./schedules.js";
import {
  applyIntegrationNetworkPreview,
  buildIntegrationNetworkPreview,
} from "./network-sync.js";
import {
  applyIntegrationDeviceSync,
  filterImportableDevicesForConnection,
} from "./device-sync.js";
import { INTEGRATION_PROVIDER_INFO } from "./types.js";
import { cronMatches, parseCronExpression } from "./cron.js";

const AUTO_SYNC_ACTOR = "integration-auto-sync";
// Exponential backoff after consecutive failures keeps a broken controller
// from being hammered every schedule tick: 5m, 10m, 20m, ... capped at 6h.
const BACKOFF_BASE_MS = 5 * 60 * 1000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

export interface IntegrationAutoSyncRunResult {
  scheduleId: string;
  connectionId: string;
  status: "ok" | "error" | "drift";
  message: string;
}

function labExists(labId: string) {
  return Boolean(db.prepare("SELECT id FROM labs WHERE id = ?").get(labId));
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

export async function runIntegrationSyncSchedule(
  scheduleId: string,
): Promise<IntegrationAutoSyncRunResult> {
  const schedule = loadIntegrationSyncSchedule(scheduleId);
  const connection = loadIntegrationConnectionSecrets(schedule.connectionId);
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
    const targetLabs =
      schedule.labIds.length > 0 ? schedule.labIds : [connection.labId];

    for (const labId of [...new Set(targetLabs)]) {
      if (!labExists(labId)) {
        labMessages.push(`${labId}: lab no longer exists, skipped`);
        continue;
      }
      // Merge previews only surface missing records; skip and mirror build
      // the mirror diff so updates are visible too. Deletes only run under
      // mirror, scoped to the object types this connection manages, with
      // referenced records protected by the engine. Devices and SSIDs stay
      // merge-only in every mode.
      const preview = buildIntegrationNetworkPreview({
        connection: { ...connection, labId },
        collection: inventory.collection,
        policy: schedule.mode === "merge" ? "merge" : "mirror",
      });
      const pendingDeletes =
        schedule.mode === "mirror"
          ? preview.summary.vlanDeletes + preview.summary.subnetDeletes
          : 0;
      const changes = previewChangeCount(preview.summary);

      const parts: string[] = [];
      if (changes > 0 || pendingDeletes > 0) {
        const applied = applyIntegrationNetworkPreview({
          preview,
          allowDeletes: schedule.mode === "mirror",
          actor: AUTO_SYNC_ACTOR,
        });
        const removed =
          applied.deletedVlanIds.length + applied.deletedSubnetIds.length;
        parts.push(
          `+${applied.createdVlanIds.length} VLAN(s), +${applied.createdSubnetIds.length} subnet(s), ${applied.updatedVlanIds.length + applied.updatedSubnetIds.length} update(s)${removed > 0 ? `, -${removed} removed` : ""}`,
        );
      }

      const importableDevices = filterImportableDevicesForConnection(
        connection,
        inventory.importableDevices ?? [],
      );
      const wifiInventory = connection.syncWifi
        ? (inventory.wifi ?? null)
        : null;
      if (importableDevices.length > 0 || wifiInventory) {
        const deviceResult = applyIntegrationDeviceSync({
          labId,
          importableDevices,
          wifi: wifiInventory,
          vendor: INTEGRATION_PROVIDER_INFO[connection.provider].vendor,
          actor: AUTO_SYNC_ACTOR,
        });
        if (
          deviceResult.createdDeviceIds.length > 0 ||
          deviceResult.createdSsidIds.length > 0
        ) {
          parts.push(
            `+${deviceResult.createdDeviceIds.length} device(s), +${deviceResult.createdSsidIds.length} SSID(s)`,
          );
        }
      }

      labMessages.push(
        `${labId}: ${parts.length > 0 ? parts.join(", ") : "in sync"}`,
      );
    }

    const status = "ok" as const;
    const message = labMessages.join(" | ") || "No target labs configured.";
    recordIntegrationSyncScheduleResult(scheduleId, {
      status,
      message,
      failureCount: 0,
      pausedUntil: null,
    });
    return {
      scheduleId,
      connectionId: schedule.connectionId,
      status,
      message,
    };
  } catch (error) {
    const failureCount = schedule.failureCount + 1;
    const backoffMs = Math.min(
      BACKOFF_BASE_MS * 2 ** (failureCount - 1),
      BACKOFF_CAP_MS,
    );
    const pausedUntil = new Date(Date.now() + backoffMs).toISOString();
    const reason = error instanceof Error ? error.message : "Auto-sync failed.";
    const message = `${reason} Retrying after ${Math.round(backoffMs / 60000)} minute(s) (failure ${failureCount}).`;
    recordIntegrationSyncScheduleResult(scheduleId, {
      status: "error",
      message,
      failureCount,
      pausedUntil,
    });
    return {
      scheduleId,
      connectionId: schedule.connectionId,
      status: "error",
      message,
    };
  }
}

// Scans the minutes since the previous tick (bounded) so a slow event loop
// or drifted timer cannot silently skip a scheduled run.
export function findDueIntegrationSyncSchedules(
  now: Date,
  previousTick: Date | null,
) {
  const due: string[] = [];
  const windowStart = previousTick
    ? Math.max(previousTick.getTime(), now.getTime() - 5 * 60 * 1000)
    : now.getTime() - 60 * 1000;

  const enabledConnections = new Set(
    (
      db
        .prepare("SELECT id FROM integrationConnections WHERE enabled = 1")
        .all() as Array<{ id: string }>
    ).map((row) => row.id),
  );

  for (const schedule of listIntegrationSyncSchedules()) {
    if (!schedule.enabled) continue;
    if (!enabledConnections.has(schedule.connectionId)) continue;
    if (
      schedule.pausedUntil &&
      new Date(schedule.pausedUntil).getTime() > now.getTime()
    ) {
      continue;
    }

    let parsed;
    try {
      parsed = parseCronExpression(schedule.cron);
    } catch {
      continue;
    }

    const lastRun = schedule.lastRunAt
      ? new Date(schedule.lastRunAt).getTime()
      : 0;
    for (
      let minute = Math.floor(windowStart / 60000) * 60000 + 60000;
      minute <= Math.floor(now.getTime() / 60000) * 60000;
      minute += 60000
    ) {
      if (cronMatches(parsed, new Date(minute)) && lastRun < minute) {
        due.push(schedule.id);
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
  for (const scheduleId of findDueIntegrationSyncSchedules(now, previousTick)) {
    results.push(await runIntegrationSyncSchedule(scheduleId));
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

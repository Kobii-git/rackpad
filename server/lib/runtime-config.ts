export const DEFAULT_MONITOR_INTERVAL_MS = 300_000;
export const DEFAULT_DISCOVERY_SCAN_SCHEDULE_INTERVAL_MS = 60_000;
export const DEFAULT_DOCKER_STATUS_SYNC_INTERVAL_MS = 300_000;

export function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return {
    port: parsePositiveInteger(environment.PORT, 3000),
    host: environment.HOST?.trim() || "0.0.0.0",
    monitorIntervalMs: parsePositiveInteger(
      environment.MONITOR_INTERVAL_MS,
      DEFAULT_MONITOR_INTERVAL_MS,
    ),
    discoveryScanScheduleIntervalMs: parsePositiveInteger(
      environment.DISCOVERY_SCAN_SCHEDULE_INTERVAL_MS,
      DEFAULT_DISCOVERY_SCAN_SCHEDULE_INTERVAL_MS,
    ),
    dockerStatusSyncIntervalMs: parsePositiveInteger(
      environment.DOCKER_STATUS_SYNC_INTERVAL_MS,
      DEFAULT_DOCKER_STATUS_SYNC_INTERVAL_MS,
    ),
  };
}

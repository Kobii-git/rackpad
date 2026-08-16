import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DISCOVERY_SCAN_SCHEDULE_INTERVAL_MS,
  DEFAULT_DOCKER_STATUS_SYNC_INTERVAL_MS,
  DEFAULT_MONITOR_INTERVAL_MS,
  parsePositiveInteger,
  resolveRuntimeConfig,
} from "../lib/runtime-config.js";

test("runtime intervals use documented defaults", () => {
  assert.deepEqual(resolveRuntimeConfig({}), {
    port: 3000,
    host: "0.0.0.0",
    monitorIntervalMs: DEFAULT_MONITOR_INTERVAL_MS,
    discoveryScanScheduleIntervalMs:
      DEFAULT_DISCOVERY_SCAN_SCHEDULE_INTERVAL_MS,
    dockerStatusSyncIntervalMs: DEFAULT_DOCKER_STATUS_SYNC_INTERVAL_MS,
  });
});

test("runtime intervals accept positive integers", () => {
  assert.deepEqual(
    resolveRuntimeConfig({
      PORT: "3100",
      HOST: "127.0.0.1",
      MONITOR_INTERVAL_MS: "15000",
      DISCOVERY_SCAN_SCHEDULE_INTERVAL_MS: "30000",
      DOCKER_STATUS_SYNC_INTERVAL_MS: "45000",
    }),
    {
      port: 3100,
      host: "127.0.0.1",
      monitorIntervalMs: 15000,
      discoveryScanScheduleIntervalMs: 30000,
      dockerStatusSyncIntervalMs: 45000,
    },
  );
});

test("invalid runtime integers fall back instead of disabling background work", () => {
  for (const value of ["0", "-1", "1.5", "not-a-number", "12ms", ""]) {
    assert.equal(parsePositiveInteger(value, 1234), 1234);
  }
});

import { INTEGRATION_PROVIDER_INFO, type IntegrationProvider } from "./types.js";
import type Database from "better-sqlite3";
import { ValidationError } from "../validation.js";
import {
  validateExternalReadings,
  MAX_EXTERNAL_READINGS,
  EXTERNAL_COLLECTION_ERRORS,
} from "./external-health-types.js";
export function validateExternalHealthRows(input: {
  connections: Record<string, unknown>[];
  devices: Record<string, unknown>[];
  monitors: Record<string, unknown>[];
  bindings: Record<string, unknown>[];
  readings: Record<string, unknown>[];
  mappings: Record<string, unknown>[];
}) {
  const connections = new Map(input.connections.map((row) => [row.id, row])),
    devices = new Map(input.devices.map((row) => [row.id, row])),
    monitors = new Map(input.monitors.map((row) => [row.id, row]));
  const bindings = new Map<unknown, Record<string, unknown>>(),
    records = new Set<string>(),
    mappingKeys = new Set<string>(),
    monitorIds = new Set<unknown>();
  const invalid = () => {
    throw new ValidationError(
      "Invalid external health bindings, readings or monitor mappings.",
      422,
    );
  };
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.length > 0 && value.length <= max;
  const date = (value: unknown) =>
    typeof value === "string" && Number.isFinite(Date.parse(value));
  const counts = new Map<unknown, number>();
  const supportsHealth = (connection: Record<string,unknown> | undefined) => !!connection && !!INTEGRATION_PROVIDER_INFO[connection.provider as IntegrationProvider]?.capabilities.health;
  for (const connection of input.connections) {
    const info = INTEGRATION_PROVIDER_INFO[connection.provider as IntegrationProvider];
    if ((connection.authKind === "anonymous" && (connection.authSecretEnc != null || connection.authId != null)) || !info || !info.authKinds.includes(connection.authKind as never) || (Boolean(connection.healthPollingEnabled) && !info.capabilities.health) || (info.capabilities.health && Boolean(connection.autoSyncEnabled))) invalid();
    if (
      connection.healthPollingEnabled !== undefined &&
      ![0, 1, true, false].includes(connection.healthPollingEnabled as number)
    )
      invalid();
    if (
      connection.healthIntervalSeconds !== undefined &&
      (!Number.isInteger(connection.healthIntervalSeconds) ||
        Number(connection.healthIntervalSeconds) < 60 ||
        Number(connection.healthIntervalSeconds) > 3600)
    )
      invalid();
    if (
      connection.healthLastError != null &&
      !(EXTERNAL_COLLECTION_ERRORS as readonly unknown[]).includes(
        connection.healthLastError,
      )
    )
      invalid();
    if (
      connection.healthLastCheckedAt != null &&
      !date(connection.healthLastCheckedAt)
    )
      invalid();
  }
  for (const row of input.bindings) {
    const connection = connections.get(row.connectionId),
      device = devices.get(row.deviceId),
      identity = JSON.stringify([row.connectionId, row.providerRecordId]);
    if (
      !supportsHealth(connection) ||
      !device ||
      connection!.labId !== device.labId ||
      !text(row.id, 80) ||
      bindings.has(row.id) ||
      !text(row.providerRecordId, 200) ||
      records.has(identity) ||
      typeof row.sourceIdentity !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.sourceIdentity) ||
      !date(row.updatedAt)
    )
      invalid();
    bindings.set(row.id, row);
    records.add(identity);
  }
  records.clear();
  for (const row of input.readings) {
    const identity = JSON.stringify([
      row.connectionId,
      row.providerRecordId,
      row.readingKey,
    ]);
    const count = (counts.get(row.connectionId) ?? 0) + 1;
    counts.set(row.connectionId, count);
    if (
      !supportsHealth(connections.get(row.connectionId)) ||
      records.has(identity) ||
      count > MAX_EXTERNAL_READINGS ||
      (row.collectionError != null &&
        !(EXTERNAL_COLLECTION_ERRORS as readonly unknown[]).includes(
          row.collectionError,
        )) ||
      !date(row.collectedAt)
    )
      invalid();
    records.add(identity);
    let value: unknown;
    try {
      value = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    } catch {
      invalid();
    }
    try {
      validateExternalReadings([
        {
          providerRecordId: row.providerRecordId,
          recordName: row.recordName,
          key: row.readingKey,
          label: row.label,
          value,
          unit: row.unit,
          health: row.health,
          observedAt: row.observedAt,
        },
      ]);
    } catch {
      invalid();
    }
  }
  for (const row of input.mappings) {
    const monitor = monitors.get(row.monitorId),
      binding = row.bindingId == null ? undefined : bindings.get(row.bindingId);
    const identity = JSON.stringify([row.bindingId, row.readingKey]);
    if (
      !monitor ||
      monitor.type !== "external" ||
      monitorIds.has(row.monitorId) ||
      !text(row.readingKey, 160) ||
      ![0, 1, true, false].includes(row.alertOnDegraded as number) ||
      (row.bindingId != null &&
        (!binding ||
          binding.deviceId !== monitor.deviceId ||
          mappingKeys.has(identity))) ||
      (row.bindingId == null && Boolean(monitor.enabled))
    )
      invalid();
    monitorIds.add(row.monitorId);
    if (binding) mappingKeys.add(identity);
  }
  for (const monitor of input.monitors)
    if (monitor.type === "external" && !monitorIds.has(monitor.id)) invalid();
}
export function validateStoredExternalHealth(database: Database.Database) {
  const rows = (table: string) =>
    database.prepare(`SELECT * FROM ${table}`).all() as Record<
      string,
      unknown
    >[];
  validateExternalHealthRows({
    connections: rows("integrationConnections"),
    devices: rows("devices"),
    monitors: rows("deviceMonitors"),
    bindings: rows("integrationRecordBindings"),
    readings: rows("integrationLatestReadings"),
    mappings: rows("externalMonitorMappings"),
  });
}

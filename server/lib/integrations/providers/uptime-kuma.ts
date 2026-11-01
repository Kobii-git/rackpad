import type {
  IntegrationClient,
  IntegrationImportableDevice,
} from "../inventory.js";
import type { IntegrationConnectionSecrets } from "../types.js";
import {
  ExternalProviderError,
  validateExternalReadings,
  type ExternalCollectionContext,
  type ExternalHealth,
  type ExternalReading,
} from "../external-health-types.js";
import { basicAuthorization, externalHttp } from "../external-http.js";

const metrics = new Map([
  ["monitor_status", { key: "status", label: "Status", unit: null }],
  [
    "monitor_response_time",
    { key: "response_time", label: "Response time", unit: "ms" },
  ],
  [
    "monitor_cert_days_remaining",
    {
      key: "certificate_days_remaining",
      label: "Certificate days remaining",
      unit: "days",
    },
  ],
  [
    "monitor_cert_is_valid",
    { key: "certificate_valid", label: "Certificate validity", unit: null },
  ],
]);
function labels(source: string) {
  const result = new Map<string, string>();
  let position = 0;
  const pattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\[\\n"]|[^"\\])*)"(?:,|$)/y;
  while (position < source.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(source);
    if (!match || result.has(match[1]))
      throw new ExternalProviderError("invalid_response");
    result.set(match[1], JSON.parse(`"${match[2]}"`) as string);
    position = pattern.lastIndex;
  }
  return result;
}
export function parseKumaMetrics(
  body: string,
  observedAt = new Date().toISOString(),
) {
  const readings: ExternalReading[] = [];
  const lines = body.split(/\r?\n/);
  if (lines.length > 100000)
    throw new ExternalProviderError("invalid_response");
  let statusCount = 0;
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    if (line.length > 8192) throw new ExternalProviderError("invalid_response");
    const match =
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([^\s]+)(?:\s+([0-9]+))?\s*$/.exec(
        line,
      );
    if (!match) throw new ExternalProviderError("invalid_response");
    const metric = metrics.get(match[1]);
    if (!metric) continue;
    const attributes = labels(match[2] || "");
    const id = attributes.get("monitor_id");
    if (!id || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(id))
      throw new ExternalProviderError(
        "incompatible",
        "Uptime Kuma metrics require stable monitor_id labels. Enable a compatible Prometheus integration; name-only metrics cannot be adopted safely.",
      );
    if (!/^(?:[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|[+-]?Inf|NaN)$/.test(match[3])) throw new ExternalProviderError("invalid_response");
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    let health: ExternalHealth = "unknown";
    let normalized: ExternalReading["value"] = value;
    if (match[1] === "monitor_status") {
      statusCount++;
      if (![0, 1, 2, 3].includes(value))
        throw new ExternalProviderError("invalid_response");
      health = value === 1 ? "healthy" : value === 0 ? "unhealthy" : "unknown";
      normalized = ["down", "up", "pending", "maintenance"][value];
    } else if (match[1] === "monitor_cert_is_valid") {
      if (value !== 0 && value !== 1)
        throw new ExternalProviderError("invalid_response");
      normalized = Boolean(value);
      health = value ? "healthy" : "unhealthy";
    }
    if (match[4] && !Number.isFinite(new Date(Number(match[4])).getTime()))
      throw new ExternalProviderError("invalid_response");
    const timestamp = match[4]
      ? new Date(Number(match[4])).toISOString()
      : observedAt;
    readings.push({
      providerRecordId: `monitor:${id}`,
      recordName:
        attributes.get("monitor_name")?.slice(0, 160) || `Monitor ${id}`,
      key: metric.key,
      label: metric.label,
      value: normalized,
      unit: metric.unit,
      health,
      observedAt: timestamp,
    });
    if (readings.length > 10000)
      throw new ExternalProviderError("invalid_response");
  }
  if (!statusCount)
    throw new ExternalProviderError(
      "incompatible",
      "Uptime Kuma returned no monitor_status metrics with stable monitor_id labels. Check Prometheus access and monitor identifiers.",
    );
  // Pending/maintenance monitors suppress certificate outages as well.
  const inactive = new Set(
    readings
      .filter((row) => row.key === "status" && row.health === "unknown")
      .map((row) => row.providerRecordId),
  );
  return validateExternalReadings(
    readings.map((row) =>
      inactive.has(row.providerRecordId)
        ? { ...row, health: "unknown" as const }
        : row,
    ),
  );
}
async function collect(
  connection: IntegrationConnectionSecrets,
  context?: ExternalCollectionContext,
) {
  if (!connection.authSecret) throw new ExternalProviderError("authentication");
  const http = externalHttp(
    connection,
    {
      Authorization: basicAuthorization(
        connection.authId || "",
        connection.authSecret,
      ),
      Accept: "text/plain",
    },
    context,
  );
  return {
    readings: parseKumaMetrics((await http.get("/metrics")).bodyText),
    warnings: [],
  };
}
export const uptimeKumaIntegrationClient: IntegrationClient = {
  provider: "uptime-kuma",
  fetchReadings: collect,
  async test(connection, context) {
    const result = await collect(connection, context);
    return {
      product: "Uptime Kuma",
      version: null,
      summary: {
        monitors: new Set(result.readings.map((row) => row.providerRecordId))
          .size,
      },
    };
  },
  async fetchInventory(connection, context) {
    const result = await collect(connection, context);
    const records = new Map(
      result.readings.map((row) => [row.providerRecordId, row]),
    );
    const importableDevices: IntegrationImportableDevice[] = [
      ...records.values(),
    ].map((row) => ({
      providerRecordId: row.providerRecordId,
      name: row.recordName,
      deviceType: "other",
      model: null,
      macAddress: null,
      ipAddress: null,
      serial: null,
      firmware: null,
      online: null,
      ports: [],
    }));
    return {
      collection: { vlans: [], subnets: [], dhcpScopes: [], warnings: [] },
      devices: importableDevices.map((row) => ({
        name: row.name,
        kind: "other",
        model: null,
        macAddress: null,
        ipAddress: null,
        status: null,
        detail: null,
      })),
      importableDevices,
      warnings: result.warnings,
    };
  },
};

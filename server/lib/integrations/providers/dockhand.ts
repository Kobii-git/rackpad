import { ValidationError } from "../../validation.js";
import {
  buildIntegrationUrl,
  integrationHttpRequest,
  parseIntegrationJson,
} from "../http.js";
import type {
  IntegrationClient,
  IntegrationDevicePreview,
  IntegrationInventory,
  IntegrationTestResult,
} from "../inventory.js";
import type { IntegrationConnectionSecrets } from "../types.js";

const TARGET_LABEL = "Dockhand";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function dockhandRequest(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
  options: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
) {
  const url = buildIntegrationUrl(connection.baseUrl, apiPath, options.query);
  const response = await integrationHttpRequest(
    {
      url,
      method: options.method ?? "GET",
      headers: { Authorization: `Bearer ${connection.authSecret ?? ""}` },
      verifyTls: connection.verifyTls,
    },
    TARGET_LABEL,
  );
  if (response.status === 401 || response.status === 403) {
    throw new ValidationError(
      "Dockhand rejected the API token. Generate one on the profile page and check that authentication is enabled.",
      502,
    );
  }
  if (response.status === 429) {
    throw new ValidationError(
      "Dockhand is rate limiting authentication attempts. Wait a few minutes and try again.",
      502,
    );
  }
  return response;
}

async function dockhandJson(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
  options: Parameters<typeof dockhandRequest>[2] = {},
): Promise<unknown> {
  const response = await dockhandRequest(connection, apiPath, options);
  if (response.status < 200 || response.status >= 300) {
    throw new ValidationError(
      `${TARGET_LABEL} returned HTTP ${response.status} for ${apiPath}.`,
      502,
    );
  }
  return parseIntegrationJson(response, TARGET_LABEL);
}

// The app version is only exposed through the Prometheus endpoint
// (dockhand_build_info); every JSON endpoint omits it.
async function dockhandVersion(
  connection: IntegrationConnectionSecrets,
): Promise<string | null> {
  try {
    const response = await dockhandRequest(connection, "/metrics");
    if (response.status < 200 || response.status >= 300) return null;
    const match = response.bodyText.match(
      /dockhand_build_info\{[^}]*version="([^"]+)"/,
    );
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

interface DockhandEnvironment {
  id: number;
  name: string;
  host: string | null;
  connectionType: string;
}

async function dockhandEnvironments(
  connection: IntegrationConnectionSecrets,
): Promise<DockhandEnvironment[]> {
  const environments = asArray(await dockhandJson(connection, "/api/environments"));
  return environments
    .map((entry) => {
      const row = asRecord(entry);
      return {
        id: asNumber(row.id) ?? -1,
        name: asText(row.name) || `environment-${asText(row.id)}`,
        host: asText(row.host) || null,
        connectionType: asText(row.connectionType) || "socket",
      };
    })
    .filter((environment) => environment.id >= 0);
}

function filterEnvironments(
  environments: DockhandEnvironment[],
  siteRef: string | null,
) {
  if (!siteRef) return environments;
  const wanted = siteRef.trim().toLowerCase();
  const matched = environments.filter(
    (environment) =>
      String(environment.id) === wanted ||
      environment.name.toLowerCase() === wanted,
  );
  if (matched.length === 0) {
    throw new ValidationError(
      `Dockhand environment "${siteRef}" was not found. Available environments: ${environments
        .map((environment) => environment.name)
        .join(", ")}.`,
    );
  }
  return matched;
}

async function dockhandTest(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationTestResult> {
  const environments = await dockhandEnvironments(connection);
  const version = await dockhandVersion(connection);
  return {
    product: "Dockhand",
    version,
    summary: {
      environments: environments.length,
      environmentNames: environments.map((environment) => environment.name),
    },
  };
}

interface DockhandEnvironmentStats {
  online: boolean;
  containersTotal: number | null;
  containersRunning: number | null;
  stacksTotal: number | null;
}

async function dockhandStats(
  connection: IntegrationConnectionSecrets,
): Promise<Map<number, DockhandEnvironmentStats>> {
  const stats = new Map<number, DockhandEnvironmentStats>();
  try {
    for (const entry of asArray(
      await dockhandJson(connection, "/api/dashboard/stats"),
    )) {
      const row = asRecord(entry);
      const id = asNumber(row.id);
      if (id == null) continue;
      const containers = asRecord(row.containers);
      const stacks = asRecord(row.stacks);
      stats.set(id, {
        online: row.online !== false,
        containersTotal: asNumber(containers.total),
        containersRunning: asNumber(containers.running),
        stacksTotal: asNumber(stacks.total),
      });
    }
  } catch {
    // Older builds may lack dashboard stats; environments still list.
  }
  return stats;
}

function containerPreview(entry: unknown): IntegrationDevicePreview {
  const row = asRecord(entry);
  const networks = asRecord(row.networks);
  const firstNetwork = Object.values(networks)
    .map((value) => asText(asRecord(value).ipAddress))
    .find(Boolean);
  const labels = asRecord(row.labels);
  const stack = asText(labels["com.docker.compose.project"]);
  const health = asText(row.health);
  const state = asText(row.state) || null;
  return {
    name: asText(row.name) || asText(row.id).slice(0, 12),
    kind: "container",
    model: asText(row.image) || null,
    macAddress: null,
    ipAddress: firstNetwork || null,
    status: health ? `${state ?? "unknown"} (${health})` : state,
    detail: stack ? `stack: ${stack}` : asText(row.status) || null,
  };
}

async function dockhandFetchInventory(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationInventory> {
  const warnings: string[] = [];
  const devices: IntegrationDevicePreview[] = [];

  const environments = filterEnvironments(
    await dockhandEnvironments(connection),
    connection.siteRef,
  );
  const stats = await dockhandStats(connection);

  for (const environment of environments) {
    const environmentStats = stats.get(environment.id);
    const online = environmentStats?.online !== false;
    devices.push({
      name: environment.name,
      kind: "host",
      model: null,
      macAddress: null,
      ipAddress: environment.host,
      status: online ? "online" : "offline",
      detail: [
        environment.connectionType,
        environmentStats?.containersTotal != null
          ? `${environmentStats.containersRunning ?? 0}/${environmentStats.containersTotal} containers running`
          : "",
        environmentStats?.stacksTotal != null
          ? `${environmentStats.stacksTotal} stack(s)`
          : "",
      ]
        .filter(Boolean)
        .join(" · ") || null,
    });

    if (!online) {
      warnings.push(
        `Dockhand environment ${environment.name} is offline; its containers were skipped.`,
      );
      continue;
    }

    // Docker connection failures surface as empty arrays, not errors, so an
    // online environment with zero rows is trustworthy.
    for (const entry of asArray(
      await dockhandJson(connection, "/api/containers", {
        query: { env: environment.id, all: true },
      }),
    )) {
      devices.push(containerPreview(entry));
    }

    for (const entry of asArray(
      await dockhandJson(connection, "/api/networks", {
        query: { env: environment.id },
      }),
    )) {
      const row = asRecord(entry);
      const ipam = asRecord(row.ipam);
      const subnets = asArray(ipam.config)
        .map((config) => asText(asRecord(config).subnet))
        .filter(Boolean);
      const memberCount = Object.keys(asRecord(row.containers)).length;
      devices.push({
        name: `${environment.name}/${asText(row.name)}`,
        kind: "bridge",
        model: null,
        macAddress: null,
        ipAddress: null,
        status: null,
        detail: [
          asText(row.driver),
          subnets.join(", "),
          memberCount > 0 ? `${memberCount} container(s)` : "",
        ]
          .filter(Boolean)
          .join(" · ") || null,
      });
    }
  }

  warnings.push(
    "Dockhand provides container inventory. Docker networks are shown as read-only previews and are not applied to IPAM.",
  );

  return {
    collection: { vlans: [], subnets: [], dhcpScopes: [] },
    devices,
    warnings,
  };
}

export const dockhandIntegrationClient: IntegrationClient = {
  provider: "dockhand",
  test: dockhandTest,
  fetchInventory: dockhandFetchInventory,
};

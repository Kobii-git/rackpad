import { ValidationError } from "../../validation.js";
import { canonicalizeIpv4Cidr } from "../../ip-cidr.js";
import {
  buildIntegrationUrl,
  integrationHttpRequest,
  parseIntegrationJson,
} from "../http.js";
import type {
  IntegrationClient,
  IntegrationDeviceKind,
  IntegrationDevicePreview,
  IntegrationInventory,
  IntegrationTestResult,
} from "../inventory.js";
import type { IntegrationConnectionSecrets } from "../types.js";
import type {
  SnmpCollectedDhcpScope,
  SnmpCollectedSubnet,
  SnmpCollectedVlan,
} from "../../snmp-profiles/types.js";

const TARGET_LABEL = "Omada Controller";
const PAGE_SIZE = 100;

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

function isUsableIpv4(value: string) {
  const octets = value.split(".");
  if (octets.length !== 4) return false;
  const numbers = octets.map((octet) => Number(octet));
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (numbers[0] === 127 || numbers[0] === 0 || numbers[0] >= 224) return false;
  if (numbers[0] === 169 && numbers[1] === 254) return false;
  return true;
}

function usableIpv4(value: unknown) {
  const address = asText(value).split("/")[0];
  return address && isUsableIpv4(address) ? address : "";
}

// Every Omada endpoint answers HTTP 200 with an
// { errorCode, msg, result } envelope; errorCode 0 means success.
function unwrapEnvelope(payload: unknown, apiPath: string): unknown {
  const body = asRecord(payload);
  const errorCode = asNumber(body.errorCode);
  if (errorCode !== 0) {
    const message = asText(body.msg) || `error ${errorCode ?? "unknown"}`;
    throw new ValidationError(
      `${TARGET_LABEL} returned ${message} for ${apiPath}.`,
      502,
    );
  }
  return body.result ?? null;
}

async function omadaRequest(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
  options: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    accessToken?: string;
  } = {},
): Promise<{ status: number; payload: unknown }> {
  const url = buildIntegrationUrl(connection.baseUrl, apiPath, options.query);
  const headers: Record<string, string> = {};
  if (options.accessToken) {
    headers.Authorization = `AccessToken=${options.accessToken}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await integrationHttpRequest(
    {
      url,
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      verifyTls: connection.verifyTls,
    },
    TARGET_LABEL,
  );
  if (response.status === 401) {
    throw new ValidationError(
      "Omada rejected the Open API credentials. Check the client ID, client secret, and app permissions.",
      502,
    );
  }
  return {
    status: response.status,
    payload:
      response.status >= 200 && response.status < 300
        ? parseIntegrationJson(response, TARGET_LABEL)
        : null,
  };
}

async function omadaJson(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
  options: Parameters<typeof omadaRequest>[2] = {},
): Promise<unknown> {
  const { status, payload } = await omadaRequest(connection, apiPath, options);
  if (status < 200 || status >= 300) {
    throw new ValidationError(
      `${TARGET_LABEL} returned HTTP ${status} for ${apiPath}.`,
      502,
    );
  }
  return unwrapEnvelope(payload, apiPath);
}

interface OmadaSession {
  omadacId: string;
  controllerVer: string;
  accessToken: string;
}

async function omadaLogin(
  connection: IntegrationConnectionSecrets,
): Promise<OmadaSession> {
  const info = asRecord(await omadaJson(connection, "/api/info"));
  const omadacId = asText(info.omadacId);
  if (!omadacId) {
    throw new ValidationError(
      "Omada did not report an omadacId. Check that the URL points at the controller (default https://host:8043).",
      502,
    );
  }

  const token = asRecord(
    await omadaJson(connection, "/openapi/authorize/token", {
      method: "POST",
      query: { grant_type: "client_credentials" },
      body: {
        omadacId,
        client_id: connection.authId ?? "",
        client_secret: connection.authSecret ?? "",
      },
    }),
  );
  const accessToken = asText(token.accessToken);
  if (!accessToken) {
    throw new ValidationError(
      "Omada did not return an access token for the Open API client.",
      502,
    );
  }
  return {
    omadacId,
    controllerVer: asText(info.controllerVer),
    accessToken,
  };
}

async function omadaGridPage(
  connection: IntegrationConnectionSecrets,
  session: OmadaSession,
  apiPath: string,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let page = 1;
  for (;;) {
    const result = asRecord(
      await omadaJson(connection, apiPath, {
        accessToken: session.accessToken,
        query: { page, pageSize: PAGE_SIZE },
      }),
    );
    const data = asArray(result.data);
    items.push(...data);
    const totalRows = asNumber(result.totalRows) ?? data.length;
    if (data.length === 0 || items.length >= totalRows) break;
    page += 1;
  }
  return items;
}

interface OmadaSite {
  siteId: string;
  name: string;
}

async function omadaSites(
  connection: IntegrationConnectionSecrets,
  session: OmadaSession,
): Promise<OmadaSite[]> {
  const sites = await omadaGridPage(
    connection,
    session,
    `/openapi/v1/${session.omadacId}/sites`,
  );
  return sites
    .map((entry) => {
      const row = asRecord(entry);
      return { siteId: asText(row.siteId), name: asText(row.name) };
    })
    .filter((site) => site.siteId);
}

function pickOmadaSite(sites: OmadaSite[], siteRef: string | null): OmadaSite {
  if (sites.length === 0) {
    throw new ValidationError(
      "Omada reported no sites visible to this Open API client.",
      502,
    );
  }
  if (!siteRef) return sites[0];
  const wanted = siteRef.trim().toLowerCase();
  const match = sites.find(
    (site) =>
      site.siteId.toLowerCase() === wanted || site.name.toLowerCase() === wanted,
  );
  if (!match) {
    throw new ValidationError(
      `Omada site "${siteRef}" was not found. Available sites: ${sites
        .map((site) => site.name)
        .join(", ")}.`,
    );
  }
  return match;
}

const OMADA_DEVICE_KINDS: Record<string, IntegrationDeviceKind> = {
  switch: "switch",
  ap: "access-point",
  gateway: "gateway",
};

const OMADA_DEVICE_STATUSES: Record<number, string> = {
  0: "disconnected",
  1: "connected",
  2: "pending",
  3: "heartbeat missed",
  4: "isolated",
};

async function omadaTest(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationTestResult> {
  const session = await omadaLogin(connection);
  const sites = await omadaSites(connection, session);
  return {
    product: "Omada Controller",
    version: session.controllerVer || null,
    summary: {
      omadacId: session.omadacId,
      sites: sites.length,
      siteNames: sites.map((site) => site.name),
    },
  };
}

interface OmadaNetworkRow {
  name: string;
  vlanNumber: number | null;
  cidr: string | null;
  pools: Array<{ startIp: string; endIp: string }>;
}

function parseLanNetwork(entry: unknown): OmadaNetworkRow {
  const row = asRecord(entry);
  const name = asText(row.name) || "Omada network";
  const vlan = asNumber(row.vlan);
  const vlanNumber =
    vlan != null && vlan >= 1 && vlan <= 4094 ? Math.trunc(vlan) : null;

  let cidr: string | null = null;
  const gatewaySubnet = asText(row.gatewaySubnet);
  if (usableIpv4(gatewaySubnet)) {
    try {
      cidr = canonicalizeIpv4Cidr(gatewaySubnet);
    } catch {
      cidr = null;
    }
  }

  const pools: Array<{ startIp: string; endIp: string }> = [];
  const dhcp = asRecord(row.dhcpSettingsVO ?? row.dhcpSettings);
  const dhcpEnabled = dhcp.enable === true || dhcp.enable === "true";
  if (dhcpEnabled) {
    for (const poolEntry of asArray(dhcp.ipRangePool)) {
      const pool = asRecord(poolEntry);
      const startIp = usableIpv4(pool.ipaddrStart);
      const endIp = usableIpv4(pool.ipaddrEnd);
      if (startIp && endIp) pools.push({ startIp, endIp });
    }
    if (pools.length === 0) {
      const startIp = usableIpv4(dhcp.ipaddrStart);
      const endIp = usableIpv4(dhcp.ipaddrEnd);
      if (startIp && endIp) pools.push({ startIp, endIp });
    }
  }

  return { name, vlanNumber, cidr, pools };
}

async function omadaLanNetworks(
  connection: IntegrationConnectionSecrets,
  session: OmadaSession,
  siteId: string,
  warnings: string[],
): Promise<OmadaNetworkRow[]> {
  // lan-networks arrived with the 5.15.x Open API expansion; newer schema
  // versions add DHCP detail, so try v3 -> v2 -> v1 and tolerate 404s from
  // older firmware.
  for (const apiVersion of ["v3", "v2", "v1"]) {
    const apiPath = `/openapi/${apiVersion}/${session.omadacId}/sites/${siteId}/lan-networks`;
    const { status, payload } = await omadaRequest(connection, apiPath, {
      accessToken: session.accessToken,
      query: { page: 1, pageSize: PAGE_SIZE },
    });
    if (status === 404) continue;
    if (status < 200 || status >= 300) {
      throw new ValidationError(
        `${TARGET_LABEL} returned HTTP ${status} for ${apiPath}.`,
        502,
      );
    }
    const result = asRecord(unwrapEnvelope(payload, apiPath));
    const rows = asArray(result.data).map(parseLanNetwork);
    const totalRows = asNumber(result.totalRows) ?? rows.length;
    if (totalRows > rows.length) {
      let page = 2;
      while (rows.length < totalRows) {
        const nextResult = asRecord(
          await omadaJson(connection, apiPath, {
            accessToken: session.accessToken,
            query: { page, pageSize: PAGE_SIZE },
          }),
        );
        const nextRows = asArray(nextResult.data).map(parseLanNetwork);
        if (nextRows.length === 0) break;
        rows.push(...nextRows);
        page += 1;
      }
    }
    return rows;
  }
  warnings.push(
    "This Omada Controller does not expose LAN networks over the Open API (controller 5.15+ required). Devices were imported; document VLANs manually.",
  );
  return [];
}

async function omadaFetchInventory(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationInventory> {
  const warnings: string[] = [];
  const devices: IntegrationDevicePreview[] = [];
  const vlans: SnmpCollectedVlan[] = [];
  const subnets: SnmpCollectedSubnet[] = [];
  const dhcpScopes: SnmpCollectedDhcpScope[] = [];
  const seenVlans = new Set<number>();
  const seenSubnets = new Set<string>();

  const session = await omadaLogin(connection);
  const site = pickOmadaSite(
    await omadaSites(connection, session),
    connection.siteRef,
  );

  for (const entry of await omadaGridPage(
    connection,
    session,
    `/openapi/v1/${session.omadacId}/sites/${site.siteId}/devices`,
  )) {
    const row = asRecord(entry);
    const status = asNumber(row.status);
    devices.push({
      name: asText(row.name) || asText(row.mac),
      kind: OMADA_DEVICE_KINDS[asText(row.type).toLowerCase()] ?? "other",
      model: asText(row.model) || null,
      macAddress: asText(row.mac) || null,
      ipAddress: usableIpv4(row.ip) || asText(row.ip) || null,
      status:
        status != null
          ? OMADA_DEVICE_STATUSES[status] ?? `status ${status}`
          : null,
      detail: asText(row.firmwareVersion)
        ? `firmware ${asText(row.firmwareVersion)}`
        : null,
    });
  }

  const networks = await omadaLanNetworks(
    connection,
    session,
    site.siteId,
    warnings,
  );
  for (const network of networks) {
    if (network.vlanNumber != null && !seenVlans.has(network.vlanNumber)) {
      seenVlans.add(network.vlanNumber);
      vlans.push({ vlanNumber: network.vlanNumber, name: network.name });
    }
    if (network.cidr && !seenSubnets.has(network.cidr)) {
      seenSubnets.add(network.cidr);
      subnets.push({
        cidr: network.cidr,
        name: network.name,
        vlanNumber: network.vlanNumber,
      });
    }
    for (const pool of network.pools) {
      dhcpScopes.push({
        name: `${network.name} DHCP`,
        startIp: pool.startIp,
        endIp: pool.endIp,
        subnetCidr: network.cidr,
        note: "Omada DHCP server range",
      });
    }
  }

  return { collection: { vlans, subnets, dhcpScopes }, devices, warnings };
}

export const omadaIntegrationClient: IntegrationClient = {
  provider: "omada",
  test: omadaTest,
  fetchInventory: omadaFetchInventory,
};

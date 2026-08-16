import { ValidationError } from "../../validation.js";
import {
  canonicalizeIpv4Cidr,
  cidrHostBounds,
  intToIp,
} from "../../ip-cidr.js";
import {
  buildIntegrationUrl,
  integrationHttpRequest,
  parseIntegrationJson,
} from "../http.js";
import type {
  IntegrationClient,
  IntegrationDevicePreview,
  IntegrationImportableDevice,
  IntegrationInventory,
  IntegrationTestResult,
} from "../inventory.js";
import type { IntegrationConnectionSecrets } from "../types.js";
import type {
  SnmpCollectedDhcpScope,
  SnmpCollectedSubnet,
  SnmpCollectedVlan,
} from "../../snmp-profiles/types.js";

const TARGET_LABEL = "OPNsense";

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

function isPlainIpv4(value: string) {
  const octets = value.split(".");
  if (octets.length !== 4) return false;
  return octets.every((octet) => {
    const parsed = Number(octet);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255;
  });
}

function usableIpv4(value: unknown) {
  const address = asText(value).split("/")[0];
  if (!address || !isPlainIpv4(address)) return "";
  const first = Number(address.split(".")[0]);
  const second = Number(address.split(".")[1]);
  if (first === 127 || first === 0 || first >= 224) return "";
  if (first === 169 && second === 254) return "";
  return address;
}

// OPNsense `get` endpoints serialize option fields as
// { "<key>": { "value": "<label>", "selected": 0|1 } } maps.
function selectedOptionKey(value: unknown) {
  const map = asRecord(value);
  for (const [key, entry] of Object.entries(map)) {
    const row = asRecord(entry);
    if (Number(row.selected) === 1) return key;
  }
  return "";
}

// 25.7 renamed API commands from camelCase to snake_case in the default
// ACLs; both dispatch on 25.7+, only camelCase exists before. Restricted
// keys can 403 on the casing their ACLs do not list, so retry the
// snake_case form when the camelCase call is rejected.
function snakeCasePath(apiPath: string) {
  const segments = apiPath.split("/");
  const last = segments.pop() ?? "";
  const snake = last.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return [...segments, snake].join("/");
}

async function opnsenseRequest(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
) {
  const url = buildIntegrationUrl(connection.baseUrl, apiPath);
  const credentials = Buffer.from(
    `${connection.authId ?? ""}:${connection.authSecret ?? ""}`,
  ).toString("base64");
  return integrationHttpRequest(
    {
      url,
      method: "GET",
      headers: { Authorization: `Basic ${credentials}` },
      verifyTls: connection.verifyTls,
    },
    TARGET_LABEL,
  );
}

async function opnsenseGet(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
): Promise<unknown> {
  let response = await opnsenseRequest(connection, apiPath);
  if (response.status === 403 || response.status === 404) {
    const fallback = snakeCasePath(apiPath);
    if (fallback !== apiPath) {
      response = await opnsenseRequest(connection, fallback);
    }
  }
  if (response.status === 401) {
    throw new ValidationError(
      "OPNsense rejected the API key and secret. Check the credential and the owning user's privileges.",
      502,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ValidationError(
      `${TARGET_LABEL} returned HTTP ${response.status} for ${apiPath}.`,
      502,
    );
  }
  return parseIntegrationJson(response, TARGET_LABEL);
}

async function tryOpnsenseGet(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
): Promise<unknown> {
  try {
    return await opnsenseGet(connection, apiPath);
  } catch (error) {
    if (
      error instanceof ValidationError &&
      /rejected the API key/.test(error.message)
    ) {
      throw error;
    }
    return null;
  }
}

async function opnsenseTest(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationTestResult> {
  const info = asRecord(
    await opnsenseGet(connection, "/api/core/firmware/info"),
  );
  const product = asRecord(info.product);
  const productName =
    asText(product.product_name) || asText(info.product_id) || "OPNsense";
  const version =
    asText(info.product_version) || asText(product.product_version) || null;

  let hostname: string | null = null;
  const system = asRecord(
    await tryOpnsenseGet(
      connection,
      "/api/diagnostics/system/systemInformation",
    ),
  );
  if (asText(system.name)) hostname = asText(system.name);

  return {
    product: productName,
    version,
    summary: {
      hostname,
      series: asText(product.product_series) || null,
    },
  };
}

interface OpnsenseInterfaceRow {
  device: string;
  identifier: string;
  description: string;
  enabled: boolean;
  status: string;
  macaddr: string;
  vlanTag: number | null;
  addresses: string[];
  gateways: string[];
}

function parseInterfaceRows(data: unknown): OpnsenseInterfaceRow[] {
  return asArray(asRecord(data).rows)
    .map((entry) => {
      const row = asRecord(entry);
      const vlanTag = Number(asText(row.vlan_tag));
      return {
        device: asText(row.device),
        identifier: asText(row.identifier),
        description: asText(row.description),
        enabled: Boolean(row.enabled),
        status: asText(row.status) || "unknown",
        macaddr: asText(row.macaddr),
        vlanTag:
          Number.isInteger(vlanTag) && vlanTag >= 1 && vlanTag <= 4094
            ? vlanTag
            : null,
        addresses: asArray(row.ipv4)
          .map((item) => asText(asRecord(item).ipaddr))
          .filter(Boolean),
        gateways: asArray(row.gateways).map(asText).filter(Boolean),
      };
    })
    .filter((row) => row.device);
}

function parsePoolEntry(
  entry: string,
): { startIp: string; endIp: string } | null {
  const text = entry.trim();
  if (!text) return null;
  if (text.includes("-")) {
    const [start, end] = text.split("-", 2).map((part) => part.trim());
    const startIp = usableIpv4(start);
    const endIp = usableIpv4(end);
    return startIp && endIp ? { startIp, endIp } : null;
  }
  if (text.includes("/")) {
    try {
      const bounds = cidrHostBounds(canonicalizeIpv4Cidr(text));
      return {
        startIp: intToIp(bounds.firstHost),
        endIp: intToIp(bounds.lastHost),
      };
    } catch {
      return null;
    }
  }
  return null;
}

async function opnsenseFetchInventory(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationInventory> {
  const warnings: string[] = [];
  const devices: IntegrationDevicePreview[] = [];
  const vlans: SnmpCollectedVlan[] = [];
  const subnets: SnmpCollectedSubnet[] = [];
  const dhcpScopes: SnmpCollectedDhcpScope[] = [];
  const seenVlans = new Set<number>();
  const seenSubnets = new Set<string>();

  const test = await opnsenseTest(connection);
  const firewallName = asText(test.summary.hostname) || connection.name;
  devices.push({
    name: firewallName,
    kind: "firewall",
    model: test.version ? `${test.product} ${test.version}` : test.product,
    macAddress: null,
    ipAddress: null,
    status: "online",
    detail: null,
  });
  let firewallIp: string | null = null;
  try {
    firewallIp = usableIpv4(new URL(connection.baseUrl).hostname) || null;
  } catch {
    firewallIp = null;
  }
  const importableDevices: IntegrationImportableDevice[] = [
    {
      name: firewallName,
      deviceType: "firewall",
      model: test.version ? `${test.product} ${test.version}` : test.product,
      macAddress: null,
      ipAddress: firewallIp,
      serial: null,
      firmware: test.version ?? null,
      online: true,
      ports: [],
    },
  ];

  // VLAN definitions first so interface subnets can link to them.
  const vlanConfig = asRecord(
    asRecord(
      asRecord(
        await tryOpnsenseGet(connection, "/api/interfaces/vlan_settings/get"),
      ).vlan,
    ).vlan,
  );
  const vlanTagByDevice = new Map<string, number>();
  for (const entry of Object.values(vlanConfig)) {
    const row = asRecord(entry);
    const tag = Number(asText(row.tag));
    if (!Number.isInteger(tag) || tag < 1 || tag > 4094) continue;
    const vlanif = asText(row.vlanif);
    const parent = selectedOptionKey(row.if) || asText(row.if);
    if (vlanif) vlanTagByDevice.set(vlanif, tag);
    if (!seenVlans.has(tag)) {
      seenVlans.add(tag);
      vlans.push({
        vlanNumber: tag,
        name: asText(row.descr) || vlanif || `VLAN ${tag}`,
      });
    }
    devices.push({
      name: vlanif || `${parent} tag ${tag}`,
      kind: "interface",
      model: null,
      macAddress: null,
      ipAddress: null,
      status: null,
      detail: `VLAN ${tag} on ${parent || "unknown parent"}`,
    });
  }

  const interfaceRows = parseInterfaceRows(
    await tryOpnsenseGet(connection, "/api/interfaces/overview/interfacesInfo"),
  );
  if (interfaceRows.length === 0) {
    warnings.push(
      "OPNsense returned no interface overview rows. The interfaces API needs OPNsense 24.1 or later.",
    );
  }
  const descriptionByIdentifier = new Map<string, string>();
  for (const row of interfaceRows) {
    if (row.identifier) {
      descriptionByIdentifier.set(
        row.identifier,
        row.description || row.device,
      );
    }
    devices.push({
      name: row.description || row.device,
      kind: "interface",
      model: null,
      macAddress: row.macaddr || null,
      ipAddress: usableIpv4(row.addresses[0]) || null,
      status: row.enabled ? row.status : "disabled",
      detail:
        [
          row.device,
          row.vlanTag != null ? `VLAN ${row.vlanTag}` : "",
          row.gateways.length > 0 ? `gateway: ${row.gateways.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || null,
    });

    const vlanNumber = row.vlanTag ?? vlanTagByDevice.get(row.device) ?? null;
    for (const address of row.addresses) {
      if (!usableIpv4(address)) continue;
      const prefix = Number(address.split("/")[1]);
      if (!Number.isInteger(prefix) || prefix < 1 || prefix > 30) continue;
      try {
        const cidr = canonicalizeIpv4Cidr(address);
        if (seenSubnets.has(cidr)) continue;
        seenSubnets.add(cidr);
        subnets.push({
          cidr,
          name: row.description || row.device,
          vlanNumber,
        });
      } catch {
        // Skip addresses that do not parse as IPv4 CIDRs.
      }
    }
  }

  // Kea DHCPv4 subnets (24.1+). Absent endpoints are skipped quietly.
  for (const entry of asArray(
    asRecord(await tryOpnsenseGet(connection, "/api/kea/dhcpv4/searchSubnet"))
      .rows,
  )) {
    const row = asRecord(entry);
    const rawSubnet = asText(row.subnet);
    if (!rawSubnet || !usableIpv4(rawSubnet)) continue;
    let subnetCidr: string | null = null;
    try {
      subnetCidr = canonicalizeIpv4Cidr(rawSubnet);
    } catch {
      subnetCidr = null;
    }
    const pools = asText(row.pools)
      .split(/[\n,]+/)
      .map(parsePoolEntry)
      .filter(
        (pool): pool is { startIp: string; endIp: string } => pool != null,
      );
    for (const pool of pools) {
      dhcpScopes.push({
        name: asText(row.description) || `Kea ${rawSubnet}`,
        startIp: pool.startIp,
        endIp: pool.endIp,
        subnetCidr,
        note: "Kea DHCPv4 pool",
      });
    }
  }

  // Dnsmasq DHCP ranges (25.1.6+).
  for (const entry of asArray(
    asRecord(
      await tryOpnsenseGet(connection, "/api/dnsmasq/settings/searchRange"),
    ).rows,
  )) {
    const row = asRecord(entry);
    const startIp = usableIpv4(row.start_addr);
    const endIp = usableIpv4(row.end_addr);
    if (!startIp || !endIp) continue;
    const interfaceLabel = asText(row.interface);
    dhcpScopes.push({
      name: interfaceLabel ? `Dnsmasq ${interfaceLabel}` : "Dnsmasq range",
      startIp,
      endIp,
      subnetCidr: null,
      note: "Dnsmasq DHCP range",
    });
  }

  // ISC dhcpd has no settings API — only leases. Flag it so ranges are not
  // silently missing from the preview.
  const iscStatus = asRecord(
    await tryOpnsenseGet(connection, "/api/dhcpv4/service/status"),
  );
  if (asText(iscStatus.status).toLowerCase() === "running") {
    warnings.push(
      "ISC dhcpd is running, but OPNsense does not expose its ranges over the API. Kea and Dnsmasq ranges are included; document ISC scopes manually.",
    );
  }

  for (const entry of asArray(
    asRecord(await tryOpnsenseGet(connection, "/api/routes/gateway/status"))
      .items,
  )) {
    const row = asRecord(entry);
    const name = asText(row.name);
    if (!name) continue;
    devices.push({
      name,
      kind: "gateway",
      model: null,
      macAddress: null,
      ipAddress: usableIpv4(row.address) || null,
      status: asText(row.status_translated) || null,
      detail:
        asText(row.delay) && asText(row.delay) !== "~"
          ? `delay ${asText(row.delay)}, loss ${asText(row.loss)}`
          : null,
    });
  }

  return {
    collection: { vlans, subnets, dhcpScopes },
    devices,
    importableDevices,
    wifi: null,
    warnings,
  };
}

export const opnsenseIntegrationClient: IntegrationClient = {
  provider: "opnsense",
  test: opnsenseTest,
  fetchInventory: opnsenseFetchInventory,
};

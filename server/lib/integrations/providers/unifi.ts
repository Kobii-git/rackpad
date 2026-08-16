import { ValidationError } from "../../validation.js";
import { canonicalizeIpv4Cidr } from "../../ip-cidr.js";
import {
  buildIntegrationUrl,
  integrationHttpRequest,
  parseIntegrationJson,
  type IntegrationHttpResponse,
} from "../http.js";
import {
  connectionScopeRefs,
  type IntegrationClient,
  type IntegrationDeviceKind,
  type IntegrationDevicePreview,
  type IntegrationImportableDevice,
  type IntegrationInventory,
  type IntegrationPortSpec,
  type IntegrationScope,
  type IntegrationTestResult,
  type IntegrationWifiSsid,
} from "../inventory.js";
import type { IntegrationConnectionSecrets } from "../types.js";
import type {
  SnmpCollectedDhcpScope,
  SnmpCollectedSubnet,
  SnmpCollectedVlan,
} from "../../snmp-profiles/types.js";

const TARGET_LABEL = "UniFi Network";
const INTEGRATION_BASE = "/proxy/network/integration";
const PAGE_LIMIT = 200;

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

interface NetworkRecord {
  name: string;
  vlanNumber: number | null;
  cidr: string | null;
  dhcpStart: string | null;
  dhcpEnd: string | null;
  purpose: string;
}

function collectNetworks(networks: NetworkRecord[]) {
  const vlans: SnmpCollectedVlan[] = [];
  const subnets: SnmpCollectedSubnet[] = [];
  const dhcpScopes: SnmpCollectedDhcpScope[] = [];
  const seenVlans = new Set<number>();
  const seenSubnets = new Set<string>();

  for (const network of networks) {
    if (
      network.vlanNumber != null &&
      network.vlanNumber >= 1 &&
      network.vlanNumber <= 4094 &&
      !seenVlans.has(network.vlanNumber)
    ) {
      seenVlans.add(network.vlanNumber);
      vlans.push({ vlanNumber: network.vlanNumber, name: network.name });
    }
    if (network.cidr && !seenSubnets.has(network.cidr)) {
      seenSubnets.add(network.cidr);
      subnets.push({
        cidr: network.cidr,
        name: network.name,
        vlanNumber:
          network.vlanNumber != null &&
          network.vlanNumber >= 1 &&
          network.vlanNumber <= 4094
            ? network.vlanNumber
            : null,
      });
    }
    if (network.dhcpStart && network.dhcpEnd) {
      dhcpScopes.push({
        name: `${network.name} DHCP`,
        startIp: network.dhcpStart,
        endIp: network.dhcpEnd,
        subnetCidr: network.cidr,
        note: "UniFi DHCP server range",
      });
    }
  }

  return { vlans, subnets, dhcpScopes };
}

// ── Official Integration API (X-API-Key, Network 9.x/10.x) ──────────

async function integrationApiRequest(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
  query?: Record<string, string | number | boolean | undefined>,
) {
  const url = buildIntegrationUrl(
    connection.baseUrl,
    `${INTEGRATION_BASE}${apiPath}`,
    query,
  );
  const response = await integrationHttpRequest(
    {
      url,
      method: "GET",
      headers: { "X-API-Key": connection.authSecret ?? "" },
      verifyTls: connection.verifyTls,
    },
    TARGET_LABEL,
  );
  if (response.status === 401 || response.status === 403) {
    throw new ValidationError(
      "UniFi Network rejected the API key. Create one under Settings > Control Plane > Integrations.",
      502,
    );
  }
  return response;
}

async function integrationApiJson(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const response = await integrationApiRequest(connection, apiPath, query);
  if (response.status < 200 || response.status >= 300) {
    throw new ValidationError(
      `${TARGET_LABEL} returned HTTP ${response.status} for ${apiPath}.`,
      502,
    );
  }
  return parseIntegrationJson(response, TARGET_LABEL);
}

async function integrationApiPage(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let offset = 0;
  for (;;) {
    const body = asRecord(
      await integrationApiJson(connection, apiPath, {
        offset,
        limit: PAGE_LIMIT,
      }),
    );
    const data = asArray(body.data);
    items.push(...data);
    const totalCount = asNumber(body.totalCount) ?? data.length;
    offset += data.length;
    if (data.length === 0 || items.length >= totalCount) break;
  }
  return items;
}

interface OfficialSite {
  id: string;
  internalReference: string;
  name: string;
}

async function officialSites(
  connection: IntegrationConnectionSecrets,
): Promise<OfficialSite[]> {
  const sites = await integrationApiPage(connection, "/v1/sites");
  return sites
    .map((entry) => {
      const row = asRecord(entry);
      return {
        id: asText(row.id),
        internalReference: asText(row.internalReference),
        name: asText(row.name),
      };
    })
    .filter((site) => site.id);
}

function pickOfficialSites(
  sites: OfficialSite[],
  refs: string[],
): OfficialSite[] {
  if (sites.length === 0) {
    throw new ValidationError(
      "UniFi Network reported no sites for this key.",
      502,
    );
  }
  if (refs.length === 0) return [sites[0]];
  const wanted = refs.map((ref) => ref.trim().toLowerCase());
  const matched = sites.filter(
    (site) =>
      wanted.includes(site.id.toLowerCase()) ||
      wanted.includes(site.internalReference.toLowerCase()) ||
      wanted.includes(site.name.toLowerCase()),
  );
  if (matched.length === 0) {
    throw new ValidationError(
      `No selected UniFi site was found. Available sites: ${sites
        .map((site) => site.name || site.internalReference)
        .join(", ")}.`,
    );
  }
  return matched;
}

function speedLabel(mbps: number | null): string | null {
  if (mbps == null || mbps <= 0) return null;
  if (mbps >= 1000) return `${mbps / 1000}G`;
  return `${mbps}M`;
}

function importableKind(
  kind: IntegrationDeviceKind,
): IntegrationImportableDevice["deviceType"] | null {
  if (kind === "switch") return "switch";
  if (kind === "gateway") return "router";
  if (kind === "access-point") return "ap";
  return null;
}

function officialDeviceKind(features: unknown): IntegrationDeviceKind {
  const list = asArray(features).map(asText);
  const keys =
    list.length > 0 ? list : Object.keys(asRecord(features));
  if (keys.includes("accessPoint") && !keys.includes("switching")) {
    return "access-point";
  }
  if (keys.includes("switching")) return "switch";
  return "other";
}

async function officialTest(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationTestResult> {
  const info = asRecord(await integrationApiJson(connection, "/v1/info"));
  const sites = await officialSites(connection);
  return {
    product: "UniFi Network",
    version: asText(info.applicationVersion) || null,
    summary: {
      sites: sites.length,
      siteNames: sites.map((site) => site.name || site.internalReference),
      apiMode: "api-key",
    },
  };
}

async function officialFetchInventory(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationInventory> {
  const warnings: string[] = [];
  const devices: IntegrationDevicePreview[] = [];
  const importableDevices: IntegrationImportableDevice[] = [];
  const ssids: IntegrationWifiSsid[] = [];
  const networks: NetworkRecord[] = [];
  const sites = pickOfficialSites(
    await officialSites(connection),
    connectionScopeRefs(connection),
  );
  const multiSite = sites.length > 1;
  let networksUnavailable = false;

  for (const site of sites) {
    const siteLabel = site.name || site.internalReference;
    for (const entry of await integrationApiPage(
      connection,
      `/v1/sites/${site.id}/devices`,
    )) {
      const row = asRecord(entry);
      const firmware = asText(row.firmwareVersion);
      const kind = officialDeviceKind(row.features);
      devices.push({
        name: asText(row.name) || asText(row.macAddress),
        kind,
        model: asText(row.model) || null,
        macAddress: asText(row.macAddress) || null,
        ipAddress: usableIpv4(row.ipAddress) || asText(row.ipAddress) || null,
        status: asText(row.state).toLowerCase() || null,
        detail:
          [
            multiSite ? `site: ${siteLabel}` : "",
            firmware ? `firmware ${firmware}` : "",
          ]
            .filter(Boolean)
            .join(" · ") || null,
      });

      const deviceType = importableKind(kind);
      const deviceId = asText(row.id);
      if (deviceType) {
        const ports: IntegrationPortSpec[] = [];
        if (deviceType === "switch" && deviceId) {
          try {
            const detail = asRecord(
              await integrationApiJson(
                connection,
                `/v1/sites/${site.id}/devices/${deviceId}`,
              ),
            );
            const interfaces = asRecord(detail.interfaces);
            for (const portEntry of asArray(interfaces.ports)) {
              const port = asRecord(portEntry);
              const idx = asNumber(port.idx);
              const connector = asText(port.connector).toUpperCase();
              ports.push({
                name: `Port ${idx ?? ports.length + 1}`,
                kind: connector.startsWith("QSFP")
                  ? "qsfp"
                  : connector === "SFP"
                    ? "sfp"
                    : connector.startsWith("SFP")
                      ? "sfp_plus"
                      : "rj45",
                speed: speedLabel(asNumber(port.maxSpeedMbps)),
                linkState:
                  asText(port.state) === "UP"
                    ? "up"
                    : asText(port.state) === "DOWN"
                      ? "down"
                      : "unknown",
              });
            }
          } catch {
            // Ports are best-effort; import the device without them.
          }
        }
        importableDevices.push({
          name: asText(row.name) || asText(row.macAddress),
          deviceType,
          model: asText(row.model) || null,
          macAddress: asText(row.macAddress) || null,
          ipAddress: usableIpv4(row.ipAddress) || null,
          serial: null,
          firmware: firmware || null,
          online: asText(row.state) === "ONLINE",
          ports,
        });
      }
    }

    // SSIDs are only exposed by Network 10+ over the integration API;
    // parse defensively and skip quietly on older versions.
    try {
      const broadcastResponse = await integrationApiRequest(
        connection,
        `/v1/sites/${site.id}/wifi/broadcasts`,
        { offset: 0, limit: PAGE_LIMIT },
      );
      if (broadcastResponse.status >= 200 && broadcastResponse.status < 300) {
        const body = asRecord(
          parseIntegrationJson(broadcastResponse, TARGET_LABEL),
        );
        for (const entry of asArray(body.data)) {
          const row = asRecord(entry);
          const name = asText(row.name ?? row.ssid);
          if (!name) continue;
          ssids.push({
            name,
            vlanNumber: asNumber(row.vlanId ?? row.vlan),
            security: asText(row.security) || null,
            hidden: row.hidden === true || row.hideSsid === true,
          });
        }
      }
    } catch {
      // SSIDs stay empty when the endpoint is unavailable.
    }

    const listResponse = await integrationApiRequest(
      connection,
      `/v1/sites/${site.id}/networks`,
      { offset: 0, limit: PAGE_LIMIT },
    );
    if (listResponse.status === 404) {
      networksUnavailable = true;
      continue;
    }
    if (listResponse.status < 200 || listResponse.status >= 300) {
      throw new ValidationError(
        `${TARGET_LABEL} returned HTTP ${listResponse.status} for the networks list.`,
        502,
      );
    }
    const listBody = asRecord(parseIntegrationJson(listResponse, TARGET_LABEL));
    for (const entry of asArray(listBody.data)) {
      const row = asRecord(entry);
      const networkId = asText(row.id);
      const name = asText(row.name) || networkId;
      const vlanNumber = asNumber(row.vlanId);
      let cidr: string | null = null;
      let dhcpStart: string | null = null;
      let dhcpEnd: string | null = null;

      if (networkId && asText(row.management) === "GATEWAY") {
        const detail = asRecord(
          await integrationApiJson(
            connection,
            `/v1/sites/${site.id}/networks/${networkId}`,
          ),
        );
        const ipv4 = asRecord(detail.ipv4Configuration);
        const hostIp = usableIpv4(ipv4.hostIpAddress);
        const prefix = asNumber(ipv4.prefixLength);
        if (hostIp && prefix != null && prefix >= 1 && prefix <= 30) {
          try {
            cidr = canonicalizeIpv4Cidr(`${hostIp}/${prefix}`);
          } catch {
            cidr = null;
          }
        }
        const dhcp = asRecord(ipv4.dhcpConfiguration);
        if (asText(dhcp.mode) === "SERVER") {
          const range = asRecord(dhcp.ipAddressRange);
          dhcpStart = usableIpv4(range.start) || null;
          dhcpEnd = usableIpv4(range.stop) || null;
        }
      }

      networks.push({
        name: multiSite ? `${siteLabel} ${name}` : name,
        vlanNumber,
        cidr,
        dhcpStart,
        dhcpEnd,
        purpose: asText(row.management).toLowerCase(),
      });
    }
  }

  if (networksUnavailable) {
    warnings.push(
      "This UniFi Network version does not expose networks over the API key integration (Network 10+ required). Use username/password auth to pull networks and VLANs.",
    );
  }

  return {
    collection: collectNetworks(networks),
    devices,
    importableDevices,
    wifi: {
      controllerName: `UniFi Network (${connection.name})`,
      vendor: "Ubiquiti",
      managementIp: null,
      ssids,
    },
    warnings,
  };
}

// ── Legacy controller API (username/password cookie session) ────────

interface LegacySession {
  cookie: string;
  apiPrefix: string;
  flavor: "unifi-os" | "classic";
}

function extractCookies(response: IntegrationHttpResponse) {
  const header = response.headers["set-cookie"];
  const entries = Array.isArray(header) ? header : header ? [header] : [];
  return entries
    .map((entry) => entry.split(";")[0]?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .join("; ");
}

async function legacyLogin(
  connection: IntegrationConnectionSecrets,
): Promise<LegacySession> {
  const body = JSON.stringify({
    username: connection.authId ?? "",
    password: connection.authSecret ?? "",
  });

  const osResponse = await integrationHttpRequest(
    {
      url: buildIntegrationUrl(connection.baseUrl, "/api/auth/login"),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      verifyTls: connection.verifyTls,
    },
    TARGET_LABEL,
  );
  if (osResponse.status >= 200 && osResponse.status < 300) {
    const cookie = extractCookies(osResponse);
    if (!cookie) {
      throw new ValidationError(
        "UniFi OS login succeeded but returned no session cookie.",
        502,
      );
    }
    return { cookie, apiPrefix: "/proxy/network/api", flavor: "unifi-os" };
  }
  if (osResponse.status !== 404) {
    throw new ValidationError(
      "UniFi Network rejected the username or password.",
      502,
    );
  }

  const classicResponse = await integrationHttpRequest(
    {
      url: buildIntegrationUrl(connection.baseUrl, "/api/login"),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      verifyTls: connection.verifyTls,
    },
    TARGET_LABEL,
  );
  if (classicResponse.status < 200 || classicResponse.status >= 300) {
    throw new ValidationError(
      "UniFi Network rejected the username or password.",
      502,
    );
  }
  const cookie = extractCookies(classicResponse);
  if (!cookie) {
    throw new ValidationError(
      "UniFi controller login succeeded but returned no session cookie.",
      502,
    );
  }
  return { cookie, apiPrefix: "/api", flavor: "classic" };
}

async function legacyJson(
  connection: IntegrationConnectionSecrets,
  session: LegacySession,
  apiPath: string,
): Promise<unknown[]> {
  const response = await integrationHttpRequest(
    {
      url: buildIntegrationUrl(connection.baseUrl, `${session.apiPrefix}${apiPath}`),
      method: "GET",
      headers: { Cookie: session.cookie },
      verifyTls: connection.verifyTls,
    },
    TARGET_LABEL,
  );
  if (response.status === 401) {
    throw new ValidationError(
      "The UniFi session expired or the account lacks permission for this site.",
      502,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ValidationError(
      `${TARGET_LABEL} returned HTTP ${response.status} for ${apiPath}.`,
      502,
    );
  }
  const body = asRecord(parseIntegrationJson(response, TARGET_LABEL));
  const meta = asRecord(body.meta);
  if (asText(meta.rc) === "error") {
    throw new ValidationError(
      `${TARGET_LABEL} returned ${asText(meta.msg) || "an API error"} for ${apiPath}.`,
      502,
    );
  }
  return asArray(body.data);
}

interface LegacySite {
  key: string;
  description: string;
}

async function legacySites(
  connection: IntegrationConnectionSecrets,
  session: LegacySession,
): Promise<LegacySite[]> {
  const sites = await legacyJson(connection, session, "/self/sites");
  return sites
    .map((entry) => {
      const row = asRecord(entry);
      return {
        key: asText(row.name),
        description: asText(row.desc) || asText(row.name),
      };
    })
    .filter((site) => site.key);
}

function pickLegacySites(sites: LegacySite[], refs: string[]): LegacySite[] {
  if (sites.length === 0) {
    throw new ValidationError(
      "UniFi Network reported no sites for this account.",
      502,
    );
  }
  if (refs.length === 0) {
    return [sites.find((site) => site.key === "default") ?? sites[0]];
  }
  const wanted = refs.map((ref) => ref.trim().toLowerCase());
  const matched = sites.filter(
    (site) =>
      wanted.includes(site.key.toLowerCase()) ||
      wanted.includes(site.description.toLowerCase()),
  );
  if (matched.length === 0) {
    throw new ValidationError(
      `No selected UniFi site was found. Available sites: ${sites
        .map((site) => site.description)
        .join(", ")}.`,
    );
  }
  return matched;
}

const LEGACY_DEVICE_KINDS: Record<string, IntegrationDeviceKind> = {
  usw: "switch",
  uap: "access-point",
  ugw: "gateway",
  udm: "gateway",
  uxg: "gateway",
  usg: "gateway",
};

const LEGACY_DEVICE_STATES: Record<number, string> = {
  0: "offline",
  1: "online",
  2: "pending adoption",
  4: "upgrading",
  5: "provisioning",
  6: "heartbeat missed",
  9: "inform error",
  10: "adopt failed",
  11: "isolated",
};

async function legacyTest(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationTestResult> {
  const session = await legacyLogin(connection);
  const sites = await legacySites(connection, session);
  const [site] = pickLegacySites(sites, connectionScopeRefs(connection));
  const sysinfo = asRecord(
    (await legacyJson(connection, session, `/s/${site.key}/stat/sysinfo`))[0],
  );
  return {
    product: "UniFi Network",
    version: asText(sysinfo.version) || null,
    summary: {
      sites: sites.length,
      siteNames: sites.map((entry) => entry.description),
      apiMode: session.flavor,
    },
  };
}

async function legacyFetchInventory(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationInventory> {
  const session = await legacyLogin(connection);
  const sites = pickLegacySites(
    await legacySites(connection, session),
    connectionScopeRefs(connection),
  );
  const multiSite = sites.length > 1;
  const devices: IntegrationDevicePreview[] = [];
  const importableDevices: IntegrationImportableDevice[] = [];
  const ssids: IntegrationWifiSsid[] = [];
  const networks: NetworkRecord[] = [];

  for (const site of sites) {
    for (const entry of await legacyJson(
      connection,
      session,
      `/s/${site.key}/stat/device`,
    )) {
      const row = asRecord(entry);
      const state = asNumber(row.state);
      const firmware = asText(row.version);
      const kind = LEGACY_DEVICE_KINDS[asText(row.type)] ?? "other";
      devices.push({
        name: asText(row.name) || asText(row.mac),
        kind,
        model: asText(row.model) || null,
        macAddress: asText(row.mac) || null,
        ipAddress: usableIpv4(row.ip) || asText(row.ip) || null,
        status:
          state != null
            ? (LEGACY_DEVICE_STATES[state] ?? `state ${state}`)
            : null,
        detail:
          [
            multiSite ? `site: ${site.description}` : "",
            firmware ? `firmware ${firmware}` : "",
          ]
            .filter(Boolean)
            .join(" · ") || null,
      });

      const deviceType = importableKind(kind);
      if (deviceType) {
        const ports: IntegrationPortSpec[] = [];
        for (const portEntry of asArray(row.port_table)) {
          const port = asRecord(portEntry);
          const media = asText(port.media).toUpperCase();
          const idx = asNumber(port.port_idx);
          ports.push({
            name: asText(port.name) || `Port ${idx ?? ports.length + 1}`,
            kind: media.includes("SFP+")
              ? "sfp_plus"
              : media.includes("SFP")
                ? "sfp"
                : "rj45",
            speed: speedLabel(asNumber(port.speed)),
            linkState:
              port.up === true ? "up" : port.up === false ? "down" : "unknown",
          });
        }
        importableDevices.push({
          name: asText(row.name) || asText(row.mac),
          deviceType,
          model: asText(row.model) || null,
          macAddress: asText(row.mac) || null,
          ipAddress: usableIpv4(row.ip) || null,
          serial: asText(row.serial) || null,
          firmware: firmware || null,
          online: state === 1,
          ports,
        });
      }
    }

    try {
      for (const entry of await legacyJson(
        connection,
        session,
        `/s/${site.key}/rest/wlanconf`,
      )) {
        const row = asRecord(entry);
        const name = asText(row.name);
        if (!name || row.enabled === false) continue;
        ssids.push({
          name,
          vlanNumber: asNumber(row.vlan),
          security: asText(row.security) || null,
          hidden: row.hide_ssid === true,
        });
      }
    } catch {
      // SSIDs stay empty when wlanconf is unavailable to this account.
    }

    for (const entry of await legacyJson(
      connection,
      session,
      `/s/${site.key}/rest/networkconf`,
    )) {
      const row = asRecord(entry);
      const purpose = asText(row.purpose);
      if (purpose === "wan" || purpose.endsWith("-vpn")) continue;
      if (row.enabled === false) continue;

      const name = asText(row.name) || "UniFi network";
      const vlanEnabled = row.vlan_enabled !== false && row.vlan != null;
      const vlanNumber = vlanEnabled ? asNumber(row.vlan) : null;
      let cidr: string | null = null;
      const ipSubnet = asText(row.ip_subnet);
      if (usableIpv4(ipSubnet)) {
        try {
          cidr = canonicalizeIpv4Cidr(ipSubnet);
        } catch {
          cidr = null;
        }
      }
      const dhcpEnabled = row.dhcpd_enabled === true;
      networks.push({
        name: multiSite ? `${site.description} ${name}` : name,
        vlanNumber,
        cidr,
        dhcpStart: dhcpEnabled ? usableIpv4(row.dhcpd_start) || null : null,
        dhcpEnd: dhcpEnabled ? usableIpv4(row.dhcpd_stop) || null : null,
        purpose,
      });
    }
  }

  return {
    collection: collectNetworks(networks),
    devices,
    importableDevices,
    wifi: {
      controllerName: `UniFi Network (${connection.name})`,
      vendor: "Ubiquiti",
      managementIp: null,
      ssids,
    },
    warnings: [],
  };
}

// ── Provider client ─────────────────────────────────────────────────

async function unifiTest(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationTestResult> {
  return connection.authKind === "username-password"
    ? legacyTest(connection)
    : officialTest(connection);
}

async function unifiFetchInventory(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationInventory> {
  return connection.authKind === "username-password"
    ? legacyFetchInventory(connection)
    : officialFetchInventory(connection);
}

async function unifiListScopes(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationScope[]> {
  if (connection.authKind === "username-password") {
    const session = await legacyLogin(connection);
    return (await legacySites(connection, session)).map((site) => ({
      id: site.key,
      label: site.description,
    }));
  }
  return (await officialSites(connection)).map((site) => ({
    id: site.id,
    label: site.name || site.internalReference,
  }));
}

export const unifiIntegrationClient: IntegrationClient = {
  provider: "unifi",
  test: unifiTest,
  fetchInventory: unifiFetchInventory,
  listScopes: unifiListScopes,
};

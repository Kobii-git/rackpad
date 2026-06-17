import { execFile } from "node:child_process";
import { reverse } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import {
  appendLabFilter,
  assertLabWrite,
  assertLabWriteFromRow,
  resolveLabIdsForList,
} from "../lib/lab-access.js";
import { optionalDeviceType } from "../lib/device-types.js";
import {
  inferDiscoveryPlacement,
  inferDiscoveryPlacementHint,
} from "../lib/discovery-placement.js";
import { createId } from "../lib/ids.js";
import { runIcmpProbe } from "../lib/monitoring.js";
import { lookupOuiVendor } from "../lib/oui.js";
import {
  asObject,
  ensureCidr,
  ensureIsoDate,
  optionalEnum,
  optionalString,
  ValidationError,
} from "../lib/validation.js";

const DEVICE_PLACEMENTS = [
  "rack",
  "room",
  "wireless",
  "virtual",
  "shelf",
] as const;
const DISCOVERY_STATUSES = ["new", "imported", "dismissed"] as const;
const DISCOVERY_MAC_SCAN_MODES = [
  "auto",
  "neighbor",
  "arp-scan",
  "nmap",
  "off",
] as const;
const execFileAsync = promisify(execFile);

type DiscoveryMacScanMode = (typeof DISCOVERY_MAC_SCAN_MODES)[number];
type DiscoveryScanDiagnostic = {
  code: string;
  severity: "info" | "warning";
  message: string;
  detail?: string;
};

type TechnicalAddress = {
  role: string;
  reason: string;
};

type TechnicalAddressContext = {
  byIp: Map<string, TechnicalAddress>;
  ranges: Array<TechnicalAddress & { start: number; end: number }>;
};

type MacScanContext = {
  macByIp: Map<string, string>;
  diagnostics: DiscoveryScanDiagnostic[];
};

function parseDiscoveredDevice(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    labId: String(row.labId),
    ipAddress: String(row.ipAddress),
    hostname: row.hostname ? String(row.hostname) : null,
    displayName: row.displayName ? String(row.displayName) : null,
    deviceType: row.deviceType ? String(row.deviceType) : null,
    placement: row.placement ? String(row.placement) : null,
    macAddress: row.macAddress ? String(row.macAddress) : null,
    vendor: row.vendor ? String(row.vendor) : null,
    source: String(row.source),
    status: String(row.status),
    notes: row.notes ? String(row.notes) : null,
    importedDeviceId: row.importedDeviceId
      ? String(row.importedDeviceId)
      : null,
    technicalRole: row.technicalRole ? String(row.technicalRole) : null,
    technicalReason: row.technicalReason ? String(row.technicalReason) : null,
    placementHint: row.placementHint ? String(row.placementHint) : null,
    lastSeen: row.lastSeen ? String(row.lastSeen) : null,
    lastScannedAt: String(row.lastScannedAt),
  };
}

function resetStaleImportedDiscoveryRows(labId?: string) {
  if (labId) {
    db.prepare(
      `
      UPDATE discoveredDevices
      SET importedDeviceId = NULL, status = 'new'
      WHERE labId = ?
        AND (
          (
            importedDeviceId IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM devices WHERE devices.id = discoveredDevices.importedDeviceId
            )
          )
          OR (status = 'imported' AND importedDeviceId IS NULL)
        )
    `,
    ).run(labId);
    return;
  }
  db.prepare(
    `
    UPDATE discoveredDevices
    SET importedDeviceId = NULL, status = 'new'
    WHERE (
        importedDeviceId IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM devices WHERE devices.id = discoveredDevices.importedDeviceId
        )
      )
      OR (status = 'imported' AND importedDeviceId IS NULL)
  `,
  ).run();
}

function ipToInt(ipAddress: string) {
  return (
    ipAddress
      .split(".")
      .reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0
  );
}

function intToIp(value: number) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

function cidrHosts(cidr: string) {
  ensureCidr(cidr);
  const [networkAddress, prefixRaw] = cidr.split("/");
  const prefix = Number.parseInt(prefixRaw, 10);
  const hostCount = Math.pow(2, 32 - prefix) - 2;

  if (hostCount < 1) {
    throw new ValidationError("CIDR must include at least one usable host.");
  }
  if (hostCount > 254) {
    throw new ValidationError(
      "Discovery scans are limited to /24 or smaller networks.",
    );
  }

  const network = ipToInt(networkAddress);
  return Array.from({ length: hostCount }, (_, index) =>
    intToIp(network + index + 1),
  );
}

function parseStringArray(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
}

function setTechnicalAddress(
  byIp: Map<string, TechnicalAddress>,
  ipAddress: string | null | undefined,
  address: TechnicalAddress,
) {
  const normalizedIp = ipAddress?.trim();
  if (!normalizedIp || byIp.has(normalizedIp)) return;
  byIp.set(normalizedIp, address);
}

function collectTechnicalAddresses(labId: string): TechnicalAddressContext {
  const byIp = new Map<string, TechnicalAddress>();
  const ranges: TechnicalAddressContext["ranges"] = [];

  const scopes = db
    .prepare(
      `
      SELECT
        dhcpScopes.name,
        dhcpScopes.gateway,
        dhcpScopes.dnsServers,
        subnets.name AS subnetName
      FROM dhcpScopes
      JOIN subnets ON subnets.id = dhcpScopes.subnetId
      WHERE subnets.labId = ?
    `,
    )
    .all(labId) as Array<{
    name: string;
    gateway: string | null;
    dnsServers: string | null;
    subnetName: string;
  }>;

  for (const scope of scopes) {
    setTechnicalAddress(byIp, scope.gateway, {
      role: "gateway",
      reason: `${scope.subnetName} DHCP gateway`,
    });
    for (const dnsServer of parseStringArray(scope.dnsServers)) {
      setTechnicalAddress(byIp, dnsServer, {
        role: "dns",
        reason: `${scope.subnetName} DNS server`,
      });
    }
  }

  const assignments = db
    .prepare(
      `
      SELECT
        ipAssignments.ipAddress,
        ipAssignments.assignmentType,
        ipAssignments.hostname,
        ipAssignments.description,
        subnets.name AS subnetName
      FROM ipAssignments
      JOIN subnets ON subnets.id = ipAssignments.subnetId
      WHERE subnets.labId = ?
        AND ipAssignments.assignmentType IN ('reserved', 'infrastructure')
    `,
    )
    .all(labId) as Array<{
    ipAddress: string;
    assignmentType: string;
    hostname: string | null;
    description: string | null;
    subnetName: string;
  }>;

  for (const assignment of assignments) {
    setTechnicalAddress(byIp, assignment.ipAddress, {
      role: assignment.assignmentType,
      reason:
        assignment.description ??
        assignment.hostname ??
        `${assignment.subnetName} ${assignment.assignmentType} IP`,
    });
  }

  const zones = db
    .prepare(
      `
      SELECT
        ipZones.kind,
        ipZones.startIp,
        ipZones.endIp,
        ipZones.description,
        subnets.name AS subnetName
      FROM ipZones
      JOIN subnets ON subnets.id = ipZones.subnetId
      WHERE subnets.labId = ?
        AND ipZones.kind IN ('reserved', 'infrastructure')
    `,
    )
    .all(labId) as Array<{
    kind: string;
    startIp: string;
    endIp: string;
    description: string | null;
    subnetName: string;
  }>;

  for (const zone of zones) {
    ranges.push({
      start: ipToInt(zone.startIp),
      end: ipToInt(zone.endIp),
      role: zone.kind,
      reason: zone.description ?? `${zone.subnetName} ${zone.kind} range`,
    });
  }

  return { byIp, ranges };
}

function technicalAddressForIp(
  ipAddress: string,
  context: TechnicalAddressContext,
) {
  const normalizedIp = ipAddress.trim();
  const direct = context.byIp.get(normalizedIp);
  if (direct) return direct;
  const value = ipToInt(normalizedIp);
  return context.ranges.find(
    (range) => value >= range.start && value <= range.end,
  );
}

function inferDeviceType(hostname: string | null) {
  const value = hostname?.toLowerCase() ?? "";
  if (!value) return "endpoint" as const;
  if (value.includes("ap") || value.includes("wifi") || value.includes("wlan"))
    return "ap" as const;
  if (value.includes("vm")) return "vm" as const;
  if (
    value.includes("fw") ||
    value.includes("firewall") ||
    value.includes("pfsense") ||
    value.includes("opnsense")
  )
    return "firewall" as const;
  if (value.includes("sw") || value.includes("switch"))
    return "switch" as const;
  if (value.includes("rtr") || value.includes("router") || value.includes("gw"))
    return "router" as const;
  if (
    value.includes("srv") ||
    value.includes("proxmox") ||
    value.includes("esx") ||
    value.includes("host")
  )
    return "server" as const;
  if (value.includes("nas") || value.includes("storage"))
    return "storage" as const;
  return "endpoint" as const;
}

function inferPlacement(
  deviceType: string,
  context?: {
    labId: string;
    ipAddress: string;
    hostname?: string | null;
    displayName?: string | null;
    macAddress?: string | null;
  },
) {
  if (context) {
    return inferDiscoveryPlacement({
      labId: context.labId,
      ipAddress: context.ipAddress,
      deviceType,
      hostname: context.hostname,
      displayName: context.displayName,
      macAddress: context.macAddress,
    });
  }
  if (deviceType === "ap") return "wireless" as const;
  if (deviceType === "vm" || deviceType === "container")
    return "virtual" as const;
  return "room" as const;
}

async function reverseLookup(ipAddress: string) {
  try {
    const names = await reverse(ipAddress);
    const hostname = names[0]?.replace(/\.$/, "") ?? null;
    return hostname;
  } catch {
    return null;
  }
}

async function systemHostnameLookup(ipAddress: string) {
  if (process.platform !== "win32") {
    try {
      const { stdout } = await execFileAsync("getent", ["hosts", ipAddress], {
        timeout: 4000,
      });
      const entry = String(stdout).trim().split(/\s+/).slice(1).find(Boolean);
      if (entry) return entry.replace(/\.$/, "");
    } catch {
      // Ignore missing getent or empty results.
    }
  }

  try {
    const { stdout } = await execFileAsync("nslookup", [ipAddress], {
      timeout: 4000,
    });
    const line = String(stdout)
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => /name\s*=|^name:/i.test(entry));
    if (!line) return null;
    return (
      line
        .split(/name\s*=|name:/i)[1]
        ?.trim()
        .replace(/\.$/, "") ?? null
    );
  } catch {
    return null;
  }
}

async function resolveHostname(ipAddress: string) {
  return (
    (await reverseLookup(ipAddress)) ?? (await systemHostnameLookup(ipAddress))
  );
}

function normalizeMacAddress(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().replaceAll("-", ":").toLowerCase();
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(normalized)) return null;
  if (normalized === "00:00:00:00:00:00") return null;
  return normalized;
}

async function lookupMacAddress(ipAddress: string) {
  const fromProc = await lookupMacFromProc(ipAddress);
  if (fromProc) return fromProc;

  const fromIpNeighbour = await lookupMacFromIpNeighbour(ipAddress);
  if (fromIpNeighbour) return fromIpNeighbour;

  try {
    const { stdout } = await execFileAsync("arp", ["-a"], { timeout: 4000 });
    return parseArpOutput(String(stdout), ipAddress);
  } catch {
    return null;
  }
}

async function lookupMacFromIpNeighbour(ipAddress: string) {
  try {
    const { stdout } = await execFileAsync("ip", ["neigh", "show", ipAddress], {
      timeout: 4000,
    });
    const match = String(stdout).match(
      /lladdr\s+((?:[0-9a-f]{2}:){5}[0-9a-f]{2})/i,
    );
    return normalizeMacAddress(match?.[1]);
  } catch {
    return null;
  }
}

async function lookupMacFromProc(ipAddress: string) {
  try {
    const raw = await readFile("/proc/net/arp", "utf8");
    const match = raw
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .find((columns) => columns[0] === ipAddress);
    return normalizeMacAddress(match?.[3]);
  } catch {
    return null;
  }
}

function parseArpOutput(output: string, ipAddress: string) {
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes(ipAddress)) continue;

    const windowsMatch = line.match(/((?:[0-9a-f]{2}-){5}[0-9a-f]{2})/i);
    if (windowsMatch) {
      return normalizeMacAddress(windowsMatch[1]);
    }

    const unixMatch = line.match(/((?:[0-9a-f]{2}:){5}[0-9a-f]{2})/i);
    if (unixMatch) {
      return normalizeMacAddress(unixMatch[1]);
    }
  }
  return null;
}

async function collectSubnetMacAddresses(
  cidr: string,
): Promise<MacScanContext> {
  const mode = discoveryMacScanMode();
  const diagnostics: DiscoveryScanDiagnostic[] = [];
  const macByIp = new Map<string, string>();

  if (mode === "off" || mode === "neighbor") {
    return { macByIp, diagnostics };
  }

  if (mode === "auto" || mode === "arp-scan") {
    const result = await runArpScan(cidr);
    for (const [ipAddress, macAddress] of result.macByIp) {
      macByIp.set(ipAddress, macAddress);
    }
    if (result.macByIp.size > 0) {
      diagnostics.push({
        code: "mac-scan-arp-scan",
        severity: "info",
        message: `arp-scan found ${result.macByIp.size} MAC address${result.macByIp.size === 1 ? "" : "es"}.`,
      });
    } else if (mode === "arp-scan") {
      diagnostics.push(result.diagnostic);
    }
  }

  if ((mode === "auto" && macByIp.size === 0) || mode === "nmap") {
    const result = await runNmapPingScan(cidr);
    for (const [ipAddress, macAddress] of result.macByIp) {
      macByIp.set(ipAddress, macAddress);
    }
    if (result.macByIp.size > 0) {
      diagnostics.push({
        code: "mac-scan-nmap",
        severity: "info",
        message: `nmap found ${result.macByIp.size} MAC address${result.macByIp.size === 1 ? "" : "es"}.`,
      });
    } else if (mode === "nmap") {
      diagnostics.push(result.diagnostic);
    }
  }

  return { macByIp, diagnostics };
}

async function runArpScan(cidr: string) {
  try {
    const { stdout } = await execFileAsync(
      "arp-scan",
      ["--retry=1", "--timeout=500", cidr],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    return {
      macByIp: parseArpScanOutput(String(stdout)),
      diagnostic: unavailableToolDiagnostic(
        "arp-scan",
        "arp-scan returned no MAC addresses.",
      ),
    };
  } catch (err) {
    return {
      macByIp: new Map<string, string>(),
      diagnostic: unavailableToolDiagnostic(
        "arp-scan",
        commandFailureMessage(err, "arp-scan"),
      ),
    };
  }
}

async function runNmapPingScan(cidr: string) {
  try {
    const { stdout } = await execFileAsync("nmap", ["-sn", "-n", cidr], {
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
    });
    return {
      macByIp: parseNmapPingScanOutput(String(stdout)),
      diagnostic: unavailableToolDiagnostic(
        "nmap",
        "nmap returned no MAC addresses.",
      ),
    };
  } catch (err) {
    return {
      macByIp: new Map<string, string>(),
      diagnostic: unavailableToolDiagnostic(
        "nmap",
        commandFailureMessage(err, "nmap"),
      ),
    };
  }
}

export function parseArpScanOutput(output: string) {
  const entries = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /^\s*((?:\d{1,3}\.){3}\d{1,3})\s+((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})\b/i,
    );
    const macAddress = normalizeMacAddress(match?.[2]);
    if (match?.[1] && macAddress) entries.set(match[1], macAddress);
  }
  return entries;
}

export function parseNmapPingScanOutput(output: string) {
  const entries = new Map<string, string>();
  let currentIp: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    const reportMatch =
      line.match(/^\s*Nmap scan report for\s+((?:\d{1,3}\.){3}\d{1,3})\s*$/i) ??
      line.match(
        /^\s*Nmap scan report for\s+.+\s+\(((?:\d{1,3}\.){3}\d{1,3})\)\s*$/i,
      );
    if (reportMatch?.[1]) {
      currentIp = reportMatch[1];
      continue;
    }

    const macMatch = line.match(
      /^\s*MAC Address:\s+((?:[0-9a-f]{2}:){5}[0-9a-f]{2})\b/i,
    );
    const macAddress = normalizeMacAddress(macMatch?.[1]);
    if (currentIp && macAddress) entries.set(currentIp, macAddress);
  }
  return entries;
}

function discoveryMacScanMode(): DiscoveryMacScanMode {
  const raw = process.env.DISCOVERY_MAC_SCAN_MODE?.trim().toLowerCase();
  return DISCOVERY_MAC_SCAN_MODES.includes(raw as DiscoveryMacScanMode)
    ? (raw as DiscoveryMacScanMode)
    : "auto";
}

function unavailableToolDiagnostic(
  tool: string,
  detail: string,
): DiscoveryScanDiagnostic {
  return {
    code: `${tool}-unavailable`,
    severity: "warning",
    message: `${tool} did not provide MAC addresses.`,
    detail,
  };
}

function commandFailureMessage(err: unknown, command: string) {
  const error = err as { code?: string; message?: string; stderr?: string };
  if (error.code === "ENOENT")
    return `${command} is not installed in this Rackpad runtime.`;
  return (
    [error.stderr, error.message].filter(Boolean).join(" ").trim() ||
    `${command} failed.`
  );
}

function macUnavailableDiagnostic(
  reachableCount: number,
): DiscoveryScanDiagnostic {
  return {
    code: "mac-unavailable",
    severity: "warning",
    message: `No MAC addresses were visible for ${reachableCount} reachable host${reachableCount === 1 ? "" : "s"}.`,
    detail:
      "MAC discovery needs layer-2 visibility. Docker bridge networking, Docker Desktop, routed VLANs, VPNs, or missing NET_RAW/CAP_NET_RAW access can hide MAC addresses from Rackpad. On Linux or Proxmox LXC installs, use the host-discovery compose variant or run Rackpad with host networking plus NET_RAW/NET_ADMIN.",
  };
}

async function scanHost(
  ipAddress: string,
  macByIp: Map<string, string>,
  labId: string,
) {
  const result = await runIcmpProbe(ipAddress);
  if (result.result !== "online") return null;

  const cachedMacAddress = macByIp.get(ipAddress);
  const [hostname, discoveredMacAddress] = await Promise.all([
    resolveHostname(ipAddress),
    cachedMacAddress
      ? Promise.resolve(cachedMacAddress)
      : lookupMacAddress(ipAddress),
  ]);
  const macAddress = cachedMacAddress ?? discoveredMacAddress;
  const deviceType = inferDeviceType(hostname);
  const displayName = hostname ? hostname.split(".")[0] : null;
  const vendor = await lookupOuiVendor(macAddress);

  return {
    ipAddress,
    hostname,
    displayName,
    deviceType,
    placement: inferPlacement(deviceType, {
      labId,
      ipAddress,
      hostname,
      displayName,
      macAddress,
    }),
    placementHint: inferDiscoveryPlacementHint({
      labId,
      ipAddress,
      deviceType,
      hostname,
      displayName,
      macAddress,
    }),
    macAddress,
    vendor,
    source: "icmp-scan",
    lastSeen: new Date().toISOString(),
  };
}

async function scanHosts(
  hosts: string[],
  macByIp: Map<string, string>,
  labId: string,
  concurrency = 24,
) {
  const results: Array<Awaited<ReturnType<typeof scanHost>>> = [];
  let index = 0;

  async function worker() {
    while (index < hosts.length) {
      const current = hosts[index];
      index += 1;
      const result = await scanHost(current, macByIp, labId);
      if (result) results.push(result);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, hosts.length) }, () => worker()),
  );
  return results;
}

export const discoveryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string; status?: string } }>(
    "/",
    async (req, reply) => {
      if (!req.authUser) {
        return reply.status(401).send({ error: "Authentication required." });
      }

      const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId);
      if (!filter.ok) {
        return reply.status(filter.status).send({ error: filter.error });
      }

      resetStaleImportedDiscoveryRows(req.query.labId);
      const filtered = appendLabFilter("SELECT * FROM discoveredDevices WHERE 1=1", [], filter.labIds);
      let sql = filtered.sql;
      const params: unknown[] = [...filtered.params];
      if (req.query.status) {
        const body = { status: req.query.status };
        const status = optionalEnum(body, "status", DISCOVERY_STATUSES);
        if (status) {
          sql += " AND status = ?";
          params.push(status);
        }
      }

      sql += " ORDER BY lastScannedAt DESC, ipAddress ASC";
      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
      return rows.map(parseDiscoveredDevice);
    },
  );

  app.post("/scan", async (req, reply) => {
    const body = asObject(req.body);
    const labId = optionalString(body, "labId", { maxLength: 80 });
    const cidr = optionalString(body, "cidr", { maxLength: 80 });

    if (!labId) {
      throw new ValidationError("labId is required.");
    }
    if (!assertLabWrite(req, reply, labId)) return;
    if (!cidr) {
      throw new ValidationError("cidr is required.");
    }

    const lab = db.prepare("SELECT id FROM labs WHERE id = ?").get(labId);
    if (!lab) {
      return reply.status(404).send({ error: "Lab not found." });
    }
    resetStaleImportedDiscoveryRows(labId);

    const scannedAt = new Date().toISOString();
    const hosts = cidrHosts(cidr);
    const macScan = await collectSubnetMacAddresses(cidr);
    const technicalAddresses = collectTechnicalAddresses(labId);
    const reachableHosts = (await scanHosts(hosts, macScan.macByIp, labId)).map(
      (record) => {
        if (!record) return record;
        const technical = technicalAddressForIp(
          record.ipAddress,
          technicalAddresses,
        );
        return {
          ...record,
          technicalRole: technical?.role ?? null,
          technicalReason: technical?.reason ?? null,
        };
      },
    );
    const macAddressCount = reachableHosts.filter(
      (record) => record?.macAddress,
    ).length;
    const vendorCount = reachableHosts.filter(
      (record) => record?.vendor,
    ).length;
    const technicalCount = reachableHosts.filter(
      (record) => record?.technicalRole,
    ).length;
    const diagnostics = [...macScan.diagnostics];
    if (reachableHosts.length > 0 && macAddressCount === 0) {
      diagnostics.push(macUnavailableDiagnostic(reachableHosts.length));
    }

    const upsert = db.prepare(`
      INSERT INTO discoveredDevices
        (id, labId, ipAddress, hostname, displayName, deviceType, placement, placementHint, macAddress, vendor, source, status, notes, importedDeviceId, technicalRole, technicalReason, lastSeen, lastScannedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(labId, ipAddress) DO UPDATE SET
        hostname = CASE
          WHEN discoveredDevices.importedDeviceId IS NOT NULL
            THEN discoveredDevices.hostname
          ELSE COALESCE(excluded.hostname, discoveredDevices.hostname)
        END,
        displayName = CASE
          WHEN discoveredDevices.importedDeviceId IS NOT NULL
            THEN discoveredDevices.displayName
          ELSE COALESCE(discoveredDevices.displayName, excluded.displayName)
        END,
        deviceType = CASE
          WHEN discoveredDevices.importedDeviceId IS NOT NULL
            THEN discoveredDevices.deviceType
          ELSE COALESCE(discoveredDevices.deviceType, excluded.deviceType)
        END,
        placement = CASE
          WHEN discoveredDevices.importedDeviceId IS NOT NULL
            THEN discoveredDevices.placement
          ELSE COALESCE(discoveredDevices.placement, excluded.placement)
        END,
        placementHint = CASE
          WHEN discoveredDevices.importedDeviceId IS NOT NULL
            THEN discoveredDevices.placementHint
          ELSE COALESCE(discoveredDevices.placementHint, excluded.placementHint)
        END,
        macAddress = CASE
          WHEN discoveredDevices.importedDeviceId IS NOT NULL
            THEN discoveredDevices.macAddress
          ELSE COALESCE(discoveredDevices.macAddress, excluded.macAddress)
        END,
        vendor = CASE
          WHEN discoveredDevices.importedDeviceId IS NOT NULL
            THEN discoveredDevices.vendor
          ELSE COALESCE(discoveredDevices.vendor, excluded.vendor)
        END,
        technicalRole = excluded.technicalRole,
        technicalReason = excluded.technicalReason,
        importedDeviceId = CASE
          WHEN excluded.technicalRole IS NOT NULL
            THEN NULL
          ELSE discoveredDevices.importedDeviceId
        END,
        status = CASE
          WHEN excluded.technicalRole IS NOT NULL
            THEN 'dismissed'
          ELSE discoveredDevices.status
        END,
        source = excluded.source,
        lastSeen = excluded.lastSeen,
        lastScannedAt = excluded.lastScannedAt
    `);

    const persistScan = db.transaction(() => {
      for (const record of reachableHosts) {
        if (!record) continue;
        upsert.run(
          createId("disc"),
          labId,
          record.ipAddress,
          record.hostname,
          record.displayName,
          record.deviceType,
          record.placement,
          record.placementHint,
          record.macAddress,
          record.vendor,
          record.source,
          record.technicalRole ? "dismissed" : "new",
          null,
          null,
          record.technicalRole,
          record.technicalReason,
          record.lastSeen,
          scannedAt,
        );
      }
    });

    persistScan();

    const rows = db
      .prepare(
        `
      SELECT * FROM discoveredDevices
      WHERE labId = ? AND lastScannedAt = ?
      ORDER BY ipAddress ASC
    `,
      )
      .all(labId, scannedAt) as Record<string, unknown>[];

    return {
      scannedHostCount: hosts.length,
      discoveredCount: rows.length,
      macAddressCount,
      vendorCount,
      technicalCount,
      diagnostics,
      rows: rows.map(parseDiscoveredDevice),
    };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const existing = db
      .prepare("SELECT * FROM discoveredDevices WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!assertLabWriteFromRow(req, reply, existing)) return;
    const discovered = existing!;

    const body = asObject(req.body);
    const updates: string[] = [];
    const values: unknown[] = [];

    const hostname = optionalString(body, "hostname", { maxLength: 200 });
    const displayName = optionalString(body, "displayName", { maxLength: 200 });
    const notes = optionalString(body, "notes", { maxLength: 2000 });
    const deviceType = optionalDeviceType(body);
    const placement = optionalEnum(body, "placement", DEVICE_PLACEMENTS);
    const status = optionalEnum(body, "status", DISCOVERY_STATUSES);
    const importedDeviceId = optionalString(body, "importedDeviceId", {
      maxLength: 80,
    });
    const lastSeen = optionalString(body, "lastSeen", { maxLength: 80 });
    const existingTechnicalRole =
      typeof discovered.technicalRole === "string" &&
      discovered.technicalRole.trim()
        ? discovered.technicalRole
        : null;

    if (lastSeen) ensureIsoDate(lastSeen, "lastSeen");
    if (existingTechnicalRole) {
      if (status !== undefined && status !== discovered.status) {
        throw new ValidationError(
          "IPAM technical addresses cannot be moved into normal discovery statuses.",
        );
      }
      if (importedDeviceId) {
        throw new ValidationError(
          "IPAM technical addresses cannot be linked or imported as devices.",
        );
      }
    }

    const stringFields = [
      ["hostname", hostname],
      ["displayName", displayName],
      ["notes", notes],
      ["lastSeen", lastSeen],
    ] as const;

    for (const [key, value] of stringFields) {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (deviceType !== undefined) {
      updates.push("deviceType = ?");
      values.push(deviceType);
    }
    if (placement !== undefined) {
      updates.push("placement = ?");
      values.push(placement);
    }
    let statusUpdated = false;
    if (status !== undefined) {
      updates.push("status = ?");
      values.push(status);
      statusUpdated = true;
    }
    if (importedDeviceId !== undefined) {
      let importedDevice:
        | {
            id: string;
            labId: string;
            hostname: string;
            displayName: string | null;
            deviceType: string;
            placement: string | null;
            macAddress: string | null;
          }
        | undefined;
      if (importedDeviceId) {
        importedDevice = db
          .prepare(
            `
            SELECT id, labId, hostname, displayName, deviceType, placement, macAddress
            FROM devices
            WHERE id = ?
          `,
          )
          .get(importedDeviceId) as typeof importedDevice;
        if (!importedDevice) {
          throw new ValidationError("Imported device does not exist.");
        }
        if (importedDevice.labId !== String(discovered.labId)) {
          throw new ValidationError(
            "Imported device must belong to the same lab.",
          );
        }
      }
      updates.push("importedDeviceId = ?");
      values.push(importedDeviceId);
      if (importedDevice) {
        updates.push(
          "hostname = ?",
          "displayName = ?",
          "deviceType = ?",
          "placement = ?",
          "macAddress = COALESCE(?, macAddress)",
        );
        values.push(
          importedDevice.hostname,
          importedDevice.displayName,
          importedDevice.deviceType,
          importedDevice.placement,
          importedDevice.macAddress,
        );
        if (!statusUpdated) {
          updates.push("status = ?");
          values.push("imported");
        }
        if (importedDevice.macAddress) {
          const linkedVendor = await lookupOuiVendor(importedDevice.macAddress);
          if (linkedVendor) {
            updates.push("vendor = COALESCE(vendor, ?)");
            values.push(linkedVendor);
          }
        }
      }
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: "No valid fields to update." });
    }

    values.push(req.params.id);
    db.prepare(
      `UPDATE discoveredDevices SET ${updates.join(", ")} WHERE id = ?`,
    ).run(...values);
    const linkedMacAddress =
      typeof discovered.macAddress === "string" ? discovered.macAddress : "";
    if (importedDeviceId && linkedMacAddress) {
      db.prepare(
        `
        UPDATE devices
        SET macAddress = COALESCE(macAddress, ?)
        WHERE id = ?
      `,
      ).run(linkedMacAddress, importedDeviceId);
    }
    const row = db
      .prepare("SELECT * FROM discoveredDevices WHERE id = ?")
      .get(req.params.id) as Record<string, unknown>;
    return parseDiscoveredDevice(row);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const existing = db
      .prepare("SELECT * FROM discoveredDevices WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!assertLabWriteFromRow(req, reply, existing)) return;

    db.prepare("DELETE FROM discoveredDevices WHERE id = ?").run(req.params.id);
    return reply.status(204).send();
  });
};

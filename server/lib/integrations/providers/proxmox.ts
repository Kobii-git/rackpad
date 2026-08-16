import { ValidationError } from "../../validation.js";
import { canonicalizeIpv4Cidr } from "../../ip-cidr.js";
import {
  buildIntegrationUrl,
  integrationHttpRequest,
  parseIntegrationJson,
} from "../http.js";
import {
  connectionScopeRefs,
  type IntegrationClient,
  type IntegrationDevicePreview,
  type IntegrationImportableDevice,
  type IntegrationInventory,
  type IntegrationPortSpec,
  type IntegrationScope,
  type IntegrationTestResult,
  type IntegrationVirtualSwitchSpec,
} from "../inventory.js";
import type { IntegrationConnectionSecrets } from "../types.js";
import type {
  SnmpCollectedDhcpScope,
  SnmpCollectedSubnet,
  SnmpCollectedVlan,
} from "../../snmp-profiles/types.js";

const TARGET_LABEL = "Proxmox VE";
// Mirrors scripts/collect-proxmox.sh so API pulls stage the same payload the
// offline collector produces and the existing import wizard already accepts.
const DISK_KEY_RE = /^(ide|sata|scsi|virtio)\d+$/;
const LXC_MOUNT_RE = /^(rootfs|mp\d+)$/;
const NET_KEY_RE = /^net\d+$/;
const QEMU_NIC_MODELS = [
  "virtio",
  "e1000",
  "e1000e",
  "rtl8139",
  "vmxnet3",
  "ne2k_pci",
  "i82551",
  "i82557b",
  "i82559er",
];

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function enabledFlag(value: unknown) {
  return ["1", "true", "yes", "on"].includes(asText(value).toLowerCase());
}

function roundGb(value: number) {
  return Math.round(value * 100) / 100;
}

function bytesToGb(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed == null) return null;
  return roundGb(parsed / 1024 ** 3);
}

function mibToGb(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed == null) return null;
  return roundGb(parsed / 1024);
}

function parseSizeToGb(value: unknown): number | null {
  const text = asText(value);
  if (!text) return null;
  const match = text.match(/^([0-9.]+)\s*([KMGTPE]?)(i?B?)?$/i);
  if (!match) return null;
  const amount = asNumber(match[1]);
  if (amount == null) return null;
  const unit = (match[2] ?? "").toUpperCase();
  const multipliers: Record<string, number> = {
    "": 1 / 1024 ** 3,
    K: 1 / 1024 ** 2,
    M: 1 / 1024,
    G: 1,
    T: 1024,
    P: 1024 ** 2,
    E: 1024 ** 3,
  };
  return roundGb(amount * (multipliers[unit] ?? 1));
}

function parseConfigString(value: unknown) {
  const options: Record<string, string> = {};
  const parts = asText(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  parts.forEach((part, index) => {
    const eq = part.indexOf("=");
    if (eq > 0) {
      options[part.slice(0, eq).trim().toLowerCase()] = part
        .slice(eq + 1)
        .trim();
    } else if (index === 0) {
      options._volume = part;
    }
  });
  return options;
}

function normalizeMac(value: unknown) {
  const text = asText(value).replace(/-/g, ":").toLowerCase();
  if (!text) return "";
  const parts = text
    .split(":")
    .filter(Boolean)
    .map((part) => part.padStart(2, "0"));
  return parts.length === 6 ? parts.join(":") : text;
}

function displayMac(value: unknown) {
  const normalized = normalizeMac(value);
  if (normalized.length !== 12) return normalized.toUpperCase();
  // Canonical MAC form: uppercase, colon-separated.
  return (normalized.match(/.{2}/g) ?? []).join(":").toUpperCase();
}

function isUsableIpv4(value: string) {
  const octets = value.split(".");
  if (octets.length !== 4) return false;
  const numbers = octets.map((octet) => Number(octet));
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  if (numbers[0] === 127 || numbers[0] === 0) return false;
  if (numbers[0] === 169 && numbers[1] === 254) return false;
  if (numbers[0] >= 224) return false;
  return true;
}

function cleanIpv4(value: unknown) {
  const address = asText(value).split("/")[0].trim();
  return address && isUsableIpv4(address) ? address : "";
}

function unique(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function splitVlanValues(value: unknown) {
  const text = asText(value);
  if (!text) return [];
  return text
    .split(/[;, ]+/)
    .map((item) => item.trim())
    .filter((item) => item && item !== "0");
}

function vlanFromOptions(options: Record<string, string>) {
  const tag = options.tag || options.vlan || "";
  const trunks = options.trunks || options.trunk || options.vlans || "";
  const native =
    options.native || options.nativevlan || options.native_vlan || "";
  if (!tag && !trunks && !native) return null;
  const raw = [
    tag ? `tag=${tag}` : "",
    native ? `native=${native}` : "",
    trunks ? `trunks=${trunks}` : "",
  ]
    .filter(Boolean)
    .join(",");
  return {
    mode: trunks ? "trunk" : "access",
    accessVlanId: tag && !trunks ? tag : null,
    nativeVlanId: native || (trunks ? tag || null : null),
    allowedVlanIds: splitVlanValues(trunks),
    raw,
  };
}

async function proxmoxGet(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const url = buildIntegrationUrl(
    connection.baseUrl,
    `/api2/json${apiPath}`,
    query,
  );
  const response = await integrationHttpRequest(
    {
      url,
      method: "GET",
      headers: {
        Authorization: `PVEAPIToken=${connection.authId ?? ""}=${connection.authSecret ?? ""}`,
      },
      verifyTls: connection.verifyTls,
    },
    TARGET_LABEL,
  );
  if (response.status === 401) {
    throw new ValidationError(
      "Proxmox VE rejected the API token. Check the token ID and secret.",
      502,
    );
  }
  if (response.status === 403) {
    throw new ValidationError(
      "The Proxmox VE API token is not permitted to read this resource. Grant it PVEAuditor on / (propagated).",
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
  return body.data ?? null;
}

async function tryProxmoxGet(
  connection: IntegrationConnectionSecrets,
  apiPath: string,
  errors: string[],
  query?: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  try {
    return await proxmoxGet(connection, apiPath, query);
  } catch (error) {
    errors.push(
      error instanceof Error
        ? `${apiPath}: ${error.message}`
        : `${apiPath}: request failed`,
    );
    return null;
  }
}

interface ProxmoxNodeEntry {
  node: string;
  status: string;
  maxcpu: number | null;
  maxmemGb: number | null;
}

function parseNodeList(data: unknown): ProxmoxNodeEntry[] {
  return asArray(data)
    .map((entry) => {
      const row = asRecord(entry);
      return {
        node: asText(row.node),
        status: asText(row.status) || "unknown",
        maxcpu: asNumber(row.maxcpu),
        maxmemGb: bytesToGb(row.maxmem),
      };
    })
    .filter((entry) => entry.node)
    .sort((a, b) => a.node.localeCompare(b.node));
}

export async function fetchProxmoxNodes(
  connection: IntegrationConnectionSecrets,
) {
  const data = await proxmoxGet(connection, "/nodes");
  return parseNodeList(data);
}

async function fetchClusterName(
  connection: IntegrationConnectionSecrets,
): Promise<string | null> {
  try {
    const entries = asArray(await proxmoxGet(connection, "/cluster/status"));
    for (const entry of entries) {
      const row = asRecord(entry);
      if (asText(row.type) === "cluster") {
        return asText(row.name) || null;
      }
    }
  } catch {
    // Standalone nodes and restricted tokens have no cluster status.
  }
  return null;
}

async function proxmoxTest(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationTestResult> {
  const version = asRecord(await proxmoxGet(connection, "/version"));
  const nodes = parseNodeList(await proxmoxGet(connection, "/nodes"));
  const clusterName = await fetchClusterName(connection);

  let qemu = 0;
  let lxc = 0;
  try {
    for (const entry of asArray(
      await proxmoxGet(connection, "/cluster/resources", { type: "vm" }),
    )) {
      const row = asRecord(entry);
      if (asText(row.type) === "qemu") qemu += 1;
      if (asText(row.type) === "lxc") lxc += 1;
    }
  } catch {
    // Workload counts are informational; auth was already proven by /version.
  }

  return {
    product: "Proxmox VE",
    version: asText(version.version) || null,
    summary: {
      release: asText(version.release) || null,
      cluster: clusterName,
      nodes: nodes.length,
      nodeNames: nodes.map((entry) => entry.node),
      qemu,
      lxc,
    },
  };
}

interface ProxmoxNetworkEntry {
  iface: string;
  type: string;
  address: string;
  cidr: string;
  gateway: string;
  bridgePorts: string;
  active: boolean;
  comments: string;
}

function parseNodeNetwork(data: unknown): ProxmoxNetworkEntry[] {
  return asArray(data)
    .map((entry) => {
      const row = asRecord(entry);
      const address = asText(row.address);
      const netmask = asText(row.netmask);
      let cidr = asText(row.cidr);
      if (!cidr && address && netmask.includes(".")) {
        const prefix = netmask
          .split(".")
          .map((part) => Number(part))
          .reduce(
            (bits, octet) =>
              bits + ((octet >>> 0).toString(2).match(/1/g)?.length ?? 0),
            0,
          );
        cidr = `${address}/${prefix}`;
      }
      return {
        iface: asText(row.iface),
        type: asText(row.type),
        address,
        cidr,
        gateway: asText(row.gateway),
        bridgePorts: asText(row.bridge_ports),
        active: Boolean(row.active),
        comments: asText(row.comments),
      };
    })
    .filter((entry) => entry.iface && entry.iface !== "lo")
    .sort((a, b) => a.iface.localeCompare(b.iface));
}

function isBridgeInterface(entry: ProxmoxNetworkEntry) {
  return (
    entry.type === "bridge" ||
    entry.type === "OVSBridge" ||
    /^(vmbr|ovs|br-)/.test(entry.iface)
  );
}

async function proxmoxFetchInventory(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationInventory> {
  const warnings: string[] = [];
  const devices: IntegrationDevicePreview[] = [];
  const vlans: SnmpCollectedVlan[] = [];
  const subnets: SnmpCollectedSubnet[] = [];
  const dhcpScopes: SnmpCollectedDhcpScope[] = [];
  const seenVlans = new Set<number>();
  const seenSubnets = new Set<string>();

  const scopeRefs = connectionScopeRefs(connection).map((ref) =>
    ref.trim().toLowerCase(),
  );
  const allNodes = parseNodeList(await proxmoxGet(connection, "/nodes"));
  const nodes =
    scopeRefs.length > 0
      ? allNodes.filter((entry) => scopeRefs.includes(entry.node.toLowerCase()))
      : allNodes;
  if (nodes.length === 0) {
    throw new ValidationError(
      `No selected Proxmox node was found. Available nodes: ${allNodes
        .map((entry) => entry.node)
        .join(", ")}.`,
    );
  }
  const nodeNames = new Set(nodes.map((entry) => entry.node));
  const importableDevices: IntegrationImportableDevice[] = [];
  const virtualSwitches: IntegrationVirtualSwitchSpec[] = [];
  for (const node of nodes) {
    devices.push({
      name: node.node,
      kind: "host",
      model: null,
      macAddress: null,
      ipAddress: null,
      status: node.status,
      detail:
        [
          node.maxcpu != null ? `${node.maxcpu} CPU` : "",
          node.maxmemGb != null ? `${node.maxmemGb} GB RAM` : "",
        ]
          .filter(Boolean)
          .join(", ") || null,
    });
    if (connection.syncHosts) {
      importableDevices.push({
        name: node.node,
        deviceType: "server",
        model: "Proxmox VE node",
        macAddress: null,
        ipAddress: null,
        serial: null,
        firmware: null,
        online: node.status === "online",
        ports: [],
      });
    }
  }

  try {
    for (const entry of asArray(
      await proxmoxGet(connection, "/cluster/resources", { type: "vm" }),
    )) {
      const row = asRecord(entry);
      if (!nodeNames.has(asText(row.node))) continue;
      const kind = asText(row.type) === "lxc" ? "container" : "vm";
      devices.push({
        name: asText(row.name) || `vmid-${asText(row.vmid)}`,
        kind,
        model: null,
        macAddress: null,
        ipAddress: null,
        status: asText(row.status) || null,
        detail: `VMID ${asText(row.vmid)} on ${asText(row.node)}`,
      });
    }
  } catch (error) {
    warnings.push(
      error instanceof Error
        ? `Workload list unavailable: ${error.message}`
        : "Workload list unavailable.",
    );
  }

  for (const node of nodes) {
    const requestErrors: string[] = [];
    const network = parseNodeNetwork(
      await tryProxmoxGet(
        connection,
        `/nodes/${node.node}/network`,
        requestErrors,
      ),
    );
    for (const entry of network) {
      if (isBridgeInterface(entry)) {
        devices.push({
          name: `${node.node}/${entry.iface}`,
          kind: "bridge",
          model: null,
          macAddress: null,
          ipAddress: entry.address || null,
          status: entry.active ? "active" : "inactive",
          detail: entry.bridgePorts
            ? `Ports: ${entry.bridgePorts}`
            : entry.comments || null,
        });
        // VLAN subinterfaces (vmbr0.20) ride on the bridge; only the
        // bridge itself becomes a virtual switch.
        if (connection.syncHosts && !entry.iface.includes(".")) {
          virtualSwitches.push({
            name: entry.iface,
            hostName: node.node,
            kind: entry.bridgePorts ? "external" : "internal",
            notes: entry.bridgePorts ? `Members: ${entry.bridgePorts}` : null,
          });
        }
      }
      if (entry.cidr && cleanIpv4(entry.cidr.split("/")[0])) {
        try {
          const cidr = canonicalizeIpv4Cidr(entry.cidr);
          if (!seenSubnets.has(cidr)) {
            seenSubnets.add(cidr);
            const vlanMatch = entry.iface.match(/\.(\d{1,4})$/);
            subnets.push({
              cidr,
              name: `${node.node} ${entry.iface}`,
              vlanNumber: vlanMatch ? Number(vlanMatch[1]) : null,
            });
          }
        } catch {
          // Skip malformed or IPv6 CIDRs; the payload keeps the raw value.
        }
      }
    }
    warnings.push(...requestErrors);
  }

  // Guests come from per-node config walks — the same NIC/MAC/VLAN/IP
  // detail the offline collector gathers. Templates are skipped: they are
  // images, not running gear.
  if (connection.syncGuests) {
    for (const node of nodes) {
      const guestErrors: string[] = [];
      const qemuItems = asArray(
        await tryProxmoxGet(
          connection,
          `/nodes/${node.node}/qemu`,
          guestErrors,
        ),
      )
        .map(asRecord)
        .sort((a, b) => workloadSortKey(a) - workloadSortKey(b));
      const lxcItems = asArray(
        await tryProxmoxGet(connection, `/nodes/${node.node}/lxc`, guestErrors),
      )
        .map(asRecord)
        .sort((a, b) => workloadSortKey(a) - workloadSortKey(b));
      warnings.push(...guestErrors);
      for (const item of qemuItems) {
        const workload = await stageQemuWorkload(connection, node.node, item);
        if (workload.template) continue;
        importableDevices.push(workloadImportable(workload, node.node));
      }
      for (const item of lxcItems) {
        const workload = await stageLxcWorkload(connection, node.node, item);
        if (workload.template) continue;
        importableDevices.push(workloadImportable(workload, node.node));
      }
    }
  }

  const sdnErrors: string[] = [];
  const vnets = asArray(
    await tryProxmoxGet(connection, "/cluster/sdn/vnets", sdnErrors),
  );
  for (const entry of vnets) {
    const row = asRecord(entry);
    const vnet = asText(row.vnet);
    const tag = asNumber(row.tag);
    if (tag != null && tag > 0 && !seenVlans.has(tag)) {
      seenVlans.add(tag);
      vlans.push({
        vlanNumber: tag,
        name: asText(row.alias) || vnet || `VLAN ${tag}`,
      });
    }
    if (!vnet) continue;
    const subnetErrors: string[] = [];
    for (const subnetEntry of asArray(
      await tryProxmoxGet(
        connection,
        `/cluster/sdn/vnets/${vnet}/subnets`,
        subnetErrors,
      ),
    )) {
      const subnetRow = asRecord(subnetEntry);
      const rawCidr = asText(subnetRow.cidr);
      if (!rawCidr || !cleanIpv4(rawCidr.split("/")[0])) continue;
      try {
        const cidr = canonicalizeIpv4Cidr(rawCidr);
        if (!seenSubnets.has(cidr)) {
          seenSubnets.add(cidr);
          subnets.push({
            cidr,
            name: asText(subnetRow.subnet) || `${vnet} ${cidr}`,
            vlanNumber: tag != null && tag > 0 ? tag : null,
          });
        }
        const ranges = asArray(subnetRow["dhcp-range"]);
        for (const rangeEntry of ranges) {
          const range = asRecord(rangeEntry);
          const startIp = cleanIpv4(range["start-address"]);
          const endIp = cleanIpv4(range["end-address"]);
          if (startIp && endIp) {
            dhcpScopes.push({
              name: `${vnet} DHCP`,
              startIp,
              endIp,
              subnetCidr: cidr,
              note: "Proxmox SDN DHCP range",
            });
          }
        }
      } catch {
        // Skip malformed SDN subnet entries.
      }
    }
  }
  if (sdnErrors.length > 0) {
    warnings.push(
      "Proxmox SDN inventory is unavailable (missing permissions or SDN is not configured).",
    );
  }

  return {
    collection: { vlans, subnets, dhcpScopes },
    devices,
    importableDevices,
    virtualSwitches,
    wifi: null,
    warnings,
  };
}

interface StagedDisk {
  path: string;
  controllerType: string;
  sizeGb: number | null;
  vhdType: string | null;
  storage: string;
  raw: string;
}

function diskFromConfig(key: string, value: unknown): StagedDisk {
  const options = parseConfigString(value);
  const volume = options._volume ?? asText(value).split(",", 1)[0];
  const controller = key.replace(/\d+$/, "");
  let sizeGb = parseSizeToGb(options.size);
  if (sizeGb == null && key === "rootfs") {
    sizeGb = parseSizeToGb(options.size ?? value);
  }
  return {
    path: volume,
    controllerType: controller,
    sizeGb,
    vhdType: options.format || controller,
    storage: volume.includes(":") ? volume.split(":", 1)[0] : "",
    raw: asText(value),
  };
}

function qemuNetworkAdapter(
  vmid: string,
  key: string,
  value: unknown,
  ipByMac: Map<string, string[]>,
) {
  const options = parseConfigString(value);
  let model = "";
  let mac = "";
  for (const candidate of QEMU_NIC_MODELS) {
    if (options[candidate]) {
      model = candidate;
      mac = options[candidate];
      break;
    }
  }
  mac = mac || options.macaddr || options.hwaddr || "";
  const macKey = normalizeMac(mac);
  const connected = !["1", "true", "yes", "on"].includes(
    asText(options.link_down ?? "0").toLowerCase(),
  );
  return {
    id: `qemu-${vmid}-${key}`,
    name: key,
    switchName: options.bridge || null,
    macAddress: displayMac(mac),
    status: connected ? "up" : "down",
    connected,
    ipAddresses: ipByMac.get(macKey) ?? [],
    vlan: vlanFromOptions(options),
    model,
    raw: asText(value),
  };
}

function lxcNetworkAdapter(
  vmid: string,
  key: string,
  value: unknown,
  liveByName: Map<string, string[]>,
  liveByMac: Map<string, string[]>,
) {
  const options = parseConfigString(value);
  const name = options.name || key;
  const mac = options.hwaddr || options.mac || options.macaddr || "";
  const macKey = normalizeMac(mac);
  const configuredIp = cleanIpv4(options.ip);
  const liveIps = [
    ...(liveByName.get(name) ?? []),
    ...(macKey ? (liveByMac.get(macKey) ?? []) : []),
  ];
  return {
    id: `lxc-${vmid}-${key}`,
    name,
    switchName: options.bridge || null,
    macAddress: displayMac(mac),
    status: "up",
    connected: true,
    ipAddresses: unique([configuredIp, ...liveIps]),
    vlan: vlanFromOptions(options),
    model: options.type || "veth",
    raw: asText(value),
  };
}

async function qemuAgentIpMap(
  connection: IntegrationConnectionSecrets,
  node: string,
  vmid: string,
): Promise<{ byMac: Map<string, string[]>; error: string | null }> {
  const byMac = new Map<string, string[]>();
  let entries: unknown[] = [];
  try {
    const data = await proxmoxGet(
      connection,
      `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`,
    );
    const record = asRecord(data);
    entries = asArray(record.result ?? data);
  } catch (error) {
    return {
      byMac,
      error:
        error instanceof Error
          ? error.message
          : "QEMU guest agent is not responding.",
    };
  }
  for (const entry of entries) {
    const row = asRecord(entry);
    const mac = normalizeMac(row["hardware-address"] ?? row["mac-address"]);
    if (!mac) continue;
    const ips: string[] = [];
    for (const ipEntry of asArray(row["ip-addresses"])) {
      const ipRow = asRecord(ipEntry);
      const ipType = asText(
        ipRow["ip-address-type"] ?? ipRow.type,
      ).toLowerCase();
      if (ipType && ipType !== "ipv4") continue;
      const ip = cleanIpv4(ipRow["ip-address"] ?? ipRow.address);
      if (ip) ips.push(ip);
    }
    byMac.set(mac, unique(ips));
  }
  return { byMac, error: null };
}

async function lxcLiveIpMaps(
  connection: IntegrationConnectionSecrets,
  node: string,
  vmid: string,
  running: boolean,
): Promise<{
  byName: Map<string, string[]>;
  byMac: Map<string, string[]>;
  error: string | null;
}> {
  const byName = new Map<string, string[]>();
  const byMac = new Map<string, string[]>();
  if (!running) return { byName, byMac, error: null };
  try {
    const entries = asArray(
      await proxmoxGet(connection, `/nodes/${node}/lxc/${vmid}/interfaces`),
    );
    for (const entry of entries) {
      const row = asRecord(entry);
      const name = asText(row.name);
      const mac = normalizeMac(row.hwaddr);
      const ip = cleanIpv4(asText(row.inet).split("/")[0]);
      const ips = ip ? [ip] : [];
      if (name) byName.set(name, ips);
      if (mac) byMac.set(mac, ips);
    }
    return { byName, byMac, error: null };
  } catch (error) {
    return {
      byName,
      byMac,
      error:
        error instanceof Error
          ? error.message
          : "Live container interfaces are unavailable.",
    };
  }
}

type StagedWorkload =
  | Awaited<ReturnType<typeof stageQemuWorkload>>
  | Awaited<ReturnType<typeof stageLxcWorkload>>;

function guestVlanNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 4094
    ? number
    : null;
}

function workloadImportable(
  workload: StagedWorkload,
  node: string,
): IntegrationImportableDevice {
  const adapters = workload.networkAdapters;
  const ports: IntegrationPortSpec[] = adapters.map((adapter, index) => {
    const vlan = adapter.vlan;
    return {
      name: adapter.name || `net${index}`,
      kind: "virtual",
      speed: "virtual",
      linkState: adapter.connected === false ? "down" : "up",
      mode: vlan ? (vlan.mode === "trunk" ? "trunk" : "access") : null,
      untaggedVlanNumber: guestVlanNumber(
        vlan?.accessVlanId ?? vlan?.nativeVlanId,
      ),
      taggedVlanNumbers: (vlan?.allowedVlanIds ?? [])
        .map((entry) => guestVlanNumber(entry))
        .filter((entry): entry is number => entry != null),
      macAddress: adapter.macAddress || null,
      virtualSwitchName: adapter.switchName || null,
      ipAddresses: adapter.ipAddresses,
    };
  });
  return {
    name: workload.name,
    deviceType: workload.kind === "lxc" ? "container" : "vm",
    model: workload.kind === "lxc" ? "LXC container" : "QEMU virtual machine",
    macAddress: adapters.map((entry) => entry.macAddress).find(Boolean) ?? null,
    ipAddress: adapters.flatMap((entry) => entry.ipAddresses)[0] ?? null,
    serial: null,
    firmware: null,
    online: workload.state === "running",
    parentName: node,
    ports,
  };
}

async function stageQemuWorkload(
  connection: IntegrationConnectionSecrets,
  node: string,
  item: JsonRecord,
) {
  const vmid = asText(item.vmid);
  const errors: string[] = [];
  const config = asRecord(
    await tryProxmoxGet(
      connection,
      `/nodes/${node}/qemu/${vmid}/config`,
      errors,
    ),
  );
  const status = asRecord(
    await tryProxmoxGet(
      connection,
      `/nodes/${node}/qemu/${vmid}/status/current`,
      errors,
    ),
  );
  const { byMac, error: agentError } = await qemuAgentIpMap(
    connection,
    node,
    vmid,
  );
  if (agentError) errors.push(agentError);

  const disks = Object.entries(config)
    .filter(
      ([key, value]) =>
        DISK_KEY_RE.test(key) &&
        !asText(value).toLowerCase().includes("media=cdrom"),
    )
    .map(([key, value]) => diskFromConfig(key, value));
  const adapters = Object.entries(config)
    .filter(([key]) => NET_KEY_RE.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => qemuNetworkAdapter(vmid, key, value, byMac));

  const maxmemGb = bytesToGb(status.maxmem) ?? mibToGb(config.memory);
  const storageGb =
    disks.reduce((sum, disk) => sum + (disk.sizeGb ?? 0), 0) ||
    bytesToGb(status.maxdisk) ||
    null;
  const cores = asNumber(config.cores);
  const sockets = asNumber(config.sockets) ?? 1;
  const cpuCount = cores
    ? Math.trunc(cores * sockets)
    : Math.trunc(asNumber(status.cpus) ?? 0) || null;
  const ostype = asText(config.ostype) || null;

  return {
    id: `qemu-${node}-${vmid}`,
    name: asText(config.name) || asText(item.name) || `vm-${vmid}`,
    state: asText(status.status) || asText(item.status) || null,
    generation: null,
    version: asText(config.machine) || asText(config.bios) || null,
    processorCount: cpuCount,
    memoryAssignedGb: maxmemGb,
    memoryStartupGb: maxmemGb,
    memoryUsedGb: bytesToGb(status.mem),
    dynamicMemoryEnabled: enabledFlag(config.balloon),
    storageGb: storageGb != null ? roundGb(storageGb) : null,
    disks,
    networkAdapters: adapters,
    guest: {
      kvpAvailable: !agentError,
      osName: ostype,
      osVersion: null,
      osBuildNumber: null,
      computerName: asText(config.name) || null,
      fullyQualifiedDomainName: null,
      integrationServicesVersion: agentError ? null : "QEMU guest agent",
      error: agentError,
    },
    guestOsName: ostype,
    guestOsVersion: null,
    notes: asText(config.description),
    kind: "qemu",
    vmType: "qemu",
    vmid: asNumber(item.vmid) ?? vmid,
    node,
    template: enabledFlag(config.template),
    tags: splitTags(config.tags),
    onBoot: enabledFlag(config.onboot),
    uptimeSeconds: asNumber(status.uptime),
    collectorErrors: unique(errors),
  };
}

async function stageLxcWorkload(
  connection: IntegrationConnectionSecrets,
  node: string,
  item: JsonRecord,
) {
  const vmid = asText(item.vmid);
  const errors: string[] = [];
  const config = asRecord(
    await tryProxmoxGet(
      connection,
      `/nodes/${node}/lxc/${vmid}/config`,
      errors,
    ),
  );
  const status = asRecord(
    await tryProxmoxGet(
      connection,
      `/nodes/${node}/lxc/${vmid}/status/current`,
      errors,
    ),
  );
  const running = (asText(status.status) || asText(item.status)) === "running";
  const {
    byName,
    byMac,
    error: liveError,
  } = await lxcLiveIpMaps(connection, node, vmid, running);
  if (liveError) errors.push(liveError);

  const disks = Object.entries(config)
    .filter(([key]) => LXC_MOUNT_RE.test(key))
    .map(([key, value]) => diskFromConfig(key, value));
  const adapters = Object.entries(config)
    .filter(([key]) => NET_KEY_RE.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => lxcNetworkAdapter(vmid, key, value, byName, byMac));

  const memoryGb = mibToGb(config.memory) ?? bytesToGb(status.maxmem);
  const storageGb =
    disks.reduce((sum, disk) => sum + (disk.sizeGb ?? 0), 0) ||
    bytesToGb(status.maxdisk) ||
    null;
  const ostype = asText(config.ostype);

  return {
    id: `lxc-${node}-${vmid}`,
    name: asText(config.hostname) || asText(item.name) || `ct-${vmid}`,
    state: asText(status.status) || asText(item.status) || null,
    generation: null,
    version: asText(config.arch) || null,
    processorCount:
      Math.trunc(asNumber(config.cores) ?? asNumber(status.cpus) ?? 0) || null,
    memoryAssignedGb: memoryGb,
    memoryStartupGb: memoryGb,
    memoryUsedGb: bytesToGb(status.mem),
    dynamicMemoryEnabled: false,
    storageGb: storageGb != null ? roundGb(storageGb) : null,
    disks,
    networkAdapters: adapters,
    guest: {
      kvpAvailable: !liveError,
      osName: ostype ? `LXC ${ostype}` : "LXC container",
      osVersion: ostype || null,
      osBuildNumber: null,
      computerName: asText(config.hostname) || null,
      fullyQualifiedDomainName: null,
      integrationServicesVersion: liveError ? null : "Proxmox API interfaces",
      error: liveError,
    },
    guestOsName: ostype ? `LXC ${ostype}` : "LXC container",
    guestOsVersion: ostype || null,
    notes: asText(config.description),
    kind: "lxc",
    vmType: "lxc",
    vmid: asNumber(item.vmid) ?? vmid,
    node,
    template: enabledFlag(config.template),
    tags: splitTags(config.tags),
    onBoot: enabledFlag(config.onboot),
    uptimeSeconds: asNumber(status.uptime),
    unprivileged: enabledFlag(config.unprivileged),
    swapGb: mibToGb(config.swap),
    collectorErrors: unique(errors),
  };
}

function splitTags(value: unknown) {
  const text = asText(value);
  if (!text) return [];
  return text
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function workloadSortKey(entry: JsonRecord) {
  return asNumber(entry.vmid) ?? Number.MAX_SAFE_INTEGER;
}

async function proxmoxListScopes(
  connection: IntegrationConnectionSecrets,
): Promise<IntegrationScope[]> {
  return (await fetchProxmoxNodes(connection)).map((entry) => ({
    id: entry.node,
    label: entry.node,
  }));
}

export const proxmoxIntegrationClient: IntegrationClient = {
  provider: "proxmox",
  test: proxmoxTest,
  fetchInventory: proxmoxFetchInventory,
  listScopes: proxmoxListScopes,
};

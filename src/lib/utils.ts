import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Device, DeviceStatus, LinkState, Port, PortKind } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const COLOR_PRESETS = [
  { label: "Blue", value: "blue", hex: "#4a78c4" },
  { label: "Cyan", value: "cyan", hex: "#4cc8d4" },
  { label: "Green", value: "green", hex: "#5aa05a" },
  { label: "Yellow", value: "yellow", hex: "#d4c43c" },
  { label: "Orange", value: "orange", hex: "#d28a3f" },
  { label: "Red", value: "red", hex: "#c4504a" },
  { label: "Purple", value: "purple", hex: "#8c63d9" },
  { label: "Aqua", value: "aqua", hex: "#59b7c5" },
  { label: "Gray", value: "gray", hex: "#7a7a7a" },
  { label: "Black", value: "black", hex: "#2a2a2a" },
] as const;

// ---------- Status color tokens ----------

export const statusColor: Record<DeviceStatus, string> = {
  online: "var(--color-ok)",
  offline: "var(--color-fg-faint)",
  warning: "var(--color-warn)",
  unknown: "var(--color-fg-subtle)",
  maintenance: "var(--color-info)",
};

export const statusGlow: Record<DeviceStatus, string> = {
  online: "var(--color-ok-glow)",
  offline: "transparent",
  warning: "var(--color-warn-glow)",
  unknown: "transparent",
  maintenance: "var(--color-info-glow)",
};

export const statusLabel: Record<DeviceStatus, string> = {
  online: "Online",
  offline: "Offline",
  warning: "Warning",
  unknown: "Unknown",
  maintenance: "Maintenance",
};

// ---------- Port type colors ----------

export const portTypeColor: Record<PortKind, string> = {
  rj45: "var(--color-port-rj45)",
  sfp: "var(--color-port-sfp)",
  sfp_plus: "var(--color-port-sfp-plus)",
  qsfp: "var(--color-port-qsfp)",
  fiber: "var(--color-port-fiber)",
  power: "var(--color-port-power)",
  console: "var(--color-port-console)",
  usb: "var(--color-port-usb)",
  virtual: "var(--color-port-virtual)",
  wifi: "var(--color-port-wifi)",
};

// ---------- Link state ----------

export const linkColor: Record<LinkState, string> = {
  up: "var(--color-cyan)",
  down: "var(--color-fg-faint)",
  disabled: "var(--color-fg-faint)",
  unknown: "var(--color-fg-subtle)",
};

// ---------- Time formatting ----------

export function relativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ---------- IP utilities ----------

export function ipToInt(ip: string): number {
  return (
    ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0
  );
}

export function intToIp(n: number): string {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join(".");
}

function isIpv4Text(value: string): boolean {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => {
      if (!/^\d+$/.test(octet)) return false;
      const parsed = Number.parseInt(octet, 10);
      return parsed >= 0 && parsed <= 255;
    })
  );
}

export function cidrBounds(cidr: string): {
  network: number;
  broadcast: number;
  prefix: number;
  size: number;
} {
  const [networkAddress, prefixRaw] = cidr.split("/");
  const prefix = Number.parseInt(prefixRaw ?? "", 10);
  if (
    !networkAddress ||
    !isIpv4Text(networkAddress) ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    throw new Error(`Invalid CIDR block: ${cidr}`);
  }
  const mask =
    prefix === 0
      ? 0
      : prefix === 32
        ? 0xffffffff
        : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipToInt(networkAddress) & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  return {
    network,
    broadcast: network + size - 1,
    prefix,
    size,
  };
}

export function cidrContainsIp(cidr: string, ipAddress: string): boolean {
  try {
    const { network, broadcast } = cidrBounds(cidr);
    const target = ipToInt(ipAddress);
    return target >= network && target <= broadcast;
  } catch {
    return false;
  }
}

export function cidrSize(cidr: string): number {
  return cidrBounds(cidr).size;
}

export function utilization(used: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

const SPEED_MULTIPLIERS_MBPS: Record<string, number> = {
  k: 0.001,
  m: 1,
  g: 1000,
  t: 1000 * 1000,
};

function trimTrailingZeros(value: number) {
  return value
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

export function parsePortSpeedMbps(speed?: string | null): number | null {
  if (!speed) return null;

  const normalized = speed
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/(?:b(?:it)?(?:\/s)?|bps|be)$/g, "");

  const match = normalized.match(/^(\d+(?:\.\d+)?)([kmgt])?$/);
  if (!match) return null;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2] ?? "m";
  const multiplier = SPEED_MULTIPLIERS_MBPS[unit];
  return multiplier ? value * multiplier : null;
}

export function formatBandwidthMbps(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return "0 Mbps";
  if (mbps >= 1000 * 1000)
    return `${trimTrailingZeros(mbps / (1000 * 1000))} Tbps`;
  if (mbps >= 1000) return `${trimTrailingZeros(mbps / 1000)} Gbps`;
  if (mbps < 1) return `${trimTrailingZeros(mbps * 1000)} Kbps`;
  return `${trimTrailingZeros(mbps)} Mbps`;
}

export function formatPortSpeedLabel(speed?: string | null): string | null {
  const mbps = parsePortSpeedMbps(speed);
  if (mbps == null) return null;
  return formatBandwidthMbps(mbps);
}

export function formatPortLabel(
  port: Pick<Port, "name" | "face"> | null | undefined,
  options: { includeFace?: boolean } = {},
): string {
  if (!port) return "Unknown port";
  if (!options.includeFace || !port.face) return port.name;
  return `${port.name} (${port.face})`;
}

export function formatPortEndpointLabel(
  port: Pick<Port, "name" | "face" | "speed">,
  device?: Pick<Device, "hostname"> | null,
  options: { includeSpeed?: boolean; includeFace?: boolean } = {},
): string {
  const label = [
    device?.hostname ?? "Unknown device",
    formatPortLabel(port, { includeFace: options.includeFace ?? true }),
    options.includeSpeed && port.speed ? port.speed : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return label;
}

export function normalizeColorToCss(color?: string | null): string | null {
  if (!color) return null;
  const value = color.trim();
  if (!value) return null;
  if (/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value)) {
    return value;
  }
  const preset = COLOR_PRESETS.find(
    (entry) => entry.value === value.toLowerCase(),
  );
  return preset?.hex ?? value;
}

// ---------- IP allocation ----------

// Returns the lowest unused IP that is:
//   - inside the subnet
//   - NOT the network or broadcast address
//   - NOT inside any DHCP scope range (skip dynamic pool by default)
//   - NOT already assigned
// Returns null if nothing available.
export function nextFreeStaticIp(
  subnetCidr: string,
  dhcpRanges: { startIp: string; endIp: string }[],
  reservedRanges: { startIp: string; endIp: string }[],
  assignedIps: string[],
  options: { skipDhcp?: boolean; skipReserved?: boolean } = {},
): string | null {
  const { skipDhcp = true, skipReserved = false } = options;
  const { network, broadcast } = cidrBounds(subnetCidr);

  const assigned = new Set(assignedIps.map(ipToInt));

  const blocked: Array<[number, number]> = [];
  if (skipDhcp) {
    for (const r of dhcpRanges)
      blocked.push([ipToInt(r.startIp), ipToInt(r.endIp)]);
  }
  if (skipReserved) {
    for (const r of reservedRanges)
      blocked.push([ipToInt(r.startIp), ipToInt(r.endIp)]);
  }

  for (let n = network + 1; n < broadcast; n++) {
    if (assigned.has(n)) continue;
    let blockedHit = false;
    for (const [s, e] of blocked) {
      if (n >= s && n <= e) {
        blockedHit = true;
        break;
      }
    }
    if (blockedHit) continue;
    return intToIp(n);
  }
  return null;
}

// Returns the lowest unused VLAN ID inside [startVlan, endVlan].
export function nextFreeVlanId(
  startVlan: number,
  endVlan: number,
  usedVlanIds: number[],
): number | null {
  const used = new Set(usedVlanIds);
  for (let v = startVlan; v <= endVlan; v++) {
    if (!used.has(v)) return v;
  }
  return null;
}

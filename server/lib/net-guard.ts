import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import net from "node:net";
import { ValidationError } from "./validation.js";

const DEFAULT_RESERVED_HOST_MESSAGE =
  "Target host must be a routable public/LAN host outside reserved ranges.";

export async function ensureRoutableHost(
  target: string | URL,
  message = DEFAULT_RESERVED_HOST_MESSAGE,
) {
  const host = normalizeLookupHost(
    typeof target === "string" ? target : target.hostname,
  );
  if (!host) {
    throw new ValidationError("Target host is required.");
  }

  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new ValidationError("Target host could not be resolved.");
  }

  if (
    addresses.length === 0 ||
    addresses.some((entry) => isReservedAddress(entry.address))
  ) {
    throw new ValidationError(message);
  }

  return host;
}

function normalizeLookupHost(host: string) {
  const trimmed = host.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isReservedAddress(address: string) {
  const normalized = normalizeLookupHost(address);
  if (net.isIP(normalized) === 4) {
    return isReservedIpv4(normalized);
  }

  const bytes = parseIpv6Bytes(normalized);
  if (!bytes) return true;

  const mappedIpv4 = mappedIpv4FromIpv6(bytes);
  if (mappedIpv4) {
    return isReservedIpv4(mappedIpv4);
  }

  return (
    bytes.every((byte, index) => byte === (index === 15 ? 1 : 0)) ||
    (bytes[0] & 0xfe) === 0xfc ||
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80)
  );
}

function isReservedIpv4(address: string) {
  const [a, b, c, d] = address.split(".").map((part) => Number(part));
  return (
    (a === 0 && b === 0 && c === 0 && d === 0) ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function mappedIpv4FromIpv6(bytes: number[]) {
  if (
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return bytes.slice(12).join(".");
  }
  return null;
}

function parseIpv6Bytes(address: string) {
  let normalized = address.toLowerCase();
  const zoneIndex = normalized.indexOf("%");
  if (zoneIndex >= 0) normalized = normalized.slice(0, zoneIndex);

  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = normalized.slice(lastColon + 1);
    if (net.isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map((part) => Number(part));
    normalized = `${normalized.slice(0, lastColon)}:${(
      (octets[0] << 8) |
      octets[1]
    ).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const sides = normalized.split("::");
  if (sides.length > 2) return null;

  const head = parseIpv6Hextets(sides[0]);
  const tail = sides.length === 2 ? parseIpv6Hextets(sides[1]) : [];
  if (!head || !tail) return null;

  const missing = 8 - head.length - tail.length;
  if (sides.length === 1 && missing !== 0) return null;
  if (sides.length === 2 && missing < 1) return null;

  const hextets = [...head, ...Array(missing).fill(0), ...tail];
  if (hextets.length !== 8) return null;

  const bytes: number[] = [];
  for (const hextet of hextets) {
    bytes.push((hextet >> 8) & 0xff, hextet & 0xff);
  }
  return bytes;
}

function parseIpv6Hextets(input: string) {
  if (!input) return [];
  const parts = input.split(":");
  const hextets: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    hextets.push(Number.parseInt(part, 16));
  }
  return hextets;
}

import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { ValidationError } from "./validation.js";

const DEFAULT_RESERVED_HOST_MESSAGE =
  "Target host must be a routable public/LAN host outside reserved ranges.";
type HostLookup = (host: string) => Promise<LookupAddress[]>;
let hostLookup: HostLookup = (host) => dns.lookup(host, { all: true });
type PinnedRequestResult = { statusCode: number; location?: string };
type PinnedRequestTransport = (
  input: URL,
  resolved: LookupAddress,
  options: {
    timeoutMs: number;
    headers: Record<string, string>;
    method: "GET" | "POST";
    body?: string;
  },
) => Promise<PinnedRequestResult>;
let pinnedRequestTransport: PinnedRequestTransport = performPinnedRequest;

export function setNetworkHostLookupForTests(lookup: HostLookup | null) {
  hostLookup = lookup ?? ((host) => dns.lookup(host, { all: true }));
}

export function setPinnedRequestTransportForTests(
  transport: PinnedRequestTransport | null,
) {
  pinnedRequestTransport = transport ?? performPinnedRequest;
}

export async function ensureRoutableHost(
  target: string | URL,
  message = DEFAULT_RESERVED_HOST_MESSAGE,
) {
  return (await resolveRoutableHost(target, message)).host;
}

export async function resolveRoutableHost(
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
    addresses = await hostLookup(host);
  } catch {
    throw new ValidationError("Target host could not be resolved.");
  }

  if (
    addresses.length === 0 ||
    addresses.some((entry) => isBlockedNetworkAddress(entry.address))
  ) {
    throw new ValidationError(message);
  }

  return { host, ...addresses[0]! };
}

function normalizeLookupHost(host: string) {
  const trimmed = host.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function isBlockedNetworkAddress(address: string) {
  const normalized = normalizeLookupHost(address);
  if (net.isIP(normalized) === 4) {
    return isBlockedIpv4(normalized);
  }

  const bytes = parseIpv6Bytes(normalized);
  if (!bytes) return true;

  const mappedIpv4 = mappedIpv4FromIpv6(bytes);
  if (mappedIpv4) {
    return isBlockedIpv4(mappedIpv4);
  }

  return (
    bytes.every((byte) => byte === 0) ||
    bytes.every((byte, index) => byte === (index === 15 ? 1 : 0)) ||
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
    bytes[0] === 0xff ||
    (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) ||
    bytes.slice(0, 12).every((byte) => byte === 0)
  );
}

function isBlockedIpv4(address: string) {
  const [a, b, c, d] = address.split(".").map((part) => Number(part));
  return (
    a === 0 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

export async function requestPinnedUrl(
  input: URL,
  options: {
    timeoutMs?: number;
    maxRedirects?: number;
    headers?: Record<string, string>;
    method?: "GET" | "POST";
    body?: string;
  } = {},
): Promise<{ statusCode: number; url: URL }> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxRedirects = options.maxRedirects ?? 3;
  if (input.protocol !== "http:" && input.protocol !== "https:") {
    throw new ValidationError("Target URL must use HTTP or HTTPS.");
  }
  if (input.username || input.password) {
    throw new ValidationError("Target URL must not contain credentials.");
  }

  const resolved = await resolveRoutableHost(input);
  const status = await pinnedRequestTransport(input, resolved, {
    timeoutMs,
    headers: options.headers ?? {},
    method: options.method ?? "GET",
    body: options.body,
  });

  if (
    status.statusCode >= 300 &&
    status.statusCode < 400 &&
    status.location
  ) {
    if (maxRedirects <= 0) {
      throw new ValidationError("Target returned too many redirects.");
    }
    const preserveMethod = status.statusCode === 307 || status.statusCode === 308;
    return requestPinnedUrl(new URL(status.location, input), {
      ...options,
      maxRedirects: maxRedirects - 1,
      method: preserveMethod ? options.method : "GET",
      body: preserveMethod ? options.body : undefined,
    });
  }
  return { statusCode: status.statusCode, url: input };
}

export function buildPinnedRequestOptions(
  input: URL,
  resolved: LookupAddress,
  headers: Record<string, string> = {},
  method: "GET" | "POST" = "GET",
): http.RequestOptions & https.RequestOptions {
  const requestOptions: http.RequestOptions & https.RequestOptions = {
    protocol: input.protocol,
    hostname: resolved.address,
    family: resolved.family,
    port: input.port
      ? Number.parseInt(input.port, 10)
      : input.protocol === "https:"
        ? 443
        : 80,
    method,
    path: `${input.pathname}${input.search}`,
    headers: { ...headers, Host: input.host },
  };
  if (input.protocol === "https:" && net.isIP(input.hostname) === 0) {
    requestOptions.servername = input.hostname;
  }
  return requestOptions;
}

function performPinnedRequest(
  input: URL,
  resolved: LookupAddress,
  options: {
    timeoutMs: number;
    headers: Record<string, string>;
    method: "GET" | "POST";
    body?: string;
  },
) {
  return new Promise<PinnedRequestResult>((resolve, reject) => {
    const requestOptions = buildPinnedRequestOptions(
      input,
      resolved,
      options.headers,
      options.method,
    );
    const request = input.protocol === "https:"
      ? https.request(requestOptions)
      : http.request(requestOptions);
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error("Request timed out."));
    });
    request.on("error", reject);
    request.on("response", (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;
      response.resume();
      response.on("end", () => resolve({ statusCode, location }));
    });
    request.end(options.body);
  });
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

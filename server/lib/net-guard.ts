import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
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
    rejectUnauthorized: boolean;
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
  if (!ipaddr.isValid(normalized)) return true;

  const parsed = ipaddr.parse(normalized);
  const ipv6 = parsed.kind() === "ipv6" ? (parsed as ipaddr.IPv6) : null;
  if (ipv6?.isIPv4MappedAddress()) {
    return isBlockedNetworkAddress(ipv6.toIPv4Address().toString());
  }

  const range = parsed.range();
  return parsed.kind() === "ipv4"
    ? range !== "unicast" && range !== "private"
    : range !== "unicast" && range !== "uniqueLocal";
}

export async function requestPinnedUrl(
  input: URL,
  options: {
    timeoutMs?: number;
    maxRedirects?: number;
    headers?: Record<string, string>;
    method?: "GET" | "POST";
    body?: string;
    rejectUnauthorized?: boolean;
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
    rejectUnauthorized: options.rejectUnauthorized ?? true,
  });

  if (status.statusCode >= 300 && status.statusCode < 400 && status.location) {
    if (maxRedirects <= 0) {
      throw new ValidationError("Target returned too many redirects.");
    }
    const preserveMethod =
      status.statusCode === 307 || status.statusCode === 308;
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
  rejectUnauthorized = true,
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
  if (input.protocol === "https:") {
    requestOptions.rejectUnauthorized = rejectUnauthorized;
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
    rejectUnauthorized: boolean;
  },
) {
  return new Promise<PinnedRequestResult>((resolve, reject) => {
    const requestOptions = buildPinnedRequestOptions(
      input,
      resolved,
      options.headers,
      options.method,
      options.rejectUnauthorized,
    );
    const request =
      input.protocol === "https:"
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

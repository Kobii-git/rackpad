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
type PinnedResponseHeaders = Record<
  string,
  string | string[] | undefined
>;
type PinnedRequestResult = {
  statusCode: number;
  location?: string;
  headers?: PinnedResponseHeaders;
  bodyText?: string;
};
type PinnedRequestTransport = (
  input: URL,
  resolved: LookupAddress,
  options: {
    timeoutMs: number;
    headers: Record<string, string>;
    method: "GET" | "POST";
    body?: string;
    rejectUnauthorized: boolean;
    captureBody?: boolean;
    maxResponseBytes?: number;
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
    reservedHostMessage?: string;
    sameOriginRedirects?: boolean;
  } = {},
): Promise<{ statusCode: number; url: URL }> {
  const response = await requestPinnedUrlResponse(input, options);
  return { statusCode: response.statusCode, url: response.url };
}

export async function requestPinnedUrlWithBody(
  input: URL,
  options: {
    timeoutMs?: number;
    maxRedirects?: number;
    maxResponseBytes?: number;
    headers?: Record<string, string>;
    method?: "GET" | "POST";
    body?: string;
    rejectUnauthorized?: boolean;
    reservedHostMessage?: string;
    sameOriginRedirects?: boolean;
  } = {},
): Promise<{
  statusCode: number;
  url: URL;
  headers: PinnedResponseHeaders;
  bodyText: string;
}> {
  return requestPinnedUrlResponse(input, {
    ...options,
    captureBody: true,
  });
}

async function requestPinnedUrlResponse(
  input: URL,
  options: {
    timeoutMs?: number;
    maxRedirects?: number;
    maxResponseBytes?: number;
    headers?: Record<string, string>;
    method?: "GET" | "POST";
    body?: string;
    rejectUnauthorized?: boolean;
    reservedHostMessage?: string;
    sameOriginRedirects?: boolean;
    captureBody?: boolean;
  },
): Promise<{
  statusCode: number;
  url: URL;
  headers: PinnedResponseHeaders;
  bodyText: string;
}> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxRedirects = options.maxRedirects ?? 3;
  if (input.protocol !== "http:" && input.protocol !== "https:") {
    throw new ValidationError("Target URL must use HTTP or HTTPS.");
  }
  if (input.username || input.password) {
    throw new ValidationError("Target URL must not contain credentials.");
  }

  const resolved = await resolveRoutableHost(
    input,
    options.reservedHostMessage,
  );
  const status = await pinnedRequestTransport(input, resolved, {
    timeoutMs,
    headers: options.headers ?? {},
    method: options.method ?? "GET",
    body: options.body,
    rejectUnauthorized: options.rejectUnauthorized ?? true,
    captureBody: options.captureBody,
    maxResponseBytes: options.maxResponseBytes,
  });

  if (status.statusCode >= 300 && status.statusCode < 400 && status.location) {
    if (maxRedirects <= 0) {
      throw new ValidationError("Target returned too many redirects.");
    }
    const redirectUrl = new URL(status.location, input);
    if (
      redirectUrl.origin !== input.origin &&
      (options.sameOriginRedirects || hasCredentialHeaders(options.headers))
    ) {
      throw new ValidationError(
        "Target redirected credentials to a different origin.",
      );
    }
    const preserveMethod =
      status.statusCode === 307 || status.statusCode === 308;
    return requestPinnedUrlResponse(redirectUrl, {
      ...options,
      maxRedirects: maxRedirects - 1,
      method: preserveMethod ? options.method : "GET",
      body: preserveMethod ? options.body : undefined,
    });
  }
  return {
    statusCode: status.statusCode,
    url: input,
    headers: status.headers ?? {},
    bodyText: status.bodyText ?? "",
  };
}

function hasCredentialHeaders(headers: Record<string, string> | undefined) {
  if (!headers) return false;
  const credentialHeaders = new Set([
    "authorization",
    "proxy-authorization",
    "cookie",
    "x-api-key",
    "x-auth-token",
  ]);
  return Object.keys(headers).some((header) =>
    credentialHeaders.has(header.toLowerCase()),
  );
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
    captureBody?: boolean;
    maxResponseBytes?: number;
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
      if (!options.captureBody) {
        response.resume();
        response.on("end", () =>
          resolve({ statusCode, location, headers: response.headers }),
        );
        return;
      }

      let settled = false;
      let bodyText = "";
      let bytes = 0;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > (options.maxResponseBytes ?? 8 * 1024 * 1024)) {
          const error = new Error("Response exceeded the allowed size.");
          fail(error);
          response.destroy(error);
          return;
        }
        bodyText += chunk;
      });
      response.on("aborted", () => fail(new Error("Response was aborted.")));
      response.on("error", fail);
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          statusCode,
          location,
          headers: response.headers,
          bodyText,
        });
      });
    });
    request.end(options.body);
  });
}

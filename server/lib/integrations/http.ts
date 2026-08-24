import { requestPinnedUrlWithBody } from "../net-guard.js";
import { ValidationError } from "../validation.js";

const INTEGRATION_RESERVED_MESSAGE =
  "Integration endpoint must resolve to a routable public or LAN address outside reserved ranges.";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface IntegrationHttpRequest {
  url: URL;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  verifyTls?: boolean;
}

export interface IntegrationHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
}

type IntegrationHttpTransport = (
  request: IntegrationHttpRequest,
) => Promise<IntegrationHttpResponse>;

let integrationHttpTransport: IntegrationHttpTransport =
  performIntegrationHttpRequest;

export function setIntegrationHttpTransportForTests(
  transport: IntegrationHttpTransport | null,
) {
  integrationHttpTransport = transport ?? performIntegrationHttpRequest;
}

export function buildIntegrationUrl(
  baseUrl: string,
  apiPath: string,
  query?: Record<string, string | number | boolean | undefined>,
) {
  if (!apiPath.startsWith("/")) {
    throw new ValidationError("Integration API path must start with '/'.");
  }
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}${apiPath}`;
  url.search = "";
  url.hash = "";
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function integrationHttpRequest(
  request: IntegrationHttpRequest,
  targetLabel: string,
): Promise<IntegrationHttpResponse> {
  if (request.url.protocol !== "http:" && request.url.protocol !== "https:") {
    throw new ValidationError("Integration endpoint must use http or https.");
  }
  if (request.url.username || request.url.password) {
    throw new ValidationError(
      "Integration endpoint must not contain credentials in the URL.",
    );
  }
  try {
    return await integrationHttpTransport(request);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    const message = error instanceof Error ? error.message : "Request failed.";
    throw new ValidationError(
      `Could not reach ${targetLabel}: ${message}`,
      502,
    );
  }
}

export function parseIntegrationJson(
  response: IntegrationHttpResponse,
  targetLabel: string,
): unknown {
  if (!response.bodyText.trim()) return null;
  try {
    return JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new ValidationError(
      `${targetLabel} returned a response that is not valid JSON.`,
      502,
    );
  }
}

export function expectStatusOk(
  response: IntegrationHttpResponse,
  targetLabel: string,
) {
  if (response.status < 200 || response.status >= 300) {
    throw new ValidationError(
      `${targetLabel} returned HTTP ${response.status}.`,
      502,
    );
  }
  return response;
}

async function performIntegrationHttpRequest(
  request: IntegrationHttpRequest,
): Promise<IntegrationHttpResponse> {
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const response = await requestPinnedUrlWithBody(request.url, {
    timeoutMs,
    maxRedirects: 3,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    method: request.method ?? "GET",
    body: request.body,
    headers: {
      Accept: "application/json",
      ...request.headers,
    },
    rejectUnauthorized: request.verifyTls !== false,
    reservedHostMessage: INTEGRATION_RESERVED_MESSAGE,
    sameOriginRedirects: true,
  });
  return {
    status: response.statusCode,
    headers: response.headers,
    bodyText: response.bodyText,
  };
}

import { ValidationError } from "../validation.js";
import type { IntegrationConnectionOptions } from "./options.js";
import type { IntegrationProvider } from "./types.js";

interface ConnectionTransport {
  baseUrl: string;
  verifyTls: boolean;
  options?: IntegrationConnectionOptions;
}

export function assertSavedSecretCanBeReused(
  provider: IntegrationProvider,
  current: ConnectionTransport,
  next: ConnectionTransport,
) {
  if (
    (current.baseUrl !== next.baseUrl &&
      normalizeIntegrationBaseUrl(current.baseUrl, provider) !==
        normalizeIntegrationBaseUrl(next.baseUrl, provider)) ||
    (current.verifyTls && !next.verifyTls) ||
    (!current.options?.allowUnencrypted && next.options?.allowUnencrypted)
  ) {
    throw new ValidationError(
      "Enter the integration credential again to change the connection URL or reduce transport security.",
      400,
      "INTEGRATION_CREDENTIAL_REQUIRED",
    );
  }
}

export function normalizeIntegrationBaseUrl(value: string, provider?: IntegrationProvider) {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError(
      "Connection URL must be a valid http(s) URL, for example https://192.168.1.2:8443.",
    );
  }
  if (provider === "nut") {
    if (url.protocol !== "nut:" || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) throw new ValidationError("NUT URL must use nut://host:port without credentials, query or path.");
    url.hostname = url.hostname.toLowerCase();
    if (!url.port) url.port="3493";
    url.pathname="";
    return url.toString();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Connection URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new ValidationError("Connection URL must not contain credentials.");
  }
  url.search = "";
  url.hash = "";
  let normalized = url.toString();
  while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}

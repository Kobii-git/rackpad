import { ValidationError } from "../validation.js";
import type { IntegrationProvider } from "./types.js";
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

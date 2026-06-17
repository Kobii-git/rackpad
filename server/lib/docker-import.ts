import http from "node:http";
import https from "node:https";
import net from "node:net";
import { ValidationError } from "./validation.js";
import { db } from "../db.js";
import { createId } from "./ids.js";
import { ensureRoutableHost, resolveRoutableHost } from "./net-guard.js";
import {
  canEncryptSecrets,
  decryptSecret,
  encryptSecret,
} from "./secret-crypto.js";

export interface DockerContainerPreview {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export interface DockerImportSource {
  id: string;
  labId: string;
  name: string;
  endpoint: string;
  hasToken: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DockerImportSourceRow extends DockerImportSource {
  tokenEnc?: string | null;
}

const DOCKER_ENDPOINT_RESERVED_MESSAGE =
  "Docker endpoint must be a routable public/LAN host outside reserved ranges.";
const DOCKER_UNIX_PROTOCOL = "unix:";
const DOCKER_SOCKET_PREFIX = "unix://";
const DOCKER_HTTP_TIMEOUT_MS = 10_000;

export interface DockerContainerLink {
  deviceId: string;
  sourceId: string;
  containerId: string;
  containerName: string;
  image: string;
  state: string;
  status: string;
  lastSyncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DockerStatusSyncResult {
  sources: number;
  updated: number;
  missing: number;
  failed: number;
  devices: Array<Record<string, unknown>>;
  errors: string[];
}

type DockerHttpJsonFetcher = (
  url: URL,
  headers: Record<string, string>,
) => Promise<unknown>;

let dockerHttpJsonFetcher: DockerHttpJsonFetcher = fetchDockerHttpJson;

export function setDockerHttpJsonFetcherForTests(
  fetcher: DockerHttpJsonFetcher | null,
) {
  dockerHttpJsonFetcher = fetcher ?? fetchDockerHttpJson;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseDockerHttpEndpoint(endpoint: string) {
  const trimmed = trimTrailingSlashes(endpoint.trim());
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError(
      "Docker endpoint must be a valid http(s) URL or unix socket endpoint.",
    );
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ValidationError("Docker endpoint must use http or https.");
  }
  return url;
}

function trimTrailingSlashes(value: string) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

function trimLeadingSlashes(value: string) {
  let start = 0;
  while (start < value.length && value.charCodeAt(start) === 47) start += 1;
  return value.slice(start);
}

function normalizeDockerPath(pathname: string, label: string) {
  const parts = trimLeadingSlashes(pathname)
    .split("/")
    .filter((part) => part.length > 0);
  const normalized: string[] = [];
  for (const part of parts) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw new ValidationError(`${label} contains an invalid path segment.`);
    }
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("\0") ||
      decoded.includes("/")
    ) {
      throw new ValidationError(`${label} contains an invalid path segment.`);
    }
    normalized.push(part);
  }
  return normalized.length > 0 ? `/${normalized.join("/")}` : "";
}

function joinDockerApiPath(basePath: string, apiPath: string) {
  const base = normalizeDockerPath(basePath, "Docker endpoint path");
  const next = normalizeDockerPath(apiPath, "Docker API path");
  return `${base}${next}` || "/";
}

export function normalizeDockerSocketEndpoint(endpoint: string) {
  const trimmed = endpoint.trim();
  if (!trimmed.startsWith(DOCKER_SOCKET_PREFIX)) {
    throw new ValidationError(
      "Docker socket endpoint must use unix:///absolute/path.sock.",
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError(
      "Docker socket endpoint must use unix:///absolute/path.sock.",
    );
  }

  if (
    url.protocol !== DOCKER_UNIX_PROTOCOL ||
    url.host ||
    url.search ||
    url.hash
  ) {
    throw new ValidationError(
      "Docker socket endpoint must use unix:///absolute/path.sock.",
    );
  }

  const socketPath = decodeURIComponent(url.pathname);
  if (
    !socketPath.startsWith("/") ||
    socketPath.includes("\0") ||
    socketPath === "/"
  ) {
    throw new ValidationError(
      "Docker socket endpoint must use an absolute socket path.",
    );
  }

  return {
    endpoint: `${DOCKER_SOCKET_PREFIX}${socketPath}`,
    socketPath,
  };
}

function isDockerSocketEndpoint(endpoint: string) {
  return endpoint.trim().startsWith(DOCKER_SOCKET_PREFIX);
}

async function normalizeDockerEndpointForRequest(endpoint: string) {
  if (isDockerSocketEndpoint(endpoint)) {
    return {
      kind: "socket" as const,
      ...normalizeDockerSocketEndpoint(endpoint),
    };
  }

  const url = parseDockerHttpEndpoint(endpoint);
  await ensureRoutableHost(url, DOCKER_ENDPOINT_RESERVED_MESSAGE);
  return {
    kind: "http" as const,
    url,
  };
}

export async function normalizeDockerEndpoint(endpoint: string) {
  const url = parseDockerHttpEndpoint(endpoint);
  await ensureRoutableHost(url, DOCKER_ENDPOINT_RESERVED_MESSAGE);
  return url;
}

export async function normalizeDockerEndpointText(endpoint: string) {
  const normalized = await normalizeDockerEndpointForRequest(endpoint);
  if (normalized.kind === "socket") return normalized.endpoint;

  const url = normalized.url;
  url.hash = "";
  url.search = "";
  return trimTrailingSlashes(url.toString());
}

function normalizeDockerEndpointTextForStorage(endpoint: string) {
  if (isDockerSocketEndpoint(endpoint)) {
    return normalizeDockerSocketEndpoint(endpoint).endpoint;
  }

  const url = parseDockerHttpEndpoint(endpoint);
  url.hash = "";
  url.search = "";
  return trimTrailingSlashes(url.toString());
}

export async function buildDockerApiUrl(endpoint: string, apiPath: string) {
  const url = await normalizeDockerEndpoint(endpoint);
  url.pathname = joinDockerApiPath(url.pathname, apiPath);
  url.search = "";
  url.hash = "";
  return url;
}

export function parseDockerContainersJson(data: unknown): DockerContainerPreview[] {
  if (!Array.isArray(data)) {
    throw new ValidationError("Docker API response must be a JSON array.");
  }

  return data.map((entry, index) => {
    const row = asRecord(entry, `containers[${index}]`);
    const id = String(row.Id ?? row.ID ?? row.id ?? "").trim();
    const names = Array.isArray(row.Names) ? row.Names : [];
    const name =
      String(names[0] ?? row.Name ?? row.name ?? id)
        .replace(/^\//, "")
        .trim() || id;
    const image = String(row.Image ?? row.image ?? "unknown").trim() || "unknown";
    const state = String(row.State ?? row.state ?? "unknown").trim() || "unknown";
    const status = String(row.Status ?? row.status ?? state).trim() || state;

    if (!id) {
      throw new ValidationError(`containers[${index}] is missing an id.`);
    }

    return { id, name, image, state, status };
  });
}

function fetchDockerSocketJson(
  socketPath: string,
  path: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath,
        path,
        method: "GET",
        headers: { Accept: "application/json" },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new ValidationError(
                `Docker socket returned HTTP ${statusCode}.`,
              ),
            );
            return;
          }

          try {
            resolve(JSON.parse(body) as unknown);
          } catch {
            reject(new ValidationError("Docker socket returned invalid JSON."));
          }
        });
      },
    );

    request.setTimeout(10_000, () => {
      request.destroy(new Error("Request timed out."));
    });
    request.on("error", reject);
    request.end();
  });
}

function fetchDockerHttpJson(
  url: URL,
  headers: Record<string, string>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    resolveRoutableHost(url, DOCKER_ENDPOINT_RESERVED_MESSAGE)
      .then((resolved) => {
        const requestOptions: http.RequestOptions & https.RequestOptions = {
          protocol: url.protocol,
          hostname: resolved.address,
          family: resolved.family,
          port: url.port
            ? Number.parseInt(url.port, 10)
            : url.protocol === "https:"
              ? 443
              : 80,
          method: "GET",
          path: `${url.pathname}${url.search}`,
          headers: {
            ...headers,
            Host: url.host,
          },
          timeout: DOCKER_HTTP_TIMEOUT_MS,
        };
        if (url.protocol === "https:" && net.isIP(url.hostname) === 0) {
          requestOptions.servername = url.hostname;
        }

        const request =
          url.protocol === "https:"
            ? https.request(requestOptions)
            : http.request(requestOptions);
        request.setTimeout(DOCKER_HTTP_TIMEOUT_MS, () => {
          request.destroy(new Error("Request timed out."));
        });
        request.on("error", reject);
        request.on("response", (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => {
            const statusCode = response.statusCode ?? 0;
            if (statusCode < 200 || statusCode >= 300) {
              reject(
                new ValidationError(
                  `Docker endpoint returned HTTP ${statusCode}.`,
                ),
              );
              return;
            }
            try {
              resolve(JSON.parse(body) as unknown);
            } catch {
              reject(new ValidationError("Docker endpoint returned invalid JSON."));
            }
          });
        });
        request.end();
      })
      .catch(reject);
  });
}

export async function fetchDockerContainersPreview(
  endpoint: string,
  token?: string,
): Promise<DockerContainerPreview[]> {
  if (isDockerSocketEndpoint(endpoint)) {
    const { socketPath } = normalizeDockerSocketEndpoint(endpoint);
    let payload: unknown;
    try {
      payload = await fetchDockerSocketJson(socketPath, "/containers/json?all=1");
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      const message = error instanceof Error ? error.message : "Request failed.";
      throw new ValidationError(`Could not reach Docker socket: ${message}`);
    }
    return parseDockerContainersJson(payload);
  }

  const url = await buildDockerApiUrl(endpoint, "/containers/json");
  url.searchParams.set("all", "1");
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  let payload: unknown;
  try {
    payload = await dockerHttpJsonFetcher(url, headers);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    const message = error instanceof Error ? error.message : "Request failed.";
    throw new ValidationError(`Could not reach Docker endpoint: ${message}`);
  }
  return parseDockerContainersJson(payload);
}

export function buildDockerContainerNotes(
  container: DockerContainerPreview,
  endpoint: string,
) {
  return `docker-import | image: ${container.image} | status: ${container.status} | source: ${endpoint}`;
}

export function buildDockerContainerSpecs(container: DockerContainerPreview) {
  return `docker-image: ${container.image}`;
}

export function dockerStateToDeviceStatus(state: string) {
  const normalized = state.trim().toLowerCase();
  if (normalized === "running") return "online";
  if (!normalized || normalized === "unknown") return "unknown";
  return "offline";
}

function parseSource(row: Record<string, unknown>): DockerImportSource {
  return {
    id: String(row.id),
    labId: String(row.labId),
    name: String(row.name),
    endpoint: String(row.endpoint),
    hasToken: Boolean(row.tokenEnc),
    lastSyncAt: row.lastSyncAt ? String(row.lastSyncAt) : null,
    lastSyncStatus: row.lastSyncStatus ? String(row.lastSyncStatus) : null,
    lastSyncMessage: row.lastSyncMessage ? String(row.lastSyncMessage) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function sourceNameFromEndpoint(endpoint: string) {
  if (isDockerSocketEndpoint(endpoint)) {
    return `Docker socket ${normalizeDockerSocketEndpoint(endpoint).socketPath}`;
  }

  try {
    const url = new URL(endpoint);
    return url.pathname && url.pathname !== "/"
      ? trimTrailingSlashes(`${url.host}${url.pathname}`)
      : url.host;
  } catch {
    return endpoint;
  }
}

function encryptDockerToken(token: string | null | undefined) {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  if (!canEncryptSecrets()) {
    throw new ValidationError(
      "RACKPAD_SECRET_KEY must be set before storing Docker API tokens.",
    );
  }
  return encryptSecret(trimmed);
}

function decryptDockerToken(source: DockerImportSourceRow) {
  if (!source.tokenEnc) return undefined;
  return decryptSecret(source.tokenEnc);
}

function getDockerImportSourceRow(sourceId: string) {
  return db
    .prepare("SELECT * FROM dockerImportSources WHERE id = ?")
    .get(sourceId) as DockerImportSourceRow | undefined;
}

export function listDockerImportSources(labId: string) {
  const rows = db
    .prepare(
      "SELECT * FROM dockerImportSources WHERE labId = ? ORDER BY name, id",
    )
    .all(labId) as Array<Record<string, unknown>>;
  return rows.map(parseSource);
}

export function upsertDockerImportSource(input: {
  labId: string;
  endpoint: string;
  token?: string | null;
}) {
  const endpoint = normalizeDockerEndpointTextForStorage(input.endpoint);
  const tokenEnc = isDockerSocketEndpoint(endpoint)
    ? undefined
    : encryptDockerToken(input.token);
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT * FROM dockerImportSources WHERE labId = ? AND endpoint = ?")
    .get(input.labId, endpoint) as DockerImportSourceRow | undefined;

  if (existing) {
    db.prepare(
      `
      UPDATE dockerImportSources
      SET name = ?, tokenEnc = COALESCE(?, tokenEnc), updatedAt = ?
      WHERE id = ?
    `,
    ).run(sourceNameFromEndpoint(endpoint), tokenEnc ?? null, now, existing.id);
    return parseSource(
      db
        .prepare("SELECT * FROM dockerImportSources WHERE id = ?")
        .get(existing.id) as Record<string, unknown>,
    );
  }

  const id = createId("docksrc");
  db.prepare(
    `
    INSERT INTO dockerImportSources (
      id, labId, name, endpoint, tokenEnc,
      lastSyncAt, lastSyncStatus, lastSyncMessage, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
  `,
  ).run(
    id,
    input.labId,
    sourceNameFromEndpoint(endpoint),
    endpoint,
    tokenEnc ?? null,
    now,
    now,
  );

  return parseSource(
    db
      .prepare("SELECT * FROM dockerImportSources WHERE id = ?")
      .get(id) as Record<string, unknown>,
  );
}

export function linkDockerContainerDevice(input: {
  deviceId: string;
  sourceId: string;
  container: DockerContainerPreview;
  syncedAt?: string;
}) {
  const now = input.syncedAt ?? new Date().toISOString();
  db.prepare(
    `
    INSERT INTO dockerContainerLinks (
      deviceId, sourceId, containerId, containerName, image,
      state, status, lastSyncedAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(deviceId) DO UPDATE SET
      sourceId = excluded.sourceId,
      containerId = excluded.containerId,
      containerName = excluded.containerName,
      image = excluded.image,
      state = excluded.state,
      status = excluded.status,
      lastSyncedAt = excluded.lastSyncedAt,
      updatedAt = excluded.updatedAt
  `,
  ).run(
    input.deviceId,
    input.sourceId,
    input.container.id,
    input.container.name,
    input.container.image,
    input.container.state,
    input.container.status,
    now,
    now,
    now,
  );
}

function emptySyncResult(): DockerStatusSyncResult {
  return {
    sources: 0,
    updated: 0,
    missing: 0,
    failed: 0,
    devices: [],
    errors: [],
  };
}

function mergeSyncResult(
  target: DockerStatusSyncResult,
  source: DockerStatusSyncResult,
) {
  target.sources += source.sources;
  target.updated += source.updated;
  target.missing += source.missing;
  target.failed += source.failed;
  target.devices.push(...source.devices);
  target.errors.push(...source.errors);
  return target;
}

function updateSourceSyncStatus(
  sourceId: string,
  status: "ok" | "error",
  message: string,
  syncedAt: string,
) {
  db.prepare(
    `
    UPDATE dockerImportSources
    SET lastSyncAt = ?, lastSyncStatus = ?, lastSyncMessage = ?, updatedAt = ?
    WHERE id = ?
  `,
  ).run(syncedAt, status, message, syncedAt, sourceId);
}

function updateLinkedDeviceFromContainer(input: {
  deviceId: string;
  container: DockerContainerPreview;
  syncedAt: string;
}) {
  const deviceStatus = dockerStateToDeviceStatus(input.container.state);
  db.prepare(
    `
    UPDATE devices
    SET status = ?, lastSeen = CASE WHEN ? = 'online' THEN ? ELSE lastSeen END,
        specs = ?
    WHERE id = ?
  `,
  ).run(
    deviceStatus,
    deviceStatus,
    input.syncedAt,
    buildDockerContainerSpecs(input.container),
    input.deviceId,
  );
  db.prepare(
    `
    UPDATE dockerContainerLinks
    SET containerName = ?, image = ?, state = ?, status = ?,
        lastSyncedAt = ?, updatedAt = ?
    WHERE deviceId = ?
  `,
  ).run(
    input.container.name,
    input.container.image,
    input.container.state,
    input.container.status,
    input.syncedAt,
    input.syncedAt,
    input.deviceId,
  );
}

function updateMissingLinkedDevice(input: {
  deviceId: string;
  syncedAt: string;
}) {
  db.prepare("UPDATE devices SET status = 'offline' WHERE id = ?").run(
    input.deviceId,
  );
  db.prepare(
    `
    UPDATE dockerContainerLinks
    SET state = 'missing', status = 'not found',
        lastSyncedAt = ?, updatedAt = ?
    WHERE deviceId = ?
  `,
  ).run(input.syncedAt, input.syncedAt, input.deviceId);
}

export async function syncDockerImportSource(sourceId: string) {
  const result = emptySyncResult();
  const source = getDockerImportSourceRow(sourceId);
  if (!source) {
    result.failed = 1;
    result.errors.push("Docker import source not found.");
    return result;
  }

  result.sources = 1;
  const syncedAt = new Date().toISOString();
  const links = db
    .prepare(
      `
      SELECT dockerContainerLinks.*
      FROM dockerContainerLinks
      JOIN devices ON devices.id = dockerContainerLinks.deviceId
      WHERE dockerContainerLinks.sourceId = ?
      ORDER BY devices.hostname, dockerContainerLinks.containerId
    `,
    )
    .all(sourceId) as DockerContainerLink[];

  try {
    const containers = await fetchDockerContainersPreview(
      source.endpoint,
      decryptDockerToken(source),
    );
    const byId = new Map(containers.map((container) => [container.id, container]));

    for (const link of links) {
      const container = byId.get(link.containerId);
      if (!container) {
        updateMissingLinkedDevice({ deviceId: link.deviceId, syncedAt });
        result.missing += 1;
        continue;
      }
      updateLinkedDeviceFromContainer({
        deviceId: link.deviceId,
        container,
        syncedAt,
      });
      result.updated += 1;
    }

    updateSourceSyncStatus(
      sourceId,
      "ok",
      `Synced ${result.updated} container(s), ${result.missing} missing.`,
      syncedAt,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Docker status sync failed.";
    updateSourceSyncStatus(sourceId, "error", message, syncedAt);
    result.failed = 1;
    result.errors.push(message);
  }

  result.devices = db
    .prepare(
      `
      SELECT devices.*
      FROM devices
      JOIN dockerContainerLinks ON dockerContainerLinks.deviceId = devices.id
      WHERE dockerContainerLinks.sourceId = ?
      ORDER BY devices.hostname, devices.id
    `,
    )
    .all(sourceId) as Array<Record<string, unknown>>;

  return result;
}

export async function syncDockerImportSourcesForLab(labId: string) {
  const rows = db
    .prepare("SELECT id FROM dockerImportSources WHERE labId = ? ORDER BY name, id")
    .all(labId) as Array<{ id: string }>;
  const result = emptySyncResult();
  for (const row of rows) {
    mergeSyncResult(result, await syncDockerImportSource(row.id));
  }
  return result;
}

export async function syncDockerImportSources() {
  const rows = db
    .prepare("SELECT id FROM dockerImportSources ORDER BY labId, name, id")
    .all() as Array<{ id: string }>;
  const result = emptySyncResult();
  for (const row of rows) {
    mergeSyncResult(result, await syncDockerImportSource(row.id));
  }
  return result;
}

let dockerSyncHandle: NodeJS.Timeout | null = null;
let dockerSyncRunning = false;

export function startDockerStatusSyncLoop(intervalMs: number) {
  if (intervalMs <= 0) return () => {};
  if (dockerSyncHandle) clearInterval(dockerSyncHandle);

  dockerSyncHandle = setInterval(() => {
    if (dockerSyncRunning) return;
    dockerSyncRunning = true;
    void syncDockerImportSources()
      .catch((error) => {
        console.error(
          "[rackpad] Docker status sync failed:",
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        dockerSyncRunning = false;
      });
  }, intervalMs);
  dockerSyncHandle.unref?.();

  return () => {
    if (dockerSyncHandle) clearInterval(dockerSyncHandle);
    dockerSyncHandle = null;
  };
}

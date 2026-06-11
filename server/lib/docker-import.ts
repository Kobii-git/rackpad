import { ValidationError } from "./validation.js";
import { db } from "../db.js";
import { createId } from "./ids.js";
import { ensureRoutableHost } from "./net-guard.js";
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

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseDockerEndpoint(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError("Docker endpoint must be a valid http(s) URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ValidationError("Docker endpoint must use http or https.");
  }
  return url;
}

export async function normalizeDockerEndpoint(endpoint: string) {
  const url = parseDockerEndpoint(endpoint);
  await ensureRoutableHost(url, DOCKER_ENDPOINT_RESERVED_MESSAGE);
  return url;
}

export async function normalizeDockerEndpointText(endpoint: string) {
  const url = await normalizeDockerEndpoint(endpoint);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

function normalizeDockerEndpointTextForStorage(endpoint: string) {
  const url = parseDockerEndpoint(endpoint);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

export async function buildDockerApiUrl(endpoint: string, apiPath: string) {
  const url = await normalizeDockerEndpoint(endpoint);
  const basePath = url.pathname.replace(/\/+$/, "");
  const nextPath = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  url.pathname = `${basePath}${nextPath}`.replace(/\/{2,}/g, "/");
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

export async function fetchDockerContainersPreview(
  endpoint: string,
  token?: string,
): Promise<DockerContainerPreview[]> {
  const url = await buildDockerApiUrl(endpoint, "/containers/json");
  url.searchParams.set("all", "1");
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    throw new ValidationError(`Could not reach Docker endpoint: ${message}`);
  }

  if (!response.ok) {
    throw new ValidationError(
      `Docker endpoint returned HTTP ${response.status}.`,
    );
  }

  const payload = (await response.json()) as unknown;
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
  try {
    const url = new URL(endpoint);
    return url.pathname && url.pathname !== "/"
      ? `${url.host}${url.pathname}`.replace(/\/+$/, "")
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
  const tokenEnc = encryptDockerToken(input.token);
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

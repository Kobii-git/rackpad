import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "rackpad-docker-tls-tests-"));
process.env.DATABASE_PATH = path.join(tempDir, "rackpad-docker-tls-test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "rackpad-docker-tls-test-secret";

const { createApp } = await import("../app.js");
const { db } = await import("../db.js");
const { setBootstrapState } = await import("../lib/auth.js");
const { setDockerHttpJsonFetcherForTests } = await import(
  "../lib/docker-import.js"
);
const {
  setNetworkHostLookupForTests,
  setPinnedRequestTransportForTests,
} = await import("../lib/net-guard.js");

type AppInstance = Awaited<ReturnType<typeof createApp>>;

const DOCKER_ENDPOINT = "https://8.8.8.8:2376";
const SAMPLE_RESPONSE = [
  {
    Id: "abc123def456",
    Names: ["/web-01"],
    Image: "nginx:1.25",
    State: "running",
    Status: "Up 2 hours",
  },
];

let app: AppInstance;
let seenVerifyTls: Array<boolean | undefined> = [];

beforeEach(async () => {
  resetDatabase();
  seenVerifyTls = [];
  setDockerHttpJsonFetcherForTests(async (_url, _headers, options) => {
    seenVerifyTls.push(options?.verifyTls);
    return SAMPLE_RESPONSE;
  });
  app = await createApp();
});

afterEach(async () => {
  setDockerHttpJsonFetcherForTests(null);
  setPinnedRequestTransportForTests(null);
  setNetworkHostLookupForTests(null);
  await app.close();
});

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("docker preview and import honor and persist the TLS verification option", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);

  const previewDefault = await app.inject({
    method: "POST",
    url: "/api/imports/docker/preview",
    headers: authHeaders(token),
    payload: { labId, endpoint: DOCKER_ENDPOINT },
  });
  assert.equal(previewDefault.statusCode, 200, previewDefault.body);
  assert.deepEqual(seenVerifyTls, [true]);

  const previewSkip = await app.inject({
    method: "POST",
    url: "/api/imports/docker/preview",
    headers: authHeaders(token),
    payload: { labId, endpoint: DOCKER_ENDPOINT, verifyTls: false },
  });
  assert.equal(previewSkip.statusCode, 200, previewSkip.body);
  assert.deepEqual(seenVerifyTls, [true, false]);

  const hostResponse = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: authHeaders(token),
    payload: {
      labId,
      hostname: "docker-host-01",
      deviceType: "server",
      status: "online",
      placement: "room",
    },
  });
  assert.equal(hostResponse.statusCode, 201, hostResponse.body);
  const hostId = (json(hostResponse) as { id: string }).id;

  const importResponse = await app.inject({
    method: "POST",
    url: "/api/imports/docker/import",
    headers: authHeaders(token),
    payload: {
      labId,
      endpoint: DOCKER_ENDPOINT,
      containerId: "abc123def456",
      hostDeviceId: hostId,
      verifyTls: false,
    },
  });
  assert.equal(importResponse.statusCode, 201, importResponse.body);

  const sources = await listSources(token, labId);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].verifyTls, false);

  // Background status sync must reuse the source's stored preference.
  seenVerifyTls = [];
  const syncResponse = await app.inject({
    method: "POST",
    url: "/api/imports/docker/sync",
    headers: authHeaders(token),
    payload: { labId, sourceId: sources[0].id },
  });
  assert.equal(syncResponse.statusCode, 200, syncResponse.body);
  assert.deepEqual(seenVerifyTls, [false]);
});

test("docker source patch updates TLS verification independently of enabled", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);
  const hostResponse = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: authHeaders(token),
    payload: {
      labId,
      hostname: "docker-host-02",
      deviceType: "server",
      status: "online",
      placement: "room",
    },
  });
  const hostId = (json(hostResponse) as { id: string }).id;
  await app.inject({
    method: "POST",
    url: "/api/imports/docker/import",
    headers: authHeaders(token),
    payload: {
      labId,
      endpoint: DOCKER_ENDPOINT,
      containerId: "abc123def456",
      hostDeviceId: hostId,
    },
  });

  let [source] = await listSources(token, labId);
  assert.equal(source.verifyTls, true);

  const patchTls = await app.inject({
    method: "PATCH",
    url: `/api/imports/docker/sources/${source.id}`,
    headers: authHeaders(token),
    payload: { verifyTls: false },
  });
  assert.equal(patchTls.statusCode, 200, patchTls.body);
  [source] = await listSources(token, labId);
  assert.equal(source.verifyTls, false);
  assert.equal(source.enabled, true);

  const patchEnabled = await app.inject({
    method: "PATCH",
    url: `/api/imports/docker/sources/${source.id}`,
    headers: authHeaders(token),
    payload: { enabled: false },
  });
  assert.equal(patchEnabled.statusCode, 200, patchEnabled.body);
  [source] = await listSources(token, labId);
  assert.equal(source.enabled, false);
  assert.equal(source.verifyTls, false);

  const patchEmpty = await app.inject({
    method: "PATCH",
    url: `/api/imports/docker/sources/${source.id}`,
    headers: authHeaders(token),
    payload: {},
  });
  assert.equal(patchEmpty.statusCode, 400);
});

test("docker HTTP preview uses the shared pinned request guard and bounds", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);
  setDockerHttpJsonFetcherForTests(null);
  setNetworkHostLookupForTests(async () => [
    { address: "10.20.30.40", family: 4 },
  ]);
  let seenOptions:
    | {
        timeoutMs: number;
        rejectUnauthorized: boolean;
        captureBody?: boolean;
        maxResponseBytes?: number;
      }
    | undefined;
  setPinnedRequestTransportForTests(async (_url, _resolved, options) => {
    seenOptions = options;
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      bodyText: JSON.stringify(SAMPLE_RESPONSE),
    };
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/imports/docker/preview",
    headers: authHeaders(token),
    payload: { labId, endpoint: DOCKER_ENDPOINT },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(seenOptions?.timeoutMs, 10_000);
  assert.equal(seenOptions?.rejectUnauthorized, true);
  assert.equal(seenOptions?.captureBody, true);
  assert.equal(seenOptions?.maxResponseBytes, 8 * 1024 * 1024);
});

function resetDatabase() {
  db.exec(`
    DELETE FROM userSessions;
    DELETE FROM oidcIdentities;
    DELETE FROM userLabAccess;
    DELETE FROM dockerContainerLinks;
    DELETE FROM dockerImportSources;
    DELETE FROM auditLog;
    DELETE FROM devices;
    DELETE FROM users;
    DELETE FROM labs;
  `);
  setBootstrapState(null);
}

async function bootstrapAdmin() {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      displayName: "Docker TLS Admin",
      password: "super-secret-1",
    },
  });
  assert.equal(response.statusCode, 201);
  return (json(response) as { token: string }).token;
}

async function firstLabId(token: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/labs",
    headers: authHeaders(token),
  });
  assert.equal(response.statusCode, 200);
  return (json(response) as Array<{ id: string }>)[0].id;
}

async function listSources(token: string, labId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/imports/docker/sources?labId=${labId}`,
    headers: authHeaders(token),
  });
  assert.equal(response.statusCode, 200);
  return json(response) as Array<{
    id: string;
    enabled: boolean;
    verifyTls: boolean;
  }>;
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function json(response: { body: string }) {
  return JSON.parse(response.body);
}

import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = mkdtempSync(
  path.join(os.tmpdir(), "rackpad-integrations-tests-"),
);
process.env.DATABASE_PATH = path.join(tempDir, "rackpad-integrations-test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "rackpad-integrations-test-secret";

const { createApp } = await import("../app.js");
const { db } = await import("../db.js");
const { setBootstrapState } = await import("../lib/auth.js");
const { loadIntegrationConnectionSecrets, normalizeIntegrationBaseUrl } =
  await import("../lib/integrations/connections.js");

type AppInstance = Awaited<ReturnType<typeof createApp>>;

interface ConnectionPublic {
  id: string;
  labId: string;
  provider: string;
  name: string;
  baseUrl: string;
  authKind: string;
  authId: string | null;
  hasSecret: boolean;
  siteRef: string | null;
  verifyTls: boolean;
  enabled: boolean;
  syncVlans: boolean;
  syncSubnets: boolean;
  syncDhcp: boolean;
  lastStatus: string;
}

let app: AppInstance;

beforeEach(async () => {
  resetDatabase();
  app = await createApp();
});

afterEach(async () => {
  await app.close();
});

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("integration providers are listed with their auth kinds", async () => {
  const token = await bootstrapAdmin();
  const response = await app.inject({
    method: "GET",
    url: "/api/integrations/providers",
    headers: authHeaders(token),
  });
  assert.equal(response.statusCode, 200);
  const providers = json(response) as Array<{
    id: string;
    authKinds: string[];
  }>;
  assert.deepEqual(
    providers.map((entry) => entry.id),
    ["proxmox", "unifi", "omada", "opnsense"],
  );
  assert.deepEqual(
    providers.find((entry) => entry.id === "unifi")?.authKinds,
    ["api-key", "username-password"],
  );
});

test("integration connections round-trip without exposing secrets", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);

  const created = await createConnection(token, {
    labId,
    provider: "proxmox",
    name: "PVE cluster",
    baseUrl: "https://pve.lab.internal:8006/",
    authKind: "api-token",
    authId: "rackpad@pam!inventory",
    authSecret: "super-secret-token-uuid",
  });
  assert.equal(created.baseUrl, "https://pve.lab.internal:8006");
  assert.equal(created.hasSecret, true);
  assert.equal(created.lastStatus, "unknown");
  assert.ok(!("authSecret" in created));
  assert.ok(!("authSecretEnc" in created));

  const listed = await listConnections(token, labId);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].authId, "rackpad@pam!inventory");

  const secrets = loadIntegrationConnectionSecrets(created.id, labId);
  assert.equal(secrets.authSecret, "super-secret-token-uuid");

  const storedRow = db
    .prepare("SELECT authSecretEnc FROM integrationConnections WHERE id = ?")
    .get(created.id) as { authSecretEnc: string };
  assert.ok(storedRow.authSecretEnc.startsWith("enc:v1:"));
  assert.ok(!storedRow.authSecretEnc.includes("super-secret-token-uuid"));
});

test("integration connection updates keep the stored secret unless replaced or cleared", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);
  const created = await createConnection(token, {
    labId,
    provider: "opnsense",
    name: "Edge firewall",
    baseUrl: "https://fw.lab.internal",
    authKind: "key-secret",
    authId: "api-key-value",
    authSecret: "api-secret-value",
  });

  const renamed = await patchConnection(token, created.id, {
    name: "Edge firewall (primary)",
    verifyTls: false,
  });
  assert.equal(renamed.name, "Edge firewall (primary)");
  assert.equal(renamed.verifyTls, false);
  assert.equal(renamed.hasSecret, true);
  assert.equal(
    loadIntegrationConnectionSecrets(created.id).authSecret,
    "api-secret-value",
  );

  const replaced = await patchConnection(token, created.id, {
    authSecret: "rotated-secret",
  });
  assert.equal(replaced.hasSecret, true);
  assert.equal(
    loadIntegrationConnectionSecrets(created.id).authSecret,
    "rotated-secret",
  );

  const cleared = await patchConnection(token, created.id, {
    clearSecret: true,
  });
  assert.equal(cleared.hasSecret, false);
  assert.equal(loadIntegrationConnectionSecrets(created.id).authSecret, null);
});

test("integration connections validate provider, auth kind, and URL shape", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);

  const badProvider = await app.inject({
    method: "POST",
    url: "/api/integrations/connections",
    headers: authHeaders(token),
    payload: {
      labId,
      provider: "vmware",
      name: "Bad provider",
      baseUrl: "https://example.lab",
      authSecret: "secret",
    },
  });
  assert.equal(badProvider.statusCode, 400);

  const badAuthKind = await app.inject({
    method: "POST",
    url: "/api/integrations/connections",
    headers: authHeaders(token),
    payload: {
      labId,
      provider: "proxmox",
      name: "Bad auth kind",
      baseUrl: "https://pve.lab.internal:8006",
      authKind: "client-credentials",
      authId: "rackpad@pam!inventory",
      authSecret: "secret",
    },
  });
  assert.equal(badAuthKind.statusCode, 400);

  const badUrl = await app.inject({
    method: "POST",
    url: "/api/integrations/connections",
    headers: authHeaders(token),
    payload: {
      labId,
      provider: "unifi",
      name: "Bad URL",
      baseUrl: "ftp://unifi.lab.internal",
      authSecret: "secret",
    },
  });
  assert.equal(badUrl.statusCode, 400);

  const missingAuthId = await app.inject({
    method: "POST",
    url: "/api/integrations/connections",
    headers: authHeaders(token),
    payload: {
      labId,
      provider: "omada",
      name: "Missing client id",
      baseUrl: "https://omada.lab.internal:8043",
      authSecret: "client-secret",
    },
  });
  assert.equal(missingAuthId.statusCode, 400);

  const unifiApiKey = await app.inject({
    method: "POST",
    url: "/api/integrations/connections",
    headers: authHeaders(token),
    payload: {
      labId,
      provider: "unifi",
      name: "UniFi console",
      baseUrl: "https://unifi.lab.internal",
      authKind: "api-key",
      authSecret: "unifi-api-key",
    },
  });
  assert.equal(unifiApiKey.statusCode, 201, unifiApiKey.body);
});

test("integration connection writes require lab write access", async () => {
  const adminToken = await bootstrapAdmin();
  const labId = await firstLabId(adminToken);
  const viewerToken = await createUserAndLogin(adminToken, {
    username: "integration-viewer",
    displayName: "Integration Viewer",
    password: "integration-viewer-1",
    role: "viewer",
  });

  const forbidden = await app.inject({
    method: "POST",
    url: "/api/integrations/connections",
    headers: authHeaders(viewerToken),
    payload: {
      labId,
      provider: "omada",
      name: "Viewer attempt",
      baseUrl: "https://omada.lab.internal:8043",
      authId: "client-id",
      authSecret: "client-secret",
    },
  });
  assert.equal(forbidden.statusCode, 403);

  const created = await createConnection(adminToken, {
    labId,
    provider: "omada",
    name: "Omada controller",
    baseUrl: "https://omada.lab.internal:8043",
    authKind: "client-credentials",
    authId: "client-id",
    authSecret: "client-secret",
  });

  const viewerList = await listConnections(viewerToken, labId);
  assert.equal(viewerList.length, 1);

  const viewerPatch = await app.inject({
    method: "PATCH",
    url: `/api/integrations/connections/${created.id}`,
    headers: authHeaders(viewerToken),
    payload: { name: "Viewer rename" },
  });
  assert.equal(viewerPatch.statusCode, 403);

  const viewerDelete = await app.inject({
    method: "DELETE",
    url: `/api/integrations/connections/${created.id}`,
    headers: authHeaders(viewerToken),
  });
  assert.equal(viewerDelete.statusCode, 403);

  const adminDelete = await app.inject({
    method: "DELETE",
    url: `/api/integrations/connections/${created.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(adminDelete.statusCode, 204);
});

test("storing integration credentials requires RACKPAD_SECRET_KEY", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);
  const savedKey = process.env.RACKPAD_SECRET_KEY;
  delete process.env.RACKPAD_SECRET_KEY;

  try {
    const blocked = await app.inject({
      method: "POST",
      url: "/api/integrations/connections",
      headers: authHeaders(token),
      payload: {
        labId,
        provider: "unifi",
        name: "No secret key",
        baseUrl: "https://unifi.lab.internal",
        authKind: "api-key",
        authSecret: "unifi-api-key",
      },
    });
    assert.equal(blocked.statusCode, 503);
  } finally {
    process.env.RACKPAD_SECRET_KEY = savedKey;
  }
});

test("integration base URLs are normalized and reject embedded credentials", () => {
  assert.equal(
    normalizeIntegrationBaseUrl(" https://pve.lab.internal:8006// "),
    "https://pve.lab.internal:8006",
  );
  assert.equal(
    normalizeIntegrationBaseUrl("https://omada.lab.internal:8043/controller?x=1#y"),
    "https://omada.lab.internal:8043/controller",
  );
  assert.throws(() =>
    normalizeIntegrationBaseUrl("https://user:pass@fw.lab.internal"),
  );
  assert.throws(() => normalizeIntegrationBaseUrl("not-a-url"));
});

function resetDatabase() {
  db.exec(`
    DELETE FROM userSessions;
    DELETE FROM oidcIdentities;
    DELETE FROM userLabAccess;
    DELETE FROM integrationConnections;
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
      displayName: "Integrations Admin",
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

async function createConnection(
  token: string,
  payload: Record<string, unknown>,
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/integrations/connections",
    headers: authHeaders(token),
    payload,
  });
  assert.equal(response.statusCode, 201, response.body);
  return json(response) as ConnectionPublic;
}

async function listConnections(token: string, labId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/integrations/connections?labId=${labId}`,
    headers: authHeaders(token),
  });
  assert.equal(response.statusCode, 200);
  return json(response) as ConnectionPublic[];
}

async function patchConnection(
  token: string,
  id: string,
  payload: Record<string, unknown>,
) {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/integrations/connections/${id}`,
    headers: authHeaders(token),
    payload,
  });
  assert.equal(response.statusCode, 200, response.body);
  return json(response) as ConnectionPublic;
}

async function createUserAndLogin(
  adminToken: string,
  input: {
    username: string;
    displayName: string;
    password: string;
    role: "editor" | "viewer";
  },
) {
  const createResponse = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: authHeaders(adminToken),
    payload: input,
  });
  assert.equal(createResponse.statusCode, 201);
  const loginResponse = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: input.username, password: input.password },
  });
  assert.equal(loginResponse.statusCode, 200);
  return (json(loginResponse) as { token: string }).token;
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function json(response: { body: string }) {
  return JSON.parse(response.body);
}

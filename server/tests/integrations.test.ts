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
const { setIntegrationClientOverrideForTests } = await import(
  "../lib/integrations/inventory.js"
);
const { buildIntegrationUrl } = await import("../lib/integrations/http.js");
const { syncIntegrationConnectionStatuses } = await import(
  "../lib/integrations/status-sync.js"
);

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
    ["proxmox", "unifi", "omada", "opnsense", "dockhand"],
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

test("integration test endpoint records success and failure status", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);
  const created = await createConnection(token, {
    labId,
    provider: "proxmox",
    name: "PVE test target",
    baseUrl: "https://pve.lab.internal:8006",
    authKind: "api-token",
    authId: "rackpad@pam!inventory",
    authSecret: "token-secret",
  });

  setIntegrationClientOverrideForTests("proxmox", {
    provider: "proxmox",
    test: async () => ({
      product: "Proxmox VE",
      version: "8.4.1",
      summary: { nodes: 2 },
    }),
    fetchInventory: async () => {
      throw new Error("not used");
    },
  });
  try {
    const okResponse = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/test`,
      headers: authHeaders(token),
    });
    assert.equal(okResponse.statusCode, 200, okResponse.body);
    const okBody = json(okResponse) as {
      connection: ConnectionPublic & {
        lastSummary: Record<string, unknown> | null;
        lastError: string | null;
      };
      result: { product: string; version: string };
    };
    assert.equal(okBody.result.product, "Proxmox VE");
    assert.equal(okBody.connection.lastStatus, "ok");
    assert.equal(okBody.connection.lastError, null);
    assert.equal(okBody.connection.lastSummary?.version, "8.4.1");
    assert.equal(okBody.connection.lastSummary?.nodes, 2);

    setIntegrationClientOverrideForTests("proxmox", {
      provider: "proxmox",
      test: async () => {
        throw new Error("Could not reach Proxmox VE: connection refused.");
      },
      fetchInventory: async () => {
        throw new Error("not used");
      },
    });
    const failResponse = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/test`,
      headers: authHeaders(token),
    });
    assert.equal(failResponse.statusCode, 502);
    const failBody = json(failResponse) as {
      error: string;
      connection: { lastStatus: string; lastError: string | null };
    };
    assert.match(failBody.error, /connection refused/);
    assert.equal(failBody.connection.lastStatus, "error");
    assert.match(failBody.connection.lastError ?? "", /connection refused/);
  } finally {
    setIntegrationClientOverrideForTests("proxmox", null);
  }
});

test("integration inventory builds a preview, honors sync toggles, and apply writes IPAM", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);
  const created = await createConnection(token, {
    labId,
    provider: "opnsense",
    name: "Edge firewall",
    baseUrl: "https://fw.lab.internal",
    authKind: "key-secret",
    authId: "key",
    authSecret: "secret",
  });

  setIntegrationClientOverrideForTests("opnsense", {
    provider: "opnsense",
    test: async () => ({ product: "OPNsense", version: "25.7", summary: {} }),
    fetchInventory: async () => ({
      collection: {
        vlans: [
          { vlanNumber: 10, name: "Servers" },
          { vlanNumber: 20, name: "IoT" },
        ],
        subnets: [
          { cidr: "10.0.10.0/24", name: "Servers", vlanNumber: 10 },
          { cidr: "10.0.20.0/24", name: "IoT", vlanNumber: 20 },
        ],
        dhcpScopes: [
          {
            name: "Servers pool",
            startIp: "10.0.10.100",
            endIp: "10.0.10.199",
            subnetCidr: "10.0.10.0/24",
          },
        ],
      },
      devices: [
        {
          name: "igc0",
          kind: "interface" as const,
          model: null,
          macAddress: "00:11:22:33:44:55",
          ipAddress: "10.0.10.1",
          status: "up",
          detail: "LAN",
        },
      ],
      warnings: ["ISC DHCP ranges are not exposed by the OPNsense API."],
    }),
  });
  try {
    const pullResponse = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/inventory`,
      headers: authHeaders(token),
      payload: {},
    });
    assert.equal(pullResponse.statusCode, 200, pullResponse.body);
    const pullBody = json(pullResponse) as {
      preview: {
        labId: string;
        deviceId: string;
        policy: string;
        summary: { vlanCreates: number; subnetCreates: number };
        dhcp: { scopes: unknown[] };
      };
      devices: Array<{ name: string }>;
      warnings: string[];
    };
    assert.equal(pullBody.preview.policy, "merge");
    assert.equal(pullBody.preview.summary.vlanCreates, 2);
    assert.equal(pullBody.preview.summary.subnetCreates, 2);
    assert.equal(pullBody.preview.dhcp.scopes.length, 1);
    assert.equal(pullBody.devices[0]?.name, "igc0");
    assert.match(pullBody.warnings[0] ?? "", /ISC DHCP/);

    const applyResponse = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/apply`,
      headers: authHeaders(token),
      payload: { preview: pullBody.preview },
    });
    assert.equal(applyResponse.statusCode, 200, applyResponse.body);
    const applyBody = json(applyResponse) as {
      createdVlanIds: string[];
      createdSubnetIds: string[];
    };
    assert.equal(applyBody.createdVlanIds.length, 2);
    assert.equal(applyBody.createdSubnetIds.length, 2);

    const vlanRows = db
      .prepare("SELECT vlanId, name FROM vlans WHERE labId = ? ORDER BY vlanId")
      .all(labId) as Array<{ vlanId: number; name: string }>;
    assert.deepEqual(
      vlanRows.map((row) => [row.vlanId, row.name]),
      [
        [10, "Servers"],
        [20, "IoT"],
      ],
    );
    const subnetRows = db
      .prepare("SELECT cidr FROM subnets WHERE labId = ? ORDER BY cidr")
      .all(labId) as Array<{ cidr: string }>;
    assert.deepEqual(
      subnetRows.map((row) => row.cidr),
      ["10.0.10.0/24", "10.0.20.0/24"],
    );
    const auditRow = db
      .prepare(
        "SELECT entityType, action FROM auditLog WHERE action = 'integration.sync.apply'",
      )
      .get() as { entityType: string } | undefined;
    assert.equal(auditRow?.entityType, "IntegrationSync");

    const disabledVlans = await patchConnection(token, created.id, {
      syncVlans: false,
    });
    assert.equal(disabledVlans.syncVlans, false);
    const filteredResponse = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/inventory`,
      headers: authHeaders(token),
      payload: {},
    });
    assert.equal(filteredResponse.statusCode, 200);
    const filteredBody = json(filteredResponse) as {
      preview: {
        vlans: unknown[];
        summary: { vlanCreates: number };
        warnings: string[];
      };
    };
    assert.equal(filteredBody.preview.vlans.length, 0);
    assert.equal(filteredBody.preview.summary.vlanCreates, 0);
    assert.match(
      filteredBody.preview.warnings.join(" "),
      /skipped 2 VLAN\(s\)/,
    );
  } finally {
    setIntegrationClientOverrideForTests("opnsense", null);
  }
});

test("integration apply requires admin and a matching preview", async () => {
  const adminToken = await bootstrapAdmin();
  const labId = await firstLabId(adminToken);
  const editorToken = await createUserAndLogin(adminToken, {
    username: "integration-editor",
    displayName: "Integration Editor",
    password: "integration-editor-1",
    role: "editor",
  });
  const created = await createConnection(adminToken, {
    labId,
    provider: "unifi",
    name: "UniFi console",
    baseUrl: "https://unifi.lab.internal",
    authKind: "api-key",
    authSecret: "api-key",
  });

  const fakePreview = {
    profileId: "integration-unifi",
    deviceId: created.id,
    labId,
    target: "https://unifi.lab.internal",
    collectedAt: new Date().toISOString(),
    policy: "merge",
    vlans: [{ action: "create", vlanNumber: 30, name: "Cameras" }],
    subnets: [],
    dhcp: { supported: false, message: "", scopes: [] },
    summary: {
      vlanCreates: 1,
      vlanUpdates: 0,
      vlanDeletes: 0,
      subnetCreates: 0,
      subnetUpdates: 0,
      subnetDeletes: 0,
    },
    warnings: [],
  };

  const editorApply = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/apply`,
    headers: authHeaders(editorToken),
    payload: { preview: fakePreview },
  });
  assert.equal(editorApply.statusCode, 403);

  const mismatched = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/apply`,
    headers: authHeaders(adminToken),
    payload: { preview: { ...fakePreview, deviceId: "intg_other" } },
  });
  assert.equal(mismatched.statusCode, 400);

  const adminApply = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/apply`,
    headers: authHeaders(adminToken),
    payload: { preview: fakePreview },
  });
  assert.equal(adminApply.statusCode, 200, adminApply.body);
});

test("integration endpoints handle missing clients and disabled connections", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);
  const created = await createConnection(token, {
    labId,
    provider: "omada",
    name: "Omada controller",
    baseUrl: "https://omada.lab.internal:8043",
    authKind: "client-credentials",
    authId: "client-id",
    authSecret: "client-secret",
  });

  setIntegrationClientOverrideForTests("omada", "none");
  try {
    const noClient = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/test`,
      headers: authHeaders(token),
    });
    assert.equal(noClient.statusCode, 501);
  } finally {
    setIntegrationClientOverrideForTests("omada", null);
  }

  await patchConnection(token, created.id, { enabled: false });
  setIntegrationClientOverrideForTests("omada", {
    provider: "omada",
    test: async () => ({ product: "Omada", version: null, summary: {} }),
    fetchInventory: async () => ({
      collection: { vlans: [], subnets: [], dhcpScopes: [] },
      devices: [],
      warnings: [],
    }),
  });
  try {
    const disabled = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/inventory`,
      headers: authHeaders(token),
      payload: {},
    });
    assert.equal(disabled.statusCode, 409);
  } finally {
    setIntegrationClientOverrideForTests("omada", null);
  }
});

test("integration status sync refreshes enabled connections and records failures", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);
  const healthy = await createConnection(token, {
    labId,
    provider: "proxmox",
    name: "PVE status target",
    baseUrl: "https://pve.lab.internal:8006",
    authKind: "api-token",
    authId: "rackpad@pam!inventory",
    authSecret: "token-secret",
  });
  const failing = await createConnection(token, {
    labId,
    provider: "opnsense",
    name: "Unreachable firewall",
    baseUrl: "https://fw.lab.internal",
    authKind: "key-secret",
    authId: "key",
    authSecret: "secret",
  });
  const disabled = await createConnection(token, {
    labId,
    provider: "omada",
    name: "Disabled controller",
    baseUrl: "https://omada.lab.internal:8043",
    authKind: "client-credentials",
    authId: "client-id",
    authSecret: "client-secret",
    enabled: false,
  });

  setIntegrationClientOverrideForTests("proxmox", {
    provider: "proxmox",
    test: async () => ({
      product: "Proxmox VE",
      version: "8.4.1",
      summary: { nodes: 1 },
    }),
    fetchInventory: async () => {
      throw new Error("not used");
    },
  });
  setIntegrationClientOverrideForTests("opnsense", {
    provider: "opnsense",
    test: async () => {
      throw new Error("Could not reach OPNsense: connection refused.");
    },
    fetchInventory: async () => {
      throw new Error("not used");
    },
  });
  setIntegrationClientOverrideForTests("omada", {
    provider: "omada",
    test: async () => {
      throw new Error("disabled connections must be skipped");
    },
    fetchInventory: async () => {
      throw new Error("not used");
    },
  });
  try {
    const result = await syncIntegrationConnectionStatuses(labId);
    assert.equal(result.connections, 2);
    assert.equal(result.ok, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.skipped, 1);
    assert.match(result.errors.join(" "), /connection refused/);

    const rows = await listConnections(token, labId);
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(byId.get(healthy.id)?.lastStatus, "ok");
    assert.equal(byId.get(failing.id)?.lastStatus, "error");
    assert.equal(byId.get(disabled.id)?.lastStatus, "unknown");
  } finally {
    setIntegrationClientOverrideForTests("proxmox", null);
    setIntegrationClientOverrideForTests("opnsense", null);
    setIntegrationClientOverrideForTests("omada", null);
  }
});

test("integration URLs join base paths and query params safely", () => {
  const plain = buildIntegrationUrl(
    "https://omada.lab.internal:8043",
    "/openapi/v1/omadac-1/sites",
    { page: 1, pageSize: 100 },
  );
  assert.equal(
    plain.toString(),
    "https://omada.lab.internal:8043/openapi/v1/omadac-1/sites?page=1&pageSize=100",
  );

  const withBasePath = buildIntegrationUrl(
    "https://unifi.lab.internal/proxy",
    "/network/integration/v1/sites",
  );
  assert.equal(
    withBasePath.toString(),
    "https://unifi.lab.internal/proxy/network/integration/v1/sites",
  );

  assert.throws(() =>
    buildIntegrationUrl("https://pve.lab.internal:8006", "no-slash"),
  );
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

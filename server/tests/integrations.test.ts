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
const { buildIntegrationNetworkPreview, applyIntegrationNetworkPreview } =
  await import("../lib/integrations/network-sync.js");
const { syncIntegrationConnectionStatuses } = await import(
  "../lib/integrations/status-sync.js"
);
const { withIntegrationSyncLock } = await import(
  "../lib/integrations/auto-sync.js"
);
const {
  consumeIntegrationPreviewToken,
  INTEGRATION_PREVIEW_TOKEN_TTL_MS,
  issueIntegrationPreviewToken,
  resetIntegrationPreviewTokensForTests,
} = await import("../lib/integrations/preview-tokens.js");

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

test("integration preview tokens are scoped, expiring, and single-use", () => {
  resetIntegrationPreviewTokensForTests();
  const scope = {
    actorId: "user-1",
    connectionId: "connection-1",
    labId: "lab-1",
    connectionRevision: "revision-1",
  };
  const issued = issueIntegrationPreviewToken(
    "network-preview",
    scope,
    { value: 42 },
    1_000,
  );
  assert.throws(
    () =>
      consumeIntegrationPreviewToken(
        issued.token,
        "network-preview",
        { ...scope, labId: "lab-2" },
        2_000,
      ),
    /does not match/,
  );
  assert.deepEqual(
    consumeIntegrationPreviewToken(
      issued.token,
      "network-preview",
      scope,
      2_000,
    ),
    { value: 42 },
  );
  assert.throws(
    () =>
      consumeIntegrationPreviewToken(
        issued.token,
        "network-preview",
        scope,
        2_000,
      ),
    /expired or was already applied/,
  );

  const expiring = issueIntegrationPreviewToken(
    "device-snapshot",
    scope,
    { value: 43 },
    5_000,
  );
  assert.throws(
    () =>
      consumeIntegrationPreviewToken(
        expiring.token,
        "device-snapshot",
        scope,
        5_000 + INTEGRATION_PREVIEW_TOKEN_TTL_MS,
      ),
    /expired or was already applied/,
  );
  resetIntegrationPreviewTokensForTests();
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

test("integration routes do not expose or mutate another lab", async () => {
  const adminToken = await bootstrapAdmin();
  const protectedLabId = await firstLabId(adminToken);
  const secondLabResponse = await app.inject({
    method: "POST",
    url: "/api/labs",
    headers: authHeaders(adminToken),
    payload: { id: "lab_integration_allowed", name: "Allowed lab" },
  });
  assert.equal(secondLabResponse.statusCode, 201, secondLabResponse.body);
  const limitedToken = await createUserAndLogin(adminToken, {
    username: "integration-limited",
    displayName: "Integration Limited",
    password: "integration-limited-1",
    role: "editor",
    labAccess: [{ labId: "lab_integration_allowed", role: "editor" }],
  });
  const created = await createConnection(adminToken, {
    labId: protectedLabId,
    provider: "opnsense",
    name: "Protected firewall",
    baseUrl: "https://protected-fw.lab.internal",
    authKind: "key-secret",
    authId: "key",
    authSecret: "secret",
  });
  const scheduleResponse = await app.inject({
    method: "POST",
    url: "/api/integrations/schedules",
    headers: authHeaders(adminToken),
    payload: {
      connectionId: created.id,
      name: "Protected schedule",
      cron: "0 2 * * *",
      labIds: [protectedLabId],
    },
  });
  assert.equal(scheduleResponse.statusCode, 201, scheduleResponse.body);
  const scheduleId = (json(scheduleResponse) as { id: string }).id;

  const globalList = await app.inject({
    method: "GET",
    url: "/api/integrations/connections",
    headers: authHeaders(limitedToken),
  });
  assert.equal(globalList.statusCode, 200);
  assert.deepEqual(json(globalList), []);

  const attempts: Array<{
    method: "GET" | "POST" | "PATCH" | "DELETE";
    url: string;
    payload?: Record<string, unknown>;
  }> = [
    {
      method: "GET",
      url: `/api/integrations/connections?labId=${protectedLabId}`,
    },
    {
      method: "POST",
      url: "/api/integrations/connections",
      payload: {
        labId: protectedLabId,
        provider: "opnsense",
        name: "Cross-lab create",
        baseUrl: "https://other-fw.lab.internal",
        authKind: "key-secret",
        authId: "key",
        authSecret: "secret",
      },
    },
    {
      method: "PATCH",
      url: `/api/integrations/connections/${created.id}`,
      payload: { name: "Cross-lab rename" },
    },
    {
      method: "DELETE",
      url: `/api/integrations/connections/${created.id}`,
    },
    {
      method: "POST",
      url: `/api/integrations/connections/${created.id}/test`,
    },
    {
      method: "POST",
      url: `/api/integrations/connections/${created.id}/inventory`,
      payload: {},
    },
    {
      method: "POST",
      url: "/api/integrations/discover-scopes",
      payload: { connectionId: created.id },
    },
    {
      method: "POST",
      url: `/api/integrations/connections/${created.id}/apply`,
      payload: { previewToken: "cross-lab-token" },
    },
    {
      method: "POST",
      url: `/api/integrations/connections/${created.id}/apply-devices`,
      payload: {
        snapshotToken: "cross-lab-token",
        selectedProviderRecordIds: ["device:cross-lab"],
      },
    },
    {
      method: "GET",
      url: `/api/integrations/schedules?connectionId=${created.id}`,
    },
    {
      method: "POST",
      url: "/api/integrations/schedules",
      payload: {
        connectionId: created.id,
        name: "Cross-lab schedule",
        cron: "0 3 * * *",
      },
    },
    {
      method: "PATCH",
      url: `/api/integrations/schedules/${scheduleId}`,
      payload: { name: "Cross-lab schedule rename" },
    },
    {
      method: "DELETE",
      url: `/api/integrations/schedules/${scheduleId}`,
    },
    {
      method: "POST",
      url: `/api/integrations/schedules/${scheduleId}/run`,
    },
  ];
  for (const attempt of attempts) {
    const response = await app.inject({
      method: attempt.method,
      url: attempt.url,
      headers: authHeaders(limitedToken),
      payload: attempt.payload,
    });
    assert.equal(
      response.statusCode,
      403,
      `${attempt.method} ${attempt.url}: ${response.body}`,
    );
  }

  const schedules = await app.inject({
    method: "GET",
    url: "/api/integrations/schedules",
    headers: authHeaders(limitedToken),
  });
  assert.equal(schedules.statusCode, 200);
  assert.deepEqual(json(schedules), []);
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
    const mirrorResponse = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/inventory`,
      headers: authHeaders(token),
      payload: { mode: "mirror" },
    });
    assert.equal(mirrorResponse.statusCode, 400);
    assert.match(mirrorResponse.body, /Mirror mode is disabled/);

    const pullResponse = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/inventory`,
      headers: authHeaders(token),
      payload: {},
    });
    assert.equal(pullResponse.statusCode, 200, pullResponse.body);
    const pullBody = json(pullResponse) as {
      networkPreviewToken: string;
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
      payload: { previewToken: pullBody.networkPreviewToken },
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
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) AS count FROM dhcpScopes").get() as {
          count: number;
        }
      ).count,
      0,
    );
    const auditRow = db
      .prepare(
        "SELECT entityType, action FROM auditLog WHERE action = 'integration.sync.apply'",
      )
      .get() as { entityType: string } | undefined;
    assert.equal(auditRow?.entityType, "IntegrationSync");

    db.prepare(
      "INSERT INTO vlans (id, labId, vlanId, name) VALUES ('manual-vlan', ?, 999, 'Manual')",
    ).run(labId);
    const skipResponse = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/inventory`,
      headers: authHeaders(token),
      payload: { mode: "skip" },
    });
    assert.equal(skipResponse.statusCode, 200, skipResponse.body);
    const skipBody = json(skipResponse) as {
      mode: string;
      preview: {
        vlans: Array<{ action: string }>;
        subnets: Array<{ action: string }>;
        summary: { vlanDeletes: number; subnetDeletes: number };
        warnings: string[];
      };
    };
    assert.equal(skipBody.mode, "skip");
    assert.equal(skipBody.preview.summary.vlanDeletes, 0);
    assert.equal(skipBody.preview.summary.subnetDeletes, 0);
    assert.equal(
      [...skipBody.preview.vlans, ...skipBody.preview.subnets].some(
        (entry) => entry.action === "delete",
      ),
      false,
    );
    assert.match(skipBody.preview.warnings.join(" "), /no deletions were proposed/);

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

test("link-only network previews count as changes and roll back atomically", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);
  const created = await createConnection(token, {
    labId,
    provider: "opnsense",
    name: "Atomic firewall",
    baseUrl: "https://atomic-fw.lab.internal",
    authKind: "key-secret",
    authId: "key",
    authSecret: "secret",
  });
  const connection = loadIntegrationConnectionSecrets(created.id);
  db.prepare(
    "INSERT INTO vlans (id, labId, vlanId, name) VALUES ('v_link', ?, 10, 'Servers')",
  ).run(labId);
  db.prepare(
    "INSERT INTO subnets (id, labId, cidr, name, vlanId) VALUES ('s_link', ?, '10.0.10.0/24', 'Servers', NULL)",
  ).run(labId);

  const linkPreview = buildIntegrationNetworkPreview({
    connection,
    policy: "merge",
    collection: {
      vlans: [{ vlanNumber: 10, name: "Servers" }],
      subnets: [
        { cidr: "10.0.10.0/24", name: "Servers", vlanNumber: 10 },
      ],
      dhcpScopes: [],
    },
  });
  assert.equal(linkPreview.summary.subnetUpdates, 1);
  assert.equal(linkPreview.subnets[0]?.linkOnly, true);
  const linkResult = applyIntegrationNetworkPreview({
    preview: linkPreview,
    allowDeletes: false,
    actor: "admin",
  });
  assert.deepEqual(linkResult.updatedSubnetIds, ["s_link"]);
  assert.equal(
    (
      db.prepare("SELECT vlanId FROM subnets WHERE id = 's_link'").get() as {
        vlanId: string | null;
      }
    ).vlanId,
    "v_link",
  );

  db.prepare("UPDATE subnets SET vlanId = NULL WHERE id = 's_link'").run();
  const rollbackPreview = buildIntegrationNetworkPreview({
    connection,
    policy: "merge",
    collection: {
      vlans: [
        { vlanNumber: 10, name: "Servers" },
        { vlanNumber: 99, name: "Must roll back" },
      ],
      subnets: [
        { cidr: "10.0.10.0/24", name: "Servers", vlanNumber: 10 },
      ],
      dhcpScopes: [],
    },
  });
  db.exec(`
    CREATE TRIGGER integration_test_block_link
    BEFORE UPDATE OF vlanId ON subnets
    WHEN OLD.id = 's_link'
    BEGIN
      SELECT RAISE(ABORT, 'blocked link for rollback test');
    END;
  `);
  try {
    assert.throws(
      () =>
        applyIntegrationNetworkPreview({
          preview: rollbackPreview,
          allowDeletes: false,
          actor: "admin",
        }),
      /blocked link for rollback test/,
    );
  } finally {
    db.exec("DROP TRIGGER IF EXISTS integration_test_block_link");
  }
  assert.equal(
    db
      .prepare("SELECT id FROM vlans WHERE labId = ? AND vlanId = 99")
      .get(labId),
    undefined,
  );
  assert.equal(
    (
      db.prepare("SELECT vlanId FROM subnets WHERE id = 's_link'").get() as {
        vlanId: string | null;
      }
    ).vlanId,
    null,
  );
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

  const other = await createConnection(adminToken, {
    labId,
    provider: "unifi",
    name: "Other UniFi console",
    baseUrl: "https://unifi-other.lab.internal",
    authKind: "api-key",
    authSecret: "api-key",
  });

  setIntegrationClientOverrideForTests("unifi", {
    provider: "unifi",
    test: async () => ({ product: "UniFi", version: null, summary: {} }),
    fetchInventory: async () => ({
      collection: {
        vlans: [{ vlanNumber: 30, name: "Cameras" }],
        subnets: [],
        dhcpScopes: [],
      },
      devices: [],
      warnings: [],
    }),
  });

  const inventory = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/inventory`,
    headers: authHeaders(adminToken),
    payload: {},
  });
  assert.equal(inventory.statusCode, 200, inventory.body);
  const previewToken = (
    json(inventory) as { networkPreviewToken: string }
  ).networkPreviewToken;

  const editorApply = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/apply`,
    headers: authHeaders(editorToken),
    payload: { previewToken },
  });
  assert.equal(editorApply.statusCode, 403);

  const mismatched = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${other.id}/apply`,
    headers: authHeaders(adminToken),
    payload: { previewToken },
  });
  assert.equal(mismatched.statusCode, 400);

  let releaseLock!: () => void;
  const heldLock = withIntegrationSyncLock(
    created.id,
    () =>
      new Promise<void>((resolve) => {
        releaseLock = resolve;
      }),
  );
  const busyApply = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/apply`,
    headers: authHeaders(adminToken),
    payload: { previewToken },
  });
  assert.equal(busyApply.statusCode, 409);
  assert.equal((json(busyApply) as { code: string }).code, "INTEGRATION_SYNC_BUSY");
  releaseLock();
  await heldLock;

  const adminApply = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/apply`,
    headers: authHeaders(adminToken),
    payload: { previewToken },
  });
  assert.equal(adminApply.statusCode, 200, adminApply.body);

  const replay = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/apply`,
    headers: authHeaders(adminToken),
    payload: { previewToken },
  });
  assert.equal(replay.statusCode, 409);

  const staleInventory = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/inventory`,
    headers: authHeaders(adminToken),
    payload: {},
  });
  assert.equal(staleInventory.statusCode, 200, staleInventory.body);
  const staleToken = (
    json(staleInventory) as { networkPreviewToken: string }
  ).networkPreviewToken;
  await patchConnection(adminToken, created.id, { syncVlans: false });
  const staleApply = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/apply`,
    headers: authHeaders(adminToken),
    payload: { previewToken: staleToken },
  });
  assert.equal(staleApply.statusCode, 400);
  assert.match(staleApply.body, /does not match/);

  await patchConnection(adminToken, created.id, { syncVlans: true });
  const disabledInventory = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/inventory`,
    headers: authHeaders(adminToken),
    payload: {},
  });
  assert.equal(disabledInventory.statusCode, 200, disabledInventory.body);
  const disabledToken = (
    json(disabledInventory) as { networkPreviewToken: string }
  ).networkPreviewToken;
  await patchConnection(adminToken, created.id, { enabled: false });
  const disabledApply = await app.inject({
    method: "POST",
    url: `/api/integrations/connections/${created.id}/apply`,
    headers: authHeaders(adminToken),
    payload: { previewToken: disabledToken },
  });
  assert.equal(disabledApply.statusCode, 409);
  assert.match(disabledApply.body, /connection is disabled/i);

  setIntegrationClientOverrideForTests("unifi", null);
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

test("discover-scopes tests credentials and lists scopes inline or by connection", async () => {
  const token = await bootstrapAdmin();
  const labId = await firstLabId(token);

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
    listScopes: async () => [
      { id: "pve1", label: "pve1" },
      { id: "pve2", label: "pve2" },
    ],
  });
  try {
    const inline = await app.inject({
      method: "POST",
      url: "/api/integrations/discover-scopes",
      headers: authHeaders(token),
      payload: {
        labId,
        provider: "proxmox",
        baseUrl: "https://pve.lab.internal:8006",
        authKind: "api-token",
        authId: "rackpad@pam!inventory",
        authSecret: "token-secret",
      },
    });
    assert.equal(inline.statusCode, 200, inline.body);
    const inlineBody = json(inline) as {
      result: { product: string };
      scopeKind: string;
      scopes: Array<{ id: string }>;
    };
    assert.equal(inlineBody.result.product, "Proxmox VE");
    assert.equal(inlineBody.scopeKind, "nodes");
    assert.deepEqual(
      inlineBody.scopes.map((scope) => scope.id),
      ["pve1", "pve2"],
    );

    const created = await createConnection(token, {
      labId,
      provider: "proxmox",
      name: "PVE with scopes",
      baseUrl: "https://pve.lab.internal:8006",
      authKind: "api-token",
      authId: "rackpad@pam!inventory",
      authSecret: "token-secret",
      scopeRefs: ["pve1"],
    });
    assert.deepEqual(
      (created as unknown as { scopeRefs: string[] }).scopeRefs,
      ["pve1"],
    );

    const stored = await app.inject({
      method: "POST",
      url: "/api/integrations/discover-scopes",
      headers: authHeaders(token),
      payload: { connectionId: created.id },
    });
    assert.equal(stored.statusCode, 200, stored.body);
    assert.equal((json(stored) as { scopeKind: string }).scopeKind, "nodes");
  } finally {
    setIntegrationClientOverrideForTests("proxmox", null);
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
    labAccess?: Array<{ labId: string; role: "editor" | "viewer" }>;
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

import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "rackpad-autosync-tests-"));
process.env.DATABASE_PATH = path.join(tempDir, "rackpad-autosync-test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "rackpad-autosync-test-secret";

const { createApp } = await import("../app.js");
const { db } = await import("../db.js");
const { setBootstrapState } = await import("../lib/auth.js");
const { setIntegrationClientOverrideForTests } = await import(
  "../lib/integrations/inventory.js"
);
const { cronMatches, isValidCronExpression, parseCronExpression } =
  await import("../lib/integrations/cron.js");
const { findDueIntegrationAutoSyncs, runIntegrationAutoSync } = await import(
  "../lib/integrations/auto-sync.js"
);

type AppInstance = Awaited<ReturnType<typeof createApp>>;

let app: AppInstance;

beforeEach(async () => {
  resetDatabase();
  app = await createApp();
});

afterEach(async () => {
  setIntegrationClientOverrideForTests("opnsense", null);
  await app.close();
});

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("cron expressions parse presets, steps, ranges, and reject junk", () => {
  const everyFifteen = parseCronExpression("*/15 * * * *");
  assert.ok(cronMatches(everyFifteen, new Date(2026, 7, 15, 10, 30)));
  assert.ok(!cronMatches(everyFifteen, new Date(2026, 7, 15, 10, 31)));

  const dailyTwo = parseCronExpression("0 2 * * *");
  assert.ok(cronMatches(dailyTwo, new Date(2026, 7, 15, 2, 0)));
  assert.ok(!cronMatches(dailyTwo, new Date(2026, 7, 15, 3, 0)));

  const weeklySunday = parseCronExpression("0 2 * * 7");
  assert.ok(cronMatches(weeklySunday, new Date(2026, 7, 16, 2, 0))); // Sunday
  assert.ok(!cronMatches(weeklySunday, new Date(2026, 7, 17, 2, 0))); // Monday

  const workHours = parseCronExpression("0 9-17/2 * * 1-5");
  assert.ok(cronMatches(workHours, new Date(2026, 7, 17, 11, 0))); // Monday
  assert.ok(!cronMatches(workHours, new Date(2026, 7, 16, 11, 0))); // Sunday

  assert.ok(isValidCronExpression("30 4 1,15 * *"));
  assert.ok(!isValidCronExpression("* * * *"));
  assert.ok(!isValidCronExpression("61 * * * *"));
  assert.ok(!isValidCronExpression("*/0 * * * *"));
  assert.ok(!isValidCronExpression("banana * * * *"));
});

test("auto-sync config is admin-only, validated, and surfaced on the connection", async () => {
  const adminToken = await bootstrapAdmin();
  const labId = await firstLabId(adminToken);
  const secondLabId = await createLab(adminToken, "Second lab");
  const editorToken = await createUserAndLogin(adminToken, {
    username: "autosync-editor",
    displayName: "Auto-sync Editor",
    password: "autosync-editor-1",
    role: "editor",
  });
  const created = await createConnection(adminToken, {
    labId,
    provider: "opnsense",
    name: "Edge firewall",
    baseUrl: "https://fw.lab.internal",
    authKind: "key-secret",
    authId: "key",
    authSecret: "secret",
  });

  const editorAttempt = await app.inject({
    method: "PATCH",
    url: `/api/integrations/connections/${created.id}`,
    headers: authHeaders(editorToken),
    payload: { autoSyncEnabled: true, autoSyncCron: "*/15 * * * *" },
  });
  assert.equal(editorAttempt.statusCode, 403);

  const badCron = await app.inject({
    method: "PATCH",
    url: `/api/integrations/connections/${created.id}`,
    headers: authHeaders(adminToken),
    payload: { autoSyncEnabled: true, autoSyncCron: "not a cron" },
  });
  assert.equal(badCron.statusCode, 400);

  const missingCron = await app.inject({
    method: "PATCH",
    url: `/api/integrations/connections/${created.id}`,
    headers: authHeaders(adminToken),
    payload: { autoSyncEnabled: true },
  });
  assert.equal(missingCron.statusCode, 400);

  const badLab = await app.inject({
    method: "PATCH",
    url: `/api/integrations/connections/${created.id}`,
    headers: authHeaders(adminToken),
    payload: {
      autoSyncEnabled: true,
      autoSyncCron: "*/15 * * * *",
      autoSyncLabIds: ["lab_missing"],
    },
  });
  assert.equal(badLab.statusCode, 422);

  const configured = await app.inject({
    method: "PATCH",
    url: `/api/integrations/connections/${created.id}`,
    headers: authHeaders(adminToken),
    payload: {
      autoSyncEnabled: true,
      autoSyncMode: "overwrite",
      autoSyncCron: "0 2 * * *",
      autoSyncLabIds: [labId, secondLabId],
    },
  });
  assert.equal(configured.statusCode, 200, configured.body);
  const body = JSON.parse(configured.body) as {
    autoSyncEnabled: boolean;
    autoSyncMode: string;
    autoSyncCron: string;
    autoSyncLabIds: string[];
  };
  assert.equal(body.autoSyncEnabled, true);
  assert.equal(body.autoSyncMode, "overwrite");
  assert.equal(body.autoSyncCron, "0 2 * * *");
  assert.deepEqual(body.autoSyncLabIds.sort(), [labId, secondLabId].sort());
});

test("auto-sync populates multiple labs, honors modes, and detects drift", async () => {
  const adminToken = await bootstrapAdmin();
  const labId = await firstLabId(adminToken);
  const secondLabId = await createLab(adminToken, "Second lab");
  const created = await createConnection(adminToken, {
    labId,
    provider: "opnsense",
    name: "Edge firewall",
    baseUrl: "https://fw.lab.internal",
    authKind: "key-secret",
    authId: "key",
    authSecret: "secret",
  });
  await patchConnection(adminToken, created.id, {
    autoSyncEnabled: true,
    autoSyncMode: "merge",
    autoSyncCron: "*/15 * * * *",
    autoSyncLabIds: [labId, secondLabId],
  });

  setIntegrationClientOverrideForTests("opnsense", {
    provider: "opnsense",
    test: async () => ({ product: "OPNsense", version: "25.7", summary: {} }),
    fetchInventory: async () => ({
      collection: {
        vlans: [{ vlanNumber: 10, name: "Servers" }],
        subnets: [{ cidr: "10.0.10.0/24", name: "Servers", vlanNumber: 10 }],
        dhcpScopes: [],
      },
      devices: [],
      warnings: [],
    }),
  });

  const mergeRun = await runIntegrationAutoSync(created.id);
  assert.equal(mergeRun.status, "ok", mergeRun.message);
  for (const targetLab of [labId, secondLabId]) {
    const vlan = db
      .prepare("SELECT name FROM vlans WHERE labId = ? AND vlanId = 10")
      .get(targetLab) as { name: string } | undefined;
    assert.equal(vlan?.name, "Servers", `lab ${targetLab} should have VLAN 10`);
    const subnet = db
      .prepare("SELECT id FROM subnets WHERE labId = ? AND cidr = '10.0.10.0/24'")
      .get(targetLab);
    assert.ok(subnet, `lab ${targetLab} should have the subnet`);
  }
  const auditRow = db
    .prepare(
      "SELECT user FROM auditLog WHERE action = 'integration.sync.apply' LIMIT 1",
    )
    .get() as { user: string } | undefined;
  assert.equal(auditRow?.user, "integration-auto-sync");

  // Rename upstream: merge must NOT update, overwrite must.
  setIntegrationClientOverrideForTests("opnsense", {
    provider: "opnsense",
    test: async () => ({ product: "OPNsense", version: "25.7", summary: {} }),
    fetchInventory: async () => ({
      collection: {
        vlans: [{ vlanNumber: 10, name: "Renamed Servers" }],
        subnets: [{ cidr: "10.0.10.0/24", name: "Servers", vlanNumber: 10 }],
        dhcpScopes: [],
      },
      devices: [],
      warnings: [],
    }),
  });

  await runIntegrationAutoSync(created.id);
  let vlanName = (
    db
      .prepare("SELECT name FROM vlans WHERE labId = ? AND vlanId = 10")
      .get(labId) as { name: string }
  ).name;
  assert.equal(vlanName, "Servers", "merge mode must not rename");

  await patchConnection(adminToken, created.id, { autoSyncMode: "skip" });
  const skipRun = await runIntegrationAutoSync(created.id);
  assert.equal(skipRun.status, "drift");
  assert.match(skipRun.message, /drift detected/);
  vlanName = (
    db
      .prepare("SELECT name FROM vlans WHERE labId = ? AND vlanId = 10")
      .get(labId) as { name: string }
  ).name;
  assert.equal(vlanName, "Servers", "skip mode must write nothing");

  await patchConnection(adminToken, created.id, { autoSyncMode: "overwrite" });
  const overwriteRun = await runIntegrationAutoSync(created.id);
  assert.equal(overwriteRun.status, "ok", overwriteRun.message);
  vlanName = (
    db
      .prepare("SELECT name FROM vlans WHERE labId = ? AND vlanId = 10")
      .get(labId) as { name: string }
  ).name;
  assert.equal(vlanName, "Renamed Servers", "overwrite mode must update");
});

test("auto-sync failures back off exponentially and recover on success", async () => {
  const adminToken = await bootstrapAdmin();
  const labId = await firstLabId(adminToken);
  const created = await createConnection(adminToken, {
    labId,
    provider: "opnsense",
    name: "Flaky firewall",
    baseUrl: "https://fw.lab.internal",
    authKind: "key-secret",
    authId: "key",
    authSecret: "secret",
  });
  await patchConnection(adminToken, created.id, {
    autoSyncEnabled: true,
    autoSyncCron: "* * * * *",
  });

  setIntegrationClientOverrideForTests("opnsense", {
    provider: "opnsense",
    test: async () => ({ product: "OPNsense", version: "25.7", summary: {} }),
    fetchInventory: async () => {
      throw new Error("Could not reach OPNsense: connection refused.");
    },
  });

  const firstFailure = await runIntegrationAutoSync(created.id);
  assert.equal(firstFailure.status, "error");
  assert.match(firstFailure.message, /Retrying after 5 minute/);

  let row = db
    .prepare(
      "SELECT autoSyncFailureCount, autoSyncPausedUntil, lastAutoSyncStatus, lastAutoSyncMessage FROM integrationConnections WHERE id = ?",
    )
    .get(created.id) as {
    autoSyncFailureCount: number;
    autoSyncPausedUntil: string | null;
    lastAutoSyncStatus: string;
    lastAutoSyncMessage: string;
  };
  assert.equal(row.autoSyncFailureCount, 1);
  assert.ok(row.autoSyncPausedUntil, "backoff pause must be set");
  assert.equal(row.lastAutoSyncStatus, "error");
  assert.match(row.lastAutoSyncMessage, /connection refused/);

  const secondFailure = await runIntegrationAutoSync(created.id);
  assert.match(secondFailure.message, /Retrying after 10 minute/);

  // While paused, the schedule scanner must not consider it due.
  const due = findDueIntegrationAutoSyncs(new Date(), null);
  assert.ok(!due.includes(created.id), "paused connections are not due");

  setIntegrationClientOverrideForTests("opnsense", {
    provider: "opnsense",
    test: async () => ({ product: "OPNsense", version: "25.7", summary: {} }),
    fetchInventory: async () => ({
      collection: { vlans: [], subnets: [], dhcpScopes: [] },
      devices: [],
      warnings: [],
    }),
  });
  const recovery = await runIntegrationAutoSync(created.id);
  assert.equal(recovery.status, "ok");
  row = db
    .prepare(
      "SELECT autoSyncFailureCount, autoSyncPausedUntil, lastAutoSyncStatus, lastAutoSyncMessage FROM integrationConnections WHERE id = ?",
    )
    .get(created.id) as typeof row;
  assert.equal(row.autoSyncFailureCount, 0);
  assert.equal(row.autoSyncPausedUntil, null);
});

test("the schedule scanner finds due connections and respects the run window", async () => {
  const adminToken = await bootstrapAdmin();
  const labId = await firstLabId(adminToken);
  const created = await createConnection(adminToken, {
    labId,
    provider: "opnsense",
    name: "Edge firewall",
    baseUrl: "https://fw.lab.internal",
    authKind: "key-secret",
    authId: "key",
    authSecret: "secret",
  });
  await patchConnection(adminToken, created.id, {
    autoSyncEnabled: true,
    autoSyncCron: "30 2 * * *",
  });

  const at230 = new Date(2026, 7, 15, 2, 30, 5);
  const at229 = new Date(2026, 7, 15, 2, 29, 5);
  assert.deepEqual(findDueIntegrationAutoSyncs(at230, at229), [created.id]);
  assert.deepEqual(
    findDueIntegrationAutoSyncs(new Date(2026, 7, 15, 3, 0, 5), null),
    [],
  );

  // A slow tick that jumps past 02:30 still catches the run.
  assert.deepEqual(
    findDueIntegrationAutoSyncs(
      new Date(2026, 7, 15, 2, 32, 5),
      new Date(2026, 7, 15, 2, 28, 5),
    ),
    [created.id],
  );

  await patchConnection(adminToken, created.id, { autoSyncEnabled: false });
  assert.deepEqual(findDueIntegrationAutoSyncs(at230, at229), []);
});

function resetDatabase() {
  db.exec(`
    DELETE FROM userSessions;
    DELETE FROM oidcIdentities;
    DELETE FROM userLabAccess;
    DELETE FROM integrationConnections;
    DELETE FROM auditLog;
    DELETE FROM ipAssignments;
    DELETE FROM dhcpScopes;
    DELETE FROM subnets;
    DELETE FROM vlans;
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
      displayName: "Auto-sync Admin",
      password: "super-secret-1",
    },
  });
  assert.equal(response.statusCode, 201);
  return (JSON.parse(response.body) as { token: string }).token;
}

async function firstLabId(token: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/labs",
    headers: authHeaders(token),
  });
  assert.equal(response.statusCode, 200);
  return (JSON.parse(response.body) as Array<{ id: string }>)[0].id;
}

async function createLab(token: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/labs",
    headers: authHeaders(token),
    payload: { name },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (JSON.parse(response.body) as { id: string }).id;
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
  return JSON.parse(response.body) as { id: string };
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
  return JSON.parse(response.body) as Record<string, unknown>;
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
  return (JSON.parse(loginResponse.body) as { token: string }).token;
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

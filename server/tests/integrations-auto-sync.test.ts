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
const { setIntegrationClientOverrideForTests } =
  await import("../lib/integrations/inventory.js");
const { cronMatches, isValidCronExpression, parseCronExpression } =
  await import("../lib/integrations/cron.js");
const { findDueIntegrationSyncSchedules, runIntegrationSyncSchedule } =
  await import("../lib/integrations/auto-sync.js");

type AppInstance = Awaited<ReturnType<typeof createApp>>;

let app: AppInstance;

beforeEach(async () => {
  resetDatabase();
  app = await createApp();
});

afterEach(async () => {
  setIntegrationClientOverrideForTests("opnsense", null);
  setIntegrationClientOverrideForTests("unifi", null);
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
  assert.ok(cronMatches(weeklySunday, new Date(2026, 7, 16, 2, 0)));
  assert.ok(!cronMatches(weeklySunday, new Date(2026, 7, 17, 2, 0)));

  const workHours = parseCronExpression("0 9-17/2 * * 1-5");
  assert.ok(cronMatches(workHours, new Date(2026, 7, 17, 11, 0)));
  assert.ok(!cronMatches(workHours, new Date(2026, 7, 16, 11, 0)));

  assert.ok(isValidCronExpression("30 4 1,15 * *"));
  assert.ok(!isValidCronExpression("* * * *"));
  assert.ok(!isValidCronExpression("61 * * * *"));
  assert.ok(!isValidCronExpression("*/0 * * * *"));
  assert.ok(!isValidCronExpression("banana * * * *"));
});

test("multiple schedules per connection are admin-only and validated", async () => {
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
    method: "POST",
    url: "/api/integrations/schedules",
    headers: authHeaders(editorToken),
    payload: {
      connectionId: created.id,
      name: "Hourly",
      cron: "0 * * * *",
    },
  });
  assert.equal(editorAttempt.statusCode, 403);

  const badCron = await app.inject({
    method: "POST",
    url: "/api/integrations/schedules",
    headers: authHeaders(adminToken),
    payload: { connectionId: created.id, name: "Bad", cron: "not a cron" },
  });
  assert.equal(badCron.statusCode, 400);

  const badLab = await app.inject({
    method: "POST",
    url: "/api/integrations/schedules",
    headers: authHeaders(adminToken),
    payload: {
      connectionId: created.id,
      name: "Bad lab",
      cron: "0 * * * *",
      labIds: ["lab_missing"],
    },
  });
  assert.equal(badLab.statusCode, 422);

  // Two schedules with different labs and cadences on one connection.
  const hourly = await createSchedule(adminToken, {
    connectionId: created.id,
    name: "Hourly main lab",
    cron: "0 * * * *",
    mode: "merge",
    labIds: [labId],
  });
  const nightly = await createSchedule(adminToken, {
    connectionId: created.id,
    name: "Nightly staging",
    cron: "0 2 * * *",
    mode: "mirror",
    labIds: [secondLabId],
  });
  assert.notEqual(hourly.id, nightly.id);

  const listResponse = await app.inject({
    method: "GET",
    url: `/api/integrations/schedules?connectionId=${created.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(listResponse.statusCode, 200);
  const schedules = JSON.parse(listResponse.body) as Array<{
    id: string;
    name: string;
    mode: string;
    labIds: string[];
  }>;
  assert.equal(schedules.length, 2);
  assert.deepEqual(schedules.map((entry) => entry.mode).sort(), [
    "merge",
    "mirror",
  ]);

  const patched = await app.inject({
    method: "PATCH",
    url: `/api/integrations/schedules/${hourly.id}`,
    headers: authHeaders(adminToken),
    payload: { cron: "*/30 * * * *", name: "Half-hourly" },
  });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.equal(
    (JSON.parse(patched.body) as { cron: string }).cron,
    "*/30 * * * *",
  );

  const deleted = await app.inject({
    method: "DELETE",
    url: `/api/integrations/schedules/${nightly.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(deleted.statusCode, 204);
});

test("schedule runs populate their own target labs and honor modes", async () => {
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
  const mergeSchedule = await createSchedule(adminToken, {
    connectionId: created.id,
    name: "Merge both labs",
    cron: "*/15 * * * *",
    mode: "merge",
    labIds: [labId, secondLabId],
  });
  const skipSchedule = await createSchedule(adminToken, {
    connectionId: created.id,
    name: "Updater",
    cron: "0 * * * *",
    mode: "skip",
    labIds: [labId],
  });
  const mirrorSchedule = await createSchedule(adminToken, {
    connectionId: created.id,
    name: "Mirror main",
    cron: "0 3 * * *",
    mode: "mirror",
    labIds: [labId],
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

  const mergeRun = await runIntegrationSyncSchedule(mergeSchedule.id);
  assert.equal(mergeRun.status, "ok", mergeRun.message);
  for (const targetLab of [labId, secondLabId]) {
    const vlan = db
      .prepare("SELECT name FROM vlans WHERE labId = ? AND vlanId = 10")
      .get(targetLab) as { name: string } | undefined;
    assert.equal(vlan?.name, "Servers", `lab ${targetLab} should have VLAN 10`);
  }
  const auditRow = db
    .prepare(
      "SELECT user FROM auditLog WHERE action = 'integration.sync.apply' LIMIT 1",
    )
    .get() as { user: string } | undefined;
  assert.equal(auditRow?.user, "integration-auto-sync");

  // Upstream rename: skip mode applies adds and updates but never deletes.
  db.prepare(
    "INSERT INTO vlans (id, labId, vlanId, name) VALUES ('v_gone', ?, 99, 'Stale')",
  ).run(labId);
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
  const skipRun = await runIntegrationSyncSchedule(skipSchedule.id);
  assert.equal(skipRun.status, "ok", skipRun.message);
  const vlanName = (
    db
      .prepare("SELECT name FROM vlans WHERE labId = ? AND vlanId = 10")
      .get(labId) as { name: string }
  ).name;
  assert.equal(vlanName, "Renamed Servers", "skip mode applies updates");
  assert.ok(
    db.prepare("SELECT id FROM vlans WHERE id = 'v_gone'").get(),
    "skip mode never deletes",
  );

  // Mirror removes destination records that are gone from the source.
  const mirrorRun = await runIntegrationSyncSchedule(mirrorSchedule.id);
  assert.equal(mirrorRun.status, "ok", mirrorRun.message);
  assert.equal(
    db.prepare("SELECT id FROM vlans WHERE id = 'v_gone'").get(),
    undefined,
    "mirror deletes records missing from the source",
  );
  assert.ok(
    db
      .prepare("SELECT id FROM vlans WHERE labId = ? AND vlanId = 10")
      .get(labId),
    "records present in the source survive a mirror",
  );
});

test("schedule failures back off and the scanner respects pauses", async () => {
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
  const schedule = await createSchedule(adminToken, {
    connectionId: created.id,
    name: "Every minute",
    cron: "* * * * *",
  });

  setIntegrationClientOverrideForTests("opnsense", {
    provider: "opnsense",
    test: async () => ({ product: "OPNsense", version: "25.7", summary: {} }),
    fetchInventory: async () => {
      throw new Error("Could not reach OPNsense: connection refused.");
    },
  });

  const firstFailure = await runIntegrationSyncSchedule(schedule.id);
  assert.equal(firstFailure.status, "error");
  assert.match(firstFailure.message, /Retrying after 5 minute/);

  const secondFailure = await runIntegrationSyncSchedule(schedule.id);
  assert.match(secondFailure.message, /Retrying after 10 minute/);

  const due = findDueIntegrationSyncSchedules(new Date(), null);
  assert.ok(!due.includes(schedule.id), "paused schedules are not due");

  setIntegrationClientOverrideForTests("opnsense", {
    provider: "opnsense",
    test: async () => ({ product: "OPNsense", version: "25.7", summary: {} }),
    fetchInventory: async () => ({
      collection: { vlans: [], subnets: [], dhcpScopes: [] },
      devices: [],
      warnings: [],
    }),
  });
  const recovery = await runIntegrationSyncSchedule(schedule.id);
  assert.equal(recovery.status, "ok");
  const row = db
    .prepare(
      "SELECT failureCount, pausedUntil FROM integrationSyncSchedules WHERE id = ?",
    )
    .get(schedule.id) as { failureCount: number; pausedUntil: string | null };
  assert.equal(row.failureCount, 0);
  assert.equal(row.pausedUntil, null);
});

test("the scanner finds due schedules and disabled connections are skipped", async () => {
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
  const schedule = await createSchedule(adminToken, {
    connectionId: created.id,
    name: "Nightly",
    cron: "30 2 * * *",
  });

  const at230 = new Date(2026, 7, 15, 2, 30, 5);
  const at229 = new Date(2026, 7, 15, 2, 29, 5);
  assert.deepEqual(findDueIntegrationSyncSchedules(at230, at229), [
    schedule.id,
  ]);
  assert.deepEqual(
    findDueIntegrationSyncSchedules(new Date(2026, 7, 15, 3, 0, 5), null),
    [],
  );
  // A slow tick that jumps past 02:30 still catches the run.
  assert.deepEqual(
    findDueIntegrationSyncSchedules(
      new Date(2026, 7, 15, 2, 32, 5),
      new Date(2026, 7, 15, 2, 28, 5),
    ),
    [schedule.id],
  );

  await app.inject({
    method: "PATCH",
    url: `/api/integrations/connections/${created.id}`,
    headers: authHeaders(adminToken),
    payload: { enabled: false },
  });
  assert.deepEqual(findDueIntegrationSyncSchedules(at230, at229), []);
});

test("device import creates loose gear with ports and WiFi inventory", async () => {
  const adminToken = await bootstrapAdmin();
  const labId = await firstLabId(adminToken);
  const created = await createConnection(adminToken, {
    labId,
    provider: "unifi",
    name: "UniFi console",
    baseUrl: "https://unifi.lab.internal",
    authKind: "api-key",
    authSecret: "unifi-api-key",
  });

  const importableDevices = [
    {
      name: "core-switch",
      deviceType: "switch",
      model: "USW-24-POE",
      macAddress: "AA:BB:CC:00:11:22",
      ipAddress: "192.168.1.2",
      serial: "SER123",
      firmware: "7.1.20",
      online: true,
      ports: [
        {
          name: "Port 1",
          kind: "rj45",
          speed: "1G",
          linkState: "up",
          mode: "access",
          untaggedVlanNumber: 10,
          taggedVlanNumbers: [],
        },
        {
          name: "SFP 1",
          kind: "sfp_plus",
          speed: "10G",
          linkState: "down",
          mode: "trunk",
          untaggedVlanNumber: null,
          // VLAN 20 does not exist in the lab and must be dropped silently.
          taggedVlanNumbers: [10, 20],
        },
      ],
    },
    {
      name: "office-ap",
      deviceType: "ap",
      model: "U6-LR",
      // Dashed lowercase on purpose: stored MACs are canonicalized.
      macAddress: "aa-bb-cc-00-11-33",
      ipAddress: "192.168.1.3",
      serial: null,
      firmware: "6.6.55",
      online: true,
      ports: [],
    },
    {
      name: "pve1",
      deviceType: "server",
      model: "Proxmox VE node",
      macAddress: null,
      ipAddress: null,
      serial: null,
      firmware: null,
      online: true,
      ports: [],
    },
    {
      name: "web01",
      deviceType: "vm",
      model: "QEMU virtual machine",
      macAddress: "AA:BB:CC:00:11:44",
      ipAddress: "192.168.1.50",
      serial: null,
      firmware: null,
      online: true,
      parentName: "pve1",
      ports: [
        {
          name: "net0",
          kind: "virtual",
          speed: "virtual",
          linkState: "up",
          mode: "access",
          untaggedVlanNumber: 10,
          taggedVlanNumbers: [],
          macAddress: "AA:BB:CC:00:11:44",
          virtualSwitchName: "vmbr0",
          ipAddresses: ["192.168.1.50"],
        },
      ],
    },
  ];
  const virtualSwitches = [
    {
      name: "vmbr0",
      hostName: "pve1",
      kind: "external",
      notes: "Members: eno1",
    },
  ];
  const wifi = {
    controllerName: "UniFi Network (UniFi console)",
    vendor: "Ubiquiti",
    managementIp: null,
    ssids: [
      { name: "HomeLab", vlanNumber: 10, security: "wpapsk", hidden: false },
    ],
  };

  setIntegrationClientOverrideForTests("unifi", {
    provider: "unifi",
    test: async () => ({
      product: "UniFi Network",
      version: "10.1.84",
      summary: {},
    }),
    fetchInventory: async () => ({
      collection: {
        vlans: [{ vlanNumber: 10, name: "Servers" }],
        subnets: [],
        dhcpScopes: [],
      },
      devices: [],
      importableDevices:
        importableDevices as unknown as import("../lib/integrations/inventory.js").IntegrationImportableDevice[],
      virtualSwitches:
        virtualSwitches as unknown as import("../lib/integrations/inventory.js").IntegrationVirtualSwitchSpec[],
      wifi,
      warnings: [],
    }),
  });
  try {
    const pullResponse = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/inventory`,
      headers: authHeaders(adminToken),
      payload: {},
    });
    assert.equal(pullResponse.statusCode, 200, pullResponse.body);
    const pullBody = JSON.parse(pullResponse.body) as {
      deviceSync: {
        devices: Array<{ action: string; name: string; portCount: number }>;
        ssids: Array<{ action: string; name: string }>;
      };
    };
    assert.deepEqual(
      pullBody.deviceSync.devices.map((entry) => [
        entry.name,
        entry.action,
        entry.portCount,
      ]),
      [
        ["core-switch", "create", 2],
        ["office-ap", "create", 0],
        ["pve1", "create", 0],
        ["web01", "create", 1],
      ],
    );
    assert.deepEqual(pullBody.deviceSync.ssids, [
      { action: "create", name: "HomeLab", vlanNumber: 10 },
    ]);

    // Apply the networks first so the SSID VLAN link resolves, and seed a
    // management subnet so device IPs link as IP assignments.
    const vlanId = db
      .prepare(
        "INSERT INTO vlans (id, labId, vlanId, name) VALUES ('v_test', ?, 10, 'Servers')",
      )
      .run(labId);
    assert.ok(vlanId);
    db.prepare(
      "INSERT INTO subnets (id, labId, cidr, name) VALUES ('sub_test', ?, '192.168.1.0/24', 'Management')",
    ).run(labId);

    const applyResponse = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/apply-devices`,
      headers: authHeaders(adminToken),
      payload: { importableDevices, wifi, virtualSwitches },
    });
    assert.equal(applyResponse.statusCode, 200, applyResponse.body);
    const applyBody = JSON.parse(applyResponse.body) as {
      createdDeviceIds: string[];
      createdPortCount: number;
      createdSsidIds: string[];
      createdIpAssignmentIds: string[];
      linkedAccessPoints: number;
    };
    assert.equal(applyBody.createdDeviceIds.length, 4);
    assert.equal(applyBody.createdPortCount, 3);
    assert.equal(applyBody.createdSsidIds.length, 1);
    assert.equal(applyBody.linkedAccessPoints, 1);
    assert.equal(
      applyBody.createdIpAssignmentIds.length,
      3,
      "device IPs inside the seeded subnet become IP assignments",
    );
    const ipRows = db
      .prepare(
        "SELECT ipAddress FROM ipAssignments WHERE subnetId = 'sub_test' ORDER BY ipAddress",
      )
      .all() as Array<{ ipAddress: string }>;
    assert.deepEqual(
      ipRows.map((row) => row.ipAddress),
      ["192.168.1.2", "192.168.1.3", "192.168.1.50"],
    );

    // MACs are canonicalized to uppercase colon form on the way in.
    const apMac = db
      .prepare("SELECT macAddress FROM devices WHERE hostname = 'office-ap'")
      .get() as { macAddress: string };
    assert.equal(apMac.macAddress, "AA:BB:CC:00:11:33");

    // The guest hangs under its host with its NIC on the virtual switch.
    const guestRow = db
      .prepare(
        "SELECT id, placement, parentDeviceId FROM devices WHERE hostname = 'web01'",
      )
      .get() as {
      id: string;
      placement: string;
      parentDeviceId: string | null;
    };
    const hostRow = db
      .prepare("SELECT id FROM devices WHERE hostname = 'pve1'")
      .get() as { id: string };
    assert.equal(guestRow.placement, "virtual");
    assert.equal(guestRow.parentDeviceId, hostRow.id);
    const vswitchRow = db
      .prepare(
        "SELECT id, kind FROM virtualSwitches WHERE hostDeviceId = ? AND name = 'vmbr0'",
      )
      .get(hostRow.id) as { id: string; kind: string };
    assert.equal(vswitchRow.kind, "external");
    const guestPort = db
      .prepare(
        "SELECT kind, virtualSwitchId, vlanId, macAddress FROM ports WHERE deviceId = ?",
      )
      .get(guestRow.id) as {
      kind: string;
      virtualSwitchId: string | null;
      vlanId: string | null;
      macAddress: string | null;
    };
    assert.equal(guestPort.kind, "virtual");
    assert.equal(guestPort.virtualSwitchId, vswitchRow.id);
    assert.equal(guestPort.vlanId, "v_test");
    assert.equal(guestPort.macAddress, "AA:BB:CC:00:11:44");

    const switchRow = db
      .prepare(
        "SELECT deviceType, placement, rackId, macAddress, manufacturer FROM devices WHERE hostname = 'core-switch'",
      )
      .get() as {
      deviceType: string;
      placement: string;
      rackId: string | null;
      macAddress: string;
      manufacturer: string;
    };
    assert.equal(switchRow.deviceType, "switch");
    assert.equal(switchRow.placement, "room", "imported as loose gear");
    assert.equal(switchRow.rackId, null);
    assert.equal(switchRow.manufacturer, "Ubiquiti");

    const portRows = db
      .prepare(
        "SELECT ports.name, ports.kind, ports.speed, ports.mode, ports.vlanId, ports.allowedVlanIds FROM ports JOIN devices ON devices.id = ports.deviceId WHERE devices.hostname = 'core-switch' ORDER BY ports.position",
      )
      .all() as Array<{
      name: string;
      kind: string;
      speed: string;
      mode: string;
      vlanId: string | null;
      allowedVlanIds: string | null;
    }>;
    assert.deepEqual(portRows, [
      {
        name: "Port 1",
        kind: "rj45",
        speed: "1G",
        mode: "access",
        vlanId: "v_test",
        allowedVlanIds: null,
      },
      {
        name: "SFP 1",
        kind: "sfp_plus",
        speed: "10G",
        mode: "trunk",
        vlanId: null,
        allowedVlanIds: '["v_test"]',
      },
    ]);

    const ssidRow = db
      .prepare(
        "SELECT vlanId FROM wifiSsids WHERE labId = ? AND name = 'HomeLab'",
      )
      .get(labId) as { vlanId: string | null };
    assert.equal(ssidRow.vlanId, "v_test", "SSID linked to the VLAN");
    const apRow = db
      .prepare(
        "SELECT wifiAccessPoints.controllerId FROM wifiAccessPoints JOIN devices ON devices.id = wifiAccessPoints.deviceId WHERE devices.hostname = 'office-ap'",
      )
      .get() as { controllerId: string };
    assert.ok(apRow.controllerId, "AP linked to the controller");

    // Re-applying must be a no-op (merge semantics).
    const reapply = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${created.id}/apply-devices`,
      headers: authHeaders(adminToken),
      payload: { importableDevices, wifi, virtualSwitches },
    });
    assert.equal(reapply.statusCode, 200);
    const reapplyBody = JSON.parse(reapply.body) as {
      createdDeviceIds: string[];
      createdSsidIds: string[];
      createdIpAssignmentIds: string[];
    };
    assert.equal(reapplyBody.createdDeviceIds.length, 0);
    assert.equal(reapplyBody.createdSsidIds.length, 0);
    assert.equal(reapplyBody.createdIpAssignmentIds.length, 0);
    const vswitchCount = db
      .prepare(
        "SELECT COUNT(*) AS n FROM virtualSwitches WHERE hostDeviceId = ?",
      )
      .get(hostRow.id) as { n: number };
    assert.equal(vswitchCount.n, 1, "vswitch upsert is idempotent");
  } finally {
    setIntegrationClientOverrideForTests("unifi", null);
  }
});

function resetDatabase() {
  db.exec(`
    DELETE FROM userSessions;
    DELETE FROM oidcIdentities;
    DELETE FROM userLabAccess;
    DELETE FROM integrationSyncSchedules;
    DELETE FROM integrationConnections;
    DELETE FROM wifiRadioSsids;
    DELETE FROM wifiClientAssociations;
    DELETE FROM wifiRadios;
    DELETE FROM wifiAccessPoints;
    DELETE FROM wifiSsids;
    DELETE FROM wifiControllers;
    DELETE FROM auditLog;
    DELETE FROM ipAssignments;
    DELETE FROM dhcpScopes;
    DELETE FROM subnets;
    DELETE FROM ports;
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

async function createSchedule(token: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/integrations/schedules",
    headers: authHeaders(token),
    payload,
  });
  assert.equal(response.statusCode, 201, response.body);
  return JSON.parse(response.body) as { id: string };
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

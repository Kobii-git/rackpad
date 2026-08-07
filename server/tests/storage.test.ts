import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "rackpad-storage-tests-"));
process.env.DATABASE_PATH = path.join(tempDir, "rackpad-storage-test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "rackpad-storage-test-secret";

const { createApp } = await import("../app.js");
const { db } = await import("../db.js");
const { setBootstrapState } = await import("../lib/auth.js");

type AppInstance = Awaited<ReturnType<typeof createApp>>;
type Slot = { id: string; driveId: string | null };
type Drive = { id: string; slotId: string | null };
type Pool = {
  id: string;
  driveIds: string[];
  usableCapacityGb: number;
  status: string;
};

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

test("storage templates are admin-managed, inherited, and applied as snapshots", async () => {
  const adminToken = await bootstrapAdmin();
  const headers = authHeaders(adminToken);
  const labId = await firstLabId(adminToken);

  const templatesRes = await app.inject({
    method: "GET",
    url: "/api/storage/drive-bay-templates",
    headers,
  });
  assert.equal(templatesRes.statusCode, 200);
  const builtIns = json(templatesRes) as Array<{
    builtIn: boolean;
    sections: Array<{ slots: unknown[] }>;
  }>;
  assert.equal(builtIns.filter((template) => template.builtIn).length, 5);
  assert.ok(
    builtIns.some(
      (template) =>
        template.sections.reduce(
          (sum, section) => sum + section.slots.length,
          0,
        ) === 24,
    ),
  );

  const viewerToken = await createUserAndLogin(adminToken, {
    username: "storage-viewer",
    displayName: "Storage Viewer",
    password: "storage-viewer-1",
    role: "viewer",
  });
  const forbidden = await app.inject({
    method: "POST",
    url: "/api/storage/drive-bay-templates",
    headers: authHeaders(viewerToken),
    payload: templatePayload("Viewer template", 1),
  });
  assert.equal(forbidden.statusCode, 403);

  const typeRes = await app.inject({
    method: "POST",
    url: "/api/device-types",
    headers,
    payload: { label: "Disk shelf", parentType: "storage" },
  });
  assert.equal(typeRes.statusCode, 201);
  const customTypeId = (json(typeRes) as { id: string }).id;

  const templateRes = await app.inject({
    method: "POST",
    url: "/api/storage/drive-bay-templates",
    headers,
    payload: templatePayload("Two bay shelf", 2),
  });
  assert.equal(templateRes.statusCode, 201);
  const templateId = (json(templateRes) as { id: string }).id;

  const device = await createDevice(adminToken, {
    labId,
    hostname: "shelf-snapshot",
    deviceType: customTypeId,
    storageGb: 777,
    driveBayTemplateId: templateId,
  });
  assert.equal((await listSlots(adminToken, device.id)).length, 2);

  const updateTemplateRes = await app.inject({
    method: "PATCH",
    url: `/api/storage/drive-bay-templates/${templateId}`,
    headers,
    payload: { sections: templatePayload("Ignored", 3).sections },
  });
  assert.equal(updateTemplateRes.statusCode, 200);
  assert.equal((await listSlots(adminToken, device.id)).length, 2);

  const reapplyRes = await app.inject({
    method: "PATCH",
    url: `/api/devices/${device.id}`,
    headers,
    payload: { driveBayTemplateId: "storage-4x3-5" },
  });
  assert.equal(reapplyRes.statusCode, 409);

  const deviceRes = await app.inject({
    method: "GET",
    url: `/api/devices/${device.id}`,
    headers,
  });
  assert.equal((json(deviceRes) as { storageGb: number }).storageGb, 777);
});

test("device template updates roll back every mutation on validation or database failure", async () => {
  const adminToken = await bootstrapAdmin();
  const headers = authHeaders(adminToken);
  const labId = await firstLabId(adminToken);
  const device = await createDevice(adminToken, {
    labId,
    hostname: "atomic-template-host",
    deviceType: "server",
  });

  const invalidTemplate = await app.inject({
    method: "PATCH",
    url: `/api/devices/${device.id}`,
    headers,
    payload: {
      portTemplateId: "server-4x1g-2x10g",
      driveBayTemplateId: "missing-drive-template",
    },
  });
  assert.equal(invalidTemplate.statusCode, 400);
  assert.equal(countRows("ports", "deviceId", device.id), 0);
  assert.equal(countRows("driveSlots", "deviceId", device.id), 0);

  db.exec(`
    CREATE TRIGGER fail_atomic_device_update
    BEFORE UPDATE ON devices
    WHEN NEW.id = '${device.id}'
    BEGIN
      SELECT RAISE(ABORT, 'forced device update failure');
    END;
  `);
  try {
    const failedUpdate = await app.inject({
      method: "PATCH",
      url: `/api/devices/${device.id}`,
      headers,
      payload: {
        hostname: "should-not-persist",
        portTemplateId: "server-4x1g-2x10g",
        driveBayTemplateId: "storage-4x3-5",
      },
    });
    assert.equal(failedUpdate.statusCode, 500);
  } finally {
    db.exec("DROP TRIGGER IF EXISTS fail_atomic_device_update;");
  }

  assert.equal(countRows("ports", "deviceId", device.id), 0);
  assert.equal(countRows("driveSlots", "deviceId", device.id), 0);
  const stored = db
    .prepare("SELECT hostname FROM devices WHERE id = ?")
    .get(device.id) as { hostname: string };
  assert.equal(stored.hostname, "atomic-template-host");
  assert.equal(
    countAuditRows("storage.template.apply", "Device", device.id),
    0,
  );
});

test("storage API mutations write one server-owned audit entry for lab editors", async () => {
  const adminToken = await bootstrapAdmin();
  const headers = authHeaders(adminToken);
  const labId = await firstLabId(adminToken);
  const foreignLabRes = await app.inject({
    method: "POST",
    url: "/api/labs",
    headers,
    payload: { name: "Audit foreign lab" },
  });
  assert.equal(foreignLabRes.statusCode, 201);
  const foreignLabId = (json(foreignLabRes) as { id: string }).id;
  const homeDevice = await createDevice(adminToken, {
    labId,
    hostname: "audit-storage-host",
    deviceType: "storage",
    driveBayTemplateId: "storage-4x3-5",
  });
  const foreignDevice = await createDevice(adminToken, {
    labId: foreignLabId,
    hostname: "audit-foreign-host",
    deviceType: "storage",
    driveBayTemplateId: "storage-4x3-5",
  });
  const homeSlots = await listSlots(adminToken, homeDevice.id);
  const foreignSlots = await listSlots(adminToken, foreignDevice.id);
  const editorToken = await createUserAndLogin(adminToken, {
    username: "storage-editor",
    displayName: "Storage Editor",
    password: "storage-editor-1",
    role: "editor",
    labAccess: [{ labId, role: "editor" }],
  });
  const editorHeaders = authHeaders(editorToken);

  const slotRes = await app.inject({
    method: "POST",
    url: "/api/storage/drive-slots",
    headers: editorHeaders,
    payload: {
      deviceId: homeDevice.id,
      name: "Audit spare slot",
      sectionName: "Rear",
      position: 1,
      slotType: "2.5",
      face: "rear",
      layout: "list",
    },
  });
  assert.equal(slotRes.statusCode, 201, slotRes.body);
  const slotId = (json(slotRes) as { id: string }).id;
  const slotUpdate = await app.inject({
    method: "PATCH",
    url: `/api/storage/drive-slots/${slotId}`,
    headers: editorHeaders,
    payload: { name: "Audit spare slot updated" },
  });
  assert.equal(slotUpdate.statusCode, 200);
  const slotDelete = await app.inject({
    method: "DELETE",
    url: `/api/storage/drive-slots/${slotId}`,
    headers: editorHeaders,
  });
  assert.equal(slotDelete.statusCode, 204);

  const drive = await createDrive(editorToken, {
    labId,
    serial: "AUDIT-001",
    slotId: homeSlots[0].id,
  });
  const driveUpdate = await app.inject({
    method: "PATCH",
    url: `/api/storage/drives/${drive.id}`,
    headers: editorHeaders,
    payload: { notes: "Audited update" },
  });
  assert.equal(driveUpdate.statusCode, 200);
  const poolRes = await app.inject({
    method: "POST",
    url: "/api/storage/pools",
    headers: editorHeaders,
    payload: poolPayload(homeDevice.id, "audit-pool", [drive.id]),
  });
  assert.equal(poolRes.statusCode, 201);
  const pool = json(poolRes) as Pool;
  const poolUpdate = await app.inject({
    method: "PATCH",
    url: `/api/storage/pools/${pool.id}`,
    headers: editorHeaders,
    payload: { status: "degraded" },
  });
  assert.equal(poolUpdate.statusCode, 200);
  const poolDelete = await app.inject({
    method: "DELETE",
    url: `/api/storage/pools/${pool.id}`,
    headers: editorHeaders,
  });
  assert.equal(poolDelete.statusCode, 204);
  const driveDelete = await app.inject({
    method: "DELETE",
    url: `/api/storage/drives/${drive.id}`,
    headers: editorHeaders,
  });
  assert.equal(driveDelete.statusCode, 204);

  const forbidden = await app.inject({
    method: "POST",
    url: "/api/storage/drives",
    headers: editorHeaders,
    payload: drivePayload(foreignLabId, "AUDIT-FOREIGN", foreignSlots[0].id),
  });
  assert.equal(forbidden.statusCode, 403);

  const expectedActions = [
    "storage.slot.create",
    "storage.slot.update",
    "storage.slot.delete",
    "storage.drive.create",
    "storage.drive.update",
    "storage.drive.delete",
    "storage.pool.create",
    "storage.pool.update",
    "storage.pool.delete",
  ];
  for (const action of expectedActions) {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS count FROM auditLog WHERE user = ? AND action = ?",
      )
      .get("storage-editor", action) as { count: number };
    assert.equal(row.count, 1, action);
  }
  const foreignAudit = db
    .prepare(
      "SELECT COUNT(*) AS count FROM auditLog WHERE user = ? AND summary LIKE ?",
    )
    .get("storage-editor", "%AUDIT-FOREIGN%") as { count: number };
  assert.equal(foreignAudit.count, 0);
});

test("lab deletion clears pool memberships before cascading storage inventory", async () => {
  const adminToken = await bootstrapAdmin();
  const headers = authHeaders(adminToken);
  const labRes = await app.inject({
    method: "POST",
    url: "/api/labs",
    headers,
    payload: { name: "Disposable storage lab" },
  });
  assert.equal(labRes.statusCode, 201);
  const labId = (json(labRes) as { id: string }).id;
  const device = await createDevice(adminToken, {
    labId,
    hostname: "disposable-storage-host",
    deviceType: "storage",
    driveBayTemplateId: "storage-4x3-5",
  });
  const slots = await listSlots(adminToken, device.id);
  const drive = await createDrive(adminToken, {
    labId,
    serial: "DISPOSABLE-001",
    slotId: slots[0].id,
  });
  const poolRes = await app.inject({
    method: "POST",
    url: "/api/storage/pools",
    headers,
    payload: poolPayload(device.id, "disposable-pool", [drive.id]),
  });
  assert.equal(poolRes.statusCode, 201);
  const poolId = (json(poolRes) as Pool).id;

  const deleteRes = await app.inject({
    method: "DELETE",
    url: `/api/labs/${labId}`,
    headers,
  });
  assert.equal(deleteRes.statusCode, 204, deleteRes.body);
  assert.equal(countRows("devices", "labId", labId), 0);
  assert.equal(countRows("storageDrives", "labId", labId), 0);
  assert.equal(countRows("storagePoolDrives", "poolId", poolId), 0);
});

test("drive inventory and cross-device pools enforce storage invariants atomically", async () => {
  const adminToken = await bootstrapAdmin();
  const headers = authHeaders(adminToken);
  const labId = await firstLabId(adminToken);
  const secondLabRes = await app.inject({
    method: "POST",
    url: "/api/labs",
    headers,
    payload: { name: "Foreign storage lab" },
  });
  assert.equal(secondLabRes.statusCode, 201);
  const secondLabId = (json(secondLabRes) as { id: string }).id;

  const host = await createDevice(adminToken, {
    labId,
    hostname: "pool-host",
    deviceType: "server",
    storageGb: 4321,
    driveBayTemplateId: "storage-4x3-5",
  });
  const shelf = await createDevice(adminToken, {
    labId,
    hostname: "jbod-01",
    deviceType: "storage_enclosure",
    driveBayTemplateId: "storage-4x3-5",
  });
  const foreignHost = await createDevice(adminToken, {
    labId: secondLabId,
    hostname: "foreign-host",
    deviceType: "storage",
    driveBayTemplateId: "storage-4x3-5",
  });
  const hostSlots = await listSlots(adminToken, host.id);
  const shelfSlots = await listSlots(adminToken, shelf.id);
  const foreignSlots = await listSlots(adminToken, foreignHost.id);

  const drive1 = await createDrive(adminToken, {
    labId,
    serial: "POOL-001",
    slotId: hostSlots[0].id,
  });
  const drive2 = await createDrive(adminToken, {
    labId,
    serial: "POOL-002",
    slotId: shelfSlots[0].id,
  });
  const foreignDrive = await createDrive(adminToken, {
    labId: secondLabId,
    serial: "FOREIGN-001",
    slotId: foreignSlots[0].id,
  });

  const duplicateSerial = await app.inject({
    method: "POST",
    url: "/api/storage/drives",
    headers,
    payload: drivePayload(labId, "pool-001", hostSlots[1].id),
  });
  assert.equal(duplicateSerial.statusCode, 409);
  const occupancyConflict = await app.inject({
    method: "POST",
    url: "/api/storage/drives",
    headers,
    payload: drivePayload(labId, "POOL-003", hostSlots[0].id),
  });
  assert.equal(occupancyConflict.statusCode, 409);

  const poolRes = await app.inject({
    method: "POST",
    url: "/api/storage/pools",
    headers,
    payload: poolPayload(host.id, "tank", [drive1.id, drive2.id]),
  });
  assert.equal(poolRes.statusCode, 201);
  const pool = json(poolRes) as Pool;
  assert.deepEqual([...pool.driveIds].sort(), [drive1.id, drive2.id].sort());

  const exclusiveConflict = await app.inject({
    method: "POST",
    url: "/api/storage/pools",
    headers,
    payload: poolPayload(shelf.id, "other", [drive2.id]),
  });
  assert.equal(exclusiveConflict.statusCode, 409);

  const atomicConflict = await app.inject({
    method: "PATCH",
    url: `/api/storage/pools/${pool.id}`,
    headers,
    payload: { driveIds: [drive1.id, foreignDrive.id] },
  });
  assert.equal(atomicConflict.statusCode, 400);
  assert.deepEqual(
    [...(await listPools(adminToken, host.id))[0].driveIds].sort(),
    [drive1.id, drive2.id].sort(),
  );

  const unslotRes = await app.inject({
    method: "PATCH",
    url: `/api/storage/drives/${drive2.id}`,
    headers,
    payload: { slotId: null },
  });
  assert.equal(unslotRes.statusCode, 200);
  assert.equal((json(unslotRes) as Drive).slotId, null);
  assert.deepEqual(
    [...(await listPools(adminToken, host.id))[0].driveIds].sort(),
    [drive1.id, drive2.id].sort(),
  );

  const blockedDelete = await app.inject({
    method: "DELETE",
    url: `/api/storage/drives/${drive2.id}`,
    headers,
  });
  assert.equal(blockedDelete.statusCode, 409);

  const updatePoolRes = await app.inject({
    method: "PATCH",
    url: `/api/storage/pools/${pool.id}`,
    headers,
    payload: {
      driveIds: [drive1.id],
      usableCapacityGb: 8000,
      status: "rebuilding",
    },
  });
  assert.equal(updatePoolRes.statusCode, 200);
  const updatedPool = json(updatePoolRes) as Pool;
  assert.equal(updatedPool.usableCapacityGb, 8000);
  assert.equal(updatedPool.status, "rebuilding");

  const deleteReleasedDrive = await app.inject({
    method: "DELETE",
    url: `/api/storage/drives/${drive2.id}`,
    headers,
  });
  assert.equal(deleteReleasedDrive.statusCode, 204);

  const preservedDrive = await createDrive(adminToken, {
    labId,
    serial: "PRESERVE-001",
    slotId: shelfSlots[1].id,
  });
  const deleteDeviceRes = await app.inject({
    method: "DELETE",
    url: `/api/devices/${shelf.id}`,
    headers,
  });
  assert.equal(deleteDeviceRes.statusCode, 204);
  const inventoryRes = await app.inject({
    method: "GET",
    url: `/api/storage/drives?labId=${labId}`,
    headers,
  });
  const preserved = (json(inventoryRes) as Drive[]).find(
    (drive) => drive.id === preservedDrive.id,
  );
  assert.ok(preserved);
  assert.equal(preserved.slotId, null);

  const hostRes = await app.inject({
    method: "GET",
    url: `/api/devices/${host.id}`,
    headers,
  });
  assert.equal((json(hostRes) as { storageGb: number }).storageGb, 4321);
});

test("storage backup restore preserves relationships and accepts legacy backups", async () => {
  const adminToken = await bootstrapAdmin();
  const labId = await firstLabId(adminToken);
  const device = await createDevice(adminToken, {
    labId,
    hostname: "restore-storage",
    deviceType: "storage",
    driveBayTemplateId: "storage-4x3-5",
  });
  const slots = await listSlots(adminToken, device.id);
  const drive = await createDrive(adminToken, {
    labId,
    serial: "RESTORE-001",
    slotId: slots[0].id,
  });
  const poolRes = await app.inject({
    method: "POST",
    url: "/api/storage/pools",
    headers: authHeaders(adminToken),
    payload: poolPayload(device.id, "restore-pool", [drive.id]),
  });
  assert.equal(poolRes.statusCode, 201);

  const exportRes = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: authHeaders(adminToken),
  });
  assert.equal(exportRes.statusCode, 200);
  const snapshot = json(exportRes) as {
    data: Record<string, unknown[]>;
  };
  assert.equal(snapshot.data.storageDrives.length, 1);
  assert.equal(snapshot.data.driveSlots.length, 4);
  assert.equal(snapshot.data.storagePools.length, 1);
  assert.equal(snapshot.data.storagePoolDrives.length, 1);

  const restoreRes = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers: authHeaders(adminToken),
    payload: snapshot,
  });
  assert.equal(restoreRes.statusCode, 200);
  const refreshedToken = await loginAdmin();
  assert.deepEqual((await listPools(refreshedToken, device.id))[0].driveIds, [
    drive.id,
  ]);

  const legacyExportRes = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: authHeaders(refreshedToken),
  });
  const legacySnapshot = json(legacyExportRes) as {
    data: Record<string, unknown>;
  };
  for (const key of [
    "driveBayTemplates",
    "storageDrives",
    "driveSlots",
    "storagePools",
    "storagePoolDrives",
  ]) {
    delete legacySnapshot.data[key];
  }
  const legacyRestoreRes = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers: authHeaders(refreshedToken),
    payload: legacySnapshot,
  });
  assert.equal(legacyRestoreRes.statusCode, 200);
  const result = json(legacyRestoreRes) as {
    counts: {
      storageDrives: number;
      driveSlots: number;
      storagePools: number;
      storagePoolDrives: number;
    };
  };
  assert.equal(result.counts.storageDrives, 0);
  assert.equal(result.counts.driveSlots, 0);
  assert.equal(result.counts.storagePools, 0);
  assert.equal(result.counts.storagePoolDrives, 0);
});

function resetDatabase() {
  db.exec(`
    DELETE FROM userSessions;
    DELETE FROM oidcIdentities;
    DELETE FROM userLabAccess;
    DELETE FROM storagePoolDrives;
    DELETE FROM storagePools;
    DELETE FROM driveSlots;
    DELETE FROM storageDrives;
    DELETE FROM driveBayTemplates;
    DELETE FROM auditLog;
    DELETE FROM ipAssignments;
    DELETE FROM portLinks;
    DELETE FROM ports;
    DELETE FROM virtualSwitches;
    DELETE FROM ipZones;
    DELETE FROM dhcpScopes;
    DELETE FROM subnets;
    DELETE FROM vlanRanges;
    DELETE FROM vlans;
    DELETE FROM portTemplates;
    DELETE FROM discoveredDevices;
    DELETE FROM devices;
    DELETE FROM racks;
    DELETE FROM rooms;
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
      displayName: "Storage Admin",
      password: "super-secret-1",
    },
  });
  assert.equal(response.statusCode, 201);
  return (json(response) as { token: string }).token;
}

async function loginAdmin() {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "super-secret-1" },
  });
  assert.equal(response.statusCode, 200);
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

async function createDevice(
  token: string,
  input: {
    labId: string;
    hostname: string;
    deviceType: string;
    storageGb?: number;
    driveBayTemplateId?: string;
    portTemplateId?: string;
  },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: authHeaders(token),
    payload: { status: "online", placement: "room", ...input },
  });
  assert.equal(response.statusCode, 201, response.body);
  return json(response) as { id: string };
}

async function listSlots(token: string, deviceId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/storage/drive-slots?deviceId=${deviceId}`,
    headers: authHeaders(token),
  });
  assert.equal(response.statusCode, 200);
  return json(response) as Slot[];
}

async function createDrive(
  token: string,
  input: { labId: string; serial: string; slotId?: string },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/storage/drives",
    headers: authHeaders(token),
    payload: drivePayload(input.labId, input.serial, input.slotId),
  });
  assert.equal(response.statusCode, 201, response.body);
  return json(response) as Drive;
}

async function listPools(token: string, deviceId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/storage/pools?deviceId=${deviceId}`,
    headers: authHeaders(token),
  });
  assert.equal(response.statusCode, 200);
  return json(response) as Pool[];
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

function templatePayload(name: string, count: number) {
  return {
    name,
    description: `${name} description`,
    deviceTypes: ["storage"],
    sections: [
      {
        name: "Front bays",
        face: "front",
        layout: "grid",
        columns: 4,
        slots: Array.from({ length: count }, (_, index) => ({
          name: `Bay ${index + 1}`,
          position: index + 1,
          slotType: "3.5",
        })),
      },
    ],
  };
}

function drivePayload(labId: string, serial: string, slotId?: string) {
  return {
    labId,
    manufacturer: "Seagate",
    model: "Exos",
    serial,
    capacityGb: 6000,
    interface: "sas",
    formFactor: "3.5",
    slotId: slotId ?? null,
  };
}

function poolPayload(deviceId: string, name: string, driveIds: string[]) {
  return {
    deviceId,
    name,
    poolType: "raidz1",
    usableCapacityGb: 12000,
    status: "healthy",
    driveIds,
  };
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function json(response: { body: string }) {
  return JSON.parse(response.body);
}

function countRows(table: "ports" | "driveSlots", key: string, value: string) {
  return (
    db
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${key} = ?`)
      .get(value) as { count: number }
  ).count;
}

function countAuditRows(action: string, entityType: string, entityId: string) {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM auditLog WHERE action = ? AND entityType = ? AND entityId = ?",
      )
      .get(action, entityType, entityId) as { count: number }
  ).count;
}

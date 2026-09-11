import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import type { RackStudioPlacementState } from "../lib/rack-studio-placement-core.js";
const directory = mkdtempSync(path.join(os.tmpdir(), "rackpad-stacks-"));
process.env.DATABASE_PATH = path.join(directory, "test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "stack-test-only-key";
const { createApp } = await import("../app.js");
const { db } = await import("../db.js");
const { validateRackpadSqliteDatabase } =
  await import("../lib/native-backup-validation.js");
const { buildStackPhysicalLayout } = await import("../lib/stack-layout.js");
const { listStackMembers } = await import("../lib/device-stacks.js");
const { validateResolvedPhysicalLayoutV1 } =
  await import("../lib/physical-layout.js");
const app = await createApp();
let token: string;
before(async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      password: "stack-test-password",
      displayName: "Admin",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  token = response.json().token;
});
after(async () => {
  await app.close();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
async function call(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: object,
  bearer = token,
) {
  return app.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}
async function device(name: string, extra: object = {}) {
  const response = await call("POST", "/api/devices", {
    labId: "lab_home",
    hostname: name,
    deviceType: "switch_stack",
    placement: "room",
    ...extra,
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string; heightU: number };
}
async function member(id: string, name: string, extra: object = {}) {
  const response = await call("POST", `/api/devices/${id}/stack-members`, {
    name,
    ...extra,
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string };
}

test("stack placement history survives unmount, room moves and earlier undo without losing identities", async () => {
  const rooms = [] as string[];
  for (const name of ["History room A", "History room B"]) {
    const response = await call("POST", "/api/rooms", {
      labId: "lab_home",
      name,
    });
    assert.equal(response.statusCode, 201, response.body);
    rooms.push(response.json().id);
  }
  const rack = await call("POST", "/api/racks", {
    labId: "lab_home",
    roomId: rooms[0],
    name: "History rack",
    totalU: 12,
  });
  assert.equal(rack.statusCode, 201, rack.body);
  const stack = await device("history-stack", { roomId: rooms[0] });
  const first = await member(stack.id, "First", {
    heightU: 2,
    macs: [{ label: "Base", macAddress: "aa:bb:cc:dd:ee:01" }],
  });
  await member(stack.id, "Second");
  const peer = await device("history-peer", {
    deviceType: "switch",
    roomId: rooms[0],
  });
  const ports = [] as string[];
  for (const [deviceId, stackMemberId] of [
    [stack.id, first.id],
    [peer.id, null],
  ]) {
    const response = await call("POST", "/api/ports", {
      deviceId,
      stackMemberId,
      name: "1/1",
      kind: "rj45",
    });
    assert.equal(response.statusCode, 201, response.body);
    ports.push(response.json().id);
  }
  const link = await call("POST", "/api/port-links", {
    fromPortId: ports[0],
    toPortId: ports[1],
  });
  assert.equal(link.statusCode, 201, link.body);
  const identities = () => ({
    members: listStackMembers(stack.id),
    ports: db
      .prepare("SELECT * FROM ports WHERE id IN (?, ?) ORDER BY id")
      .all(...ports),
    link: db
      .prepare("SELECT * FROM portLinks WHERE id = ?")
      .get(link.json().id),
  });
  const originalIdentities = identities();
  const loose: RackStudioPlacementState = {
    mountKind: "loose",
    roomId: rooms[0]!,
    rackId: null,
    parentDeviceId: null,
    startU: null,
    heightU: null,
    face: null,
    column: null,
    columnSpan: null,
    shelfX: null,
    shelfY: null,
    shelfWidth: null,
    shelfHeight: null,
    orientation: null,
    side: null,
  };
  const mounted: RackStudioPlacementState = {
    ...loose,
    mountKind: "direct",
    rackId: rack.json().id,
    startU: 1,
    heightU: 3,
    face: "front",
    column: 0,
    columnSpan: 12,
  };
  async function move(
    expected: RackStudioPlacementState,
    next: RackStudioPlacementState,
  ) {
    const response = await call("POST", "/api/rack-studio/actions", {
      kind: "device.place",
      targetId: stack.id,
      expected,
      next,
    });
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json() as {
      before: RackStudioPlacementState;
      after: RackStudioPlacementState;
      device: { heightU: number };
    };
    assert.deepEqual(result.before, expected);
    assert.deepEqual(result.after, next);
    assert.equal(result.device.heightU, 3);
    assert.deepEqual(identities(), originalIdentities);
    return result;
  }
  const earlier = await move(loose, mounted);
  const repositioned = await move(earlier.after, { ...mounted, startU: 6 });
  const unmounted = await move(repositioned.after, loose);
  await move(unmounted.after, unmounted.before); // Undo unmount.
  await move(unmounted.before, unmounted.after); // Redo unmount.
  const roomMove = await move(unmounted.after, { ...loose, roomId: rooms[1]! });
  await move(roomMove.after, roomMove.before);
  await move(roomMove.before, roomMove.after);
  await move(roomMove.after, roomMove.before);
  await move(unmounted.after, unmounted.before);
  await move(repositioned.after, repositioned.before); // Earlier history remains valid.
  await move(earlier.after, earlier.before);
  const concurrent = await move(loose, mounted);
  const stale = await call("POST", "/api/rack-studio/actions", {
    kind: "device.place",
    targetId: stack.id,
    expected: loose,
    next: { ...mounted, startU: 9 },
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().code, "RACK_STUDIO_CONFLICT");
  assert.deepEqual(stale.json().current, concurrent.after);
  assert.deepEqual(identities(), originalIdentities);
  assert.equal(
    (await call("DELETE", `/api/port-links/${link.json().id}`)).statusCode,
    204,
  );
  assert.equal(
    (await call("DELETE", `/api/devices/${stack.id}`)).statusCode,
    204,
  );
  assert.equal(
    (await call("DELETE", `/api/devices/${peer.id}`)).statusCode,
    204,
  );
  assert.equal(
    (await call("DELETE", `/api/racks/${rack.json().id}`)).statusCode,
    204,
  );
  for (const roomId of rooms)
    assert.equal(
      (await call("DELETE", `/api/rooms/${roomId}`)).statusCode,
      204,
    );
});

test("stack CRUD, ownership, write-only ownership fields, order and port reference protection", async () => {
  const stack = await device("crud-stack");
  assert.equal(stack.heightU, 1);
  const a = await member(stack.id, "Top", {
    heightU: 2,
    macs: [{ label: "Base", macAddress: "AABB.CCDD.EEFF" }],
  });
  const b = await member(stack.id, "Bottom");
  const saved = (await call("GET", `/api/devices/${stack.id}`)).json();
  assert.equal(saved.heightU, 3);
  assert.equal(saved.stackMembers[0].macs[0].macAddress, "aa:bb:cc:dd:ee:ff");
  assert.equal(
    (await call("PATCH", `/api/devices/${stack.id}`, { heightU: 4 }))
      .statusCode,
    409,
  );
  assert.equal(
    (await call("PATCH", `/api/devices/${stack.id}`, { deviceType: "switch" }))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await call("POST", "/api/devices/bulk", {
        deviceIds: [stack.id],
        changes: { deviceType: "switch" },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call("PUT", `/api/devices/${stack.id}/stack-members/order`, {
        memberIds: [a.id, a.id],
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(
    listStackMembers(stack.id).map((row) => row.id),
    [a.id, b.id],
  );
  assert.equal(
    (
      await call("PUT", `/api/devices/${stack.id}/stack-members/order`, {
        memberIds: [b.id, a.id],
      })
    ).statusCode,
    200,
  );
  assert.deepEqual(
    listStackMembers(stack.id).map((row) => row.position),
    [0, 1],
  );
  const peer = await device("other-stack");
  const port = await call("POST", "/api/ports", {
    deviceId: stack.id,
    name: "1/1",
    kind: "rj45",
    stackMemberId: a.id,
  });
  assert.equal(port.statusCode, 201, port.body);
  assert.equal(
    (
      await call("POST", "/api/ports", {
        deviceId: peer.id,
        name: "bad",
        kind: "rj45",
        stackMemberId: a.id,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call("PATCH", `/api/devices/${peer.id}/stack-members/${a.id}`, {
        name: "bad",
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await call("DELETE", `/api/devices/${stack.id}/stack-members/${a.id}`))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await call("PATCH", `/api/ports/${port.json().id}`, {
        description: "preserve",
      })
    ).json().stackMemberId,
    a.id,
  );
  assert.equal(
    (
      await call("PATCH", `/api/ports/${port.json().id}`, {
        stackMemberId: null,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await call("DELETE", `/api/devices/${stack.id}/stack-members/${a.id}`))
      .statusCode,
    204,
  );
  assert.equal(
    (await call("DELETE", `/api/devices/${stack.id}`)).statusCode,
    204,
  );
});

test("lab authorization covers every member method, unauthenticated and viewers", async () => {
  const stack = await device("auth-stack");
  const m = await member(stack.id, "Member");
  const routes: Array<
    ["GET" | "POST" | "PATCH" | "DELETE" | "PUT", string, object?]
  > = [
    ["GET", `/api/devices/${stack.id}/stack-members`],
    ["POST", `/api/devices/${stack.id}/stack-members`, { name: "New" }],
    [
      "PATCH",
      `/api/devices/${stack.id}/stack-members/${m.id}`,
      { name: "Changed" },
    ],
    ["DELETE", `/api/devices/${stack.id}/stack-members/${m.id}`],
    [
      "PUT",
      `/api/devices/${stack.id}/stack-members/order`,
      { memberIds: [m.id] },
    ],
  ];
  for (const [method, url, body] of routes)
    assert.equal((await call(method, url, body, "")).statusCode, 401);
  const create = await call("POST", "/api/users", {
    username: "stack-viewer",
    password: "stack-viewer-password",
    displayName: "Viewer",
    role: "viewer",
    labAccess: [{ labId: "lab_home", role: "viewer" }],
  });
  assert.equal(create.statusCode, 201, create.body);
  const login = await call("POST", "/api/auth/login", {
    username: "stack-viewer",
    password: "stack-viewer-password",
  });
  for (const [method, url, body] of routes)
    assert.equal(
      (await call(method, url, body, login.json().token)).statusCode,
      method === "GET" ? 200 : 403,
    );
  db.prepare("INSERT INTO labs (id, name) VALUES ('other', 'Other')").run();
  const other = await device("secret-stack", { labId: "other" });
  const om = await member(other.id, "Secret");
  for (const [method, url, body] of routes)
    assert.equal(
      (
        await call(
          method,
          url.replace(stack.id, other.id).replace(m.id, om.id),
          body,
          login.json().token,
        )
      ).statusCode,
      403,
    );
});

test("resize is atomic, total height can exceed20, and derived layout preserves canonical anchors", async () => {
  const rack = await call("POST", "/api/racks", {
    labId: "lab_home",
    name: "Stack rack",
    totalU: 42,
  });
  assert.equal(rack.statusCode, 201, rack.body);
  const stack = await device("tall-stack", {
    placement: "rack",
    rackId: rack.json().id,
    startU: 1,
  });
  const first = await member(stack.id, "Twenty", { heightU: 20 });
  await member(stack.id, "Two", { heightU: 2 });
  assert.equal(
    (
      await call("PATCH", `/api/devices/${stack.id}`, {
        heightU: 22,
        notes: "same derived height",
      })
    ).statusCode,
    200,
  );
  const blocker = await device("blocker", {
    deviceType: "switch",
    placement: "rack",
    rackId: rack.json().id,
    startU: 23,
  });
  const result = await call("POST", `/api/devices/${stack.id}/stack-members`, {
    name: "Overlap",
  });
  assert.equal(result.statusCode, 400, result.body);
  assert.equal(listStackMembers(stack.id).length, 2);
  assert.equal(
    (await call("GET", `/api/devices/${stack.id}`)).json().heightU,
    22,
  );
  await call("DELETE", `/api/devices/${blocker.id}`);
  const port = await call("POST", "/api/ports", {
    deviceId: stack.id,
    name: "1/1",
    kind: "rj45",
    stackMemberId: first.id,
  });
  const loose = await call("POST", "/api/ports", {
    deviceId: stack.id,
    name: "Console",
    kind: "console",
  });
  const layout = (
    await call("GET", `/api/physical-layouts/${stack.id}`)
  ).json();
  assert.equal(layout.unmappedPortIds.length, 0);
  assert.equal(layout.bindings.length, 2);
  assert.deepEqual(
    new Set(layout.bindings.map((row: { portId: string }) => row.portId)),
    new Set([port.json().id, loose.json().id]),
  );
  validateResolvedPhysicalLayoutV1(layout.snapshot);
  const pure = buildStackPhysicalLayout(
    { id: stack.id, deviceType: "switch_stack", heightU: 22 },
    [port.json(), loose.json()],
    listStackMembers(stack.id),
  );
  assert.deepEqual(pure.snapshot.portSlots, layout.snapshot.portSlots);
  assert.equal(
    (await call("DELETE", `/api/devices/${stack.id}`)).statusCode,
    204,
  );
});

test("logical and native integrity round trips reject malformed stacks atomically", async () => {
  const stack = await device("backup-stack");
  const m = await member(stack.id, "Member", {
    macs: [{ label: "Base", macAddress: "00:11:22:33:44:55" }],
  });
  const p = await call("POST", "/api/ports", {
    deviceId: stack.id,
    name: "1/1",
    kind: "rj45",
    stackMemberId: m.id,
  });
  assert.equal(p.statusCode, 201);
  assert.equal(validateRackpadSqliteDatabase(db, "Test"), 52);
  const backup = (await call("GET", "/api/admin/export")).json();
  for (const corrupt of ["height", "order", "owner", "mac"]) {
    const invalid = structuredClone(backup);
    if (corrupt === "height")
      invalid.data.devices.find(
        (row: { id: string }) => row.id === stack.id,
      ).heightU = 9;
    if (corrupt === "order")
      invalid.data.deviceStackMembers.find(
        (row: { id: string }) => row.id === m.id,
      ).position = 9;
    if (corrupt === "owner")
      invalid.data.ports.find(
        (row: { id: string }) => row.id === p.json().id,
      ).stackMemberId = "missing";
    if (corrupt === "mac")
      invalid.data.deviceStackMemberMacs.find(
        (row: { memberId: string }) => row.memberId === m.id,
      ).macAddress = "bad";
    const restored = await call("POST", "/api/admin/restore", invalid);
    assert.ok(restored.statusCode >= 400, restored.body);
    assert.equal(
      listStackMembers(stack.id)[0].macs[0].macAddress,
      "00:11:22:33:44:55",
    );
    assert.equal(
      (await call("GET", `/api/devices/${stack.id}`)).json().heightU,
      1,
    );
  }
  const success = await call("POST", "/api/admin/restore", backup);
  assert.equal(success.statusCode, 200, success.body);
  assert.equal(validateRackpadSqliteDatabase(db, "Restored"), 52);
  assert.equal(
    (
      db
        .prepare("SELECT stackMemberId FROM ports WHERE id = ?")
        .get(p.json().id) as { stackMemberId: string }
    ).stackMemberId,
    m.id,
  );
  const login = await call("POST", "/api/auth/login", {
    username: "admin",
    password: "stack-test-password",
  });
  token = login.json().token;
});

test("custom ancestry and rack shrink cannot invalidate stacks; integration merges preserve assignments", async () => {
  const custom = await call("POST", "/api/device-types", {
    id: "custom_stack",
    label: "Custom stack",
    parentType: "switch_stack",
  });
  assert.equal(custom.statusCode, 201, custom.body);
  const { deviceTypeMatches } = await import("../lib/device-types.js");
  assert.equal(deviceTypeMatches("switch_stack", ["switch"]), true);
  assert.equal(deviceTypeMatches("custom_stack", ["switch"]), true);
  const stack = await device("custom-stack", { deviceType: "custom_stack" });
  const m = await member(stack.id, "Member");
  const p = await call("POST", "/api/ports", {
    deviceId: stack.id,
    name: "1/1",
    kind: "rj45",
    stackMemberId: m.id,
  });
  assert.equal(
    (
      await call("PATCH", "/api/device-types/custom_stack", {
        parentType: "switch",
      })
    ).statusCode,
    409,
  );
  const { applyIntegrationDeviceSync, sanitizeImportableDevices } =
    await import("../lib/integrations/device-sync.js");
  const result = applyIntegrationDeviceSync({
    labId: "lab_home",
    vendor: "test",
    actor: "admin",
    wifi: null,
    importableDevices: sanitizeImportableDevices([
      {
        providerRecordId: "same-stack",
        name: "custom-stack",
        deviceType: "switch",
        ports: [{ name: "1/1", kind: "rj45" }],
      },
    ]),
  });
  assert.deepEqual(result.createdDeviceIds, []);
  assert.equal(listStackMembers(stack.id)[0].id, m.id);
  assert.equal(
    (await call("GET", `/api/ports/${p.json().id}`)).json().stackMemberId,
    m.id,
  );
  const rack = await call("POST", "/api/racks", {
    labId: "lab_home",
    name: "Bounds",
    totalU: 42,
  });
  assert.equal(
    (
      await call("PATCH", `/api/devices/${stack.id}`, {
        placement: "rack",
        rackId: rack.json().id,
        startU: 40,
      })
    ).statusCode,
    200,
  );
  const shrunk = await call("PATCH", `/api/racks/${rack.json().id}`, {
    totalU: 39,
  });
  assert.equal(shrunk.statusCode, 400, shrunk.body);
  assert.equal(
    (await call("GET", `/api/racks/${rack.json().id}`)).json().totalU,
    42,
  );
  const { currentRackStudioPlacement } =
    await import("../lib/rack-studio-placement.js");
  const row = (await call("GET", `/api/devices/${stack.id}`)).json();
  const before = currentRackStudioPlacement(row);
  const next = {
    ...before,
    mountKind: "rack-top",
    startU: null,
    column: 2,
    columnSpan: 3,
  };
  const placed = await call("POST", "/api/rack-studio/actions", {
    kind: "device.place",
    targetId: stack.id,
    expected: before,
    next,
  });
  assert.equal(placed.statusCode, 200, placed.body);
  assert.equal(
    (
      await call("PATCH", `/api/devices/${stack.id}`, {
        heightU: 1,
        notes: "preserve geometry",
      })
    ).statusCode,
    200,
  );
  const same = (await call("GET", `/api/devices/${stack.id}`)).json();
  assert.equal(same.rackMountKind, "rack-top");
  assert.equal(same.rackColumn, 2);
  assert.equal(same.rackColumnSpan, 3);
  const invalidHeight = await call("POST", "/api/rack-studio/actions", {
    kind: "device.place",
    targetId: stack.id,
    expected: currentRackStudioPlacement(same),
    next: { ...next, heightU: 2 },
  });
  assert.equal(invalidHeight.statusCode, 409, invalidHeight.body);
  const layoutPreview = await call(
    "POST",
    `/api/physical-layouts/${stack.id}/preview`,
    { templateId: "generic-auto-v1" },
  );
  assert.equal(layoutPreview.statusCode, 409);
  const backup = (await call("GET", "/api/admin/export")).json();
  assert.equal(
    (await call("POST", "/api/admin/restore", backup)).statusCode,
    200,
  );
  token = (
    await call("POST", "/api/auth/login", {
      username: "admin",
      password: "stack-test-password",
    })
  ).json().token;
  assert.equal(listStackMembers(stack.id)[0].id, m.id);
});

test("native semantic validation rejects invalid geometry and version markers using the supplied database", async () => {
  const { restoreNativeBackup } =
    await import("../cli/restore-native-backup.js");
  const source = path.join(directory, "native-source.db");
  const destination = path.join(directory, "native-destination.db");
  await db.backup(source);
  await db.backup(destination);
  await restoreNativeBackup({ source, active: destination });
  const restored = new Database(destination, { readonly: true });
  assert.deepEqual(
    restored.prepare("SELECT * FROM deviceStackMembers ORDER BY id").all(),
    db.prepare("SELECT * FROM deviceStackMembers ORDER BY id").all(),
  );
  assert.deepEqual(
    restored
      .prepare(
        "SELECT * FROM deviceStackMemberMacs ORDER BY memberId, macAddress",
      )
      .all(),
    db
      .prepare(
        "SELECT * FROM deviceStackMemberMacs ORDER BY memberId, macAddress",
      )
      .all(),
  );
  assert.deepEqual(
    restored.prepare("SELECT id, stackMemberId FROM ports ORDER BY id").all(),
    db.prepare("SELECT id, stackMemberId FROM ports ORDER BY id").all(),
  );
  restored.close();
  const snapshot = new Database(source);
  const id = (
    snapshot
      .prepare("SELECT id FROM devices WHERE deviceType = 'custom_stack'")
      .get() as { id: string }
  ).id;
  snapshot
    .prepare(
      "UPDATE devices SET rackMountKind='side', rackId=NULL, rackSide='nonsense' WHERE id=?",
    )
    .run(id);
  assert.throws(
    () => validateRackpadSqliteDatabase(snapshot, "Invalid source"),
    /stack.*(integrity|side)|Invalid stack/i,
  );
  snapshot.close();
  await assert.rejects(restoreNativeBackup({ source, active: destination }));
  const intact = new Database(destination, { readonly: true });
  assert.equal(validateRackpadSqliteDatabase(intact, "Intact destination"), 52);
  intact.close();
  const marker = new Database(source);
  marker.prepare("UPDATE schemaVersion SET version=50").run();
  assert.throws(
    () => validateRackpadSqliteDatabase(marker, "Forged source"),
    /inconsistent schema 50/,
  );
  marker.close();
  await assert.rejects(restoreNativeBackup({ source, active: destination }));
});

test("schema50 upgrades without changing existing ports and old logical backups default to empty membership", async () => {
  const legacy = path.join(directory, "schema50.db");
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "const { db } = await import('./server/db.ts'); db.close()",
    ],
    { env: { ...process.env, DATABASE_PATH: legacy } },
  );
  const database = new Database(legacy);
  database.exec(
    `DROP TRIGGER cable_guide_device_delete;
    DROP TRIGGER cable_guide_device_room;
    DROP TRIGGER cable_guide_rack_room;
    ALTER TABLE portLinks DROP COLUMN routeMode;
    ALTER TABLE portLinks DROP COLUMN routeGuides;
    DROP TRIGGER ports_stack_owner_insert; DROP TRIGGER ports_stack_owner_update; DROP TRIGGER stack_member_device_immutable; DROP TRIGGER stack_device_delete; DROP TRIGGER stack_type_guard; DROP TRIGGER stack_height_guard; DROP INDEX idx_ports_stack_member; ALTER TABLE ports DROP COLUMN stackMemberId; DROP TABLE deviceStackMemberMacs; DROP TABLE deviceStackMembers; UPDATE schemaVersion SET version=50; INSERT INTO labs (id,name) VALUES ('legacy','Legacy'); INSERT INTO devices (id,labId,hostname,deviceType) VALUES ('legacy-switch','legacy','old-switch','switch'); INSERT INTO ports (id,deviceId,name,position,kind) VALUES ('legacy-port','legacy-switch','Port1',1,'rj45');`,
  );
  assert.equal(validateRackpadSqliteDatabase(database, "Legacy"), 50);
  database.exec("CREATE INDEX idx_ports_stack_member ON ports(name)");
  database.close();
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "const { db } = await import('./server/db.ts'); db.close()",
      ],
      { env: { ...process.env, DATABASE_PATH: legacy }, stdio: "pipe" },
    ),
  );
  const failed = new Database(legacy);
  assert.equal(
    (
      failed.prepare("SELECT version FROM schemaVersion").get() as {
        version: number;
      }
    ).version,
    50,
  );
  assert.equal(
    failed
      .prepare("SELECT name FROM sqlite_master WHERE name='deviceStackMembers'")
      .get(),
    undefined,
  );
  assert.equal(
    (
      failed.prepare("PRAGMA table_info(ports)").all() as Array<{
        name: string;
      }>
    ).some((row) => row.name === "stackMemberId"),
    false,
  );
  failed.exec("DROP INDEX idx_ports_stack_member");
  failed.close();
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "const { db } = await import('./server/db.ts'); db.close()",
    ],
    { env: { ...process.env, DATABASE_PATH: legacy } },
  );
  const upgraded = new Database(legacy, { readonly: true });
  assert.equal(validateRackpadSqliteDatabase(upgraded, "Upgraded"), 52);
  assert.deepEqual(
    upgraded.prepare("SELECT id, name, stackMemberId FROM ports").all(),
    [{ id: "legacy-port", name: "Port1", stackMemberId: null }],
  );
  assert.deepEqual(
    upgraded.prepare("SELECT * FROM deviceStackMembers").all(),
    [],
  );
  upgraded.close();
  const backup = (await call("GET", "/api/admin/export")).json();
  backup.schemaVersion = 50;
  delete backup.data.deviceStackMembers;
  delete backup.data.deviceStackMemberMacs;
  backup.data.devices = backup.data.devices.filter(
    (row: { deviceType: string }) =>
      row.deviceType !== "switch_stack" && row.deviceType !== "custom_stack",
  );
  const ids = new Set(backup.data.devices.map((row: { id: string }) => row.id));
  backup.data.ports = backup.data.ports.filter((row: { deviceId: string }) =>
    ids.has(row.deviceId),
  );
  backup.data.devicePhysicalLayouts = backup.data.devicePhysicalLayouts.filter(
    (row: { deviceId: string }) => ids.has(row.deviceId),
  );
  for (const port of backup.data.ports) delete port.stackMemberId;
  assert.equal(
    (await call("POST", "/api/admin/restore", backup)).statusCode,
    200,
  );
  assert.deepEqual(db.prepare("SELECT * FROM deviceStackMembers").all(), []);
  token = (
    await call("POST", "/api/auth/login", {
      username: "admin",
      password: "stack-test-password",
    })
  ).json().token;
});

test("rack and shelf removal preserve stacks as loose devices, and parent edits reject invalid geometry", async () => {
  const rack = await call("POST", "/api/racks", {
    labId: "lab_home",
    name: "Removal rack",
    totalU: 12,
  });
  assert.equal(
    (
      await call("POST", "/api/device-types", {
        id: "custom_shelf",
        label: "Custom shelf",
        parentType: "rack_shelf",
      })
    ).statusCode,
    201,
  );
  const shelf = await device("Stack shelf", {
    deviceType: "custom_shelf",
    placement: "rack",
    rackId: rack.json().id,
    startU: 1,
    heightU: 2,
  });
  const stack = await device("shelf-stack", {
    placement: "shelf",
    parentDeviceId: shelf.id,
  });
  const m = await member(stack.id, "Shelf member");
  const port = await call("POST", "/api/ports", {
    deviceId: stack.id,
    name: "1/1",
    kind: "rj45",
    stackMemberId: m.id,
  });
  const reparented = await call("PATCH", "/api/device-types/custom_shelf", {
    parentType: "switch",
  });
  assert.ok(reparented.statusCode >= 400, reparented.body);
  const incompatible = await call("PATCH", `/api/devices/${shelf.id}`, {
    deviceType: "switch",
  });
  assert.ok(incompatible.statusCode >= 400, incompatible.body);
  assert.equal(
    (await call("GET", `/api/devices/${shelf.id}`)).json().deviceType,
    "custom_shelf",
  );
  assert.equal(
    (await call("DELETE", `/api/devices/${shelf.id}`)).statusCode,
    204,
  );
  let saved = (await call("GET", `/api/devices/${stack.id}`)).json();
  assert.equal(saved.rackMountKind, "loose");
  assert.equal(saved.parentDeviceId, null);
  assert.equal(saved.heightU, 1);
  const { currentRackStudioPlacement } =
    await import("../lib/rack-studio-placement.js");
  const current = currentRackStudioPlacement(saved);
  const placed = await call("POST", "/api/rack-studio/actions", {
    kind: "device.place",
    targetId: stack.id,
    expected: current,
    next: {
      ...current,
      mountKind: "rack-top",
      rackId: rack.json().id,
      heightU: 1,
      face: "front",
      column: 0,
      columnSpan: 12,
    },
  });
  assert.equal(placed.statusCode, 200, placed.body);
  assert.equal(
    (await call("DELETE", `/api/racks/${rack.json().id}`)).statusCode,
    204,
  );
  saved = (await call("GET", `/api/devices/${stack.id}`)).json();
  assert.equal(saved.rackMountKind, "loose");
  assert.equal(saved.rackId, null);
  assert.equal(
    (await call("GET", `/api/ports/${port.json().id}`)).json().stackMemberId,
    m.id,
  );
  assert.equal(validateRackpadSqliteDatabase(db, "After parent removal"), 52);
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import Database from "better-sqlite3";
import { CURRENT_SCHEMA_VERSION } from "../schema-version.js";
const directory = mkdtempSync(path.join(os.tmpdir(), "rackpad-floorplans-"));
process.env.DATABASE_PATH = path.join(directory, "fixture.db");
process.env.NODE_ENV = "test";
const { db } = await import("../db.js");
const { createApp } = await import("../app.js");
const { validateRackpadSqliteDatabase } =
  await import("../lib/native-backup-validation.js");
const app = await createApp();
let headers: Record<string, string>;
const password = "synthetic-floorplan-password";
async function login(username = "admin") {
  const result = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  assert.equal(result.statusCode, 200, result.body);
  return { authorization: `Bearer ${result.json().token}` };
}
before(async () => {
  const result = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      password,
      displayName: "Admin",
      loadDemoData: false,
    },
  });
  assert.equal(result.statusCode, 201, result.body);
  headers = { authorization: `Bearer ${result.json().token}` };
});
beforeEach(() => {
  db.exec(`DELETE FROM labs; DELETE FROM auditLog; DELETE FROM users WHERE username!='admin';
    INSERT INTO labs(id,name) VALUES('a','A'),('b','B'); INSERT INTO rooms(id,labId,name) VALUES('room','a','Room'),('other','a','Other'),('foreign','b','Foreign');
    INSERT INTO racks(id,labId,name,totalU,roomId) VALUES('rack','a','Rack',12,'room');
    INSERT INTO devices(id,labId,hostname,deviceType,placement,roomId) VALUES('device','a','Device','server','room','room'),('outside','a','Outside','server','room','other'),('foreign','b','Foreign','server','room','foreign');
    INSERT INTO devices(id,labId,hostname,deviceType,placement,roomId,rackId,startU,heightU,face,rackMountKind,rackColumn,rackColumnSpan) VALUES('mounted','a','Mounted','server','rack',NULL,'rack',1,1,'front','direct',0,12);`);
  const image = db.prepare(
    "INSERT INTO referenceImages(id,labId,entityType,entityId,label,fileName,mimeType,dataUrl,createdAt,updatedAt) VALUES(?,?,'room',?,?,?,'image/png',?,'2026-10-30T00:00:00Z','2026-10-30T00:00:00Z')",
  );
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yZuoAAAAASUVORK5CYII=";
  image.run("image", "a", "room", "Plan", "plan.png", png);
  image.run("replacement", "a", "room", "Replacement", "new.png", png);
  image.run("foreign-image", "b", "foreign", "Foreign", "foreign.png", png);
});
after(async () => {
  await app.close();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
async function read(roomId = "room", auth = headers) {
  return app.inject({
    method: "GET",
    url: `/api/floorplans/${roomId}`,
    headers: auth,
  });
}
async function put(payload: Record<string, unknown>, expected = 200) {
  const result = await app.inject({
    method: "PUT",
    url: "/api/floorplans/room",
    headers,
    payload,
  });
  assert.equal(result.statusCode, expected, result.body);
  return result.json();
}
async function add(payload: Record<string, unknown>, expected = 200) {
  const result = await app.inject({
    method: "POST",
    url: "/api/floorplans/room/markers",
    headers,
    payload,
  });
  assert.equal(result.statusCode, expected, result.body);
  return result.json();
}

test("floorplans deny unauthenticated, cross-lab and viewer writes on every endpoint", async () => {
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/floorplans/room" }))
      .statusCode,
    401,
  );
  const created = await app.inject({
    method: "POST",
    url: "/api/users",
    headers,
    payload: {
      username: "limited",
      password,
      displayName: "Limited",
      role: "viewer",
      labAccess: [{ labId: "a", role: "viewer" }],
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const limited = await login("limited");
  assert.equal((await read("room", limited)).statusCode, 200);
  assert.equal((await read("foreign", limited)).statusCode, 403);
  const plan = await add({ revision: 0, deviceId: "device" });
  for (const [method, url] of [
    ["PUT", "/api/floorplans/room"],
    ["POST", "/api/floorplans/room/markers"],
    ["PATCH", `/api/floorplans/room/markers/${plan.markers[0].id}`],
    ["DELETE", `/api/floorplans/room/markers/${plan.markers[0].id}`],
  ] as const) {
    assert.equal(
      (
        await app.inject({
          method,
          url,
          headers: limited,
          payload: {
            revision: 1,
            backgroundImageId: null,
            x: 0.1,
            deviceId: "mounted",
          },
        })
      ).statusCode,
      403,
    );
  }
});
test("background replacement requires confirmation and removal preserves normalized markers", async () => {
  assert.deepEqual((await read()).json().markers, []);
  let plan = await put({ revision: 0, backgroundImageId: "image" });
  plan = await add({
    revision: plan.revision,
    deviceId: "device",
    x: 0.25,
    y: 0.75,
    label: "Server",
  });
  const marker = plan.markers[0];
  await put({ revision: plan.revision, backgroundImageId: "replacement" }, 409);
  plan = await put({
    revision: plan.revision,
    backgroundImageId: "replacement",
    confirmBackgroundChange: true,
  });
  assert.equal(plan.background.id, "replacement");
  assert.deepEqual(plan.markers[0], marker);
  await put(
    {
      revision: plan.revision,
      backgroundImageId: "foreign-image",
      confirmBackgroundChange: true,
    },
    422,
  );
  await put(
    {
      revision: plan.revision,
      backgroundImageId: "missing",
      confirmBackgroundChange: true,
    },
    422,
  );
  plan = await put({ revision: plan.revision, backgroundImageId: null });
  assert.equal(plan.background, null);
  assert.deepEqual(plan.markers[0], marker);
  plan = await put({ revision: plan.revision, backgroundImageId: "image" });
  db.prepare("DELETE FROM referenceImages WHERE id='image'").run();
  const after = (await read()).json();
  assert.equal(after.background, null);
  assert.deepEqual(after.markers[0], marker);
  assert.ok(after.revision > plan.revision);
});
test("marker ownership, duplicates, coordinate bounds and stale edits are enforced without moving inventory", async () => {
  for (const payload of [
    { deviceId: "outside" },
    { deviceId: "foreign" },
    { deviceId: "missing" },
    { rackId: "missing" },
  ])
    await add({ revision: 0, ...payload }, 422);
  await add({ revision: 0, deviceId: "device", rackId: "rack" }, 400);
  for (const x of [-0.1, 1.1, "bad"])
    await add({ revision: 0, deviceId: "device", x }, 400);
  const before = db
    .prepare("SELECT roomId,rackId,startU FROM devices WHERE id='device'")
    .get();
  const plan = await add({ revision: 0, deviceId: "device" });
  const id = plan.markers[0].id;
  await add({ revision: plan.revision, deviceId: "device" }, 409);
  let changed = await app.inject({
    method: "PATCH",
    url: `/api/floorplans/room/markers/${id}`,
    headers,
    payload: { revision: plan.revision, x: 0.1, y: 0.9, label: "Custom" },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.deepEqual(
    db
      .prepare("SELECT roomId,rackId,startU FROM devices WHERE id='device'")
      .get(),
    before,
  );
  const stale = await app.inject({
    method: "PATCH",
    url: `/api/floorplans/room/markers/${id}`,
    headers,
    payload: { revision: plan.revision, x: 0.8 },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "FLOORPLAN_CONFLICT");
  const current = changed.json();
  assert.equal((await read()).json().markers[0].x, 0.1);
  changed = await app.inject({
    method: "DELETE",
    url: `/api/floorplans/room/markers/${id}`,
    headers,
    payload: { revision: current.revision },
  });
  assert.equal(changed.statusCode, 200);
  assert.deepEqual(changed.json().markers, []);
});
test("inventory room moves and deletion prune invalid markers in the same transaction", async () => {
  let plan = await add({ revision: 0, deviceId: "device" });
  plan = await add({ revision: plan.revision, deviceId: "mounted" });
  plan = await add({ revision: plan.revision, rackId: "rack" });
  db.transaction(() => {
    db.prepare("UPDATE devices SET roomId='other' WHERE id='device'").run();
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM roomFloorplanMarkers WHERE deviceId='device'",
          )
          .get() as { n: number }
      ).n,
      0,
    );
    db.prepare("UPDATE racks SET roomId='other' WHERE id='rack'").run();
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) AS n FROM roomFloorplanMarkers").get() as {
          n: number;
        }
      ).n,
      0,
    );
  })();
  assert.ok((await read()).json().revision > plan.revision);
  db.exec("UPDATE devices SET roomId='room' WHERE id='device'");
  plan = await add({
    revision: (await read()).json().revision,
    deviceId: "device",
  });
  db.exec("DELETE FROM devices WHERE id='device'");
  assert.equal((await read()).json().markers.length, 0);
  assert.ok((await read()).json().revision > plan.revision);
});
test("logical/native recovery round trips markers and rejects invalid ownership atomically", async () => {
  let plan = await put({ revision: 0, backgroundImageId: "image" });
  plan = await add({
    revision: plan.revision,
    deviceId: "device",
    x: 0.23,
    y: 0.81,
  });
  const snapshot = (
    await app.inject({ method: "GET", url: "/api/admin/export", headers })
  ).json();
  for (const change of [
    (data: typeof snapshot.data) => {
      data.roomFloorplans[0].backgroundImageId = "foreign-image";
    },
    (data: typeof snapshot.data) => {
      data.roomFloorplanMarkers[0].deviceId = "foreign";
    },
    (data: typeof snapshot.data) => {
      data.roomFloorplanMarkers[0].x = 1.1;
    },
  ]) {
    const bad = structuredClone(snapshot);
    change(bad.data);
    const result = await app.inject({
      method: "POST",
      url: "/api/admin/restore",
      headers,
      payload: bad,
    });
    assert.equal(result.statusCode, 422, result.body);
    assert.deepEqual((await read()).json(), plan);
  }
  const result = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers,
    payload: snapshot,
  });
  assert.equal(result.statusCode, 200, result.body);
  headers = await login();
  assert.deepEqual((await read()).json(), plan);
  assert.equal(
    validateRackpadSqliteDatabase(db, "Current"),
    CURRENT_SCHEMA_VERSION,
  );
  const file = path.join(directory, "bad-native.db");
  await db.backup(file);
  const bad = new Database(file);
  try {
    bad.exec(
      "PRAGMA ignore_check_constraints=ON; UPDATE roomFloorplanMarkers SET x=2",
    );
    assert.throws(
      () => validateRackpadSqliteDatabase(bad, "Invalid"),
      /invalid room floorplans/,
    );
  } finally {
    bad.close();
  }
  delete snapshot.data.roomFloorplans;
  delete snapshot.data.roomFloorplanMarkers;
  const old = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers,
    payload: snapshot,
  });
  assert.equal(old.statusCode, 200, old.body);
  headers = await login();
  assert.deepEqual((await read()).json().markers, []);
});

test("selection no-ops preserve revision and maximum valid revisions round-trip", async () => {
  const plan = await add({ revision: 0, deviceId: "device" });
  const id = plan.markers[0].id;
  const noop = await app.inject({
    method: "PATCH",
    url: `/api/floorplans/room/markers/${id}`,
    headers,
    payload: { revision: plan.revision, x: 0.5, y: 0.5 },
  });
  assert.equal(noop.statusCode, 200);
  assert.deepEqual(noop.json(), plan);
  db.exec("UPDATE roomFloorplans SET revision=2147483647 WHERE roomId='room'");
  assert.equal(
    validateRackpadSqliteDatabase(db, "Maximum revision"),
    CURRENT_SCHEMA_VERSION,
  );
  const snapshot = (
    await app.inject({ method: "GET", url: "/api/admin/export", headers })
  ).json();
  const restored = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers,
    payload: snapshot,
  });
  assert.equal(restored.statusCode, 200, restored.body);
  headers = await login();
  assert.equal((await read()).json().revision, 2147483647);
});

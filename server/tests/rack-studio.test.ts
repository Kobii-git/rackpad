import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { legacyShelfGeometry } from "../lib/legacy-shelf-geometry.js";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "rackpad-studio-"));
process.env.DATABASE_PATH = path.join(tempDir, "rack-studio-test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "rackpad-studio-test-secret";

const { createApp } = await import("../app.js");
const { db } = await import("../db.js");
const { setBootstrapState } = await import("../lib/auth.js");
const { rackStudioRoomCanvasBounds } =
  await import("../lib/rack-studio-canvas.js");

type AppInstance = Awaited<ReturnType<typeof createApp>>;
let app: AppInstance;

test("dense legacy shelf geometry remains bounded and non-overlapping", () => {
  const geometries = Array.from({ length: 64 }, (_, index) =>
    legacyShelfGeometry(index, 64),
  );

  for (const geometry of geometries) {
    assert.ok(geometry.x >= 0);
    assert.ok(geometry.y >= 0);
    assert.ok(geometry.x + geometry.width <= 1000);
    assert.ok(geometry.y + geometry.height <= 1000);
  }

  for (let index = 0; index < geometries.length; index += 1) {
    const current = geometries[index]!;
    for (
      let otherIndex = index + 1;
      otherIndex < geometries.length;
      otherIndex += 1
    ) {
      const other = geometries[otherIndex]!;
      const overlaps =
        current.x < other.x + other.width &&
        current.x + current.width > other.x &&
        current.y < other.y + other.height &&
        current.y + current.height > other.y;
      assert.equal(overlaps, false);
    }
  }
});

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

test("rack canvas moves are lab-authorized, audited, and conflict-safe", async () => {
  const adminToken = await bootstrapAdmin();
  const viewerToken = await createUserAndLogin(adminToken, {
    username: "studio-viewer",
    password: "studio-viewer-password",
    role: "viewer",
  });
  const room = await createRoom(adminToken, "Studio room");
  const rack = await createRack(adminToken, room.id, "Studio rack", 12);
  const before = { roomId: room.id, x: null, y: null };
  const afterMove = { roomId: room.id, x: 140, y: 220 };

  const denied = await app.inject({
    method: "POST",
    url: "/api/rack-studio/actions",
    headers: authHeaders(viewerToken),
    payload: {
      kind: "rack.move",
      targetId: rack.id,
      expected: before,
      next: afterMove,
    },
  });
  assert.equal(denied.statusCode, 403, denied.body);

  const moved = await applyStudioAction(adminToken, {
    kind: "rack.move",
    targetId: rack.id,
    expected: before,
    next: afterMove,
  });
  assert.deepEqual(moved.before, before);
  assert.deepEqual(moved.after, afterMove);
  assert.equal(moved.rack.studioX, 140);
  assert.equal(moved.rack.studioY, 220);

  const stale = await app.inject({
    method: "POST",
    url: "/api/rack-studio/actions",
    headers: authHeaders(adminToken),
    payload: {
      kind: "rack.move",
      targetId: rack.id,
      expected: before,
      next: { roomId: room.id, x: 300, y: 300 },
    },
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(json(stale).code, "RACK_STUDIO_CONFLICT");

  const undone = await applyStudioAction(adminToken, {
    kind: "rack.move",
    targetId: rack.id,
    expected: afterMove,
    next: before,
  });
  assert.deepEqual(undone.after, before);
  assert.deepEqual(
    db.prepare("SELECT studioX, studioY FROM racks WHERE id = ?").get(rack.id),
    { studioX: null, studioY: null },
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM auditLog WHERE action = 'rack-studio.rack.move' AND entityId = ?",
        )
        .get(rack.id) as { count: number }
    ).count,
    2,
  );
});

test("dense room bounds keep the last rack reachable and constrain full footprints and waypoints", async () => {
  const adminToken = await bootstrapAdmin();
  const room = await createRoom(adminToken, "Dense Studio room");
  const racks = await Promise.all(
    Array.from({ length: 11 }, (_, index) =>
      createRack(
        adminToken,
        room.id,
        `Dense rack ${String(index + 1).padStart(2, "0")}`,
        42,
      ),
    ),
  );
  const lastRack = racks.at(-1)!;

  const initialBounds = rackStudioRoomCanvasBounds(room.id);
  assert.equal(initialBounds.rackAreaHeight, 930);
  const moved = await applyStudioAction(adminToken, {
    kind: "rack.move",
    targetId: lastRack.id,
    expected: { roomId: room.id, x: null, y: null },
    next: { roomId: room.id, x: 30, y: 618 },
  });
  assert.equal(moved.rack.studioY, 618);

  for (const next of [
    { roomId: room.id, x: 843, y: 618 },
    { roomId: room.id, x: 30, y: 653 },
  ]) {
    const invalid = await app.inject({
      method: "POST",
      url: "/api/rack-studio/actions",
      headers: authHeaders(adminToken),
      payload: {
        kind: "rack.move",
        targetId: lastRack.id,
        expected: { roomId: room.id, x: 30, y: 618 },
        next,
      },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.match(invalid.body, /full rack footprint/i);
  }

  const firstDevice = await createDevice(adminToken, room.id, "dense-route-a");
  const secondDevice = await createDevice(adminToken, room.id, "dense-route-b");
  const firstPort = await createPort(
    adminToken,
    firstDevice.id,
    "NIC 1",
    "rear",
  );
  const secondPort = await createPort(
    adminToken,
    secondDevice.id,
    "NIC 1",
    "rear",
  );
  const boundsWithTray = rackStudioRoomCanvasBounds(room.id);
  assert.ok(boundsWithTray.height > 620);

  const created = await app.inject({
    method: "POST",
    url: "/api/port-links",
    headers: authHeaders(adminToken),
    payload: {
      fromPortId: firstPort.id,
      toPortId: secondPort.id,
      physicalMode: true,
      routeWaypoints: [
        {
          id: "dense-row-waypoint",
          roomId: room.id,
          face: "rear",
          x: 500,
          y: 800,
        },
      ],
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const link = json(created) as { id: string };

  const outside = await app.inject({
    method: "PATCH",
    url: `/api/port-links/${link.id}`,
    headers: authHeaders(adminToken),
    payload: {
      routeWaypoints: [
        {
          id: "outside-dense-room",
          roomId: room.id,
          face: "rear",
          x: 500,
          y: boundsWithTray.height + 1,
        },
      ],
    },
  });
  assert.equal(outside.statusCode, 400, outside.body);
  assert.match(outside.body, /Rack Studio canvas/i);
});

test("Studio placement supports 12-column, shelf, rotated, side, inverse, and cross-lab validation", async () => {
  const adminToken = await bootstrapAdmin();
  const room = await createRoom(adminToken, "Placement room");
  const rack = await createRack(adminToken, room.id, "Placement rack", 10);
  const first = await createDevice(adminToken, room.id, "third-a");
  const second = await createDevice(adminToken, room.id, "third-b");
  const third = await createDevice(adminToken, room.id, "third-conflict");

  const firstDirect = directState(room.id, rack.id, 2, 2, 0, 4);
  const secondDirect = directState(room.id, rack.id, 2, 2, 4, 4);
  const firstPlaced = await applyStudioAction(adminToken, {
    kind: "device.place",
    targetId: first.id,
    expected: looseState(room.id),
    next: firstDirect,
  });
  assert.equal(firstPlaced.device.rackColumn, 0);
  assert.equal(firstPlaced.device.rackColumnSpan, 4);
  const secondPlaced = await applyStudioAction(adminToken, {
    kind: "device.place",
    targetId: second.id,
    expected: looseState(room.id),
    next: secondDirect,
  });
  assert.equal(secondPlaced.device.rackColumn, 4);
  assert.equal(secondPlaced.device.rackColumnSpan, 4);

  const overlap = await app.inject({
    method: "POST",
    url: "/api/rack-studio/actions",
    headers: authHeaders(adminToken),
    payload: {
      kind: "device.place",
      targetId: third.id,
      expected: looseState(room.id),
      next: directState(room.id, rack.id, 2, 1, 3, 3),
    },
  });
  assert.equal(overlap.statusCode, 400, overlap.body);
  assert.match(overlap.body, /overlap/i);

  const overflow = await app.inject({
    method: "POST",
    url: "/api/rack-studio/actions",
    headers: authHeaders(adminToken),
    payload: {
      kind: "device.place",
      targetId: third.id,
      expected: looseState(room.id),
      next: directState(room.id, rack.id, 10, 2, 8, 4),
    },
  });
  assert.equal(overflow.statusCode, 400, overflow.body);
  assert.match(overflow.body, /exceed rack height/i);

  const shelf = await createDevice(
    adminToken,
    room.id,
    "rack-shelf",
    "rack_shelf",
  );
  const shelfDirect = directState(room.id, rack.id, 5, 2, 0, 12);
  await applyStudioAction(adminToken, {
    kind: "device.place",
    targetId: shelf.id,
    expected: looseState(room.id),
    next: shelfDirect,
  });
  const shelfChild = await createDevice(adminToken, room.id, "shelf-child");
  const shelfSibling = await createDevice(adminToken, room.id, "shelf-sibling");
  const rotatedShelfState = shelfState(
    room.id,
    rack.id,
    shelf.id,
    50,
    100,
    300,
    180,
    90,
  );
  const shelfPlaced = await applyStudioAction(adminToken, {
    kind: "device.place",
    targetId: shelfChild.id,
    expected: looseState(room.id),
    next: rotatedShelfState,
  });
  assert.equal(shelfPlaced.device.shelfOrientation, 90);
  assert.equal(shelfPlaced.device.parentDeviceId, shelf.id);

  const secondRack = await createRack(
    adminToken,
    room.id,
    "Second placement rack",
    10,
  );
  const movedShelf = await applyStudioAction(adminToken, {
    kind: "device.place",
    targetId: shelf.id,
    expected: shelfDirect,
    next: directState(room.id, secondRack.id, 5, 2, 0, 12),
  });
  assert.equal(movedShelf.devices.length, 2);
  assert.equal(
    movedShelf.devices.find(
      (device: { id: string }) => device.id === shelfChild.id,
    )?.rackId,
    secondRack.id,
  );
  assert.deepEqual(
    db
      .prepare("SELECT rackId, roomId, face FROM devices WHERE id = ?")
      .get(shelfChild.id),
    { rackId: secondRack.id, roomId: room.id, face: "front" },
  );

  const shelfOverlap = await app.inject({
    method: "POST",
    url: "/api/rack-studio/actions",
    headers: authHeaders(adminToken),
    payload: {
      kind: "device.place",
      targetId: shelfSibling.id,
      expected: looseState(room.id),
      next: shelfState(room.id, rack.id, shelf.id, 100, 120, 120, 120, 0),
    },
  });
  assert.equal(shelfOverlap.statusCode, 400, shelfOverlap.body);
  assert.match(shelfOverlap.body, /overlap/i);

  const sideA = await createDevice(adminToken, room.id, "side-a", "pdu");
  const sideB = await createDevice(adminToken, room.id, "side-b", "pdu");
  await applyStudioAction(adminToken, {
    kind: "device.place",
    targetId: sideA.id,
    expected: looseState(room.id),
    next: sideState(room.id, rack.id, "right"),
  });
  const sideConflict = await app.inject({
    method: "POST",
    url: "/api/rack-studio/actions",
    headers: authHeaders(adminToken),
    payload: {
      kind: "device.place",
      targetId: sideB.id,
      expected: looseState(room.id),
      next: sideState(room.id, rack.id, "right"),
    },
  });
  assert.equal(sideConflict.statusCode, 400, sideConflict.body);
  assert.match(sideConflict.body, /side conflicts/i);

  const rackTopA = await createDevice(adminToken, room.id, "rack-top-a");
  const rackTopB = await createDevice(adminToken, room.id, "rack-top-b");
  const firstRackTop = rackTopState(room.id, rack.id, 0, 6);
  const rackTopPlaced = await applyStudioAction(adminToken, {
    kind: "device.place",
    targetId: rackTopA.id,
    expected: looseState(room.id),
    next: firstRackTop,
  });
  assert.deepEqual(
    {
      placement: rackTopPlaced.device.placement,
      rackMountKind: rackTopPlaced.device.rackMountKind,
      rackId: rackTopPlaced.device.rackId,
      roomId: rackTopPlaced.device.roomId,
      startU: rackTopPlaced.device.startU,
      heightU: rackTopPlaced.device.heightU,
      rackColumn: rackTopPlaced.device.rackColumn,
      rackColumnSpan: rackTopPlaced.device.rackColumnSpan,
    },
    {
      placement: "rack",
      rackMountKind: "rack-top",
      rackId: rack.id,
      roomId: room.id,
      startU: null,
      heightU: 1,
      rackColumn: 0,
      rackColumnSpan: 6,
    },
  );
  const rackTopOverlap = await app.inject({
    method: "POST",
    url: "/api/rack-studio/actions",
    headers: authHeaders(adminToken),
    payload: {
      kind: "device.place",
      targetId: rackTopB.id,
      expected: looseState(room.id),
      next: { ...rackTopState(room.id, rack.id, 4, 4), face: "rear" },
    },
  });
  assert.equal(rackTopOverlap.statusCode, 400, rackTopOverlap.body);
  assert.match(rackTopOverlap.body, /rack-top position overlaps/i);
  await applyStudioAction(adminToken, {
    kind: "device.place",
    targetId: rackTopB.id,
    expected: looseState(room.id),
    next: rackTopState(room.id, rack.id, 6, 6),
  });

  const secondUndone = await applyStudioAction(adminToken, {
    kind: "device.place",
    targetId: second.id,
    expected: secondDirect,
    next: looseState(room.id),
  });
  assert.equal(secondUndone.device.rackId, null);
  assert.equal(secondUndone.device.rackMountKind, "loose");

  const otherLab = await createLab(adminToken, "Other lab");
  const otherRoom = await createRoom(adminToken, "Other room", otherLab.id);
  const otherRack = await createRack(
    adminToken,
    otherRoom.id,
    "Other rack",
    12,
    otherLab.id,
  );
  const crossLab = await app.inject({
    method: "POST",
    url: "/api/rack-studio/actions",
    headers: authHeaders(adminToken),
    payload: {
      kind: "device.place",
      targetId: third.id,
      expected: looseState(room.id),
      next: directState(otherRoom.id, otherRack.id, 1, 1, 0, 12),
    },
  });
  assert.equal(crossLab.statusCode, 400, crossLab.body);
  assert.match(crossLab.body, /same lab/i);

  const exported = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: authHeaders(adminToken),
  });
  assert.equal(exported.statusCode, 200, exported.body);
  const restored = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers: authHeaders(adminToken),
    payload: json(exported),
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(
    db
      .prepare(
        "SELECT rackMountKind, rackId, startU, rackColumn, rackColumnSpan FROM devices WHERE id = ?",
      )
      .get(rackTopA.id),
    {
      rackMountKind: "rack-top",
      rackId: rack.id,
      startU: null,
      rackColumn: 0,
      rackColumnSpan: 6,
    },
  );
});

test("physical patching validates connectors and persists inspected cable routing atomically", async () => {
  const adminToken = await bootstrapAdmin();
  const editorToken = await createUserAndLogin(adminToken, {
    username: "cable-editor",
    password: "cable-editor-password",
    role: "editor",
  });
  const viewerToken = await createUserAndLogin(adminToken, {
    username: "cable-viewer",
    password: "cable-viewer-password",
    role: "viewer",
  });
  const room = await createRoom(adminToken, "Cable room");
  const firstDevice = await createDevice(adminToken, room.id, "cable-a");
  const secondDevice = await createDevice(adminToken, room.id, "cable-b");
  const networkPort = await createPort(
    adminToken,
    firstDevice.id,
    "NIC 1",
    "rear",
    "rj45",
  );
  const powerPort = await createPort(
    adminToken,
    secondDevice.id,
    "PSU 1",
    "rear",
    "power",
  );

  const unusual = await app.inject({
    method: "POST",
    url: "/api/port-links",
    headers: authHeaders(editorToken),
    payload: {
      fromPortId: networkPort.id,
      toPortId: powerPort.id,
      physicalMode: true,
    },
  });
  assert.equal(unusual.statusCode, 409, unusual.body);
  assert.equal(json(unusual).code, "CABLE_CONNECTOR_CONFIRMATION_REQUIRED");
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS count FROM portLinks").get() as {
        count: number;
      }
    ).count,
    0,
  );

  const createdResponse = await app.inject({
    method: "POST",
    url: "/api/port-links",
    headers: authHeaders(editorToken),
    payload: {
      fromPortId: networkPort.id,
      toPortId: powerPort.id,
      physicalMode: true,
      confirmUnusual: true,
      label: "LAB-PWR-01",
      cableType: "Adapter lead",
      cableLength: "2m",
      color: "#f59e0b",
      notes: "Documented exception",
      visible: false,
      routeWaypoints: [
        {
          id: "route-one",
          roomId: room.id,
          face: "rear",
          x: 440,
          y: 310,
        },
      ],
    },
  });
  assert.equal(createdResponse.statusCode, 201, createdResponse.body);
  const created = json(createdResponse) as {
    id: string;
    label: string;
    visible: boolean;
    routeWaypoints: Array<{ id: string; roomId: string }>;
  };
  assert.equal(created.label, "LAB-PWR-01");
  assert.equal(created.visible, false);
  assert.deepEqual(created.routeWaypoints, [
    {
      id: "route-one",
      roomId: room.id,
      face: "rear",
      x: 440,
      y: 310,
    },
  ]);
  assert.deepEqual(
    db
      .prepare("SELECT linkState FROM ports WHERE id IN (?, ?) ORDER BY id")
      .all(networkPort.id, powerPort.id),
    [{ linkState: "up" }, { linkState: "up" }],
  );
  assert.ok(
    db
      .prepare(
        "SELECT id FROM auditLog WHERE action = 'port.link.physical' AND entityId = ?",
      )
      .get(created.id),
  );

  const viewerRead = await app.inject({
    method: "GET",
    url: `/api/port-links/${created.id}`,
    headers: authHeaders(viewerToken),
  });
  assert.equal(viewerRead.statusCode, 200, viewerRead.body);
  assert.equal(json(viewerRead).visible, false);
  assert.deepEqual(json(viewerRead).routeWaypoints, created.routeWaypoints);

  const exportResponse = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: authHeaders(adminToken),
  });
  assert.equal(exportResponse.statusCode, 200, exportResponse.body);
  const snapshot = json(exportResponse) as {
    data: {
      portLinks: Array<{
        id: string;
        label: string | null;
        visible: number;
        routeWaypoints: Array<{
          id: string;
          roomId: string;
          face: "front" | "rear";
          x: number;
          y: number;
        }>;
      }>;
    };
  };
  const exportedCable = snapshot.data.portLinks.find(
    (entry) => entry.id === created.id,
  );
  assert.equal(exportedCable?.label, "LAB-PWR-01");
  assert.equal(exportedCable?.visible, 0);
  assert.deepEqual(exportedCable?.routeWaypoints, created.routeWaypoints);

  const viewerPatch = await app.inject({
    method: "PATCH",
    url: `/api/port-links/${created.id}`,
    headers: authHeaders(viewerToken),
    payload: { label: "denied" },
  });
  assert.equal(viewerPatch.statusCode, 403, viewerPatch.body);

  const invalidWaypoint = await app.inject({
    method: "PATCH",
    url: `/api/port-links/${created.id}`,
    headers: authHeaders(editorToken),
    payload: {
      routeWaypoints: [
        {
          id: "outside",
          roomId: room.id,
          face: "front",
          x: 1001,
          y: 20,
        },
      ],
    },
  });
  assert.equal(invalidWaypoint.statusCode, 400, invalidWaypoint.body);

  const duplicateWaypointIds = await app.inject({
    method: "PATCH",
    url: `/api/port-links/${created.id}`,
    headers: authHeaders(editorToken),
    payload: {
      routeWaypoints: [
        { id: "duplicate", roomId: room.id, face: "front", x: 20, y: 20 },
        { id: "duplicate", roomId: room.id, face: "rear", x: 30, y: 30 },
      ],
    },
  });
  assert.equal(duplicateWaypointIds.statusCode, 400, duplicateWaypointIds.body);

  const updated = await app.inject({
    method: "PATCH",
    url: `/api/port-links/${created.id}`,
    headers: authHeaders(editorToken),
    payload: { label: "LAB-PWR-02", visible: true, routeWaypoints: [] },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(json(updated).label, "LAB-PWR-02");
  assert.equal(json(updated).visible, true);
  assert.deepEqual(json(updated).routeWaypoints, []);

  const viewerDelete = await app.inject({
    method: "DELETE",
    url: `/api/port-links/${created.id}`,
    headers: authHeaders(viewerToken),
  });
  assert.equal(viewerDelete.statusCode, 403, viewerDelete.body);
  const deleted = await app.inject({
    method: "DELETE",
    url: `/api/port-links/${created.id}`,
    headers: authHeaders(editorToken),
  });
  assert.equal(deleted.statusCode, 204, deleted.body);
  assert.deepEqual(
    db
      .prepare("SELECT linkState FROM ports WHERE id IN (?, ?) ORDER BY id")
      .all(networkPort.id, powerPort.id),
    [{ linkState: "down" }, { linkState: "down" }],
  );

  const invalidSnapshot = structuredClone(snapshot);
  invalidSnapshot.data.portLinks.find(
    (entry) => entry.id === created.id,
  )!.routeWaypoints[0]!.roomId = "missing-cable-room";
  const invalidRestore = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers: authHeaders(adminToken),
    payload: invalidSnapshot,
  });
  assert.equal(invalidRestore.statusCode, 422, invalidRestore.body);
  assert.equal(
    db.prepare("SELECT id FROM portLinks WHERE id = ?").get(created.id),
    undefined,
  );

  const outsideCanvasSnapshot = structuredClone(snapshot);
  outsideCanvasSnapshot.data.portLinks.find(
    (entry) => entry.id === created.id,
  )!.routeWaypoints[0]!.y = 100_000;
  const outsideCanvasRestore = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers: authHeaders(adminToken),
    payload: outsideCanvasSnapshot,
  });
  assert.equal(outsideCanvasRestore.statusCode, 422, outsideCanvasRestore.body);
  assert.equal(
    db.prepare("SELECT id FROM portLinks WHERE id = ?").get(created.id),
    undefined,
  );

  const restored = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers: authHeaders(adminToken),
    payload: snapshot,
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(
    db
      .prepare(
        "SELECT label, visible, routeWaypoints FROM portLinks WHERE id = ?",
      )
      .get(created.id),
    {
      label: "LAB-PWR-01",
      visible: 0,
      routeWaypoints: JSON.stringify(created.routeWaypoints),
    },
  );
});

test("physical patching excludes logical ports and authorizes both endpoint labs", async () => {
  const adminToken = await bootstrapAdmin();
  const homeRoom = await createRoom(adminToken, "Home cable room");
  const homeDevice = await createDevice(adminToken, homeRoom.id, "home-node");
  const logicalPort = await createPort(
    adminToken,
    homeDevice.id,
    "bond0",
    "rear",
    "virtual",
  );
  const homePort = await createPort(
    adminToken,
    homeDevice.id,
    "NIC 1",
    "rear",
    "rj45",
  );
  const logicalPatch = await app.inject({
    method: "POST",
    url: "/api/port-links",
    headers: authHeaders(adminToken),
    payload: {
      fromPortId: logicalPort.id,
      toPortId: homePort.id,
      physicalMode: true,
      confirmUnusual: true,
    },
  });
  assert.equal(logicalPatch.statusCode, 400, logicalPatch.body);
  assert.match(logicalPatch.body, /physical ports/i);

  const otherLab = await createLab(adminToken, "Cable other lab");
  const otherRoom = await createRoom(
    adminToken,
    "Remote cable room",
    otherLab.id,
  );
  const otherDevice = await createDevice(
    adminToken,
    otherRoom.id,
    "remote-node",
    "server",
    otherLab.id,
  );
  const otherPort = await createPort(
    adminToken,
    otherDevice.id,
    "NIC 1",
    "rear",
    "rj45",
  );
  const otherPortTwo = await createPort(
    adminToken,
    otherDevice.id,
    "NIC 2",
    "rear",
    "rj45",
  );
  const editorToken = await createUserAndLogin(adminToken, {
    username: "home-editor",
    password: "home-editor-password",
    role: "editor",
  });
  const crossLab = await app.inject({
    method: "POST",
    url: "/api/port-links",
    headers: authHeaders(adminToken),
    payload: {
      fromPortId: homePort.id,
      toPortId: otherPort.id,
      physicalMode: true,
      routeWaypoints: [
        {
          id: "home-room-route",
          roomId: homeRoom.id,
          face: "rear",
          x: 300,
          y: 200,
        },
      ],
    },
  });
  assert.equal(crossLab.statusCode, 201, crossLab.body);
  const crossLabLink = json(crossLab) as { id: string };

  const staleWaypointMove = await app.inject({
    method: "PATCH",
    url: `/api/port-links/${crossLabLink.id}`,
    headers: authHeaders(adminToken),
    payload: { fromPortId: otherPortTwo.id },
  });
  assert.equal(staleWaypointMove.statusCode, 400, staleWaypointMove.body);
  assert.match(staleWaypointMove.body, /endpoint lab/i);

  for (const method of ["GET", "PATCH", "DELETE"] as const) {
    const denied = await app.inject({
      method,
      url: `/api/port-links/${crossLabLink.id}`,
      headers: authHeaders(editorToken),
      ...(method === "PATCH" ? { payload: { label: "denied" } } : {}),
    });
    assert.equal(denied.statusCode, 403, `${method}: ${denied.body}`);
  }
});

function looseState(roomId: string | null) {
  return {
    mountKind: "loose",
    roomId,
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
}

function directState(
  roomId: string,
  rackId: string,
  startU: number,
  heightU: number,
  column: number,
  columnSpan: number,
) {
  return {
    ...looseState(roomId),
    mountKind: "direct",
    rackId,
    startU,
    heightU,
    face: "front",
    column,
    columnSpan,
  };
}

function shelfState(
  roomId: string,
  rackId: string,
  parentDeviceId: string,
  shelfX: number,
  shelfY: number,
  shelfWidth: number,
  shelfHeight: number,
  orientation: 0 | 90,
) {
  return {
    ...looseState(roomId),
    mountKind: "shelf",
    rackId,
    parentDeviceId,
    heightU: 1,
    face: "front",
    shelfX,
    shelfY,
    shelfWidth,
    shelfHeight,
    orientation,
  };
}

function sideState(roomId: string, rackId: string, side: "left" | "right") {
  return {
    ...looseState(roomId),
    mountKind: "side",
    rackId,
    heightU: 1,
    face: "front",
    side,
  };
}

function rackTopState(
  roomId: string,
  rackId: string,
  column: number,
  columnSpan: number,
) {
  return {
    ...looseState(roomId),
    mountKind: "rack-top",
    rackId,
    heightU: 1,
    face: "front",
    column,
    columnSpan,
  };
}

async function applyStudioAction(token: string, payload: object) {
  const response = await app.inject({
    method: "POST",
    url: "/api/rack-studio/actions",
    headers: authHeaders(token),
    payload,
  });
  assert.equal(response.statusCode, 200, response.body);
  return json(response);
}

async function bootstrapAdmin() {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      displayName: "Rack Studio Admin",
      password: "super-secret-1",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (json(response) as { token: string }).token;
}

async function createUserAndLogin(
  adminToken: string,
  input: { username: string; password: string; role: "viewer" | "editor" },
) {
  const created = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: authHeaders(adminToken),
    payload: {
      username: input.username,
      displayName: input.username,
      password: input.password,
      role: input.role,
      labAccess: [{ labId: "lab_home", role: input.role }],
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: input.username, password: input.password },
  });
  assert.equal(login.statusCode, 200, login.body);
  return (json(login) as { token: string }).token;
}

async function createLab(token: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/labs",
    headers: authHeaders(token),
    payload: { name },
  });
  assert.equal(response.statusCode, 201, response.body);
  return json(response) as { id: string };
}

async function createRoom(token: string, name: string, labId = "lab_home") {
  const response = await app.inject({
    method: "POST",
    url: "/api/rooms",
    headers: authHeaders(token),
    payload: { labId, name },
  });
  assert.equal(response.statusCode, 201, response.body);
  return json(response) as { id: string };
}

async function createRack(
  token: string,
  roomId: string,
  name: string,
  totalU: number,
  labId = "lab_home",
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/racks",
    headers: authHeaders(token),
    payload: { labId, roomId, name, totalU },
  });
  assert.equal(response.statusCode, 201, response.body);
  return json(response) as { id: string };
}

async function createDevice(
  token: string,
  roomId: string,
  hostname: string,
  deviceType = "server",
  labId = "lab_home",
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: authHeaders(token),
    payload: {
      labId,
      roomId,
      hostname,
      deviceType,
      status: "online",
      placement: "room",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return json(response) as { id: string };
}

async function createPort(
  token: string,
  deviceId: string,
  name: string,
  face: "front" | "rear",
  kind = "rj45",
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/ports",
    headers: authHeaders(token),
    payload: { deviceId, name, kind, face },
  });
  assert.equal(response.statusCode, 201, response.body);
  return json(response) as { id: string };
}

function resetDatabase() {
  db.exec(`
    DELETE FROM userSessions;
    DELETE FROM oidcIdentities;
    DELETE FROM userLabAccess;
    DELETE FROM devicePhysicalLayouts;
    DELETE FROM portLinks;
    DELETE FROM ports;
    DELETE FROM auditLog;
    DELETE FROM devices;
    DELETE FROM racks;
    DELETE FROM rooms;
    DELETE FROM users;
    DELETE FROM labs;
  `);
  setBootstrapState(null);
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function json(response: { body: string }) {
  return JSON.parse(response.body);
}

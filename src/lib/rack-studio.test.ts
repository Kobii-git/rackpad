import assert from "node:assert/strict";
import test from "node:test";
import type { Device, Rack } from "./types";
import {
  automaticRackCanvasPosition,
  devicePlacementState,
  directPlacementState,
  rackTopPlacementState,
  reconcileFocusedRackId,
  shelfPlacementBounds,
  validateDirectPlacementPreview,
  validateRackTopPlacementPreview,
} from "./rack-studio";

const rack: Rack = {
  id: "rack-a",
  labId: "lab-a",
  roomId: "room-a",
  name: "Rack A",
  totalU: 12,
};

test("automatic rack positions are deterministic and form a stable grid", () => {
  assert.deepEqual(automaticRackCanvasPosition(0), { x: 30, y: 34 });
  assert.deepEqual(automaticRackCanvasPosition(4), { x: 790, y: 34 });
  assert.deepEqual(automaticRackCanvasPosition(5), { x: 30, y: 326 });
});

test("focused rack keeps canvas selection until the external initial rack changes", () => {
  const availableRackIds = ["rack-a", "rack-b", "rack-c"];
  assert.equal(reconcileFocusedRackId({ currentRackId: "rack-b", initialRackId: "rack-a", previousInitialRackId: "rack-a", availableRackIds }), "rack-b");
  assert.equal(reconcileFocusedRackId({ currentRackId: "rack-b", initialRackId: "rack-c", previousInitialRackId: "rack-a", availableRackIds }), "rack-c");
  assert.equal(reconcileFocusedRackId({ currentRackId: "missing", initialRackId: "rack-a", previousInitialRackId: "rack-a", availableRackIds }), "rack-a");
});

test("12-column preview permits adjacent thirds and rejects intersections", () => {
  const existing = device({
    id: "existing",
    hostname: "existing-third",
    rackId: rack.id,
    roomId: rack.roomId,
    placement: "rack",
    startU: 4,
    heightU: 2,
    face: "front",
    rackMountKind: "direct",
    rackColumn: 0,
    rackColumnSpan: 4,
  });
  const adjacent = directPlacementState({
    roomId: rack.roomId ?? null,
    rackId: rack.id,
    startU: 4,
    heightU: 2,
    face: "front",
    column: 4,
    columnSpan: 4,
  });
  assert.deepEqual(
    validateDirectPlacementPreview({
      targetDeviceId: "target",
      next: adjacent,
      rack,
      devices: [existing],
    }),
    { valid: true, reason: null },
  );
  const overlap = { ...adjacent, column: 3 };
  const conflict = validateDirectPlacementPreview({
      targetDeviceId: "target",
      next: overlap,
      rack,
      devices: [existing],
    });
  assert.match(conflict.reason ?? "", /existing-third/);
  assert.equal(conflict.conflictDeviceId, existing.id);
  assert.equal(conflict.conflictDeviceName, existing.hostname);
});

test("rotated shelf footprints swap their effective dimensions", () => {
  const shelfDevice = device({
    id: "shelf-child",
    placement: "shelf",
    rackMountKind: "shelf",
    parentDeviceId: "shelf",
    shelfX: 100,
    shelfY: 200,
    shelfWidth: 300,
    shelfHeight: 120,
    shelfOrientation: 90,
  });
  assert.deepEqual(shelfPlacementBounds(devicePlacementState(shelfDevice)), {
    x: 100,
    y: 200,
    width: 120,
    height: 300,
  });
});

test("rack-top placement reuses rack columns and rejects occupied surface ranges", () => {
  const existing = device({
    id: "top-existing",
    hostname: "top-existing",
    rackId: rack.id,
    roomId: rack.roomId,
    placement: "rack",
    heightU: 1,
    face: "rear",
    rackMountKind: "rack-top",
    rackColumn: 0,
    rackColumnSpan: 6,
  });
  assert.deepEqual(
    devicePlacementState(existing),
    rackTopPlacementState({
      roomId: rack.roomId ?? null,
      rackId: rack.id,
      heightU: 1,
      face: "rear",
      column: 0,
      columnSpan: 6,
    }),
  );

  const adjacent = rackTopPlacementState({
    roomId: rack.roomId ?? null,
    rackId: rack.id,
    heightU: 1,
    column: 6,
    columnSpan: 6,
  });
  assert.deepEqual(
    validateRackTopPlacementPreview({
      targetDeviceId: "top-target",
      next: adjacent,
      rack,
      devices: [existing],
    }),
    { valid: true, reason: null },
  );
  const conflict = validateRackTopPlacementPreview({
      targetDeviceId: "top-target",
      next: { ...adjacent, face: "rear", column: 5 },
      rack,
      devices: [existing],
    });
  assert.match(conflict.reason ?? "", /top-existing/);
  assert.equal(conflict.conflictDeviceId, existing.id);
  assert.deepEqual(
    validateRackTopPlacementPreview({ targetDeviceId: "top-target", next: { ...adjacent, column: 0, face: "front" }, rack, devices: [existing] }),
    { valid: true, reason: null },
  );
});

function device(overrides: Partial<Device>): Device {
  return {
    id: "device",
    labId: "lab-a",
    hostname: "device",
    deviceType: "server",
    status: "online",
    ...overrides,
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import type { Device, Rack } from "./types";
import {
  automaticRackCanvasPosition,
  devicePlacementState,
  directPlacementState,
  shelfPlacementBounds,
  validateDirectPlacementPreview,
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
  assert.match(
    validateDirectPlacementPreview({
      targetDeviceId: "target",
      next: overlap,
      rack,
      devices: [existing],
    }).reason ?? "",
    /existing-third/,
  );
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

import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "./types";
import { resolveRackColumns } from "../components/rack/RackView";

function device(overrides: Partial<Device>): Device {
  return {
    id: "device",
    labId: "lab",
    hostname: "device",
    deviceType: "server",
    status: "online",
    placement: "rack",
    startU: 1,
    heightU: 1,
    face: "front",
    ...overrides,
  };
}

test("classic rack rendering honours explicit twelve-column placement before legacy slots", () => {
  assert.deepEqual(
    resolveRackColumns(device({ rackColumn: 0, rackColumnSpan: 12 })),
    {
      column: 0,
      columnSpan: 12,
    },
  );
  assert.deepEqual(
    resolveRackColumns(device({ rackColumn: 0, rackColumnSpan: 6 })),
    {
      column: 0,
      columnSpan: 6,
    },
  );
  assert.deepEqual(
    resolveRackColumns(device({ rackColumn: 6, rackColumnSpan: 6 })),
    {
      column: 6,
      columnSpan: 6,
    },
  );
  assert.deepEqual(
    resolveRackColumns(device({ rackColumn: 9, rackColumnSpan: 3 })),
    {
      column: 9,
      columnSpan: 3,
    },
  );
  assert.deepEqual(resolveRackColumns(device({ rackSlot: "right" })), {
    column: 6,
    columnSpan: 6,
  });
});

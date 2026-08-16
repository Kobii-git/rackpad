import assert from "node:assert/strict";
import { test } from "node:test";
import { selectComputeInventory } from "./compute";
import type { Device, DeviceTypeDefinition } from "./types";

const device = (id: string, deviceType: string, parentDeviceId?: string) =>
  ({
    id,
    labId: "lab",
    hostname: id,
    deviceType,
    status: "online",
    parentDeviceId,
  }) satisfies Device;

test("compute selectors preserve custom inheritance and exclude enclosures", () => {
  const types: DeviceTypeDefinition[] = [
    {
      id: "custom-host",
      label: "Custom host",
      builtIn: false,
      parentType: "server",
    },
    {
      id: "custom-enclosure",
      label: "Shelf",
      builtIn: false,
      parentType: "storage_enclosure",
    },
    { id: "custom-vm", label: "Guest", builtIn: false, parentType: "vm" },
  ];
  const inventory = selectComputeInventory(
    [
      device("host", "custom-host"),
      device("empty-host", "server"),
      device("shelf", "custom-enclosure"),
      device("guest", "custom-vm", "host"),
      device("orphan", "container", "missing"),
    ],
    types,
  );
  assert.deepEqual(
    inventory.hosts.map((entry) => entry.id),
    ["empty-host", "host"],
  );
  assert.deepEqual(
    inventory.guestsByHostId.host.map((entry) => entry.id),
    ["guest"],
  );
  assert.deepEqual(
    inventory.unassignedWorkloads.map((entry) => entry.id),
    ["orphan"],
  );
});

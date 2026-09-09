import assert from "node:assert/strict";
import test from "node:test";
import {
  deviceTypeBase,
  deviceTypeChainIncludes,
  deviceTypeLineage,
  deviceTypeMatchesTemplate,
} from "./device-types.ts";
import type { Device, DeviceTypeDefinition } from "./types.ts";

test("device type ancestry distinguishes storage enclosures from storage hosts", () => {
  const definitions: DeviceTypeDefinition[] = [
    {
      id: "custom_enclosure",
      label: "Custom enclosure",
      parentType: "storage_enclosure",
      builtIn: false,
    },
    {
      id: "custom_storage",
      label: "Custom storage",
      parentType: "storage",
      builtIn: false,
    },
  ];

  assert.equal(
    deviceTypeChainIncludes(
      "storage_enclosure",
      "storage_enclosure",
      definitions,
    ),
    true,
  );
  assert.equal(
    deviceTypeChainIncludes("storage", "storage_enclosure", definitions),
    false,
  );
  assert.equal(
    deviceTypeChainIncludes(
      "custom_enclosure",
      "storage_enclosure",
      definitions,
    ),
    true,
  );
  assert.equal(
    deviceTypeChainIncludes("custom_storage", "storage_enclosure", definitions),
    false,
  );
  assert.deepEqual(deviceTypeLineage("custom_enclosure", definitions), [
    "custom_enclosure",
    "storage_enclosure",
    "storage",
  ]);
  assert.equal(
    deviceTypeMatchesTemplate(
      "custom_enclosure",
      ["storage_enclosure"],
      definitions,
    ),
    true,
  );
  assert.equal(
    deviceTypeMatchesTemplate("custom_enclosure", ["storage"], definitions),
    true,
  );
  assert.equal(
    deviceTypeMatchesTemplate("custom_enclosure", ["server"], definitions),
    false,
  );
  assert.equal(
    deviceTypeMatchesTemplate("custom_enclosure", [], definitions),
    true,
  );
});

test("device type lineage terminates safely when definitions contain a cycle", () => {
  const definitions: DeviceTypeDefinition[] = [
    { id: "cycle_a", label: "Cycle A", parentType: "cycle_b", builtIn: false },
    { id: "cycle_b", label: "Cycle B", parentType: "cycle_a", builtIn: false },
  ];

  assert.deepEqual(deviceTypeLineage("cycle_a", definitions), [
    "cycle_a",
    "cycle_b",
  ]);
  assert.equal(deviceTypeBase("cycle_a", definitions), "cycle_a");
});

test("custom device types inherit workload, AP, shelf, and patch-panel behavior", () => {
  const definitions: DeviceTypeDefinition[] = [
    { id: "custom_vm", label: "Custom VM", parentType: "vm", builtIn: false },
    {
      id: "custom_container",
      label: "Custom container",
      parentType: "container",
      builtIn: false,
    },
    { id: "custom_ap", label: "Custom AP", parentType: "ap", builtIn: false },
    {
      id: "custom_shelf",
      label: "Custom shelf",
      parentType: "rack_shelf",
      builtIn: false,
    },
    {
      id: "custom_patch",
      label: "Custom patch panel",
      parentType: "patch_panel",
      builtIn: false,
    },
  ];

  assert.equal(deviceTypeBase("custom_vm", definitions), "vm");
  assert.equal(deviceTypeBase("custom_container", definitions), "container");
  assert.equal(deviceTypeBase("custom_ap", definitions), "ap");
  assert.equal(deviceTypeBase("custom_shelf", definitions), "rack_shelf");
  assert.equal(deviceTypeBase("custom_patch", definitions), "patch_panel");

  const virtualPortDefaults = (deviceType: string) => {
    const baseType = deviceTypeBase(deviceType, definitions);
    const virtual = baseType === "vm" || baseType === "container";
    return { kind: virtual ? "virtual" : "rj45", speed: virtual ? "virtio" : "" };
  };
  assert.deepEqual(virtualPortDefaults("custom_vm"), {
    kind: "virtual",
    speed: "virtio",
  });
  assert.deepEqual(virtualPortDefaults("custom_container"), {
    kind: "virtual",
    speed: "virtio",
  });

  const devices = [
    { id: "ap", deviceType: "custom_ap", hostname: "custom-ap" },
    { id: "client", deviceType: "endpoint", hostname: "client" },
  ] as Device[];
  const accessPoints = devices.filter(
    (device) => deviceTypeBase(device.deviceType, definitions) === "ap",
  );
  assert.deepEqual(
    accessPoints.map((device) => device.id),
    ["ap"],
  );
  assert.equal(
    deviceTypeBase("custom_patch", definitions) === "patch_panel",
    true,
  );
});

test("Docker host candidates inherit server device types only", () => {
  const definitions: DeviceTypeDefinition[] = [
    {
      id: "mini_pc",
      label: "Mini PC",
      parentType: "server",
      builtIn: false,
    },
    {
      id: "camera",
      label: "Camera",
      parentType: "endpoint",
      builtIn: false,
    },
    {
      id: "access_switch",
      label: "Access switch",
      parentType: "switch",
      builtIn: false,
    },
  ];
  const dockerHostTypes = new Set(["server", "vm", "container"]);
  const devices = [
    { id: "mini", deviceType: "mini_pc" },
    { id: "camera", deviceType: "camera" },
    { id: "switch", deviceType: "access_switch" },
  ] as Device[];

  const candidates = devices.filter((device) =>
    dockerHostTypes.has(deviceTypeBase(device.deviceType, definitions)),
  );

  assert.deepEqual(
    candidates.map((device) => device.id),
    ["mini"],
  );
});

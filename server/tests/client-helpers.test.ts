import assert from "node:assert/strict";
import { test } from "node:test";
import { buildManagementAssignmentPatch } from "../../src/lib/management-assignment-sync.ts";
import { summarizeNetworkCapacity } from "../../src/lib/report-capacity.ts";
import type { Device, IpAssignment, Port } from "../../src/lib/types.ts";

function makeDevice(overrides: Partial<Device>): Device {
  return {
    id: "device_1",
    labId: "lab_home",
    hostname: "device-1",
    deviceType: "switch",
    status: "online",
    ...overrides,
  } as Device;
}

function makePort(overrides: Partial<Port>): Port {
  return {
    id: `${overrides.deviceId ?? "device_1"}_${overrides.name ?? "port"}`,
    deviceId: "device_1",
    name: "Port 1",
    position: 1,
    kind: "rj45",
    speed: "1G",
    linkState: "down",
    mode: "access",
    face: "front",
    ...overrides,
  } as Port;
}

test("management IP sync preserves assignment semantics for unrelated device edits", () => {
  const existingAssignment = {
    id: "assignment_1",
    subnetId: "subnet_1",
    ipAddress: "192.168.10.50",
    assignmentType: "device",
    allocationMode: "static",
    dhcpScopeId: "scope_1",
    deviceId: "device_1",
    hostname: "device-1",
    description: "Management IP",
  } satisfies IpAssignment;

  const unchangedPatch = buildManagementAssignmentPatch({
    existingAssignment,
    device: { id: "device_1", hostname: "device-1" },
    subnetId: "subnet_1",
    ipAddress: "192.168.10.50",
  });
  assert.equal(unchangedPatch, null);

  const metadataPatch = buildManagementAssignmentPatch({
    existingAssignment,
    device: { id: "device_1", hostname: "renamed-device" },
    subnetId: "subnet_1",
    ipAddress: "192.168.10.50",
  });
  assert.deepEqual(metadataPatch, { hostname: "renamed-device" });
});

test("management IP sync includes assignment semantics when the IP changes", () => {
  const existingAssignment = {
    id: "assignment_1",
    subnetId: "subnet_1",
    ipAddress: "192.168.10.50",
    assignmentType: "device",
    allocationMode: "static",
    dhcpScopeId: "scope_1",
    deviceId: "device_1",
    hostname: "device-1",
    description: "Management IP",
  } satisfies IpAssignment;

  const patch = buildManagementAssignmentPatch({
    existingAssignment,
    device: { id: "device_1", hostname: "device-1" },
    subnetId: "subnet_1",
    ipAddress: "192.168.10.51",
  });

  assert.deepEqual(patch, {
    ipAddress: "192.168.10.51",
    allocationMode: "static",
    dhcpScopeId: "scope_1",
  });
});

test("network capacity counts passive patch panel pairs once", () => {
  const patchPanel = makeDevice({
    id: "patch_1",
    hostname: "patch-panel",
    deviceType: "patch_panel",
  });
  const patchPorts = Array.from({ length: 24 }, (_, index) => {
    const position = index + 1;
    return [
      makePort({
        id: `patch_${position}_front`,
        deviceId: "patch_1",
        name: `F${position}`,
        position,
        face: "front",
        linkState: "up",
      }),
      makePort({
        id: `patch_${position}_rear`,
        deviceId: "patch_1",
        name: `R${position}`,
        position,
        face: "rear",
        linkState: "up",
      }),
    ];
  }).flat();

  const summary = summarizeNetworkCapacity(patchPorts, [patchPanel]);

  assert.equal(summary.capacityMbps, 24_000);
  assert.equal(summary.linkedCapacityMbps, 24_000);
});

test("network capacity sums every port on non-patch-panel devices", () => {
  const switchDevice = makeDevice({
    id: "switch_1",
    hostname: "switch-1",
    deviceType: "switch",
  });
  const summary = summarizeNetworkCapacity(
    [
      makePort({
        id: "switch_1_front",
        deviceId: "switch_1",
        name: "Gi0/1",
        position: 1,
        linkState: "up",
      }),
      makePort({
        id: "switch_1_rear",
        deviceId: "switch_1",
        name: "Gi0/2",
        position: 1,
        linkState: "up",
      }),
    ],
    [switchDevice],
  );

  assert.equal(summary.capacityMbps, 2_000);
  assert.equal(summary.linkedCapacityMbps, 2_000);
});

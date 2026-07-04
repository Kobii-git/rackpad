import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCablingMapLines,
  buildCablingMapText,
} from "../../src/lib/cabling-map.ts";
import { buildManagementAssignmentPatch } from "../../src/lib/management-assignment-sync.ts";
import { summarizeNetworkCapacity } from "../../src/lib/report-capacity.ts";
import type {
  Device,
  DeviceTypeDefinition,
  IpAssignment,
  Port,
  PortLink,
} from "../../src/lib/types.ts";

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

test("network capacity counts custom patch panel descendants as passive pairs", () => {
  const deviceTypes: DeviceTypeDefinition[] = [
    {
      id: "keystone_patch_panel",
      label: "Keystone patch panel",
      builtIn: false,
      parentType: "patch_panel",
    },
  ];
  const patchPanel = makeDevice({
    id: "custom_patch_1",
    hostname: "keystone-panel",
    deviceType: "keystone_patch_panel",
  });
  const patchPorts = Array.from({ length: 24 }, (_, index) => {
    const position = index + 1;
    return [
      makePort({
        id: `custom_patch_${position}_front`,
        deviceId: "custom_patch_1",
        name: `F${position}`,
        position,
        face: "front",
        linkState: "up",
      }),
      makePort({
        id: `custom_patch_${position}_rear`,
        deviceId: "custom_patch_1",
        name: `R${position}`,
        position,
        face: "rear",
        linkState: "up",
      }),
    ];
  }).flat();

  const summary = summarizeNetworkCapacity(
    patchPorts,
    [patchPanel],
    deviceTypes,
  );

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

test("cabling map reports direct peers and spare ports", () => {
  const switchA = makeDevice({ id: "switch_a", hostname: "switch-a" });
  const switchB = makeDevice({ id: "switch_b", hostname: "switch-b" });
  const ports = [
    makePort({
      id: "a_1",
      deviceId: "switch_a",
      name: "Gi1",
      position: 1,
    }),
    makePort({
      id: "a_2",
      deviceId: "switch_a",
      name: "Gi2",
      position: 2,
    }),
    makePort({
      id: "b_1",
      deviceId: "switch_b",
      name: "Gi1",
      position: 1,
    }),
  ];
  const links: PortLink[] = [
    { id: "link_1", fromPortId: "a_1", toPortId: "b_1" },
  ];

  const text = buildCablingMapText(
    buildCablingMapLines(
      {
        deviceId: "switch_a",
        devices: [switchA, switchB],
        ports,
        portLinks: links,
      },
      "direct",
    ),
  );

  assert.match(text, /switch-a Gi1 -> switch-b Gi1/);
  assert.match(text, /switch-a Gi2 -> spare/);
});

test("cabling map follows passive patch panel pairs to active endpoints", () => {
  const server = makeDevice({
    id: "server_1",
    hostname: "server-1",
    deviceType: "server",
  });
  const patch = makeDevice({
    id: "patch_1",
    hostname: "patch-1",
    deviceType: "patch_panel",
  });
  const access = makeDevice({
    id: "access_1",
    hostname: "access-1",
    deviceType: "switch",
  });
  const ports = [
    makePort({ id: "server_eth0", deviceId: "server_1", name: "eth0" }),
    makePort({
      id: "patch_front",
      deviceId: "patch_1",
      name: "F1",
      position: 1,
      face: "front",
    }),
    makePort({
      id: "patch_rear",
      deviceId: "patch_1",
      name: "R1",
      position: 1,
      face: "rear",
    }),
    makePort({ id: "access_gi1", deviceId: "access_1", name: "Gi1" }),
  ];
  const links: PortLink[] = [
    { id: "link_1", fromPortId: "server_eth0", toPortId: "patch_front" },
    { id: "link_2", fromPortId: "patch_rear", toPortId: "access_gi1" },
  ];

  const lines = buildCablingMapLines(
    {
      deviceId: "server_1",
      devices: [server, patch, access],
      ports,
      portLinks: links,
    },
    "active",
  );

  assert.equal(lines[0].text, "server-1 eth0 -> access-1 Gi1");
});

test("cabling map full path includes passive hops", () => {
  const server = makeDevice({ id: "server_2", hostname: "server-2" });
  const patch = makeDevice({
    id: "patch_2",
    hostname: "patch-2",
    deviceType: "patch_panel",
  });
  const access = makeDevice({ id: "access_2", hostname: "access-2" });
  const ports = [
    makePort({ id: "server_eth1", deviceId: "server_2", name: "eth1" }),
    makePort({
      id: "patch_2_front",
      deviceId: "patch_2",
      name: "F1",
      position: 1,
      face: "front",
    }),
    makePort({
      id: "patch_2_rear",
      deviceId: "patch_2",
      name: "R1",
      position: 1,
      face: "rear",
    }),
    makePort({ id: "access_2_gi1", deviceId: "access_2", name: "Gi1" }),
  ];
  const links: PortLink[] = [
    { id: "link_3", fromPortId: "server_eth1", toPortId: "patch_2_front" },
    { id: "link_4", fromPortId: "patch_2_rear", toPortId: "access_2_gi1" },
  ];

  const text = buildCablingMapText(
    buildCablingMapLines(
      {
        deviceId: "server_2",
        devices: [server, patch, access],
        ports,
        portLinks: links,
      },
      "full",
    ),
  );

  assert.match(
    text,
    /server-2 eth1 --cable--> patch-2 F1 --passive--> patch-2 R1 --cable--> access-2 Gi1/,
  );
});

test("cabling map stops at broken passive endpoints", () => {
  const server = makeDevice({ id: "server_broken", hostname: "server-broken" });
  const patch = makeDevice({
    id: "patch_broken",
    hostname: "patch-broken",
    deviceType: "patch_panel",
  });
  const ports = [
    makePort({
      id: "server_broken_eth0",
      deviceId: "server_broken",
      name: "eth0",
    }),
    makePort({
      id: "patch_broken_front",
      deviceId: "patch_broken",
      name: "F1",
      position: 1,
      face: "front",
    }),
  ];
  const links: PortLink[] = [
    {
      id: "broken_link",
      fromPortId: "server_broken_eth0",
      toPortId: "patch_broken_front",
    },
  ];

  const lines = buildCablingMapLines(
    {
      deviceId: "server_broken",
      devices: [server, patch],
      ports,
      portLinks: links,
    },
    "active",
  );

  assert.equal(
    lines[0].text,
    "server-broken eth0 -> patch-broken F1 (passive endpoint)",
  );
});

test("cabling map marks aggregate members as cabled through aggregate", () => {
  const server = makeDevice({ id: "lag_server", hostname: "lag-server" });
  const ports = [
    makePort({
      id: "bond_1",
      deviceId: "lag_server",
      name: "Bond1",
      kind: "virtual",
      portRole: "aggregate",
    }),
    makePort({
      id: "eth_1",
      deviceId: "lag_server",
      name: "eth1",
      aggregatePortId: "bond_1",
    }),
  ];

  const lines = buildCablingMapLines(
    { deviceId: "lag_server", devices: [server], ports, portLinks: [] },
    "direct",
  );

  assert.equal(lines[1].text, "lag-server eth1 -> cable aggregate Bond1");
});

test("cabling map stops loops instead of walking forever", () => {
  const switchDevice = makeDevice({
    id: "loop_switch",
    hostname: "loop-switch",
  });
  const patch = makeDevice({
    id: "loop_patch",
    hostname: "loop-patch",
    deviceType: "patch_panel",
  });
  const ports = [
    makePort({
      id: "loop_switch_gi1",
      deviceId: "loop_switch",
      name: "Gi1",
      position: 1,
    }),
    makePort({
      id: "loop_front",
      deviceId: "loop_patch",
      name: "F1",
      position: 1,
      face: "front",
    }),
    makePort({
      id: "loop_rear",
      deviceId: "loop_patch",
      name: "R1",
      position: 1,
      face: "rear",
    }),
  ];
  const links: PortLink[] = [
    {
      id: "loop_link_1",
      fromPortId: "loop_switch_gi1",
      toPortId: "loop_front",
    },
    { id: "loop_link_2", fromPortId: "loop_rear", toPortId: "loop_switch_gi1" },
  ];

  const lines = buildCablingMapLines(
    {
      deviceId: "loop_switch",
      devices: [switchDevice, patch],
      ports,
      portLinks: links,
    },
    "full",
  );

  assert.match(lines[0].text, /loop detected/);
});

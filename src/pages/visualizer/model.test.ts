import assert from "node:assert/strict";
import test from "node:test";
import type { Device, DeviceTypeDefinition } from "@/lib/types";
import { buildVisualizerModel, visualizerCablePath } from "./model";
import type { RoomGroup, VisualizerNode } from "./types";

function testDevice(id: string): Device {
  return {
    id,
    labId: "lab_visualizer_routes",
    hostname: id,
    deviceType: "endpoint",
    status: "online",
    placement: "room",
  };
}

function testNode(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): VisualizerNode {
  return {
    device: testDevice(id),
    effectiveDeviceType: "endpoint",
    x,
    y,
    width,
    height,
    health: "online",
    typeColor: "var(--type-endpoint)",
    stripeColor: "var(--type-endpoint)",
    zoneId: "room:test:loose",
    roomId: "room_test",
    roomName: "Test room",
    ports: [],
    portSummary: {
      linked: 0,
      total: 0,
    },
  };
}

test("bundled visualizer cables route loose devices through a right-side gutter", () => {
  const fromNode = testNode("loose-a", 48, 96, 160, 40);
  const toNode = testNode("loose-b", 48, 172, 160, 40);
  const group: RoomGroup = {
    id: "room:test:loose",
    name: "Test room / Loose",
    subtitle: "Room inventory",
    color: "var(--type-endpoint)",
    x: 28,
    y: 48,
    width: 220,
    nodes: [fromNode, toNode],
    total: 2,
    online: 2,
    down: 0,
    collapsed: false,
    groupType: "device-type",
  };
  const fromPoint = { x: fromNode.x + fromNode.width - 4, y: 116 };
  const toPoint = { x: toNode.x + toNode.width - 4, y: 192 };

  const path = visualizerCablePath(fromPoint, toPoint, 0, "bundled", {
    fromNode,
    toNode,
    roomGroups: [group],
  });
  assert.ok(path);

  const xCoordinates = Array.from(path.matchAll(/-?\d+(?:\.\d+)?/g))
    .map((match, index) => (index % 2 === 0 ? Number(match[0]) : null))
    .filter((value): value is number => value !== null);

  assert.ok(
    Math.max(...xCoordinates) > group.x + group.width,
    "expected loose-device bundled routing to use a gutter outside the group",
  );
});

test("custom device type parents drive visualizer grouping and counts", () => {
  const deviceTypes: DeviceTypeDefinition[] = [
    { id: "switch", label: "Switch", builtIn: true },
    {
      id: "unmanaged_switch",
      label: "Unmanaged switch",
      builtIn: false,
      parentType: "switch",
    },
  ];
  const devices: Device[] = [
    {
      id: "d_custom",
      labId: "lab_visualizer_types",
      hostname: "netgear-lab",
      deviceType: "unmanaged_switch",
      status: "online",
      placement: "room",
    },
    {
      id: "d_switch",
      labId: "lab_visualizer_types",
      hostname: "core-switch",
      deviceType: "switch",
      status: "online",
      placement: "room",
    },
  ];

  const model = buildVisualizerModel({
    racks: [],
    rooms: [],
    devices,
    deviceTypes,
    ports: [],
    portLinks: [],
    deviceMonitors: [],
    subnets: [],
    vlans: [],
    discoveredDevices: [],
    virtualSwitches: [],
    expandedRackRuns: new Set(),
    collapsedGroups: new Set(),
  });

  assert.equal(model.roomZone.groups.length, 1);
  assert.equal(model.roomZone.groups[0]?.name, "Unassigned / Switch");
  assert.equal(model.nodesByDeviceId.d_custom?.effectiveDeviceType, "switch");
  assert.deepEqual(model.deviceTypes, [
    { type: "switch", label: "Switch", count: 2 },
  ]);
});

test("manual visualizer order controls sections, racks, groups, and group devices", () => {
  const devices: Device[] = [
    {
      id: "endpoint_a",
      labId: "lab_visualizer_order",
      hostname: "alpha-endpoint",
      deviceType: "endpoint",
      status: "online",
      placement: "room",
      roomId: "room_a",
    },
    {
      id: "endpoint_z",
      labId: "lab_visualizer_order",
      hostname: "zulu-endpoint",
      deviceType: "endpoint",
      status: "online",
      placement: "room",
      roomId: "room_a",
    },
    {
      id: "switch_a",
      labId: "lab_visualizer_order",
      hostname: "access-switch",
      deviceType: "switch",
      status: "online",
      placement: "room",
      roomId: "room_a",
    },
  ];

  const model = buildVisualizerModel({
    rooms: [
      { id: "room_a", labId: "lab_visualizer_order", name: "Alpha room" },
      { id: "room_b", labId: "lab_visualizer_order", name: "Beta room" },
    ],
    racks: [
      {
        id: "rack_a",
        labId: "lab_visualizer_order",
        name: "Alpha rack",
        totalU: 24,
        roomId: "room_a",
      },
      {
        id: "rack_b",
        labId: "lab_visualizer_order",
        name: "Beta rack",
        totalU: 24,
        roomId: "room_b",
      },
    ],
    devices,
    deviceTypes: [],
    ports: [],
    portLinks: [],
    deviceMonitors: [],
    subnets: [],
    vlans: [],
    discoveredDevices: [],
    virtualSwitches: [],
    expandedRackRuns: new Set(),
    collapsedGroups: new Set(),
    layout: {
      includeRoomOnlySections: true,
      order: {
        sections: ["room:room_b", "room:room_a"],
        racks: ["rack_b", "rack_a"],
        groups: ["room:room_a:type:endpoint", "room:room_a:type:switch"],
        devicesByGroup: {
          "room:room_a:type:endpoint": ["endpoint_z", "endpoint_a"],
        },
      },
    },
  });

  assert.deepEqual(
    model.rackZone.sections.map((section) => section.id),
    ["room:room_b", "room:room_a"],
  );
  assert.deepEqual(
    model.rackZone.racks.map((panel) => panel.rack.id),
    ["rack_b", "rack_a"],
  );

  const alphaSection = model.rackZone.sections.find(
    (section) => section.id === "room:room_a",
  );
  assert.ok(alphaSection);
  assert.deepEqual(
    alphaSection.looseGroups.map((group) => group.id),
    ["room:room_a:type:endpoint", "room:room_a:type:switch"],
  );
  assert.deepEqual(
    alphaSection.looseGroups[0]?.nodes.map((node) => node.device.id),
    ["endpoint_z", "endpoint_a"],
  );
});

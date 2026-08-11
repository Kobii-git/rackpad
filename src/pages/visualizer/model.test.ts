import assert from "node:assert/strict";
import test from "node:test";
import type { Device, DeviceTypeDefinition, Port } from "@/lib/types";
import {
  buildSearchResults,
  buildVisualizerModel,
  summarizeCableLengths,
  visualizerCableLaneIndexes,
  visualizerCablePath,
  visualizerSearchResultMeta,
} from "./model";
import type { TranslationKey } from "@/i18n/translations";
import type {
  RoomGroup,
  TraceSegment,
  VisualizerCable,
  VisualizerNode,
} from "./types";

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

function testPort(deviceId: string, id: string, position: number): Port {
  return {
    id,
    deviceId,
    name: `eth${position}`,
    position,
    kind: "rj45",
    linkState: "up",
    mode: "access",
  };
}

function testCable(
  id: string,
  fromNode: VisualizerNode,
  toNode: VisualizerNode,
  fromPosition: number,
  toPosition: number,
): VisualizerCable {
  const fromPort = testPort(fromNode.device.id, `${id}_from`, fromPosition);
  const toPort = testPort(toNode.device.id, `${id}_to`, toPosition);
  return {
    link: {
      id,
      fromPortId: fromPort.id,
      toPortId: toPort.id,
    },
    fromPort,
    toPort,
    fromDevice: fromNode.device,
    toDevice: toNode.device,
    fromNode,
    toNode,
    fromPoint: { x: fromNode.x + fromNode.width, y: fromNode.y + 12 },
    toPoint: { x: toNode.x, y: toNode.y + 12 },
    path: null,
    color: "blue",
    up: true,
    bothOnline: true,
    unknown: false,
    crossZone: false,
    snmpVerified: false,
    logicalAggregate: false,
  };
}

function lengthSegments(
  ...entries: Array<string | null | undefined | { patch: string }>
): TraceSegment[] {
  return entries.map((entry, index) => {
    const patchLength =
      typeof entry === "object" && entry ? entry.patch : undefined;
    const length = patchLength ?? (typeof entry === "string" ? entry : null);
    const kind: TraceSegment["kind"] =
      patchLength === undefined ? "cable" : "patch";
    return {
      kind,
      fromPort: testPort("length-source", `length-from-${index}`, index + 1),
      toPort: testPort("length-target", `length-to-${index}`, index + 1),
      color: "blue",
      length,
    };
  });
}

test("trace cable lengths are calculated only when every cable is known", () => {
  assert.equal(
    summarizeCableLengths(lengthSegments("6ft", "25ft", "3ft", "1ft")),
    "35ft",
  );
  assert.equal(summarizeCableLengths(lengthSegments("1m", "50 cm")), "1.5m");
  assert.equal(summarizeCableLengths(lengthSegments("1 foot", '12"')), "2ft");
  assert.equal(summarizeCableLengths(lengthSegments("1yd", "3 FT")), "2yd");
  assert.equal(summarizeCableLengths(lengthSegments("1m", "3.28084ft")), "2m");
  assert.equal(summarizeCableLengths(lengthSegments("1m", "1mm")), "1.001m");
  assert.equal(
    summarizeCableLengths(lengthSegments("1m", { patch: "999m" })),
    "1m",
  );

  assert.equal(
    summarizeCableLengths(lengthSegments("1m", undefined)),
    "Unknown",
  );
  assert.equal(summarizeCableLengths(lengthSegments("1m", "~3m")), "1m + ~3m");
  assert.equal(
    summarizeCableLengths(lengthSegments("6ft 3in", "1ft")),
    "6ft 3in + 1ft",
  );
  assert.equal(
    summarizeCableLengths(lengthSegments("1-2m", "-3m")),
    "1-2m + -3m",
  );
  assert.equal(
    summarizeCableLengths(lengthSegments({ patch: "1m" })),
    "Unknown",
  );
});

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

test("visualizer cable lanes are stable within each route container pair", () => {
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
  const cableA = testCable("link-a", fromNode, toNode, 1, 1);
  const cableB = testCable("link-b", fromNode, toNode, 2, 2);

  const lanesAFirst = visualizerCableLaneIndexes([cableA, cableB], {
    roomGroups: [group],
  });
  const lanesBFirst = visualizerCableLaneIndexes([cableB, cableA], {
    roomGroups: [group],
  });

  assert.equal(lanesAFirst.get("link-a"), lanesBFirst.get("link-a"));
  assert.equal(lanesAFirst.get("link-b"), lanesBFirst.get("link-b"));
  assert.notEqual(lanesAFirst.get("link-a"), lanesAFirst.get("link-b"));
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

test("custom server and storage types keep pyramid root priority", () => {
  const devices: Device[] = [
    { ...testDevice("custom_server"), deviceType: "mini_server" },
    testDevice("server_endpoint"),
    { ...testDevice("custom_storage"), deviceType: "disk_array" },
    testDevice("storage_endpoint"),
  ];
  const ports = [
    testPort("custom_server", "custom_server_port", 1),
    testPort("server_endpoint", "server_endpoint_port", 1),
    testPort("custom_storage", "custom_storage_port", 1),
    testPort("storage_endpoint", "storage_endpoint_port", 1),
  ];
  const model = buildVisualizerModel({
    racks: [],
    rooms: [],
    devices,
    deviceTypes: [
      {
        id: "mini_server",
        label: "Mini server",
        parentType: "server",
        builtIn: false,
      },
      {
        id: "disk_array",
        label: "Disk array",
        parentType: "storage",
        builtIn: false,
      },
    ],
    ports,
    portLinks: [
      {
        id: "server_link",
        fromPortId: "custom_server_port",
        toPortId: "server_endpoint_port",
      },
      {
        id: "storage_link",
        fromPortId: "custom_storage_port",
        toPortId: "storage_endpoint_port",
      },
    ],
    deviceMonitors: [],
    subnets: [],
    vlans: [],
    discoveredDevices: [],
    virtualSwitches: [],
    expandedRackRuns: new Set(),
    collapsedGroups: new Set(),
    layout: { topologyLayout: "pyramid" },
  });

  const customServer = model.nodesByDeviceId.custom_server;
  const serverEndpoint = model.nodesByDeviceId.server_endpoint;
  const customStorage = model.nodesByDeviceId.custom_storage;
  const storageEndpoint = model.nodesByDeviceId.storage_endpoint;
  assert.ok(customServer);
  assert.ok(serverEndpoint);
  assert.ok(customStorage);
  assert.ok(storageEndpoint);
  assert.equal(customServer.effectiveDeviceType, "server");
  assert.equal(customStorage.effectiveDeviceType, "storage");
  assert.ok(customServer.y < serverEndpoint.y);
  assert.ok(customStorage.y < storageEndpoint.y);
});

test("visualizer search localizes built-in types and preserves custom labels", () => {
  const deviceTypes: DeviceTypeDefinition[] = [
    { id: "storage", label: "Storage", builtIn: true },
    {
      id: "storage_enclosure",
      label: "Storage enclosure",
      builtIn: true,
      parentType: "storage",
    },
    { id: "archive_shelf", label: "Archive shelf", builtIn: false },
  ];
  const model = buildVisualizerModel({
    racks: [],
    rooms: [],
    devices: [
      {
        id: "d_enclosure",
        labId: "lab_visualizer_types",
        hostname: "jbod-lab",
        deviceType: "storage_enclosure",
        status: "online",
        placement: "room",
      },
      {
        id: "d_archive",
        labId: "lab_visualizer_types",
        hostname: "archive-lab",
        deviceType: "archive_shelf",
        status: "online",
        placement: "room",
      },
    ],
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
  const t = (key: TranslationKey) =>
    key === "Storage enclosure" ? "Boîtier de stockage" : key;
  const enclosure = buildSearchResults(model, "jbod-lab")[0];
  const archive = buildSearchResults(model, "archive-lab")[0];
  assert.ok(enclosure);
  assert.ok(archive);
  assert.equal(enclosure.meta, "");
  assert.equal(
    visualizerSearchResultMeta(model, enclosure, t),
    "Boîtier de stockage",
  );
  assert.equal(
    visualizerSearchResultMeta(model, archive, t),
    "Archive shelf",
  );
});

test("visualizer search canonicalizes full MAC queries without changing fuzzy search", () => {
  const model = buildVisualizerModel({
    racks: [],
    rooms: [],
    devices: [
      {
        ...testDevice("core-switch"),
        hostname: "core-sw-01",
        managementIp: "10.10.0.5",
        macAddress: "00:11:22:33:44:55",
        manufacturer: "Aruba",
      },
    ],
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
  });

  const macScores = [
    "00:11:22:33:44:55",
    "00-11-22-33-44-55",
    "0011.2233.4455",
    "001122334455",
  ].map((query) => buildSearchResults(model, query)[0]?.score ?? 0);

  assert.ok(macScores.every((score) => score > 0));
  assert.ok(macScores.every((score) => score === macScores[0]));
  assert.equal(buildSearchResults(model, "crs1")[0]?.score, 40);
});

test("visualizer marks aggregate endpoint links as logical LAG links", () => {
  const devices = [testDevice("lag-a"), testDevice("lag-b")];
  const ports: Port[] = [
    {
      ...testPort("lag-a", "lag-a-bond", 1),
      name: "Bond1",
      kind: "virtual",
      portRole: "aggregate",
    },
    {
      ...testPort("lag-b", "lag-b-bond", 1),
      name: "Bond1",
      kind: "virtual",
      portRole: "aggregate",
    },
  ];
  const model = buildVisualizerModel({
    racks: [],
    rooms: [],
    devices,
    deviceTypes: [],
    ports,
    portLinks: [
      {
        id: "lag-link",
        fromPortId: "lag-a-bond",
        toPortId: "lag-b-bond",
        cableType: "lacp",
      },
    ],
    deviceMonitors: [],
    subnets: [],
    vlans: [],
    discoveredDevices: [],
    virtualSwitches: [],
    expandedRackRuns: new Set(),
    collapsedGroups: new Set(),
  });

  assert.equal(model.cables[0]?.logicalAggregate, true);
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

test("pyramid visualizer bounds expand around dragged nodes", () => {
  const devices: Device[] = [
    {
      id: "endpoint_dragged",
      labId: "lab_visualizer_drag",
      hostname: "dragged-endpoint",
      deviceType: "endpoint",
      status: "online",
      placement: "room",
    },
    {
      id: "switch_source",
      labId: "lab_visualizer_drag",
      hostname: "source-switch",
      deviceType: "switch",
      status: "online",
      placement: "room",
    },
  ];

  const model = buildVisualizerModel({
    rooms: [],
    racks: [],
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
      topologyLayout: "pyramid",
      customNodePositions: {
        endpoint_dragged: { x: 1600, y: 1200 },
      },
    },
  });

  const draggedNode = model.nodesByDeviceId.endpoint_dragged;
  assert.ok(draggedNode);
  assert.equal(draggedNode.x, 1600);
  assert.equal(draggedNode.y, 1200);
  assert.ok(model.width > draggedNode.x + draggedNode.width);
  assert.ok(model.height > draggedNode.y + draggedNode.height);
  assert.ok(
    model.rackZone.width > draggedNode.x - model.rackZone.x + draggedNode.width,
  );
  assert.ok(model.rackZone.height > draggedNode.y + draggedNode.height);
});

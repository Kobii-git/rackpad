import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RACK_STUDIO_ROUTE_STYLE_STORAGE_KEY,
  RACK_STUDIO_SHOW_LABELS_STORAGE_KEY,
  buildRackElevationCableRoutes,
  buildRackStudioCableRoutes,
  cablePath,
  connectorPairIsUsual,
  defaultCableMetadata,
  nextManualWaypoint,
  rackStudioRouteStylePreference,
  rackStudioShowLabelsPreference,
  resolveRackStudioPortAnchor,
} from "./rack-studio-cables";
import { buildRackStudioSvg } from "./rack-studio-export";
import type {
  Device,
  DevicePhysicalLayout,
  Port,
  PortLink,
  Rack,
  Room,
} from "./types";

const room: Room = { id: "room-a", labId: "lab-a", name: "Main room" };
const rackA: Rack = {
  id: "rack-a",
  labId: "lab-a",
  roomId: room.id,
  name: "Rack A",
  totalU: 42,
  studioX: 80,
  studioY: 70,
};
const rackB: Rack = {
  id: "rack-b",
  labId: "lab-a",
  roomId: room.id,
  name: "Rack B",
  totalU: 42,
  studioX: 520,
  studioY: 70,
};
const serverA = device("server-a", rackA.id, 10);
const serverB = device("server-b", rackB.id, 10);
const portA = port("port-a", serverA.id, "NIC 1", "rj45");
const portB = port("port-b", serverB.id, "NIC 1", "rj45");
const layouts = [
  layout(serverA.id, portA.id, 80, 260),
  layout(serverB.id, portB.id, 820, 260),
];
const link: PortLink = {
  id: "link-a",
  fromPortId: portA.id,
  toPortId: portB.id,
  cableType: "Cat6A",
  color: "#22d3ee",
  visible: true,
  routeWaypoints: [],
};

test("exact mapped ports drive stable room routes while rack movement updates automatic endpoints", () => {
  const input = {
    room,
    face: "both" as const,
    devices: [serverA, serverB],
    racks: [rackA, rackB],
    layouts,
    ports: [portA, portB],
    links: [link],
  };
  const first = buildRackStudioCableRoutes(input)[0]!;
  const repeat = buildRackStudioCableRoutes(input)[0]!;
  assert.equal(first.path, repeat.path);
  assert.equal(first.category, "network");
  assert.equal(first.points.length, 6);

  const movedRack = { ...rackB, studioX: 680, studioY: 190 };
  const moved = buildRackStudioCableRoutes({
    ...input,
    racks: [rackA, movedRack],
  })[0]!;
  assert.notEqual(moved.path, first.path);
  assert.notDeepEqual(moved.points.at(-1), first.points.at(-1));
});

test("manual waypoints remain fixed while endpoint anchors follow rack placement", () => {
  const routedLink: PortLink = {
    ...link,
    routeWaypoints: [
      { id: "manual-1", roomId: room.id, face: "rear", x: 400, y: 420 },
    ],
  };
  const original = buildRackStudioCableRoutes({
    room,
    face: "rear",
    devices: [serverA, serverB],
    racks: [rackA, rackB],
    layouts,
    ports: [portA, portB],
    links: [routedLink],
  })[0]!;
  const moved = buildRackStudioCableRoutes({
    room,
    face: "rear",
    devices: [serverA, serverB],
    racks: [rackA, { ...rackB, studioY: 260 }],
    layouts,
    ports: [portA, portB],
    links: [routedLink],
  })[0]!;
  assert.deepEqual(original.points[1], { x: 400, y: 420 });
  assert.deepEqual(moved.points[1], { x: 400, y: 420 });
  assert.notDeepEqual(original.points.at(-1), moved.points.at(-1));
  assert.match(original.path, /L 400\.00 420\.00/);
});

test("overlapping corridors receive unbounded stable lanes independent of input order", () => {
  const devices: Device[] = [];
  const ports: Port[] = [];
  const routeLayouts: DevicePhysicalLayout[] = [];
  const links: PortLink[] = [];
  for (let index = 0; index < 14; index += 1) {
    const fromDevice = {
      ...device(`lane-from-${index}`, rackA.id, index + 1),
      heightU: 1,
    };
    const toDevice = {
      ...device(`lane-to-${index}`, rackA.id, index + 29),
      heightU: 1,
    };
    const fromPort = port(
      `lane-from-port-${index}`,
      fromDevice.id,
      `NIC ${index + 1}`,
      "rj45",
    );
    const toPort = port(
      `lane-to-port-${index}`,
      toDevice.id,
      `NIC ${index + 1}`,
      "rj45",
    );
    devices.push(fromDevice, toDevice);
    ports.push(fromPort, toPort);
    routeLayouts.push(
      layout(fromDevice.id, fromPort.id, 100, 260),
      layout(toDevice.id, toPort.id, 900, 260),
    );
    links.push({
      id: `lane-link-${String(index).padStart(2, "0")}`,
      fromPortId: fromPort.id,
      toPortId: toPort.id,
      visible: true,
      routeWaypoints: [],
    });
  }
  const input = {
    room,
    face: "both" as const,
    devices,
    racks: [rackA],
    layouts: routeLayouts,
    ports,
    links,
    style: "orthogonal" as const,
  };
  const routes = buildRackStudioCableRoutes(input);
  const shuffled = buildRackStudioCableRoutes({
    ...input,
    devices: [...devices].reverse(),
    layouts: [...routeLayouts].reverse(),
    ports: [...ports].reverse(),
    links: [...links].reverse(),
  });

  assert.equal(routes.length, 14);
  assert.equal(
    new Set(routes.map((route) => route.points[1]!.x)).size,
    14,
    JSON.stringify(
      routes.map((route) => ({
        id: route.link.id,
        points: route.points,
      })),
    ),
  );
  assert.deepEqual(
    routes.map((route) => [route.link.id, route.path]),
    shuffled.map((route) => [route.link.id, route.path]),
  );
});

test("automatic cross-rack routes use an exterior corridor around unrelated racks", () => {
  const blockingRack: Rack = {
    ...rackA,
    id: "rack-blocking",
    name: "Rack blocking",
    studioX: 310,
  };
  const route = buildRackStudioCableRoutes({
    room,
    face: "both",
    devices: [serverA, serverB],
    racks: [rackA, blockingRack, rackB],
    layouts,
    ports: [portA, portB],
    links: [link],
    style: "orthogonal",
  })[0]!;

  assert.ok(route.points.length >= 6);
  assert.ok(route.points[2]!.y > blockingRack.studioY! + 278);
});

test("route preferences default safely and smooth paths retain manual anchors", () => {
  assert.equal(rackStudioRouteStylePreference(null), "smooth");
  assert.equal(rackStudioRouteStylePreference("invalid"), "smooth");
  assert.equal(rackStudioRouteStylePreference("orthogonal"), "orthogonal");
  assert.equal(rackStudioShowLabelsPreference(null), false);
  assert.equal(rackStudioShowLabelsPreference("false"), false);
  assert.equal(rackStudioShowLabelsPreference("true"), true);
  assert.match(RACK_STUDIO_ROUTE_STYLE_STORAGE_KEY, /^rackpad\.rack-studio\./);
  assert.match(RACK_STUDIO_SHOW_LABELS_STORAGE_KEY, /^rackpad\.rack-studio\./);
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 80, y: 40 },
  ];
  assert.match(cablePath(points, "smooth", [2]), /Q/);
  assert.match(cablePath(points, "smooth", [2]), /L 40\.00 40\.00/);
  assert.doesNotMatch(cablePath(points, "orthogonal"), /Q/);
});

test("cross-room endpoints become labeled canvas handoffs and hidden links stay hidden", () => {
  const remoteRoom: Room = {
    id: "room-b",
    labId: "lab-a",
    name: "Remote room",
  };
  const remoteRack = { ...rackB, roomId: remoteRoom.id };
  const remoteDevice = { ...serverB, roomId: remoteRoom.id };
  const crossRoom = buildRackStudioCableRoutes({
    room,
    face: "both",
    devices: [serverA, remoteDevice],
    racks: [rackA, remoteRack],
    layouts,
    ports: [portA, portB],
    links: [link],
  })[0]!;
  assert.equal(crossRoom.crossRoom, true);
  assert.equal(crossRoom.remoteRoomId, remoteRoom.id);
  assert.equal(crossRoom.points.length, 3);

  const hidden = buildRackStudioCableRoutes({
    room,
    face: "both",
    devices: [serverA, serverB],
    racks: [rackA, rackB],
    layouts,
    ports: [portA, portB],
    links: [{ ...link, visible: false }],
  });
  assert.deepEqual(hidden, []);
});

test("connector compatibility and defaults distinguish network, optical, and power", () => {
  const power = port("power", serverB.id, "PSU", "power");
  const sfp = port("sfp", serverA.id, "SFP 1", "sfp");
  const fiber = port("fiber", serverB.id, "Fiber 1", "fiber");
  assert.equal(connectorPairIsUsual(portA, portB), true);
  assert.equal(connectorPairIsUsual(sfp, fiber), true);
  assert.equal(connectorPairIsUsual(portA, power), false);
  assert.deepEqual(defaultCableMetadata(portA, portB), {
    cableType: "Cat6A",
    color: "#22d3ee",
  });
  assert.equal(defaultCableMetadata(portA, power).cableType, "Power");
});

test("room and focused-rack exports are deterministic, themed, and retain exact port labels", () => {
  const labels = {
    cable: "Cable",
    cables: "Cables",
    devices: "devices",
    front: "Front",
    rear: "Rear",
    room: "Room",
    rack: "Rack",
    legend: "Cable · Type",
    crossRoom: "Room",
    categories: {
      network: "Network",
      fiber: "Fiber",
      power: "Power",
      console: "Console",
      usb: "USB",
      storage: "Storage",
      other: "Other",
    },
  };
  const input = {
    room,
    racks: [rackA, rackB],
    devices: [serverA, serverB],
    layouts,
    ports: [portA, portB],
    links: [{ ...link, color: '"/><script>alert(1)</script>' }],
    face: "both" as const,
    showLabels: true,
    routeStyle: "smooth" as const,
    theme: "dark" as const,
    labels,
  };
  const roomImage = buildRackStudioSvg(input);
  assert.equal(roomImage.svg, buildRackStudioSvg(input).svg);
  assert.match(roomImage.svg, /data-theme="dark"/);
  assert.match(roomImage.svg, /Main room/);
  assert.match(roomImage.svg, /Cable · Type/);
  assert.doesNotMatch(roomImage.svg, /<script>/i);
  const screenRoute = buildRackStudioCableRoutes({
    room,
    face: "both",
    devices: [serverA, serverB],
    racks: [rackA, rackB],
    layouts,
    ports: [portA, portB],
    links: [link],
    style: "smooth",
  })[0]!;
  const exportedPath = cablePath(
    screenRoute.points.map((point) => ({ x: point.x + 60, y: point.y + 92 })),
    "smooth",
    screenRoute.manualPointIndexes,
  );
  assert.ok(roomImage.svg.includes(`d="${exportedPath}"`));

  const rackImage = buildRackStudioSvg({ ...input, focusRackId: rackA.id });
  assert.match(rackImage.filename, /rack-a-rack-studio\.svg/);
  assert.match(rackImage.svg, /Rack A · Front/);
  assert.match(rackImage.svg, /Rack A · Rear/);
  assert.match(rackImage.svg, /server-a: NIC 1/);

  const focusedPlanning = buildRackElevationCableRoutes({
    rack: rackA,
    face: "rear",
    devices: [serverA, serverB],
    layouts,
    ports: [portA, portB],
    links: [link],
    style: "smooth",
    width: 1000,
    unitHeight: 42,
  });
  const focusedRoute = focusedPlanning.routes[0]!;
  const focusedImage = buildRackStudioSvg({
    ...input,
    face: "rear",
    focusRackId: rackA.id,
  });
  const focusedPath = cablePath(
    focusedRoute.points.map((point) => ({
      x: 84 + point.x * (372 / focusedPlanning.scene.width),
      y: 150 + point.y * (548 / focusedPlanning.scene.height),
    })),
    "smooth",
    focusedRoute.manualPointIndexes,
  );
  assert.ok(focusedImage.svg.includes(`d="${focusedPath}"`));
});

test("six mapped rear ports retain left, center, and right physical anchors", () => {
  const sixPorts = Array.from({ length: 6 }, (_, index) =>
    port(`six-${index + 1}`, serverA.id, `NIC ${index + 1}`, "rj45"),
  );
  const xs = [70, 155, 440, 525, 810, 895];
  const sixLayout = multiPortLayout(serverA.id, sixPorts, xs);
  const anchors = sixPorts.map((mappedPort) =>
    resolveRackStudioPortAnchor({
      port: mappedPort,
      devices: [serverA],
      racks: [rackA],
      layouts: [sixLayout],
    }),
  );
  assert.ok(anchors.every(Boolean));
  assert.ok(anchors[0]!.x < anchors[2]!.x);
  assert.ok(anchors[2]!.x < anchors[4]!.x);
  assert.ok(anchors[4]!.x < rackA.studioX! + 140);
});

test("new manual waypoints never reuse an existing generated ID", () => {
  const waypoint = nextManualWaypoint({
    link: {
      id: "link-one",
      fromPortId: "port-a",
      toPortId: "port-b",
      routeWaypoints: [
        {
          id: "route-link-one-2",
          roomId: room.id,
          face: "front",
          x: 100,
          y: 100,
        },
      ],
    },
    roomId: room.id,
    face: "front",
  });

  assert.equal(waypoint.id, "route-link-one-3");
});

function device(id: string, rackId: string, startU: number): Device {
  return {
    id,
    labId: "lab-a",
    rackId,
    roomId: room.id,
    hostname: id,
    deviceType: "server",
    status: "online",
    placement: "rack",
    startU,
    heightU: 2,
    face: "front",
    rackMountKind: "direct",
    rackColumn: 0,
    rackColumnSpan: 12,
  };
}

function port(
  id: string,
  deviceId: string,
  name: string,
  kind: Port["kind"],
): Port {
  return {
    id,
    deviceId,
    name,
    position: 1,
    kind,
    linkState: "down",
    mode: "access",
    face: "rear",
  };
}

function layout(
  deviceId: string,
  portId: string,
  x: number,
  y: number,
): DevicePhysicalLayout {
  return multiPortLayout(
    deviceId,
    [port(portId, deviceId, "NIC 1", "rj45")],
    [x],
    y,
  );
}

function multiPortLayout(
  deviceId: string,
  mappedPorts: Port[],
  xs: number[],
  y = 260,
): DevicePhysicalLayout {
  const portSlots = mappedPorts.map((mappedPort, index) => ({
    id: `slot-${index + 1}`,
    face: "rear" as const,
    x: xs[index]!,
    y,
    width: 45,
    height: 70,
    rotation: 0 as const,
    connector: mappedPort.kind,
    acceptedPortKinds: [mappedPort.kind],
  }));
  return {
    deviceId,
    sourceTemplateId: "test-layout",
    status: "accurate",
    effectiveStatus: "accurate",
    snapshot: {
      schemaVersion: 1,
      sourceTemplateId: "test-layout",
      category: "server",
      mount: { kind: "direct", heightU: 2, column: 0, columnSpan: 12 },
      faces: {
        front: { schemaVersion: 1, width: 1000, height: 400, elements: [] },
        rear: { schemaVersion: 1, width: 1000, height: 400, elements: [] },
      },
      portSlots,
    },
    bindings: mappedPorts.map((mappedPort, index) => ({
      portId: mappedPort.id,
      slotId: `slot-${index + 1}`,
    })),
    portFingerprint: "test",
    currentPortFingerprint: "test",
    unmappedPortIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

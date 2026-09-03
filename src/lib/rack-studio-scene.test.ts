import assert from "node:assert/strict";
import test from "node:test";
import { buildRackStudioCableRoutes } from "./rack-studio-cables";
import { buildRackStudioSvg } from "./rack-studio-export";
import {
  buildRackElevationScene,
  buildRackStudioScene,
  rackStudioCanvasBounds,
} from "./rack-studio-scene";
import type {
  Device,
  DevicePhysicalLayout,
  Port,
  PortLink,
  Rack,
  Room,
} from "./types";

const room: Room = { id: "dense-room", labId: "lab-a", name: "Dense room" };

test("selected rack faces control exact anchors and hidden-face handoffs", () => {
  const rack = rackFixture(0);
  const device = deviceFixture("face-device", rack.id, 10);
  const frontPort = portFixture("front-port", device.id, "front");
  const rearPort = portFixture("rear-port", device.id, "rear");
  const layout = layoutFixture(device.id, [frontPort, rearPort]);
  const link: PortLink = {
    id: "face-link",
    fromPortId: frontPort.id,
    toPortId: rearPort.id,
    visible: true,
    routeWaypoints: [],
  };

  const frontScene = buildRackStudioScene({
    room,
    face: "front",
    racks: [rack],
    devices: [device],
    layouts: [layout],
    ports: [frontPort, rearPort],
  });
  assert.deepEqual(
    frontScene.portAnchors.map((anchor) => anchor.portId),
    [frontPort.id],
  );
  const frontRoute = buildRackStudioCableRoutes({
    room,
    face: "front",
    racks: [rack],
    devices: [device],
    layouts: [layout],
    ports: [frontPort, rearPort],
    links: [link],
    scene: frontScene,
  });
  assert.equal(frontRoute.length, 1);
  assert.equal(frontRoute[0]!.crossRoom, false);
  assert.equal(frontRoute[0]!.handoff, "hidden-face");
  assert.equal(frontRoute[0]!.handoffFace, "rear");

  const rearScene = buildRackStudioScene({
    room,
    face: "rear",
    racks: [rack],
    devices: [device],
    layouts: [layout],
    ports: [frontPort, rearPort],
  });
  assert.deepEqual(
    rearScene.portAnchors.map((anchor) => anchor.portId),
    [rearPort.id],
  );

  const focusedFrontExport = buildRackStudioSvg({
    room,
    face: "front",
    focusRackId: rack.id,
    racks: [rack],
    devices: [device],
    layouts: [layout],
    ports: [frontPort, rearPort],
    links: [link],
    showLabels: true,
    theme: "dark",
    labels: exportLabels(),
  });
  assert.match(focusedFrontExport.svg, /Cable · Rear/);
});

test("rack-top equipment follows its rack and keeps physical port anchors", () => {
  const rack = { ...rackFixture(0), studioX: 120, studioY: 90 };
  const topDevice: Device = {
    ...deviceFixture("rack-top-switch", rack.id, 1),
    startU: undefined,
    rackMountKind: "rack-top",
    rackColumn: 2,
    rackColumnSpan: 8,
  };
  const port = portFixture("rack-top-port", topDevice.id, "front");
  const layout = layoutFixture(topDevice.id, [port]);
  const first = buildRackStudioScene({
    room,
    face: "front",
    racks: [rack],
    devices: [topDevice],
    layouts: [layout],
    ports: [port],
  });
  const item = first.equipment.find(
    (candidate) => candidate.mountKind === "rack-top",
  );
  assert.ok(item);
  assert.ok(first.portAnchors.some((anchor) => anchor.portId === port.id));

  const moved = buildRackStudioScene({
    room,
    face: "front",
    racks: [{ ...rack, studioX: 180, studioY: 130 }],
    devices: [topDevice],
    layouts: [layout],
    ports: [port],
  });
  const movedItem = moved.equipment.find(
    (candidate) => candidate.mountKind === "rack-top",
  );
  assert.ok(movedItem);
  assert.equal(movedItem.rect.x - item.rect.x, 60);
  assert.equal(movedItem.rect.y - item.rect.y, 40);

  const elevation = buildRackElevationScene({
    rack,
    rackFace: "front",
    devices: [topDevice],
    layouts: [layout],
    ports: [port],
    unitHeight: 42,
  });
  assert.ok(elevation.rackOffsetY > 0);
  assert.ok(elevation.height > rack.totalU * 42 + 16);
  assert.ok(
    elevation.equipment.some(
      (candidate) =>
        candidate.mountKind === "rack-top" &&
        candidate.rect.y < elevation.rackOffsetY,
    ),
  );

  const image = buildRackStudioSvg({
    room,
    face: "front",
    focusRackId: rack.id,
    racks: [rack],
    devices: [topDevice],
    layouts: [layout],
    ports: [port],
    links: [],
    showLabels: false,
    theme: "dark",
    labels: exportLabels(),
  });
  assert.match(image.svg, /data-mount-kind="rack-top"/);
});

test("dense mixed-placement scenes and exports are complete and deterministic", () => {
  const racks = Array.from({ length: 15 }, (_, index) => rackFixture(index));
  const devices: Device[] = [];
  const ports: Port[] = [];
  const layouts: DevicePhysicalLayout[] = [];

  for (const rack of racks) {
    const rackIndex = Number(rack.id.split("-").at(-1));
    const parent = deviceFixture(`direct-${rackIndex}-0`, rack.id, 1);
    devices.push(parent);
    for (let index = 1; index < 12; index += 1) {
      devices.push(
        deviceFixture(
          `direct-${rackIndex}-${index}`,
          rack.id,
          1 + (index % 40),
        ),
      );
    }
    for (let index = 0; index < 4; index += 1) {
      devices.push({
        ...deviceFixture(`shelf-${rackIndex}-${index}`, rack.id, 1),
        placement: "shelf",
        parentDeviceId: parent.id,
        rackMountKind: "shelf",
        startU: undefined,
        shelfX: 40 + index * 210,
        shelfY: 80,
        shelfWidth: 170,
        shelfHeight: 260,
        shelfOrientation: index % 2 === 0 ? 0 : 90,
      });
    }
    for (let index = 0; index < 2; index += 1) {
      devices.push({
        ...deviceFixture(`side-${rackIndex}-${index}`, rack.id, 1),
        rackMountKind: "side",
        startU: undefined,
        rackSide: index === 0 ? "left" : "right",
      });
    }
  }
  for (let index = 0; index < 30; index += 1) {
    devices.push({
      ...deviceFixture(`loose-${index}`, "", 1),
      rackId: undefined,
      placement: "room",
      rackMountKind: "loose",
      startU: undefined,
    });
  }
  for (const [index, device] of devices.entries()) {
    const port = portFixture(`dense-port-${index}`, device.id, "rear");
    ports.push(port);
    layouts.push(layoutFixture(device.id, [port]));
  }
  const links = Array.from({ length: 500 }, (_, index): PortLink => ({
    id: `dense-link-${index}`,
    fromPortId: ports[index % ports.length]!.id,
    toPortId: ports[(index * 7 + 1) % ports.length]!.id,
    visible: true,
    routeWaypoints: [],
  }));
  const sceneInput = {
    room,
    face: "both" as const,
    racks,
    devices,
    layouts,
    ports,
  };
  const first = buildRackStudioScene(sceneInput);
  const repeat = buildRackStudioScene(sceneInput);
  assert.equal(devices.length, 300);
  assert.equal(first.portAnchors.length, ports.length);
  assert.equal(first.equipment.length, devices.length * 2);
  assert.ok(first.bounds.height > 620);
  assert.ok(
    racks.every((rack, index) => {
      const bounds = rackStudioCanvasBounds(racks, 30);
      const y = rack.studioY ?? 34 + Math.floor(index / 5) * 292;
      return y + 278 <= bounds.rackAreaHeight;
    }),
  );
  assert.deepEqual(first, repeat);

  const routes = buildRackStudioCableRoutes({
    ...sceneInput,
    links,
    scene: first,
  });
  assert.equal(routes.length, links.length);
  assert.deepEqual(
    routes.map((route) => route.path),
    buildRackStudioCableRoutes({ ...sceneInput, links, scene: repeat }).map(
      (route) => route.path,
    ),
  );

  const image = buildRackStudioSvg({
    ...sceneInput,
    links,
    showLabels: false,
    theme: "dark",
    labels: exportLabels(),
  });
  assert.ok(image.height > 770);
  assert.match(image.svg, /data-mount-kind="direct"/);
  assert.match(image.svg, /data-mount-kind="shelf"/);
  assert.match(image.svg, /data-mount-kind="side"/);
  assert.match(image.svg, /data-mount-kind="loose"/);
});

function rackFixture(index: number): Rack {
  return {
    id: `rack-${index}`,
    labId: room.labId,
    roomId: room.id,
    name: `Rack ${index}`,
    totalU: 42,
  };
}

function deviceFixture(id: string, rackId: string, startU: number): Device {
  return {
    id,
    labId: room.labId,
    roomId: room.id,
    rackId: rackId || undefined,
    hostname: id,
    deviceType: "server",
    status: "online",
    placement: rackId ? "rack" : "room",
    startU,
    heightU: 1,
    face: "front",
    rackMountKind: rackId ? "direct" : "loose",
    rackColumn: 0,
    rackColumnSpan: 12,
  };
}

function portFixture(
  id: string,
  deviceId: string,
  face: "front" | "rear",
): Port {
  return {
    id,
    deviceId,
    name: id,
    position: 1,
    kind: "rj45",
    linkState: "down",
    mode: "access",
    face,
  };
}

function layoutFixture(
  deviceId: string,
  mappedPorts: Port[],
): DevicePhysicalLayout {
  const portSlots = mappedPorts.map((port, index) => ({
    id: `slot-${port.id}`,
    face: port.face === "rear" ? ("rear" as const) : ("front" as const),
    x: 120 + index * 180,
    y: 110,
    width: 48,
    height: 42,
    rotation: 0 as const,
    connector: "rj45",
    acceptedPortKinds: ["rj45"],
  }));
  return {
    deviceId,
    sourceTemplateId: "dense-template",
    status: "accurate",
    effectiveStatus: "accurate",
    snapshot: {
      schemaVersion: 1,
      sourceTemplateId: "dense-template",
      category: "server",
      mount: { kind: "direct", heightU: 1, column: 0, columnSpan: 12 },
      faces: {
        front: { schemaVersion: 1, width: 1000, height: 300, elements: [] },
        rear: { schemaVersion: 1, width: 1000, height: 300, elements: [] },
      },
      portSlots,
    },
    bindings: mappedPorts.map((port) => ({
      portId: port.id,
      slotId: `slot-${port.id}`,
    })),
    portFingerprint: "fixture",
    currentPortFingerprint: "fixture",
    unmappedPortIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function exportLabels() {
  return {
    cable: "Cable",
    cables: "Cables",
    devices: "Devices",
    front: "Front",
    rear: "Rear",
    room: "Room",
    rack: "Rack",
    legend: "Legend",
    crossRoom: "Cross-room",
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
}

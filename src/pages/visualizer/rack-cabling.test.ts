import assert from "node:assert/strict";
import test from "node:test";
import type {
  Device,
  DevicePhysicalLayout,
  Port,
  PortLink,
  Rack,
  Room,
} from "@/lib/types";
import {
  RACK_CABLING_BODY_WIDTH,
  RACK_CABLING_UNIT_HEIGHT,
  buildRackCablingRoutes,
  buildRackCablingScene,
  buildRackCablingScope,
  layoutRackCablingHandoffLabels,
  rackCablingSelectionIsInScope,
  rackCablingPath,
} from "./rack-cabling";

const room: Room = { id: "room-a", labId: "lab-a", name: "Server room" };
const rack24: Rack = {
  id: "rack-24",
  labId: room.labId,
  roomId: room.id,
  name: "Rack 24",
  totalU: 24,
  studioX: 400,
};
const rack42: Rack = {
  id: "rack-42",
  labId: room.labId,
  roomId: room.id,
  name: "Rack 42",
  totalU: 42,
  studioX: 20,
};

test("rack cabling scene bottom-aligns ordered racks and preserves exact face anchors", () => {
  const firstDevice = device("device-a", rack24.id, 20);
  const secondDevice = device("device-b", rack42.id, 38);
  const front = port("front-a", firstDevice.id, "front", 1);
  const rear = port("rear-b", secondDevice.id, "rear", 1);
  const input = {
    room,
    racks: [rack42, rack24],
    devices: [firstDevice, secondDevice],
    layouts: [layout(firstDevice.id, [front]), layout(secondDevice.id, [rear])],
    ports: [front, rear],
    faceMode: "both" as const,
    rackOrder: [rack24.id],
    looseExpanded: false,
  };
  const scene = buildRackCablingScene(input);
  const repeat = buildRackCablingScene(input);
  const shuffled = buildRackCablingScene({
    ...input,
    racks: [...input.racks].reverse(),
    devices: [...input.devices].reverse(),
    layouts: [...input.layouts].reverse(),
    ports: [...input.ports].reverse(),
  });

  assert.deepEqual(
    scene.racks.map((frame) => frame.rack.id),
    [rack24.id, rack42.id],
  );
  assert.equal(
    scene.racks[0]!.y + scene.racks[0]!.height,
    scene.racks[1]!.y + scene.racks[1]!.height,
  );
  assert.deepEqual(
    scene.racks[0]!.faces.map((frame) => frame.face),
    ["front", "rear"],
  );
  const frontAnchor = scene.anchors.find(
    (anchor) => anchor.portId === front.id,
  );
  assert.ok(frontAnchor);
  assert.equal(frontAnchor.rackFace, "front");
  assert.equal(frontAnchor.x, 120);
  assert.equal(frontAnchor.y, 510.2);
  assert.deepEqual(scene, repeat);
  assert.deepEqual(scene, shuffled);
});

test("rack cabling scene renders fallback equipment and collapsible loose gear", () => {
  const missing = device("missing-layout", rack24.id, 4);
  const incomplete = {
    ...device("incomplete-layout", rack24.id, 1),
    startU: undefined,
  };
  const orphanShelf = {
    ...device("orphan-shelf", rack24.id, 1),
    placement: "shelf" as const,
    rackMountKind: "shelf" as const,
    parentDeviceId: "missing-parent",
    startU: undefined,
  };
  const invalidParent = {
    ...device("invalid-parent", rack24.id, 30),
    rackColumn: 20,
    rackColumnSpan: 8,
  };
  const invalidChild = {
    ...device("invalid-child", rack24.id, 1),
    placement: "shelf" as const,
    rackMountKind: "shelf" as const,
    parentDeviceId: invalidParent.id,
    startU: undefined,
    shelfX: 100,
    shelfY: 100,
    shelfWidth: 200,
    shelfHeight: 200,
  };
  const loose = {
    ...device("loose-device", undefined, 1),
    rackId: undefined,
    roomId: room.id,
    placement: "room" as const,
    rackMountKind: "loose" as const,
    startU: undefined,
  };
  const loosePort = port("loose-port", loose.id, "front", 1);
  const missingPort = port("missing-port", missing.id, "front", 1);
  const incompletePort = port("incomplete-port", incomplete.id, "front", 1);
  const orphanPort = port("orphan-port", orphanShelf.id, "front", 1);
  const invalidParentPort = port(
    "invalid-parent-port",
    invalidParent.id,
    "front",
    1,
  );
  const invalidChildPort = port(
    "invalid-child-port",
    invalidChild.id,
    "front",
    1,
  );
  const layouts = [
    layout(incomplete.id, [incompletePort]),
    layout(orphanShelf.id, [orphanPort]),
    layout(invalidParent.id, [invalidParentPort]),
    layout(invalidChild.id, [invalidChildPort]),
    layout(loose.id, [loosePort]),
  ];
  const ports = [
    loosePort,
    missingPort,
    incompletePort,
    orphanPort,
    invalidParentPort,
    invalidChildPort,
  ];
  const collapsed = buildRackCablingScene({
    room,
    racks: [rack24],
    devices: [
      missing,
      incomplete,
      orphanShelf,
      invalidParent,
      invalidChild,
      loose,
    ],
    layouts,
    ports,
    faceMode: "front",
    looseExpanded: false,
  });
  const expanded = buildRackCablingScene({
    room,
    racks: [rack24],
    devices: [
      missing,
      incomplete,
      orphanShelf,
      invalidParent,
      invalidChild,
      loose,
    ],
    layouts,
    ports,
    faceMode: "front",
    looseExpanded: true,
  });

  assert.equal(
    collapsed.equipment.find((item) => item.device.id === missing.id)
      ?.fallbackReason,
    "missing-layout",
  );
  const incompleteFallback = collapsed.equipment.find(
    (item) => item.device.id === incomplete.id,
  );
  assert.equal(incompleteFallback?.fallbackReason, "unavailable-position");
  assert.ok(incompleteFallback?.layout);
  assert.equal(
    collapsed.equipment.find((item) => item.device.id === orphanShelf.id)
      ?.fallbackReason,
    "unavailable-position",
  );
  const invalidParentFallback = collapsed.equipment.find(
    (item) => item.device.id === invalidParent.id,
  );
  const rackFace = collapsed.racks[0]!.faces[0]!;
  assert.ok(invalidParentFallback);
  assert.ok(invalidParentFallback.rect.x >= rackFace.x);
  assert.ok(
    invalidParentFallback.rect.x + invalidParentFallback.rect.width <=
      rackFace.x + rackFace.width,
  );
  assert.equal(
    collapsed.equipment.find((item) => item.device.id === invalidParent.id)
      ?.fallbackReason,
    "unavailable-position",
  );
  assert.equal(
    collapsed.equipment.find((item) => item.device.id === invalidChild.id)
      ?.fallbackReason,
    "unavailable-position",
  );
  assert.equal(collapsed.looseCards.length, 0);
  assert.equal(
    collapsed.anchors.find((anchor) => anchor.portId === loosePort.id)?.kind,
    "loose-handoff",
  );
  assert.equal(expanded.looseCards.length, 1);
  assert.equal(
    expanded.anchors.find((anchor) => anchor.portId === loosePort.id)?.kind,
    "physical",
  );
  assert.ok(expanded.height > collapsed.height);

  const collapsedRoutes = buildRackCablingRoutes({
    scene: collapsed,
    rooms: [room],
    racks: [rack24],
    devices: [
      missing,
      incomplete,
      orphanShelf,
      invalidParent,
      invalidChild,
      loose,
    ],
    ports,
    links: [link("tray-link", missingPort.id, loosePort.id, "Cat6A")],
    style: "smooth",
  });
  assert.deepEqual(
    collapsedRoutes[0]!.handoffs.map((handoff) => handoff.reason),
    ["unavailable", "loose-tray"],
  );
  assert.equal(
    collapsedRoutes[0]!.handoffs[0]?.fallbackReason,
    "missing-layout",
  );
  const unavailablePlacementRoutes = buildRackCablingRoutes({
    scene: collapsed,
    rooms: [room],
    racks: [rack24],
    devices: [
      missing,
      incomplete,
      orphanShelf,
      invalidParent,
      invalidChild,
      loose,
    ],
    ports,
    links: [
      link("unavailable-placement", incompletePort.id, loosePort.id, "Cat6A"),
    ],
    style: "smooth",
  });
  assert.equal(
    unavailablePlacementRoutes[0]!.handoffs[0]?.reason,
    "unavailable",
  );
  assert.equal(
    unavailablePlacementRoutes[0]!.handoffs[0]?.fallbackReason,
    "unavailable-position",
  );
  assert.ok(
    buildRackCablingScope(collapsed, unavailablePlacementRoutes).portIds.has(
      incompletePort.id,
    ),
  );
  const rearScene = buildRackCablingScene({
    room,
    racks: [rack24],
    devices: [incomplete, loose],
    layouts: [
      layout(incomplete.id, [incompletePort]),
      layout(loose.id, [loosePort]),
    ],
    ports: [incompletePort, loosePort],
    faceMode: "rear",
    looseExpanded: false,
  });
  const hiddenFallbackRoutes = buildRackCablingRoutes({
    scene: rearScene,
    rooms: [room],
    racks: [rack24],
    devices: [incomplete, loose],
    ports: [incompletePort, loosePort],
    links: [link("hidden-fallback", incompletePort.id, loosePort.id, "Cat6A")],
    style: "smooth",
  });
  assert.equal(hiddenFallbackRoutes[0]!.handoffs[0]?.reason, "unavailable");
});

test("rack cabling scene keeps shelf and side-mounted equipment in rack geometry", () => {
  const parent = device("parent", rack24.id, 12);
  const shelf = {
    ...device("shelf", rack24.id, 1),
    placement: "shelf" as const,
    rackMountKind: "shelf" as const,
    parentDeviceId: parent.id,
    startU: undefined,
    shelfX: 120,
    shelfY: 150,
    shelfWidth: 300,
    shelfHeight: 400,
    shelfOrientation: 90 as const,
  };
  const side = {
    ...device("side", rack24.id, 1),
    rackMountKind: "side" as const,
    rackSide: "right" as const,
    startU: undefined,
  };
  const parentPort = port("parent-port", parent.id, "front", 1);
  const shelfPort = port("shelf-port", shelf.id, "front", 1);
  const sidePort = port("side-port", side.id, "front", 1);
  const scene = buildRackCablingScene({
    room,
    racks: [rack24],
    devices: [parent, shelf, side],
    layouts: [
      layout(parent.id, [parentPort]),
      layout(shelf.id, [shelfPort]),
      layout(side.id, [sidePort]),
    ],
    ports: [parentPort, shelfPort, sidePort],
    faceMode: "front",
  });

  const shelfEquipment = scene.equipment.find(
    (item) => item.device.id === shelf.id,
  );
  const sideEquipment = scene.equipment.find(
    (item) => item.device.id === side.id,
  );
  assert.ok(shelfEquipment);
  assert.equal(shelfEquipment.rotation, 90);
  assert.ok(sideEquipment);
  assert.ok(sideEquipment.rect.x > scene.racks[0]!.faces[0]!.x);
  assert.ok(scene.anchors.some((anchor) => anchor.portId === shelfPort.id));
  assert.ok(scene.anchors.some((anchor) => anchor.portId === sidePort.id));
});

test("rack cabling reserves a top band for rack-top equipment and its ports", () => {
  const rackTop = {
    ...device("rack-top", rack24.id, 1),
    rackMountKind: "rack-top" as const,
    startU: undefined,
    rackColumn: 2,
    rackColumnSpan: 8,
  };
  const topPort = port("rack-top-port", rackTop.id, "front", 1);
  const scene = buildRackCablingScene({
    room,
    racks: [rack24],
    devices: [rackTop],
    layouts: [layout(rackTop.id, [topPort])],
    ports: [topPort],
    faceMode: "front",
  });
  const frame = scene.racks[0]!.faces[0]!;
  const equipment = frame.equipment.find(
    (item) => item.device.id === rackTop.id,
  );

  assert.ok(equipment);
  assert.equal(equipment.fallbackReason, null);
  assert.equal(equipment.rect.width, (8 / 12) * RACK_CABLING_BODY_WIDTH);
  assert.ok(frame.height > rack24.totalU * RACK_CABLING_UNIT_HEIGHT + 16);
  assert.ok(equipment.rect.y < frame.y + frame.height);
  assert.ok(scene.anchors.some((anchor) => anchor.portId === topPort.id));
});

test("rack cabling scene preserves exact 12-column placement geometry", () => {
  const mounted = {
    ...device("column-device", rack24.id, 8),
    rackColumn: 3,
    rackColumnSpan: 6,
    heightU: 2,
  };
  const mountedPort = port("column-port", mounted.id, "front", 1);
  const scene = buildRackCablingScene({
    room,
    racks: [rack24],
    devices: [mounted],
    layouts: [layout(mounted.id, [mountedPort])],
    ports: [mountedPort],
    faceMode: "front",
  });
  const face = scene.racks[0]!.faces[0]!;
  const equipment = face.equipment[0]!;

  assert.equal(equipment.rect.x - face.x, 80);
  assert.equal(equipment.rect.width, 160);
  assert.equal(equipment.rect.height, 34);
});

test("rack cabling routes are deterministic, filter physical links, and label handoffs", () => {
  const localDevice = device("local", rack24.id, 8);
  const unavailableDevice = device("unavailable", rack24.id, 6);
  const remoteRoom: Room = {
    id: "room-b",
    labId: room.labId,
    name: "Remote room",
  };
  const remoteRack: Rack = {
    ...rack42,
    id: "remote-rack",
    roomId: remoteRoom.id,
  };
  const remoteDevice = {
    ...device("remote", remoteRack.id, 8),
    roomId: remoteRoom.id,
  };
  const localFront = port("local-front", localDevice.id, "front", 1);
  const localRear = port("local-rear", localDevice.id, "rear", 2);
  const remotePort = port("remote-port", remoteDevice.id, "front", 1);
  const unavailablePort = port(
    "unavailable-port",
    unavailableDevice.id,
    "front",
    1,
  );
  const aggregatePort = {
    ...port("aggregate", localDevice.id, "front", 3),
    portRole: "aggregate" as const,
  };
  const virtualPort = {
    ...port("virtual", localDevice.id, "front", 4),
    kind: "virtual" as const,
  };
  const wifiPort = {
    ...port("wifi", localDevice.id, "front", 5),
    kind: "wifi" as const,
  };
  const links: PortLink[] = [
    link("hidden", localFront.id, localRear.id, "Cat6A"),
    link("cross-room", localFront.id, remotePort.id, "Fiber"),
    link("unavailable", localFront.id, unavailablePort.id, "Cat6A"),
    link("aggregate-link", aggregatePort.id, remotePort.id, "Fiber"),
    link("virtual-link", virtualPort.id, remotePort.id, "Virtual"),
    link("wifi-link", wifiPort.id, remotePort.id, "WiFi"),
    {
      ...link("invisible", localFront.id, localRear.id, "Cat6A"),
      visible: false,
    },
  ];
  const scene = buildRackCablingScene({
    room,
    racks: [rack24, remoteRack],
    devices: [localDevice, unavailableDevice, remoteDevice],
    layouts: [
      layout(localDevice.id, [localFront, localRear]),
      layout(remoteDevice.id, [remotePort]),
    ],
    ports: [
      localFront,
      localRear,
      remotePort,
      unavailablePort,
      aggregatePort,
      virtualPort,
      wifiPort,
    ],
    faceMode: "front",
  });
  const routeInput = {
    scene,
    rooms: [room, remoteRoom],
    racks: [rack24, remoteRack],
    devices: [localDevice, unavailableDevice, remoteDevice],
    ports: [
      localFront,
      localRear,
      remotePort,
      unavailablePort,
      aggregatePort,
      virtualPort,
      wifiPort,
    ],
    links,
    cableType: "all",
    style: "smooth" as const,
  };
  const routes = buildRackCablingRoutes(routeInput);

  assert.equal(routes.length, 3);
  assert.equal(
    routes.find((route) => route.link.id === "hidden")?.handoffs[0]?.reason,
    "hidden-face",
  );
  assert.equal(
    routes.find((route) => route.link.id === "cross-room")?.handoffs[0]?.reason,
    "cross-room",
  );
  assert.equal(
    routes.find((route) => route.link.id === "unavailable")?.handoffs[0]
      ?.reason,
    "unavailable",
  );
  const crossRoomRoute = routes.find((route) => route.link.id === "cross-room");
  assert.equal(crossRoomRoute?.handoffs[0]?.roomLabel, remoteRoom.name);
  assert.equal(crossRoomRoute?.to.x, 8);
  assert.match(routes[0]!.path, / C /);
  assert.deepEqual(routes, buildRackCablingRoutes(routeInput));
  assert.deepEqual(
    routes,
    buildRackCablingRoutes({ ...routeInput, links: [...links].reverse() }),
  );
  assert.equal(
    buildRackCablingRoutes({ ...routeInput, cableType: "Cat6A" }).length,
    2,
  );
});

test("handoff label geometry packs stable lanes within scene bounds", () => {
  const local = device("label-local", rack24.id, 8);
  const unavailable = device("label-unavailable", rack24.id, 7);
  const loose = {
    ...device("label-loose", undefined, 1),
    rackId: undefined,
    roomId: room.id,
    placement: "room" as const,
    rackMountKind: "loose" as const,
    startU: undefined,
  };
  const remoteRoom: Room = {
    id: "label-room-remote",
    labId: room.labId,
    name: "Label remote room",
  };
  const remoteRack: Rack = {
    ...rack42,
    id: "label-rack-remote",
    roomId: remoteRoom.id,
  };
  const remote = {
    ...device("label-remote", remoteRack.id, 8),
    roomId: remoteRoom.id,
  };
  const localFront = port("label-local-front", local.id, "front", 1);
  const localRear = port("label-local-rear", local.id, "rear", 2);
  const unavailablePort = port(
    "label-unavailable-port",
    unavailable.id,
    "front",
    1,
  );
  const loosePort = port("label-loose-port", loose.id, "front", 1);
  const remotePort = port("label-remote-port", remote.id, "front", 1);
  const devices = [local, unavailable, loose, remote];
  const ports = [localFront, localRear, unavailablePort, loosePort, remotePort];
  const scene = buildRackCablingScene({
    room,
    racks: [rack24, remoteRack],
    devices,
    layouts: [layout(local.id, [localFront, localRear])],
    ports,
    faceMode: "front",
    looseExpanded: false,
  });
  const links = [
    link("label-hidden", localFront.id, localRear.id, "Cat6A"),
    link("label-unavailable", localFront.id, unavailablePort.id, "Cat6A"),
    link("label-tray", localFront.id, loosePort.id, "Cat6A"),
    ...Array.from({ length: 8 }, (_, index) =>
      link(`label-cross-${index}`, localFront.id, remotePort.id, "Fiber"),
    ),
  ];
  const routes = buildRackCablingRoutes({
    scene,
    rooms: [room, remoteRoom],
    racks: [rack24, remoteRack],
    devices,
    ports,
    links,
    style: "smooth",
  });
  const geometry = layoutRackCablingHandoffLabels(scene, routes);

  assert.deepEqual(
    geometry,
    layoutRackCablingHandoffLabels(scene, [...routes].reverse()),
  );
  assert.ok(
    geometry.every((entry) => entry.y >= 16 && entry.y <= scene.height - 16),
  );
  assert.ok(geometry.some((entry) => entry.lane.startsWith("scene-edge:")));
  assert.ok(geometry.some((entry) => entry.lane.startsWith("rack-edge:")));
  assert.ok(
    geometry.some((entry) => entry.lane.startsWith("fallback-equipment:")),
  );
  assert.ok(geometry.some((entry) => entry.lane.startsWith("loose-tray:")));
  assert.ok(geometry.some((entry) => entry.leaderPath));
  for (const column of ["left", "center", "right"] as const) {
    const packed = geometry
      .filter((entry) => entry.packingColumn === column)
      .sort((left, right) => left.y - right.y);
    for (let index = 1; index < packed.length; index += 1) {
      assert.ok(packed[index]!.y - packed[index - 1]!.y >= 13.99);
    }
  }
  for (const entry of geometry.filter((candidate) => candidate.leaderPath)) {
    assert.match(
      entry.leaderPath!,
      new RegExp(
        `^M ${entry.anchorX.toFixed(2)} ${entry.anchorY.toFixed(2)} L `,
      ),
    );
  }
});

test("rack cabling scopes exact anchors by face and supports empty rooms", () => {
  const mounted = device("face-device", rack24.id, 10);
  const front = port("face-front", mounted.id, "front", 1);
  const rear = port("face-rear", mounted.id, "rear", 2);
  const common = {
    room,
    racks: [rack24],
    devices: [mounted],
    layouts: [layout(mounted.id, [front, rear])],
    ports: [front, rear],
  };
  const frontScene = buildRackCablingScene({ ...common, faceMode: "front" });
  const rearScene = buildRackCablingScene({ ...common, faceMode: "rear" });
  const emptyScene = buildRackCablingScene({
    room,
    racks: [],
    devices: [],
    layouts: [],
    ports: [],
    faceMode: "front",
  });

  assert.deepEqual(
    frontScene.anchors.map((anchor) => anchor.portId),
    [front.id],
  );
  assert.deepEqual(
    rearScene.anchors.map((anchor) => anchor.portId),
    [rear.id],
  );
  assert.equal(emptyScene.racks.length, 0);
  assert.equal(emptyScene.anchors.length, 0);
  assert.equal(emptyScene.looseTray, null);
});

test("expanded loose equipment without a layout uses an unavailable handoff", () => {
  const mounted = device("mounted", rack24.id, 10);
  const loose = {
    ...device("loose-missing", undefined, 1),
    rackId: undefined,
    roomId: room.id,
    placement: "room" as const,
    rackMountKind: "loose" as const,
    startU: undefined,
  };
  const mountedPort = port("mounted-port", mounted.id, "front", 1);
  const loosePort = port("loose-missing-port", loose.id, "front", 1);
  const scene = buildRackCablingScene({
    room,
    racks: [rack24],
    devices: [mounted, loose],
    layouts: [layout(mounted.id, [mountedPort])],
    ports: [mountedPort, loosePort],
    faceMode: "front",
    looseExpanded: true,
  });
  const routes = buildRackCablingRoutes({
    scene,
    rooms: [room],
    racks: [rack24],
    devices: [mounted, loose],
    ports: [mountedPort, loosePort],
    links: [link("loose-unavailable", mountedPort.id, loosePort.id, "Cat6A")],
    style: "smooth",
  });

  assert.equal(routes.length, 1);
  assert.equal(routes[0]!.handoffs[0]?.reason, "unavailable");
  assert.equal(routes[0]!.handoffs[0]?.deviceId, loose.id);
  assert.equal(routes[0]!.handoffs[0]?.fallbackReason, "missing-layout");
  assert.equal(routes[0]!.to.kind, "handoff");
});

test("routes two unavailable local endpoints and omits links with no visible face", () => {
  const firstMissing = device("first-missing", rack24.id, 12);
  const secondMissing = device("second-missing", rack24.id, 11);
  const rearOnly = device("rear-only", rack24.id, 10);
  const firstPort = port("first-missing-port", firstMissing.id, "front", 1);
  const secondPort = port("second-missing-port", secondMissing.id, "front", 1);
  const rearOne = port("rear-one", rearOnly.id, "rear", 1);
  const rearTwo = port("rear-two", rearOnly.id, "rear", 2);
  const scene = buildRackCablingScene({
    room,
    racks: [rack24],
    devices: [firstMissing, secondMissing, rearOnly],
    layouts: [layout(rearOnly.id, [rearOne, rearTwo])],
    ports: [firstPort, secondPort, rearOne, rearTwo],
    faceMode: "front",
  });
  const routes = buildRackCablingRoutes({
    scene,
    rooms: [room],
    racks: [rack24],
    devices: [firstMissing, secondMissing, rearOnly],
    ports: [firstPort, secondPort, rearOne, rearTwo],
    links: [
      link("both-unavailable", firstPort.id, secondPort.id, "Cat6A"),
      link("both-hidden", rearOne.id, rearTwo.id, "Cat6A"),
    ],
    style: "smooth",
  });

  assert.deepEqual(
    routes.map((route) => route.link.id),
    ["both-unavailable"],
  );
  assert.deepEqual(
    routes[0]!.handoffs.map((handoff) => handoff.reason),
    ["unavailable", "unavailable"],
  );
});

test("smooth and orthogonal cable styles use stable distinct paths", () => {
  const from = {
    portId: "a",
    deviceId: "a",
    rackId: "a",
    rackFace: "front" as const,
    physicalFace: "front" as const,
    x: 100,
    y: 200,
    kind: "physical" as const,
  };
  const to = { ...from, portId: "b", x: 500, y: 320 };
  const smooth = rackCablingPath(from, to, "stable-link", "smooth");
  const orthogonal = rackCablingPath(from, to, "stable-link", "orthogonal");
  assert.match(smooth, / C /);
  assert.match(orthogonal, / L /);
  assert.equal(smooth, rackCablingPath(from, to, "stable-link", "smooth"));
  assert.notEqual(smooth, orthogonal);
});

test("rack cabling scope validates rack, device, port, and cable selections", () => {
  const mounted = device("scoped-device", rack24.id, 8);
  const from = port("scoped-from", mounted.id, "front", 1);
  const to = port("scoped-to", mounted.id, "front", 2);
  const scene = buildRackCablingScene({
    room,
    racks: [rack24],
    devices: [mounted],
    layouts: [layout(mounted.id, [from, to])],
    ports: [from, to],
    faceMode: "front",
  });
  const routes = buildRackCablingRoutes({
    scene,
    rooms: [room],
    racks: [rack24],
    devices: [mounted],
    ports: [from, to],
    links: [link("scoped-cable", from.id, to.id, "Cat6A")],
    style: "smooth",
  });
  const scope = buildRackCablingScope(scene, routes);

  for (const selection of [
    { kind: "rack" as const, id: rack24.id },
    { kind: "device" as const, id: mounted.id },
    { kind: "port" as const, id: from.id },
    { kind: "cable" as const, id: "scoped-cable" },
  ]) {
    assert.equal(rackCablingSelectionIsInScope(selection, scope), true);
    assert.equal(
      rackCablingSelectionIsInScope({ ...selection, id: "outside" }, scope),
      false,
    );
  }
});

function device(
  id: string,
  rackId: string | undefined,
  startU: number,
): Device {
  return {
    id,
    labId: room.labId,
    roomId: room.id,
    rackId,
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

function port(
  id: string,
  deviceId: string,
  face: "front" | "rear",
  position: number,
): Port {
  return {
    id,
    deviceId,
    name: id,
    position,
    kind: "rj45",
    linkState: "up",
    mode: "access",
    portRole: "physical",
    face,
  };
}

function link(
  id: string,
  fromPortId: string,
  toPortId: string,
  cableType: string,
): PortLink {
  return {
    id,
    fromPortId,
    toPortId,
    cableType,
    visible: true,
    routeWaypoints: [],
  };
}

function layout(deviceId: string, mappedPorts: Port[]): DevicePhysicalLayout {
  return {
    deviceId,
    sourceTemplateId: "fixture-v1",
    status: "accurate",
    effectiveStatus: "accurate",
    snapshot: {
      schemaVersion: 1,
      sourceTemplateId: "fixture-v1",
      category: "server",
      mount: { kind: "direct", heightU: 1, column: 0, columnSpan: 12 },
      faces: {
        front: { schemaVersion: 1, width: 1000, height: 200, elements: [] },
        rear: { schemaVersion: 1, width: 1000, height: 200, elements: [] },
      },
      portSlots: mappedPorts.map((mappedPort, index) => ({
        id: `slot-${mappedPort.id}`,
        face:
          mappedPort.face === "rear" ? ("rear" as const) : ("front" as const),
        x: 100 + index * 180,
        y: 70,
        width: 50,
        height: 40,
        rotation: 0 as const,
        connector: "rj45",
        acceptedPortKinds: ["rj45"],
      })),
    },
    bindings: mappedPorts.map((mappedPort) => ({
      portId: mappedPort.id,
      slotId: `slot-${mappedPort.id}`,
    })),
    portFingerprint: "fixture",
    currentPortFingerprint: "fixture",
    unmappedPortIds: [],
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
}

import { buildRackStudioScene } from "./rack-studio-scene";
import { buildCablingMapLines } from "./cabling-map";
import { buildVisualizerModel, tracePorts } from "../pages/visualizer/model";
import { rackCableFixture } from "../../e2e/fixtures/rack-cables";
import {
  buildRackStudioCableRoutes,
  buildRackElevationCableRoutes,
} from "./rack-studio-cables";
import { buildRackStudioSvg } from "./rack-studio-export";
import {
  buildRackCablingScene,
  buildRackCablingRoutes,
  RACK_CABLING_UNIT_HEIGHT,
  RACK_CABLING_BODY_WIDTH,
} from "../pages/visualizer/rack-cabling";
import assert from "node:assert/strict";
import test from "node:test";
import {
  planPhysicalCableRoutes,
  cableGeometryLabelPoint,
  renderCableGeometry,
  type CableRoutingInput,
  type RoutePlanningContext,
} from "./rack-studio-cables";

const context: RoutePlanningContext = {
  width: 1200,
  height: 1000,
  racks: [
    {
      id: "rack",
      rect: { x: 40, y: 20, width: 1000, height: 960 },
      unitHeight: 40,
    },
  ],
  obstacles: [],
};
function connection(index = 0): CableRoutingInput {
  const from = {
    portId: `front-${index}`,
    deviceId: "panel",
    roomId: "room",
    rackId: "rack",
    face: "front" as const,
    rackFace: "front" as const,
    x: 100 + index * 32,
    y: 200,
  };
  return {
    id: `cable-${index}`,
    from,
    to: { ...from, portId: `switch-${index}`, deviceId: "switch", y: 240 },
    manualPoints: [],
  };
}

test("24 adjacent patch cords use distinct reproducible cubic geometry and exact anchors", () => {
  const inputs = Array.from({ length: 24 }, (_, index) => connection(index));
  const routes = planPhysicalCableRoutes(inputs, context, "smooth");
  assert.equal(routes.length, 24);
  assert.equal(new Set(routes.map((route) => route.path)).size, 24);
  assert.deepEqual(
    routes,
    planPhysicalCableRoutes([...inputs].reverse(), context, "smooth"),
  );
  for (const route of routes) {
    const input = inputs.find((entry) => entry.id === route.id)!;
    assert.equal(route.geometry.kind, "cubic");
    assert.deepEqual(route.points, [input.from, input.to]);
    assert.match(route.path, / C /);
    assert.equal(route.path, renderCableGeometry(route.geometry));
  }
  // Equal port order creates parallel curves, rather than crossing cord bundles.
  const controls = inputs.map(
    (input) => routes.find((route) => route.id === input.id)!.geometry,
  );
  controls.forEach((geometry, index) => {
    assert.equal(geometry.kind, "cubic");
    if (geometry.kind !== "cubic" || !index) return;
    const previous = controls[index - 1]!;
    assert.equal(previous.kind, "cubic");
    if (previous.kind === "cubic")
      assert.ok(
        geometry.control1.x > previous.control1.x &&
          geometry.control2.x > previous.control2.x,
      );
  });
});

test("mixed routing enforces the 4U boundary, rack face, identity, handoff, and manual exclusions", () => {
  const base = connection();
  const route = (input: CableRoutingInput) =>
    planPhysicalCableRoutes([input], context, "smooth")[0]!;
  assert.equal(
    route({ ...base, to: { ...base.to!, y: 360 } }).geometry.kind,
    "cubic",
  );
  for (const input of [
    { ...base, to: { ...base.to!, y: 360.01 } },
    { ...base, to: { ...base.to!, rackId: "other" } },
    { ...base, to: { ...base.to!, rackFace: "rear" as const } },
    { ...base, to: { ...base.to!, deviceId: "panel" } },
    { ...base, to: undefined },
    { ...base, allowDirect: false },
    { ...base, manualPoints: [{ x: 250, y: 220 }] },
  ])
    assert.equal(route(input).geometry.kind, "polyline");
  const manual = route({ ...base, manualPoints: [{ x: 250, y: 220 }] });
  assert.deepEqual(manual.points[1], { x: 250, y: 220 });
  assert.match(manual.path, /L 250\.00 220\.00/);
  const orthogonal = planPhysicalCableRoutes([base], context, "orthogonal")[0]!;
  assert.equal(orthogonal.geometry.kind, "polyline");
  assert.doesNotMatch(orthogonal.path, /[CQ]/);
});

test("curve clearance includes obstacles but excludes the endpoint shelf and opposite face", () => {
  const base = connection();
  const blocker = {
    id: "blocker",
    rackId: "rack",
    face: "front" as const,
    rect: { x: 50, y: 214, width: 200, height: 12 },
  };
  assert.equal(
    planPhysicalCableRoutes(
      [base],
      { ...context, obstacles: [blocker] },
      "smooth",
    )[0]!.geometry.kind,
    "polyline",
  );
  assert.equal(
    planPhysicalCableRoutes(
      [base],
      { ...context, obstacles: [{ ...blocker, face: "rear" }] },
      "smooth",
    )[0]!.geometry.kind,
    "cubic",
  );
  assert.equal(
    planPhysicalCableRoutes(
      [base],
      {
        ...context,
        obstacles: [
          { ...blocker, id: "shelf" },
          { ...blocker, id: "panel", parentDeviceId: "shelf" },
        ],
      },
      "smooth",
    )[0]!.geometry.kind,
    "cubic",
  );
});

test("curves reverse without changing their physical shape and preserve scaled export controls", () => {
  const input = connection();
  const first = planPhysicalCableRoutes([input], context, "smooth")[0]!
    .geometry;
  const reversed = planPhysicalCableRoutes(
    [{ ...input, from: input.to!, to: input.from }],
    context,
    "smooth",
  )[0]!.geometry;
  assert.equal(first.kind, "cubic");
  assert.equal(reversed.kind, "cubic");
  if (first.kind !== "cubic" || reversed.kind !== "cubic") return;
  assert.deepEqual(first.control1, reversed.control2);
  assert.deepEqual(first.control2, reversed.control1);
  assert.equal(
    renderCableGeometry(first, { x: 10, y: 20 }, { x: 2, y: 3 }),
    `M 210.00 620.00 C ${(first.control1.x * 2 + 10).toFixed(2)} ${(first.control1.y * 3 + 20).toFixed(2)} ${(first.control2.x * 2 + 10).toFixed(2)} ${(first.control2.y * 3 + 20).toFixed(2)} 210.00 740.00`,
  );
});

test("the synthetic 24-cord lab shares curve geometry across room, elevation, Rack Cabling, and exports", () => {
  const fixture = rackCableFixture();
  const input = {
    ...fixture,
    racks: [fixture.rack],
    face: "front" as const,
    style: "smooth" as const,
  };
  const roomRoutes = buildRackStudioCableRoutes(input);
  const elevation = buildRackElevationCableRoutes({
    ...input,
    rack: fixture.rack,
    unitHeight: RACK_CABLING_UNIT_HEIGHT,
    width: RACK_CABLING_BODY_WIDTH,
  });
  const scene = buildRackCablingScene({
    ...input,
    faceMode: "front",
    rackOrder: [],
    looseExpanded: false,
  });
  const cabling = buildRackCablingRoutes({ ...input, scene });
  assert.equal(roomRoutes.length, 24);
  assert.equal(elevation.routes.length, 24);
  assert.equal(cabling.length, 24);
  const frame = scene.racks[0]!.faces[0]!;
  for (const route of elevation.routes) {
    assert.equal(route.geometry.kind, "cubic");
    const other = cabling.find((entry) => entry.link.id === route.link.id)!;
    assert.equal(
      other.path,
      renderCableGeometry(route.geometry, { x: frame.x, y: frame.y }),
    );
  }
  const labels = {
    cable: "Cable",
    cables: "Cables",
    devices: "devices",
    front: "Front",
    rear: "Rear",
    room: "Room",
    rack: "Rack",
    legend: "Legend",
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
  const exported = buildRackStudioSvg({
    ...input,
    routeStyle: "smooth",
    showLabels: true,
    theme: "dark",
    labels,
  });
  for (const route of roomRoutes) {
    assert.equal(route.geometry.kind, "cubic");
    assert.ok(
      exported.svg.includes(
        `d="${renderCableGeometry(route.geometry, { x: 60, y: 92 })}"`,
      ),
    );
  }
  const focused = buildRackElevationCableRoutes({
    ...input,
    rack: fixture.rack,
    unitHeight: 42,
    width: 1000,
  });
  const focusedSvg = buildRackStudioSvg({
    ...input,
    focusRackId: fixture.rack.id,
    routeStyle: "smooth",
    showLabels: true,
    theme: "dark",
    labels,
  }).svg;
  for (const route of focused.routes)
    assert.ok(
      focusedSvg.includes(
        `d="${renderCableGeometry(route.geometry, { x: 84, y: 150 }, { x: 372 / focused.scene.width, y: 548 / focused.scene.height })}"`,
      ),
    );
  const reversed = buildRackStudioCableRoutes({
    ...input,
    devices: [...fixture.devices].reverse(),
    ports: [...fixture.ports].reverse(),
    layouts: [...fixture.layouts].reverse(),
    links: [...fixture.links].reverse(),
  });
  assert.deepEqual(roomRoutes, reversed);
});

test("all 24 normalized patch pairs trace in both directions for built-in and custom panels", () => {
  const fixture = rackCableFixture("trace-pairs");
  for (const deviceType of ["patch_panel", "custom_patch"]) {
    const devices = fixture.devices.map((device, index) =>
      index ? device : { ...device, deviceType },
    );
    const deviceTypes = [
      { id: "patch_panel", label: "Patch panel", builtIn: true },
      {
        id: "custom_patch",
        label: "Custom panel",
        builtIn: false,
        parentType: "patch_panel",
      },
    ];
    const ports = fixture.ports.map((port) =>
      port.deviceId === devices[0]!.id && port.face === "rear"
        ? { ...port, name: ` ${port.name.toUpperCase()} ` }
        : port,
    );
    const model = buildVisualizerModel({
      devices,
      deviceTypes,
      ports,
      portLinks: fixture.links,
      rooms: [fixture.room],
      racks: [fixture.rack],
      deviceMonitors: [],
      subnets: [],
      vlans: [],
      discoveredDevices: [],
      virtualSwitches: [],
      expandedRackRuns: new Set(),
      collapsedGroups: new Set(),
    });
    const map = buildCablingMapLines(
      {
        deviceId: devices[0]!.id,
        devices,
        deviceTypes,
        ports,
        portLinks: fixture.links,
      },
      "full",
    );
    for (let index = 1; index <= 24; index += 1) {
      const front = `${devices[0]!.id}-ports:front-${index}`;
      const rear = `${devices[0]!.id}-ports:rear-${index}`;
      for (const [from, to] of [
        [front, rear],
        [rear, front],
      ]) {
        const trace = tracePorts(model, from!, to!);
        assert.ok(trace, `${deviceType} missing pair ${index}`);
        assert.equal(trace.segments.length, 1);
        assert.equal(trace.segments[0]!.kind, "patch");
        assert.equal(trace.segments[0]!.toPort.id, to);
      }
      const rearLine = map.find((line) => line.portId === rear)!;
      assert.match(rearLine.text, /--passive-->/);
      assert.ok(rearLine.text.includes(devices[1]!.hostname));
    }
  }
});

test("smooth gutter exports scale the original quadratic controls without changing corner shape", () => {
  const geometry = {
    kind: "polyline" as const,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    style: "smooth" as const,
    manualPointIndexes: [],
  };
  assert.equal(
    renderCableGeometry(geometry),
    "M 0.00 0.00 L 90.00 0.00 Q 100.00 0.00 100.00 10.00 L 100.00 100.00",
  );
  assert.equal(
    renderCableGeometry(geometry, { x: 10, y: 20 }, { x: 0.5, y: 3 }),
    "M 10.00 20.00 L 55.00 20.00 Q 60.00 20.00 60.00 50.00 L 60.00 320.00",
  );
});

test("rear mounting and rack-top placement use rack faces and physical U scale for route decisions", () => {
  const fixture = rackCableFixture("mounts");
  const rearDevices = fixture.devices.map((device) => ({
    ...device,
    face: "rear" as const,
  }));
  const input = {
    ...fixture,
    racks: [fixture.rack],
    devices: rearDevices,
    face: "rear" as const,
  };
  assert.ok(
    buildRackStudioCableRoutes(input).every(
      (route) => route.geometry.kind === "cubic",
    ),
  );
  assert.ok(
    buildRackElevationCableRoutes({
      ...input,
      rack: fixture.rack,
    }).routes.every((route) => route.geometry.kind === "cubic"),
  );
  const opposite = buildRackStudioCableRoutes({
    ...input,
    face: "both",
    devices: [rearDevices[0]!, fixture.devices[1]!],
  });
  assert.equal(opposite.length, 24);
  assert.ok(opposite.every((route) => route.geometry.kind === "polyline"));
  const topDevices = [
    {
      ...fixture.devices[0]!,
      startU: undefined,
      rackMountKind: "rack-top" as const,
    },
    { ...fixture.devices[1]!, startU: 12 },
  ];
  assert.ok(
    buildRackStudioCableRoutes({
      ...input,
      devices: topDevices,
      face: "front",
    }).every((route) => route.geometry.kind === "cubic"),
  );
  const focused = buildRackElevationCableRoutes({
    ...input,
    devices: topDevices,
    face: "front",
    rack: fixture.rack,
  });
  assert.equal(focused.routes.length, 24);
  assert.ok(focused.routes.every((route) => route.geometry.kind === "cubic"));
});

test("shelf, rotated, and side equipment retain exact anchors in room and focused routing", () => {
  const fixture = rackCableFixture("placement-anchors");
  const shelf = {
    ...fixture.devices[0]!,
    id: "parent-shelf",
    deviceType: "rack_shelf",
    startU: 10,
    heightU: 2,
  };
  const shelfLayout = {
    ...fixture.layouts[0]!,
    deviceId: shelf.id,
    bindings: [],
  };
  for (const face of ["front", "rear"] as const) {
    for (const orientation of [0, 90] as const) {
      for (const mountKind of ["shelf", "side"] as const) {
        const mounted = {
          ...fixture.devices[0]!,
          face,
          placement:
            mountKind === "shelf" ? ("shelf" as const) : ("rack" as const),
          rackMountKind: mountKind,
          startU: undefined,
          parentDeviceId: mountKind === "shelf" ? shelf.id : undefined,
          shelfX: 100,
          shelfY: 100,
          shelfWidth: 700,
          shelfHeight: 350,
          shelfOrientation: orientation,
          rackSide: "left" as const,
        };
        const input = {
          ...fixture,
          devices: [
            mounted,
            { ...fixture.devices[1]!, face, startU: 8 },
            { ...shelf, face },
          ],
          layouts: [...fixture.layouts, shelfLayout],
          racks: [fixture.rack],
          face,
        };
        const room = buildRackStudioScene(input);
        const focused = buildRackElevationCableRoutes({
          ...input,
          rack: fixture.rack,
        });
        const roomRoutes = buildRackStudioCableRoutes({
          ...input,
          scene: room,
        });
        for (const [routes, anchors] of [
          [roomRoutes, room.portAnchors],
          [focused.routes, focused.scene.portAnchors],
        ] as const) {
          assert.equal(routes.length, 24);
          for (const route of routes) {
            const from = anchors.find(
              (anchor) => anchor.portId === route.link.fromPortId,
            )!;
            const to = anchors.find(
              (anchor) => anchor.portId === route.link.toPortId,
            )!;
            assert.deepEqual(
              { x: route.points[0]!.x, y: route.points[0]!.y },
              { x: from.x, y: from.y },
            );
            assert.deepEqual(
              { x: route.points.at(-1)!.x, y: route.points.at(-1)!.y },
              { x: to.x, y: to.y },
            );
            assert.equal(route.path, renderCableGeometry(route.geometry));
            assert.doesNotMatch(route.path, /NaN|Infinity/);
          }
        }
        assert.deepEqual(
          roomRoutes,
          buildRackStudioCableRoutes({
            ...input,
            devices: [...input.devices].reverse(),
            links: [...input.links].reverse(),
          }),
        );
      }
    }
  }
});

test("labels and focus use a point on the actual cubic or gutter geometry", () => {
  assert.deepEqual(
    cableGeometryLabelPoint({
      kind: "cubic",
      from: { x: 0, y: 0 },
      control1: { x: 40, y: 10 },
      control2: { x: 40, y: 20 },
      to: { x: 0, y: 30 },
    }),
    { x: 30, y: 15 },
  );
  for (const style of ["smooth", "orthogonal"] as const) {
    const geometry = {
      kind: "polyline" as const,
      points: [
        { x: 100, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 200 },
        { x: 100, y: 200 },
      ],
      style,
      manualPointIndexes: [],
    };
    assert.deepEqual(cableGeometryLabelPoint(geometry), { x: 0, y: 100 });
  }
  const fixture = rackCableFixture("label-geometry");
  const input = {
    ...fixture,
    racks: [fixture.rack],
    faceMode: "front" as const,
    rackOrder: [],
    looseExpanded: false,
  };
  const scene = buildRackCablingScene(input);
  for (const style of ["smooth", "orthogonal"] as const) {
    const routes = buildRackCablingRoutes({ ...input, scene, style });
    assert.equal(routes.length, 24);
    for (const route of routes)
      assert.deepEqual(
        route.labelPoint,
        cableGeometryLabelPoint(route.geometry),
      );
  }
});

test("label points handle degenerate paths, manual anchors, and endpoint reversal", () => {
  const base = {
    kind: "polyline" as const,
    style: "smooth" as const,
    manualPointIndexes: [1, 2],
  };
  assert.deepEqual(cableGeometryLabelPoint({ ...base, points: [] }), {
    x: 0,
    y: 0,
  });
  const point = { x: 40, y: 30 };
  for (const points of [[point], [point, point]])
    assert.deepEqual(cableGeometryLabelPoint({ ...base, points }), point);
  const points = [
    { x: 0, y: 100 },
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  for (const ordered of [points, [...points].reverse()])
    assert.deepEqual(cableGeometryLabelPoint({ ...base, points: ordered }), {
      x: 50,
      y: 0,
    });
  const curve = planPhysicalCableRoutes([connection()], context, "smooth")[0]!
    .geometry;
  assert.equal(curve.kind, "cubic");
  if (curve.kind === "cubic")
    assert.deepEqual(
      cableGeometryLabelPoint(curve),
      cableGeometryLabelPoint({
        ...curve,
        from: curve.to,
        to: curve.from,
        control1: curve.control2,
        control2: curve.control1,
      }),
    );
});

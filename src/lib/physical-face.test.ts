import assert from "node:assert/strict";
import test from "node:test";
import {
  faceGeometry,
  faceUnitPoint,
  faceInputDelta,
  rotateFacePoint,
  unrotateFacePoint,
} from "../../server/lib/physical-face-appearance";
import {
  validateHardwareTemplateV1,
  resolveTemplateSnapshot,
} from "../../server/lib/physical-layout";
import { createStarterTemplate } from "./hardware-template-builder";
import { buildPhysicalNodePresentation } from "../pages/visualizer/physical-node";
import { portAnchorsForEquipment } from "./rack-studio-scene";
import type { DevicePhysicalLayout, Device, Port } from "./types";
import { buildStackPhysicalLayout } from "../../server/lib/stack-layout";
import type { StackMemberLayout } from "../../server/lib/stack-member-layout-data";
import type { StackMember } from "../../server/lib/stack-data";
import { readFaceArtworkProjection } from "../../server/lib/physical-face-projection";
import { projectedFaceArtwork, faceplateDetailPath } from "./faceplate-artwork";

test("face rotations have inverse pointer mappings and screen-relative keyboard deltas", () => {
  const expected = [
    [0.12, 0.35],
    [0.65, 0.12],
    [0.88, 0.65],
    [0.35, 0.88],
  ];
  for (const [index, rotation] of ([0, 90, 180, 270] as const).entries()) {
    const face = { width: 1000, height: 200, rotation };
    const point = rotateFacePoint(face, 120, 70);
    assert.deepEqual(unrotateFacePoint(face, point.x, point.y), {
      x: 120,
      y: 70,
    });
    const unit = faceUnitPoint(face, 120, 70);
    assert.ok(Math.abs(unit.x - expected[index][0]) < 1e-12);
    assert.ok(Math.abs(unit.y - expected[index][1]) < 1e-12);
    const [dx, dy] = faceInputDelta(face, 1, 0);
    const moved = rotateFacePoint(face, 120 + dx, 70 + dy);
    assert.equal(moved.x - point.x, 1);
    assert.equal(moved.y - point.y, 0);
    assert.equal(
      faceGeometry(face).width,
      rotation === 90 || rotation === 270 ? 200 : 1000,
    );
  }
});

test("skins and rotation survive validation and resolution without changing port identity or coordinates", () => {
  const template = createStarterTemplate("server-2u");
  template.rear.skin = "ivory";
  template.rear.rotation = 90;
  const validated = validateHardwareTemplateV1(template);
  const snapshot = resolveTemplateSnapshot(validated, {
    id: "device",
    deviceType: "server",
    heightU: 2,
  });
  assert.equal(snapshot.faces.rear.skin, "ivory");
  assert.equal(snapshot.faces.rear.rotation, 90);
  assert.deepEqual(snapshot.portSlots, template.portSlots);
  for (const rotation of [null, 45, "90", NaN])
    assert.throws(
      () =>
        validateHardwareTemplateV1({
          ...template,
          rear: { ...template.rear, rotation },
        }),
      /rotation/,
    );
});

test("rotated faces keep mounted and visualizer cable anchors on their rendered port centers", () => {
  const face = {
    schemaVersion: 1 as const,
    width: 1000 as const,
    height: 200,
    elements: [],
    skin: "silver" as const,
    rotation: 90 as const,
  };
  const port = {
    id: "port",
    deviceId: "device",
    face: "front",
    kind: "rj45",
    name: "LAN",
    position: 1,
    linkState: "up",
    mode: "access",
  } as Port;
  const layout = {
    snapshot: {
      schemaVersion: 1,
      sourceTemplateId: "custom",
      category: "server",
      mount: { kind: "direct", heightU: 2, column: 0, columnSpan: 12 },
      faces: { front: face, rear: face },
      portSlots: [
        {
          id: "slot",
          face: "front",
          x: 100,
          y: 50,
          width: 40,
          height: 40,
          rotation: 0,
          connector: "rj45",
          acceptedPortKinds: ["ethernet"],
        },
      ],
    },
    bindings: [{ portId: "port", slotId: "slot" }],
    unmappedPortIds: [],
  } as unknown as DevicePhysicalLayout;
  const equipment = {
    id: "device:front",
    device: { id: "device" } as Device,
    layout,
    rackId: "rack",
    rackFace: "front" as const,
    physicalFace: "front" as const,
    mountKind: "direct" as const,
    rect: { x: 10, y: 20, width: 400, height: 80 },
    rotation: 0 as const,
  };
  const anchor = portAnchorsForEquipment([equipment], [port])[0];
  assert.equal(anchor.x, 270);
  assert.equal(anchor.y, 29.6);
  const presentation = buildPhysicalNodePresentation({
    layout,
    requestedFaceMode: "front",
    visiblePorts: [port],
  });
  const frame = presentation.faces[0];
  assert.equal(frame.height, 1700);
  assert.equal(presentation.anchors[0].x, 10 + 0.65 * 340);
  assert.equal(presentation.anchors[0].y, frame.top + 0.12 * frame.height);
  const sideways = portAnchorsForEquipment(
    [{ ...equipment, rotation: 90 }],
    [port],
  )[0];
  assert.equal(sideways.x, 10 + 0.88 * 400);
  assert.equal(sideways.y, 20 + 0.65 * 80);
});

test("stack composition retains member skins, rotated geometry and stable linked port bindings", () => {
  const member: StackMember = {
    id: "member",
    deviceId: "stack",
    position: 1,
    name: "Member",
    manufacturer: null,
    model: null,
    serial: null,
    heightU: 2,
    status: "online",
    notes: null,
    macs: [],
  };
  const template = createStarterTemplate("switch-24");
  template.front.skin = "silver";
  template.front.rotation = 90;
  template.front.height = 200;
  template.front.elements = [
    {
      kind: "panel",
      id: "panel",
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      tone: "dark",
    },
    { kind: "label", id: "label", x: 120, y: 70, text: "Member model" },
    { kind: "vent", id: "vent", x: 10, y: 20, width: 100, height: 40 },
    { kind: "bay", id: "bay", x: 150, y: 20, width: 120, height: 40 },
    { kind: "screw", id: "screw", x: 300, y: 50, radius: 5 },
  ];
  template.portSlots = [
    {
      id: "slot",
      face: "front",
      x: 100,
      y: 50,
      width: 40,
      height: 40,
      rotation: 0,
      connector: "rj45",
      acceptedPortKinds: ["rj45"],
    },
  ];
  const snapshot = resolveTemplateSnapshot(
    validateHardwareTemplateV1(template),
    { id: "stack", deviceType: "switch_stack", heightU: 2 },
  );
  const stored: StackMemberLayout = {
    memberId: "member",
    sourceTemplateId: template.id,
    status: "accurate",
    snapshot,
    bindings: [{ portId: "linked-port", slotId: "slot" }],
    portFingerprint: "synthetic",
    createdAt: "2026-11-06T00:00:00Z",
    updatedAt: "2026-11-06T00:00:00Z",
  };
  const port = {
    id: "linked-port",
    name: "LAN",
    position: 1,
    kind: "rj45",
    face: "front",
    stackMemberId: "member",
  };
  const layout = buildStackPhysicalLayout(
    { id: "stack", deviceType: "switch_stack", heightU: 2 },
    [port],
    [member],
    new Map([[member.id, stored]]),
  );
  const slot = layout.snapshot.portSlots[0];
  const point = faceUnitPoint(snapshot.faces.front, 120, 70);
  assert.equal(slot.rotation, 90);
  assert.equal(slot.x + slot.width / 2, point.x * 1000);
  assert.equal(slot.y + slot.height / 2, point.y * 200);
  assert.equal(layout.bindings[0].portId, "linked-port");
  assert.equal(layout.bindings[0].slotId, slot.id);
  assert.ok(
    layout.snapshot.faces.front.elements.some(
      (element) => element.color === "#aab4bf",
    ),
  );
  const again = buildStackPhysicalLayout(
    { id: "stack", deviceType: "switch_stack", heightU: 2 },
    [port],
    [member],
    new Map([[member.id, stored]]),
  );
  assert.deepEqual(again.bindings, layout.bindings);
  for (const kind of ["vent", "bay", "screw"] as const) {
    const composed = layout.snapshot.faces.front.elements.find(element => element.kind === kind)!;
    const presentation = projectedFaceArtwork(composed)!;
    assert.equal(presentation.transform, "matrix(0 0.2 -5 0 1000 0)");
    const original = template.front.elements.find(element => element.kind === kind)!;
    assert.equal(faceplateDetailPath(presentation.primitive), faceplateDetailPath(original));
    if (kind === "vent") {
      const path = faceplateDetailPath(presentation.primitive);
      assert.equal(path.match(/M /g)?.length, 7, "composition must retain the seven source grille strokes");
      assert.ok(path.startsWith("M 22.5 26 V 54"));
      const [a,b,c,d,e,f] = composed.projection!.matrix;
      assert.equal(a*22.5+c*26+e, 870);
      assert.equal(b*22.5+d*26+f, 4.5);
      assert.equal(a*22.5+c*54+e, 730);
      assert.equal(b*22.5+d*54+f, 4.5, "the rotated grille must be horizontal");
    }
    if (kind === "screw") assert.equal("radius" in presentation.primitive && presentation.primitive.radius, 5);
  }
});

test("generated artwork projection cannot enter canonical templates or render non-finite SVG transforms", () => {
  const template = createStarterTemplate("switch-24");
  const projection = {geometry:{kind:"vent",x:10,y:20,width:100,height:40},matrix:[0,0.2,-5,0,1000,0]};
  assert.ok(readFaceArtworkProjection(projection, "vent"));
  for (const value of [
    {...projection,matrix:[NaN,0.2,-5,0,1000,0]},
    {...projection,matrix:[0,0,0,0,0,0]},
    {...projection,matrix:[0,0.2,-5,0,'1" onload="bad',0]},
    {...projection,geometry:{...projection.geometry,width:Infinity}},
    {...projection,geometry:{...projection.geometry,kind:"label"}},
  ]) assert.equal(readFaceArtworkProjection(value, "vent"), undefined);
  template.front.elements[0].projection = projection as NonNullable<typeof template.front.elements[0]["projection"]>;
  assert.throws(() => validateHardwareTemplateV1(template), /reserved for generated stack artwork/);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { DevicePhysicalLayout } from "@/lib/types";
import {
  buildPhysicalNodePresentation,
  PHYSICAL_NODE_HEADER_HEIGHT,
  PHYSICAL_NODE_PADDING_X,
  PHYSICAL_NODE_WIDTH,
  physicalHandlePlacement,
  physicalPortHandleId,
} from "./physical-node";

test("physical nodes retain exact slot centers and reveal linked opposite faces", () => {
  const layout = physicalLayoutFixture();
  const presentation = buildPhysicalNodePresentation({
    layout,
    requestedFaceMode: "front",
    visiblePorts: [{ id: "rear-port", face: "rear" }],
  });

  assert.deepEqual(
    presentation.faces.map((frame) => frame.face),
    ["front", "rear"],
  );
  const frontAnchor = presentation.anchors.find(
    (anchor) => anchor.portId === "front-port",
  );
  const rearAnchor = presentation.anchors.find(
    (anchor) => anchor.portId === "rear-port",
  );
  const contentWidth = PHYSICAL_NODE_WIDTH - PHYSICAL_NODE_PADDING_X * 2;
  assert.equal(
    frontAnchor?.x,
    PHYSICAL_NODE_PADDING_X + (120 / 1000) * contentWidth,
  );
  assert.equal(
    frontAnchor?.y,
    PHYSICAL_NODE_HEADER_HEIGHT + 16 + (60 / 200) * (contentWidth * 0.2),
  );
  assert.equal(rearAnchor?.side, "right");
  assert.ok((rearAnchor?.y ?? 0) > (frontAnchor?.y ?? 0));
});

test("physical nodes use a declared fallback only for unmapped visible ports", () => {
  const layout = physicalLayoutFixture();
  const presentation = buildPhysicalNodePresentation({
    layout,
    requestedFaceMode: "rear",
    visiblePorts: [{ id: "unmapped-port", face: "rear" }],
  });

  assert.deepEqual(
    presentation.faces.map((frame) => frame.face),
    ["rear"],
  );
  assert.deepEqual(presentation.unmappedPortIds, ["unmapped-port"]);
  assert.equal(
    physicalPortHandleId("source", "rear-port"),
    "source-port-rear-port",
  );
});

test("directional React Flow handles place their cable boundary on the exact anchor", () => {
  assert.deepEqual(physicalHandlePlacement(120, 80, "left"), {
    left: 120,
    top: 76,
    width: 8,
    height: 8,
  });
  assert.deepEqual(physicalHandlePlacement(120, 80, "right"), {
    left: 112,
    top: 76,
    width: 8,
    height: 8,
  });
  assert.deepEqual(physicalHandlePlacement(120, 80, "bottom"), {
    left: 116,
    top: 72,
    width: 8,
    height: 8,
  });
});

function physicalLayoutFixture(): DevicePhysicalLayout {
  return {
    deviceId: "device-1",
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
        rear: { schemaVersion: 1, width: 1000, height: 300, elements: [] },
      },
      portSlots: [
        {
          id: "front-slot",
          face: "front",
          x: 100,
          y: 40,
          width: 40,
          height: 40,
          rotation: 0,
          connector: "rj45",
          acceptedPortKinds: ["ethernet"],
        },
        {
          id: "rear-slot",
          face: "rear",
          x: 800,
          y: 100,
          width: 60,
          height: 40,
          rotation: 0,
          connector: "sfp_plus",
          acceptedPortKinds: ["sfp_plus"],
        },
      ],
    },
    bindings: [
      { portId: "front-port", slotId: "front-slot" },
      { portId: "rear-port", slotId: "rear-slot" },
    ],
    portFingerprint: "fixture",
    currentPortFingerprint: "fixture",
    unmappedPortIds: [],
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "@/lib/types";
import { visualizerCablePath } from "./model";
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

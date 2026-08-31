import assert from "node:assert/strict";
import test from "node:test";
import {
  createStarterTemplate,
  generatePortBlock,
  movePhysicalPortSlot,
  replacePortBlock,
  type PortBlockDefinition,
} from "./hardware-template-builder";

test("port block generation is deterministic across supported numbering directions", () => {
  const base: PortBlockDefinition = {
    id: "access",
    face: "rear",
    connector: "rj45",
    count: 6,
    rows: 2,
    columns: 3,
    start: 10,
    direction: "left-to-right",
    x: 100,
    y: 50,
    width: 300,
    height: 120,
  };
  const leftToRight = generatePortBlock(base);
  const rightToLeft = generatePortBlock({
    ...base,
    direction: "right-to-left",
  });
  const vertical = generatePortBlock({ ...base, direction: "vertical" });
  const serpentine = generatePortBlock({ ...base, direction: "serpentine" });

  assert.deepEqual(
    leftToRight.map((slot) => slot.id),
    [
      "access-10",
      "access-11",
      "access-12",
      "access-13",
      "access-14",
      "access-15",
    ],
  );
  assert.ok(rightToLeft[0].x > rightToLeft[2].x);
  assert.equal(vertical[0].x, vertical[1].x);
  assert.ok(vertical[0].y < vertical[1].y);
  assert.ok(serpentine[3].x > serpentine[5].x);
});

test("24-port switch starter keeps access ports separate from right-side 10G uplinks", () => {
  const template = createStarterTemplate(
    "switch-24",
    "lab-switch",
    "Lab switch",
  );
  const access = template.portSlots.filter((slot) => slot.groupId === "ports");
  const uplinks = template.portSlots.filter(
    (slot) => slot.groupId === "uplinks",
  );

  assert.equal(access.length, 24);
  assert.equal(uplinks.length, 4);
  assert.ok(access.every((slot) => slot.connector === "rj45"));
  assert.ok(uplinks.every((slot) => slot.connector === "sfp_plus"));
  assert.ok(
    Math.min(...uplinks.map((slot) => slot.x)) >
      Math.max(...access.map((slot) => slot.x)),
  );
});

test("server starters support independent module variants and exact device geometry edits", () => {
  const template = createStarterTemplate(
    "server-2u",
    "server-profile",
    "Server profile",
  );
  assert.equal(template.moduleSlots.length, 2);
  assert.deepEqual(
    template.modules.map((module) => module.slotId),
    ["rear-module-a", "rear-module-a", "rear-module-b"],
  );

  const withPorts = replacePortBlock(template, {
    id: "six-nics",
    face: "rear",
    connector: "rj45",
    count: 6,
    rows: 1,
    columns: 6,
    start: 1,
    direction: "left-to-right",
    x: 80,
    y: 120,
    width: 760,
    height: 60,
  });
  const moved = movePhysicalPortSlot(withPorts, "six-nics-1", 90, 130);
  assert.equal(moved.portSlots.find((slot) => slot.id === "six-nics-1")?.x, 90);
  assert.equal(
    moved.portSlots.find((slot) => slot.id === "six-nics-1")?.y,
    130,
  );
  assert.equal(template.portSlots.length, 0);
});

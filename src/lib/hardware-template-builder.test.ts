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

test("patch-panel starter produces matching face-qualified front and rear blocks", () => {
  const template = createStarterTemplate(
    "patch-panel",
    "lab-patch",
    "Lab patch panel",
  );
  const front = template.portSlots.filter((slot) => slot.face === "front");
  const rear = template.portSlots.filter((slot) => slot.face === "rear");

  assert.equal(front.length, 24);
  assert.equal(rear.length, 24);
  assert.deepEqual(
    template.portBlueprints.map((block) => [block.id, block.face]),
    [
      ["ports:front", "front"],
      ["ports:rear", "rear"],
    ],
  );
  assert.deepEqual(
    front.map((slot) => slot.label),
    rear.map((slot) => slot.label),
  );
  assert.equal(new Set(template.portSlots.map((slot) => slot.id)).size, 48);
  assert.deepEqual(
    new Set(front.map((slot) => slot.groupId)),
    new Set(["ports:front"]),
  );
  assert.deepEqual(
    new Set(rear.map((slot) => slot.groupId)),
    new Set(["ports:rear"]),
  );
});

test("port-block replacement is face-aware and upgrades only the selected legacy face", () => {
  const legacyFront: PortBlockDefinition = {
    id: "ports",
    face: "front",
    connector: "rj45",
    count: 2,
    rows: 1,
    columns: 2,
    start: 1,
    direction: "left-to-right",
    x: 100,
    y: 100,
    width: 200,
    height: 60,
  };
  const template = createStarterTemplate("server-1u", "legacy", "Legacy");
  template.portBlueprints = [{ ...legacyFront }];
  template.portSlots = generatePortBlock(legacyFront);

  const withRear = replacePortBlock(template, {
    ...legacyFront,
    face: "rear",
  });
  assert.deepEqual(
    withRear.portBlueprints.map((block) => [block.id, block.face]),
    [
      ["ports", "front"],
      ["ports:rear", "rear"],
    ],
  );
  assert.equal(
    withRear.portSlots.filter((slot) => slot.groupId === "ports").length,
    2,
  );
  assert.equal(
    withRear.portSlots.filter((slot) => slot.groupId === "ports:rear").length,
    2,
  );

  const updatedFront = replacePortBlock(withRear, {
    ...legacyFront,
    count: 3,
    columns: 3,
  });
  assert.deepEqual(
    updatedFront.portBlueprints.map((block) => [block.id, block.face]),
    [
      ["ports:rear", "rear"],
      ["ports:front", "front"],
    ],
  );
  assert.equal(
    updatedFront.portSlots.filter((slot) => slot.groupId === "ports:front")
      .length,
    3,
  );
  assert.equal(
    updatedFront.portSlots.filter((slot) => slot.groupId === "ports:rear")
      .length,
    2,
  );
  assert.equal(
    updatedFront.portSlots.some((slot) => slot.groupId === "ports"),
    false,
  );
  assert.equal(new Set(updatedFront.portSlots.map((slot) => slot.id)).size, 5);
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
  const moved = movePhysicalPortSlot(withPorts, "six-nics:rear-1", 90, 130);
  assert.equal(
    moved.portSlots.find((slot) => slot.id === "six-nics:rear-1")?.x,
    90,
  );
  assert.equal(
    moved.portSlots.find((slot) => slot.id === "six-nics:rear-1")?.y,
    130,
  );
  assert.equal(template.portSlots.length, 0);
});

test("one-row 24-column patch blocks preserve their opposite face on repeated updates", () => {
  let template = createStarterTemplate("patch-panel", "row-panel", "Row panel");
  for (const face of ["front", "rear", "front", "rear"] as const) {
    const opposite = template.portSlots.filter((slot) => slot.face !== face);
    const block = template.portBlueprints.find(
      (entry) => entry.face === face,
    ) as unknown as PortBlockDefinition;
    template = replacePortBlock(template, {
      ...block,
      id: "ports",
      face,
      count: 24,
      rows: 1,
      columns: 24,
    });
    assert.deepEqual(
      template.portSlots.filter((slot) => slot.face !== face),
      opposite,
    );
    const updated = template.portSlots.filter((slot) => slot.face === face);
    assert.equal(updated.length, 24);
    assert.equal(new Set(updated.map((slot) => slot.y)).size, 1);
    assert.equal(new Set(updated.map((slot) => slot.x)).size, 24);
    assert.equal(new Set(template.portSlots.map((slot) => slot.id)).size, 48);
  }
});

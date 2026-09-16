import assert from "node:assert/strict";
import test from "node:test";
import {
  createStarterTemplate,
  createHardwareModule,
  deleteModulePosition,
  updateModulePosition,
  templatePortBlocks,
  deletePortBlock,
  nextTemplatePartId,
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

test("port-block replacement preserves existing identities while adding independent faces", () => {
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
      ["ports", "front"],
    ],
  );
  assert.equal(
    updatedFront.portSlots.filter((slot) => slot.groupId === "ports").length,
    3,
  );
  assert.equal(
    updatedFront.portSlots.filter((slot) => slot.groupId === "ports:rear")
      .length,
    2,
  );
  assert.equal(
    updatedFront.portSlots.some((slot) => slot.groupId === "ports:front"),
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

test("block editing retains identities and deletes only the selected face and group", () => {
  const original = createStarterTemplate("patch-panel", "panel", "Panel");
  const front = templatePortBlocks(original).find(
    (block) => block.face === "front",
  )!;
  assert.ok(front);
  const edited = replacePortBlock(original, { ...front, x: front.x + 5 });
  assert.deepEqual(
    edited.portSlots.map((slot) => slot.id).sort(),
    original.portSlots.map((slot) => slot.id).sort(),
  );
  const id = nextTemplatePartId(
    front.id,
    templatePortBlocks(edited).map((block) => block.id),
  );
  const duplicate = replacePortBlock(edited, {
    ...front,
    id,
    connector: "sfp",
    count: 4,
    columns: 4,
  });
  assert.equal(duplicate.portSlots.length, original.portSlots.length + 4);
  assert.equal(
    new Set(duplicate.portSlots.map((slot) => slot.id)).size,
    duplicate.portSlots.length,
  );
  const removed = deletePortBlock(duplicate, { ...front, id });
  assert.deepEqual(removed.portSlots, edited.portSlots);
  assert.deepEqual(removed.rear, original.rear);
});

test("port-block geometry updates resize the generated layout independently of position", () => {
  const block: PortBlockDefinition = {
    id: "geometry",
    face: "front",
    connector: "rj45",
    count: 4,
    rows: 2,
    columns: 2,
    start: 1,
    direction: "left-to-right",
    x: 100,
    y: 80,
    width: 200,
    height: 80,
  };
  const originalSlots = generatePortBlock(block);
  const movedSlots = generatePortBlock({ ...block, x: block.x + 40 });
  const resizedSlots = generatePortBlock({
    ...block,
    width: 100,
    height: 160,
  });

  assert.equal(movedSlots[0]!.x - originalSlots[0]!.x, 40);
  assert.ok(
    resizedSlots[1]!.x - resizedSlots[0]!.x <
      originalSlots[1]!.x - originalSlots[0]!.x,
  );
  assert.ok(
    resizedSlots[2]!.y - resizedSlots[0]!.y >
      originalSlots[2]!.y - originalSlots[0]!.y,
  );
});

test("module positions control both faces and preserve module port identities while moving and resizing", () => {
  const template = createStarterTemplate("mini-pc", "mini", "Mini");
  const position = {
    id: "front-module",
    face: "front" as const,
    x: 40,
    y: 20,
    width: 260,
    height: 224,
  };
  const module = createHardwareModule(
    "nic-front",
    "NIC",
    position.id,
    "nic",
    2,
    position,
  );
  assert.equal(module.face, "front");
  assert.ok(
    module.portSlots.every(
      (slot) =>
        slot.face === "front" && slot.x >= position.x && slot.y >= position.y,
    ),
  );
  const assigned = { ...template, moduleSlots: [position], modules: [module] };
  assert.equal(deleteModulePosition(assigned, position.id), assigned);
  const moved = updateModulePosition(assigned, {
    ...position,
    face: "rear",
    x: 500,
    y: 40,
    width: 130,
    height: 112,
  });
  assert.equal(moved.modules[0].face, "rear");
  assert.deepEqual(
    moved.modules[0].portSlots.map((slot) => slot.id),
    module.portSlots.map((slot) => slot.id),
  );
  assert.ok(
    moved.modules[0].portSlots.every(
      (slot) =>
        slot.face === "rear" && slot.x >= 500 && slot.x + slot.width <= 630,
    ),
  );
  assert.deepEqual(moved.portSlots, template.portSlots);
  assert.equal(
    deleteModulePosition({ ...moved, modules: [] }, position.id).moduleSlots
      .length,
    0,
  );
});

test("repeated switch access and uplink edits preserve legacy block and port IDs", () => {
  let template = createStarterTemplate(
    "switch-24",
    "stable-switch",
    "Stable switch",
  );
  const originalIds = template.portSlots.map((slot) => slot.id).sort();
  const originals = templatePortBlocks(template);
  assert.deepEqual(
    originals.map((block) => block.id),
    ["ports", "uplinks"],
  );
  for (const original of originals) {
    for (const offset of [10, 20]) {
      const block = templatePortBlocks(template).find(
        (entry) => entry.id === original.id && entry.face === original.face,
      );
      assert.ok(block, "selected block remains addressable after Update");
      const unaffected = template.portSlots.filter(
        (slot) => slot.groupId !== original.id,
      );
      template = replacePortBlock(template, {
        ...block,
        x: original.x + offset,
      });
      const updated = templatePortBlocks(template).find(
        (entry) => entry.id === original.id,
      );
      assert.equal(updated?.x, original.x + offset);
      assert.deepEqual(
        template.portSlots.map((slot) => slot.id).sort(),
        originalIds,
      );
      assert.deepEqual(
        template.portSlots.filter((slot) => slot.groupId !== original.id),
        unaffected,
      );
    }
  }
});

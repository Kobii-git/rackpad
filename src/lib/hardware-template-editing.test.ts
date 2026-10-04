import assert from "node:assert/strict";
import test from "node:test";
import {
  createStarterTemplate,
  deletePortBlock,
  createHardwareModule,
  replacePortBlock,
  templatePortBlocks,
} from "./hardware-template-builder";
import {
  templateItems,
  templateItemValue,
  transferTemplateItem,
  updateModuleGrid,
  updateTemplateItem,
} from "./hardware-template-editing";
import { physicalItemColor } from "./faceplate-artwork";
import { validateHardwareTemplateV1 } from "../../server/lib/physical-layout";

function fixture() {
  let template = createStarterTemplate("server-2u");
  template.modules = [];
  template = replacePortBlock(template, {
    id: "test-access",
    face: "rear",
    connector: "rj45",
    count: 4,
    rows: 1,
    columns: 4,
    start: 1,
    direction: "left-to-right",
    x: 100,
    y: 70,
    width: 240,
    height: 60,
  });
  const position = template.moduleSlots[0];
  template.modules.push(
    createHardwareModule("test-nic", "NIC", position.id, "nic", 8, position),
  );
  return template;
}
test("item colors round-trip through validation and reject SVG paint injection", () => {
  const original = fixture();
  const port = original.portSlots[0];
  const item = { kind: "port" as const, id: port.id, face: port.face };
  const colored = updateTemplateItem(original, item, { color: "#12AB34" });
  const validated = validateHardwareTemplateV1(colored);
  assert.equal(validated.portSlots[0].color, "#12ab34");
  assert.equal(original.portSlots[0].color, undefined);
  assert.equal(
    updateTemplateItem(colored, item, { color: "" }).portSlots[0].color,
    undefined,
  );
  for (const color of [
    "url(https://example.invalid)",
    "#abc",
    "red",
    '#123456" onload="alert(1)',
  ]) {
    assert.throws(() => updateTemplateItem(original, item, { color }));
    assert.throws(() =>
      validateHardwareTemplateV1({
        ...original,
        portSlots: [{ ...port, color }, ...original.portSlots.slice(1)],
      }),
    );
    assert.equal(physicalItemColor(color, "default"), "default");
  }
  const element = original.rear.elements[0];
  const artwork = updateTemplateItem(
    original,
    { kind: "element", face: "rear", id: element.id },
    { color: "#654321" },
  );
  assert.equal(
    validateHardwareTemplateV1(artwork).rear.elements[0].color,
    "#654321",
  );
});
test("module grids preserve identities and colors without silently discarding ports", () => {
  let template = fixture();
  template.modules[0].portSlots[0].color = "#aabbcc";
  const ids = template.modules[0].portSlots.map((slot) => slot.id);
  template = updateModuleGrid(template, "test-nic", 8, 1, 8);
  assert.deepEqual(
    template.modules[0].portSlots.map((slot) => slot.id),
    ids,
  );
  assert.equal(
    new Set(template.modules[0].portSlots.map((slot) => slot.y)).size,
    1,
  );
  assert.equal(template.modules[0].portSlots[0].color, "#aabbcc");
  assert.deepEqual(validateHardwareTemplateV1(template).modules[0].portGrid, {
    rows: 1,
    columns: 8,
  });
  template = updateModuleGrid(template, "test-nic", 8, 2, 4);
  assert.equal(
    new Set(template.modules[0].portSlots.map((slot) => slot.y)).size,
    2,
  );
  assert.throws(
    () => updateModuleGrid(template, "test-nic", 8, 1, 4),
    /cannot omit/,
  );
  for (const count of [1, 3, 16]) {
    const changed = updateModuleGrid(
      template,
      "test-nic",
      count,
      count > 8 ? 2 : 1,
      Math.ceil(count / (count > 8 ? 2 : 1)),
    );
    assert.equal(changed.modules[0].portSlots.length, count);
    assert.equal(changed.modules[0].portSlots[0].id, ids[0]);
    assert.doesNotThrow(() => validateHardwareTemplateV1(changed));
  }
});
test("module resizing and face transfers preserve existing identities and allocate unique copies", () => {
  const original = fixture();
  const position = original.moduleSlots[0];
  const item = {
    kind: "position" as const,
    face: position.face,
    id: position.id,
  };
  const resized = updateTemplateItem(original, item, {
    width: position.width + 20,
    height: position.height + 20,
  });
  assert.equal(
    resized.modules[0].portSlots[0].id,
    original.modules[0].portSlots[0].id,
  );
  assert.notEqual(
    resized.modules[0].portSlots[0].x,
    original.modules[0].portSlots[0].x,
  );
  const moved = transferTemplateItem(resized, item, false);
  assert.equal(moved.modules[0].face, "front");
  assert.equal(moved.modules[0].id, original.modules[0].id);
  assert.doesNotThrow(() => validateHardwareTemplateV1(moved));
  const copied = transferTemplateItem(original, item, true);
  const allPorts = copied.modules.flatMap((module) =>
    module.portSlots.map((slot) => slot.id),
  );
  assert.equal(new Set(allPorts).size, allPorts.length);
  assert.equal(copied.modules.length, 2);
  assert.doesNotThrow(() => validateHardwareTemplateV1(copied));
  assert.throws(() => updateTemplateItem(original, item, { width: 1001 }));
});
test("transferred individual ports are not recreated by their former block", () => {
  const original = fixture();
  const port = original.portSlots[0];
  const moved = transferTemplateItem(
    original,
    { kind: "port", id: port.id, face: port.face },
    false,
  );
  const regenerated = replacePortBlock(
    moved,
    templatePortBlocks(moved).find((block) => block.id === port.groupId)!,
  );
  assert.equal(
    regenerated.portSlots.filter((slot) => slot.id === port.id).length,
    1,
  );
  assert.equal(
    regenerated.portSlots.find((slot) => slot.id === port.id)?.face,
    "front",
  );
  assert.doesNotThrow(() => validateHardwareTemplateV1(regenerated));
});
test("face copy handles differing canvas heights and rejects duplicate move IDs", () => {
  const original = fixture();
  original.front.height = 600;
  const element = original.rear.elements.find(
    (entry) => entry.kind === "bay" || entry.kind === "panel",
  )!;
  const item = {
    kind: "element" as const,
    id: element.id,
    face: "rear" as const,
  };
  const copied = transferTemplateItem(original, item, true);
  const added = copied.front.elements.at(-1)!;
  assert.equal(added.y, element.y * 2);
  assert.notEqual(added.id, element.id);
  assert.equal(
    templateItems(copied).length,
    templateItems(original).length + 1,
  );
  original.front.elements.push({ ...element });
  assert.throws(
    () => transferTemplateItem(original, item, false),
    /already contains/,
  );
});

test("copied and moved blocks retain colors, slot IDs and metadata when regenerated", () => {
  const original = fixture();
  const block = templatePortBlocks(original)[0];
  const slot = original.portSlots.find((slot) => slot.groupId === block.id)!;
  slot.color = "#aabbcc";
  slot.rotation = 90;
  slot.label = "Custom label";
  for (const copy of [false, true]) {
    const changed = transferTemplateItem(
      original,
      { kind: "block", id: block.id, face: block.face },
      copy,
    );
    const other = templatePortBlocks(changed).find(
      (entry) => entry.face === "front",
    )!;
    const before = changed.portSlots.filter(
      (slot) => slot.groupId === other.id,
    );
    const regenerated = replacePortBlock(changed, {
      ...other,
      x: other.x + 10,
    });
    const after = regenerated.portSlots.filter(
      (slot) => slot.groupId === other.id,
    );
    assert.deepEqual(
      after.map((slot) => slot.id),
      before.map((slot) => slot.id),
    );
    assert.equal(after[0].color, "#aabbcc");
    assert.equal(after[0].rotation, 90);
    assert.equal(after[0].label, "Custom label");
    assert.doesNotThrow(() => validateHardwareTemplateV1(regenerated));
  }
});

test("legacy ungrouped block slots transform and cannot overwrite a destination block", () => {
  const template = fixture();
  const block = templatePortBlocks(template)[0];
  for (const slot of template.portSlots)
    if (slot.groupId === block.id) delete slot.groupId;
  const resized = updateTemplateItem(
    template,
    { kind: "block", id: block.id, face: block.face },
    { width: block.width + 40 },
  );
  assert.notEqual(resized.portSlots[0].x, template.portSlots[0].x);
  const moved = transferTemplateItem(
    template,
    { kind: "block", id: block.id, face: block.face },
    false,
  );
  assert.ok(moved.portSlots.every((slot) => slot.face === "front"));
  template.portBlueprints.push({ ...block, face: "front" });
  assert.throws(
    () =>
      transferTemplateItem(
        template,
        { kind: "block", id: block.id, face: block.face },
        false,
      ),
    /already contains/,
  );
});

function twoFaceBlocks() {
  let template = createStarterTemplate("server-2u");
  template.modules = [];
  template.portSlots = [];
  template.portBlueprints = [];
  const block = {
    id: "access", face: "front" as const, connector: "rj45" as const,
    count: 2, rows: 1, columns: 2, start: 1,
    direction: "left-to-right" as const, x: 100, y: 70, width: 240, height: 60,
  };
  template = replacePortBlock(template, block);
  template = replacePortBlock(template, { ...block, face: "rear", x: 500 });
  return template;
}

test("transferred face-qualified blocks regenerate and delete without consuming their sibling", () => {
  for (const ungrouped of [false, true]) {
    const original = twoFaceBlocks();
    if (ungrouped) original.portSlots.forEach(slot => { delete slot.groupId; });
    const frontPorts = structuredClone(original.portSlots.filter(slot => slot.face === "front"));
    const rear = templatePortBlocks(original).find(block => block.face === "rear")!;
    const moved = transferTemplateItem(original, { kind: "block", id: rear.id, face: "rear" }, false);
    const regenerated = replacePortBlock(moved, { ...rear, face: "front", x: 550 });
    assert.deepEqual(regenerated.portSlots.filter(slot => frontPorts.some(port => port.id === slot.id)), frontPorts);
    assert.equal(regenerated.portSlots.length, original.portSlots.length);
    assert.equal(templatePortBlocks(regenerated).length, 2);
    const deleted = deletePortBlock(regenerated, { ...rear, face: "front" });
    assert.deepEqual(deleted.portSlots, frontPorts);
    assert.equal(templatePortBlocks(deleted).length, 1);
    assert.doesNotThrow(() => validateHardwareTemplateV1(regenerated));
  }
});

test("legacy shared blueprint IDs resize only the selected face", () => {
  for (const ungrouped of [false, true]) {
    const template = twoFaceBlocks();
    template.portBlueprints = template.portBlueprints.map(block => ({ ...block, id: "shared" }));
    template.portSlots = template.portSlots.map(slot => ({ ...slot, id: `${slot.face}-${slot.id}`, groupId: "shared" }));
    if (ungrouped) template.portSlots = template.portSlots.map((slot, index) => {
      const next = { ...slot, id: `shared-${index + 1}` }; delete next.groupId; return next;
    });
    validateHardwareTemplateV1(template);
    const before = structuredClone(template);
    const item = { kind: "block" as const, id: "shared", face: "rear" as const };
    const selected = templateItemValue(template, item);
    assert.ok(selected && "face" in selected);
    assert.equal(selected.face, "rear");
    const changed = updateTemplateItem(template, item, { width: 300 });
    assert.deepEqual(changed.portSlots.filter(slot => slot.face === "front"), before.portSlots.filter(slot => slot.face === "front"));
    assert.notDeepEqual(changed.portSlots.filter(slot => slot.face === "rear"), before.portSlots.filter(slot => slot.face === "rear"));
    assert.deepEqual(template, before);
    assert.doesNotThrow(() => validateHardwareTemplateV1(changed));
  }
});

test("ambiguous legacy ownership rejects edits, regeneration and deletion atomically", () => {
  const original = twoFaceBlocks();
  const rear = templatePortBlocks(original).find(block => block.face === "rear")!;
  const moved = transferTemplateItem(original, { kind: "block", id: rear.id, face: "rear" }, false);
  moved.portSlots = moved.portSlots.map((slot, index) => ({ ...slot, id: `access-${index + 1}`, groupId: undefined }));
  const before = structuredClone(moved);
  const item = { kind: "block" as const, id: rear.id, face: "front" as const };
  for (const operation of [
    () => updateTemplateItem(moved, item, { width: 300 }),
    () => replacePortBlock(moved, { ...rear, face: "front", width: 300 }),
    () => deletePortBlock(moved, { ...rear, face: "front" }),
    () => transferTemplateItem(moved, item, true),
    () => replacePortBlock(moved, { ...rear, id: "access", face: "front" }),
  ]) {
    assert.throws(operation, /Ambiguous/);
    assert.deepEqual(moved, before);
  }
});

test("unique legacy aliases preserve slot identities and detached ports survive source deletion", () => {
  const original = twoFaceBlocks();
  const rear = templatePortBlocks(original).find(block => block.face === "rear")!;
  original.portSlots = original.portSlots.map(slot => slot.face === "rear" ? { ...slot, id: slot.id.replace("access:rear-", "access-"), groupId: undefined } : slot);
  const resized = replacePortBlock(original, { ...rear, id: "access", width: 300 });
  assert.deepEqual(resized.portSlots.map(slot => slot.id), original.portSlots.map(slot => slot.id));
  for (const copy of [false, true]) {
    const port = original.portSlots.find(slot => slot.face === "rear")!;
    const detached = transferTemplateItem(original, { kind: "port", id: port.id, face: "rear" }, copy);
    const movedPort = detached.portSlots.at(-1)!;
    const removed = deletePortBlock(detached, rear);
    const front = templatePortBlocks(removed).find(block => block.face === "front")!;
    const regenerated = replacePortBlock(removed, { ...front, x: 120 });
    assert.deepEqual(regenerated.portSlots.find(slot => slot.id === movedPort.id), movedPort);
    assert.doesNotThrow(() => validateHardwareTemplateV1(regenerated));
  }
});

test("copying a qualified block with legacy slot IDs preserves copied identities on regeneration", () => {
  const original = twoFaceBlocks();
  const rear = templatePortBlocks(original).find(block => block.face === "rear")!;
  original.portSlots = original.portSlots.map(slot => slot.face === "rear" ? { ...slot, id: slot.id.replace("access:rear-", "access-"), groupId: undefined, color: "#aabbcc", rotation: 90 } : slot);
  const copied = transferTemplateItem(original, { kind: "block", id: rear.id, face: "rear" }, true);
  const added = templatePortBlocks(copied).find(block => block.id !== "access:front" && block.id !== "access:rear")!;
  const copiedPorts = copied.portSlots.filter(slot => slot.groupId === added.id);
  const regenerated = replacePortBlock(copied, { ...added, x: 550 });
  assert.deepEqual(regenerated.portSlots.filter(slot => slot.groupId === added.id).map(slot => ({ id: slot.id, color: slot.color, rotation: slot.rotation })), copiedPorts.map(slot => ({ id: slot.id, color: slot.color, rotation: slot.rotation })));
  assert.deepEqual(regenerated.portSlots.filter(slot => slot.groupId !== added.id), original.portSlots);
  assert.doesNotThrow(() => validateHardwareTemplateV1(regenerated));
});

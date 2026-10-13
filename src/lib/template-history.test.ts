import assert from "node:assert/strict";
import test from "node:test";
import {
  createStarterTemplate,
  createHardwareModule,
} from "./hardware-template-builder";
import { transferTemplateItem } from "./hardware-template-editing";
import { reorderTemplateArtwork, templateArtwork } from "./template-artwork";
import {
  changeTemplate,
  finishTemplateGesture,
  stepTemplateHistory,
  type TemplateHistory,
} from "./template-history";
import {
  resolveTemplateSnapshot,
  validateHardwareTemplateV1,
  validateResolvedPhysicalLayoutV1,
} from "../../server/lib/physical-layout";

test("drawing order qualifies module artwork, survives serialization and resolution, and maintains transferred references", () => {
  let draft = createStarterTemplate("server-2u");
  const position = draft.moduleSlots[0];
  const module = createHardwareModule(
    "ordered-module",
    "NIC",
    position.id,
    "nic",
    2,
    position,
  );
  draft.modules = [module];
  const item = { elementId: module.elements[0].id, moduleId: module.id };
  draft = reorderTemplateArtwork(draft, module.face, item, "back");
  assert.deepEqual(templateArtwork(draft, module.face)[0].reference, item);
  const validated = validateHardwareTemplateV1(
    JSON.parse(JSON.stringify(draft)),
  );
  const snapshot = resolveTemplateSnapshot(
    validated,
    { id: "device", deviceType: "server", heightU: 2 },
    [module.id],
  );
  assert.equal(snapshot.faces[module.face].elements[0].id, item.elementId);
  assert.deepEqual(validateResolvedPhysicalLayoutV1(snapshot), snapshot);
  const copied = transferTemplateItem(
    draft,
    { kind: "position", id: position.id, face: module.face },
    true,
  );
  const copiedModule = copied.modules.find((entry) => entry.id !== module.id)!;
  const sourceOrder = templateArtwork(draft, module.face)
    .filter((entry) => entry.reference.moduleId === module.id)
    .map((entry) =>
      module.elements.findIndex((element) => element.id === entry.element.id),
    );
  const copiedOrder = templateArtwork(copied, copiedModule.face)
    .filter((entry) => entry.reference.moduleId === copiedModule.id)
    .map((entry) =>
      copiedModule.elements.findIndex(
        (element) => element.id === entry.element.id,
      ),
    );
  assert.deepEqual(copiedOrder, sourceOrder);
  validateHardwareTemplateV1(copied);
  const wrongOwner = structuredClone(draft);
  wrongOwner[module.face].artworkOrder![0].moduleId = "missing";
  assert.throws(() => validateHardwareTemplateV1(wrongOwner), /Unknown/);
  const duplicate = structuredClone(draft);
  duplicate[module.face].artworkOrder!.push(item);
  assert.throws(() => validateHardwareTemplateV1(duplicate), /duplicate/i);
  const base = draft[module.face].elements[0];
  const history: TemplateHistory<string> = { draft, past: [], future: [] };
  const moved = changeTemplate(
    history,
    transferTemplateItem(
      draft,
      { kind: "element", face: module.face, id: base.id },
      false,
    ),
    "source",
  );
  assert.ok(
    !moved.draft[module.face].artworkOrder!.some(
      (ref) => ref.elementId === base.id && !ref.moduleId,
    ),
  );
  validateHardwareTemplateV1(moved.draft);
});

test("history groups gestures, restores selection, clears redo and bounds snapshots to100", () => {
  let history: TemplateHistory<string> = {
    draft: createStarterTemplate("server-2u"),
    past: [],
    future: [],
  };
  history = {
    ...history,
    gesture: { draft: history.draft, selection: "before-drag" },
  };
  for (const name of ["a", "b", "c"])
    history = changeTemplate(history, { ...history.draft, name }, "during");
  assert.equal(history.past.length, 0);
  history = finishTemplateGesture(history);
  assert.equal(history.past.length, 1);
  const undo = stepTemplateHistory(history, "after-drag", "undo");
  assert.equal(undo.selection, "before-drag");
  const redo = stepTemplateHistory(undo.history, undo.selection, "redo");
  assert.equal(redo.selection, "after-drag");
  assert.equal(redo.history.draft.name, "c");
  history = changeTemplate(
    undo.history,
    { ...undo.history.draft, name: "new-edit" },
    "new",
  );
  assert.equal(history.future.length, 0);
  const before = history;
  history = finishTemplateGesture({
    ...history,
    gesture: { draft: history.draft, selection: "unchanged" },
  });
  assert.deepEqual(history, before);
  for (let index = 0; index < 110; index++)
    history = changeTemplate(
      history,
      { ...history.draft, name: String(index) },
      "item",
    );
  assert.equal(history.past.length, 100);
});

import assert from "node:assert/strict";
import test from "node:test";
import { validateHardwareTemplateV1 } from "../../server/lib/physical-layout";
import {
  createHardwareModule,
  createStarterTemplate,
} from "./hardware-template-builder";
import {
  exportHardwareTemplate,
  HardwareTemplateFileError,
  prepareHardwareTemplateImport,
} from "./hardware-template-sharing";

test("shared definitions round-trip geometry, modules, colors and drawing order without local assignments", () => {
  const template = createStarterTemplate(
    "server-2u",
    "shared-server",
    "Shared server",
  );
  template.front.elements[0].color = "#123456";
  template.front.skin = "silver";
  template.front.rotation = 90;
  template.front.artworkOrder = template.front.elements.map((element) => ({
    elementId: element.id,
  }));
  const slot = template.moduleSlots[0];
  template.modules = [
    createHardwareModule("shared-nic", "NIC", slot.id, "nic", 4, slot),
  ];
  template.modules[0].portGrid = { rows: 2, columns: 2 };
  template.portBlueprints = [{ name: "LAN", kind: "ethernet", speed: 1000 }];
  template.driveBayBlueprints = [{ name: "Front bays", count: 4 }];
  const source = validateHardwareTemplateV1(template);
  const original = structuredClone(source);
  const exported = exportHardwareTemplate({
    ...source,
    builtIn: true,
    deviceId: "private-device",
    defaults: ["local-default"],
  } as typeof source);
  const definition = JSON.parse(exported.content);
  assert.equal(definition.builtIn, undefined);
  assert.equal(definition.deviceId, undefined);
  assert.equal(definition.defaults, undefined);
  assert.deepEqual(definition, source);
  const imported = validateHardwareTemplateV1(
    prepareHardwareTemplateImport(exported.content, "other", []),
  );
  assert.deepEqual(imported, {
    ...source,
    id: imported.id,
    deviceTypes: ["other"],
  });
  assert.notEqual(imported.id, source.id);
  assert.deepEqual(source, original);
});

test("round templates retain face shape and port identities when shared across device types", () => {
  const source = createStarterTemplate("round-device", "ap-model", "Round AP");
  source.deviceTypes = ["foreign-custom-type"];
  const imported = validateHardwareTemplateV1(
    prepareHardwareTemplateImport(
      exportHardwareTemplate(source).content,
      "ap",
      [],
    ),
  );
  assert.equal(imported.front.shape, "round");
  assert.equal(imported.rear.shape, "round");
  assert.deepEqual(imported.portSlots, source.portSlots);
  assert.deepEqual(imported.deviceTypes, ["ap"]);
});

test("repeat imports use independent IDs and available names even for built-in definitions", () => {
  const source = createStarterTemplate(
    "round-device",
    "builtin.round",
    "Round AP",
  );
  source.builtIn = true;
  const text = "\uFEFF" + JSON.stringify(source);
  const first = prepareHardwareTemplateImport(text, "ap", [source]);
  const second = prepareHardwareTemplateImport(text, "ap", [
    source,
    { name: String(first.name) },
  ]);
  assert.equal(first.name, "Round AP copy");
  assert.equal(second.name, "Round AP copy 2");
  assert.notEqual(first.id, source.id);
  assert.notEqual(first.id, second.id);
  assert.equal(first.builtIn, undefined);
  assert.doesNotThrow(() => validateHardwareTemplateV1(first));
});

test("imports reject foreign formats and leave structural validation to the existing server boundary", () => {
  for (const value of [
    "invalid",
    "[]",
    "null",
    "{}",
    JSON.stringify({ schemaVersion: 2, id: "future", name: "Future" }),
    JSON.stringify({ schemaVersion: 1, id: "bad", name: {} }),
  ]) {
    assert.throws(
      () => prepareHardwareTemplateImport(value, "other", []),
      HardwareTemplateFileError,
    );
  }
  const source = createStarterTemplate("round-device");
  source.front.width = 500 as 1000;
  const prepared = prepareHardwareTemplateImport(
    JSON.stringify(source),
    "ap",
    [],
  );
  assert.throws(() => validateHardwareTemplateV1(prepared), /1000-unit canvas/);
});

test("download filenames cannot introduce paths or active content", () => {
  const source = createStarterTemplate("round-device");
  source.name = "../../<script>\\bad:name";
  const exported = exportHardwareTemplate(source);
  assert.match(exported.filename, /^rackpad-template-[a-z0-9_-]+\.json$/);
  assert.doesNotMatch(exported.filename, /[/\\<>]/);
});

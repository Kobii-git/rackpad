import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNetboxPortTemplateDraft,
  findExistingNetboxTemplate,
  netboxDedupeKey,
  parseNetBoxDeviceTypeYaml,
  previewNetboxDeviceTypeImport,
} from "../lib/netbox-device-type.js";
import type { PortTemplate } from "../lib/port-templates.js";

const SAMPLE_YAML = `
manufacturer: Cisco
model: Catalyst 9300-24T
slug: cisco-catalyst-9300-24t
part_number: C9300-24T
u_height: 1
is_full_depth: true
interfaces:
  - name: GigabitEthernet1/0/1
    type: 1000base-t
  - name: GigabitEthernet1/0/2
    type: 1000base-t
  - name: TenGigabitEthernet1/0/1
    type: 10gbase-x-sfpp
console-ports:
  - name: Console
    type: rj-45
power-ports:
  - name: PSU1
    type: iec-60320-c14
    maximum_draw: 350
`.trim();

test("parseNetBoxDeviceTypeYaml extracts manufacturer, model, u-height, and ports", () => {
  const parsed = parseNetBoxDeviceTypeYaml(SAMPLE_YAML);

  assert.equal(parsed.manufacturer, "Cisco");
  assert.equal(parsed.model, "Catalyst 9300-24T");
  assert.equal(parsed.uHeight, 1);
  assert.equal(parsed.slug, "cisco-catalyst-9300-24t");
  assert.equal(parsed.partNumber, "C9300-24T");
  assert.equal(parsed.interfaces.length, 5);

  const dataPorts = parsed.interfaces.filter((entry) => entry.section === "interface");
  assert.equal(dataPorts.length, 3);
  assert.deepEqual(dataPorts[0], {
    name: "GigabitEthernet1/0/1",
    type: "1000base-t",
    section: "interface",
  });

  const consolePorts = parsed.interfaces.filter((entry) => entry.section === "console");
  assert.equal(consolePorts.length, 1);
  assert.equal(consolePorts[0]?.name, "Console");

  const powerPorts = parsed.interfaces.filter((entry) => entry.section === "power");
  assert.equal(powerPorts.length, 1);
  assert.equal(powerPorts[0]?.name, "PSU1");
});

test("buildNetboxPortTemplateDraft maps NetBox interfaces to Rackpad port kinds", () => {
  const parsed = parseNetBoxDeviceTypeYaml(SAMPLE_YAML);
  const draft = buildNetboxPortTemplateDraft(parsed);

  assert.equal(draft.name, "Cisco Catalyst 9300-24T");
  assert.match(draft.description, /^netbox:cisco::catalyst 9300-24t \| /);
  assert.deepEqual(draft.deviceTypes, ["switch"]);
  assert.equal(draft.ports.length, 5);
  assert.deepEqual(draft.ports[0], {
    name: "GigabitEthernet1/0/1",
    position: 1,
    kind: "rj45",
    speed: "1G",
    face: "front",
    mode: "access",
    allowedVlanIds: [],
  });
  assert.equal(draft.ports[2]?.kind, "sfp_plus");
  assert.equal(draft.ports[3]?.kind, "console");
  assert.equal(draft.ports[4]?.kind, "power");
  assert.equal(draft.ports[4]?.face, "rear");
});

test("previewNetboxDeviceTypeImport dedupes by manufacturer and model", () => {
  const parsed = parseNetBoxDeviceTypeYaml(SAMPLE_YAML);
  const draft = buildNetboxPortTemplateDraft(parsed);
  const templates: PortTemplate[] = [
    {
      id: "existing-template",
      name: draft.name,
      description: draft.description,
      deviceTypes: draft.deviceTypes,
      ports: draft.ports,
    },
  ];

  const preview = previewNetboxDeviceTypeImport(SAMPLE_YAML, templates);
  assert.equal(preview.dedupeKey, netboxDedupeKey("Cisco", "Catalyst 9300-24T"));
  assert.equal(preview.existingTemplate?.id, "existing-template");
  assert.equal(
    findExistingNetboxTemplate("Cisco", "Catalyst 9300-24T", templates)?.id,
    "existing-template",
  );
  assert.equal(preview.existingDevice, null);
  assert.equal(preview.deviceDraft.heightU, 1);
  assert.equal(preview.deviceDraft.portCount, 5);
});

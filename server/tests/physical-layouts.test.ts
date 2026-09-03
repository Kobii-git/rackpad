import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import Database from "better-sqlite3";

const tempDir = mkdtempSync(
  path.join(os.tmpdir(), "rackpad-physical-layouts-"),
);
process.env.DATABASE_PATH = path.join(tempDir, "physical-layouts-test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "rackpad-physical-layout-test-secret";

const { createApp } = await import("../app.js");
const { CURRENT_SCHEMA_VERSION, db } = await import("../db.js");
const { setBootstrapState } = await import("../lib/auth.js");

type AppInstance = Awaited<ReturnType<typeof createApp>>;
let app: AppInstance;

beforeEach(async () => {
  resetDatabase();
  app = await createApp();
});

afterEach(async () => {
  await app.close();
});

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("physical layout preview is lab-authorized, fingerprinted, and preserves canonical cabling", async () => {
  const adminToken = await bootstrapAdmin();
  const device = await createDevice(adminToken, "layout-server");
  const peer = await createDevice(adminToken, "layout-switch", "switch");
  const firstPort = await createPort(adminToken, device.id, "NIC 1", "rear");
  const secondPort = await createPort(adminToken, device.id, "NIC 2", "rear");
  const virtualPort = await createPort(
    adminToken,
    device.id,
    "bond0",
    "front",
    "virtual",
  );
  const peerPort = await createPort(adminToken, peer.id, "Port 1", "front");
  const linkResponse = await app.inject({
    method: "POST",
    url: "/api/port-links",
    headers: authHeaders(adminToken),
    payload: {
      fromPortId: firstPort.id,
      toPortId: peerPort.id,
      cableType: "cat6a",
      color: "#22d3ee",
    },
  });
  assert.equal(linkResponse.statusCode, 201, linkResponse.body);
  const link = json(linkResponse) as { id: string };

  const layoutResponse = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${device.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(layoutResponse.statusCode, 200, layoutResponse.body);
  const initialLayout = json(layoutResponse) as {
    status: string;
    effectiveStatus: string;
    bindings: Array<{ portId: string; slotId: string }>;
  };
  assert.equal(initialLayout.status, "needs-mapping");
  assert.equal(initialLayout.effectiveStatus, "needs-mapping");
  assert.deepEqual(initialLayout.bindings, []);

  const viewerToken = await createUserAndLogin(adminToken, {
    username: "layout-viewer",
    password: "layout-viewer-password",
    role: "viewer",
    labRole: "viewer",
  });
  const editorToken = await createUserAndLogin(adminToken, {
    username: "layout-editor",
    password: "layout-editor-password",
    role: "editor",
    labRole: "editor",
  });
  const viewerRead = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${device.id}`,
    headers: authHeaders(viewerToken),
  });
  assert.equal(viewerRead.statusCode, 200);
  const viewerPreview = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/preview`,
    headers: authHeaders(viewerToken),
    payload: { templateId: "generic-auto-v1" },
  });
  assert.equal(viewerPreview.statusCode, 403);

  const previewResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/preview`,
    headers: authHeaders(editorToken),
    payload: { templateId: "generic-auto-v1" },
  });
  assert.equal(previewResponse.statusCode, 200, previewResponse.body);
  const preview = json(previewResponse) as {
    templateId: string;
    portFingerprint: string;
    bindings: Array<{ portId: string; slotId: string }>;
  };

  const thirdPort = await createPort(adminToken, device.id, "NIC 3", "rear");
  const staleApply = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/apply`,
    headers: authHeaders(editorToken),
    payload: preview,
  });
  assert.equal(staleApply.statusCode, 409);
  assert.equal(json(staleApply).code, "PHYSICAL_LAYOUT_STALE_PREVIEW");

  const freshPreviewResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/preview`,
    headers: authHeaders(editorToken),
    payload: { templateId: "generic-auto-v1" },
  });
  const freshPreview = json(freshPreviewResponse) as typeof preview;
  assert.deepEqual(
    freshPreview.bindings.map((binding) => binding.portId).sort(),
    [firstPort.id, secondPort.id, thirdPort.id].sort(),
  );
  const applyResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/apply`,
    headers: authHeaders(editorToken),
    payload: freshPreview,
  });
  assert.equal(applyResponse.statusCode, 200, applyResponse.body);
  const appliedBindings = (
    json(applyResponse) as {
      bindings: Array<{ portId: string; slotId: string }>;
    }
  ).bindings;

  const addedPort = await createPort(adminToken, device.id, "NIC 4", "rear");
  const needsMappingResponse = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${device.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(needsMappingResponse.statusCode, 200, needsMappingResponse.body);
  assert.equal(json(needsMappingResponse).effectiveStatus, "needs-mapping");
  assert.deepEqual(json(needsMappingResponse).bindings, appliedBindings);

  const removeAddedPort = await app.inject({
    method: "DELETE",
    url: `/api/ports/${addedPort.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(removeAddedPort.statusCode, 204, removeAddedPort.body);
  const reconciledResponse = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${device.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(reconciledResponse.statusCode, 200, reconciledResponse.body);
  assert.equal(json(reconciledResponse).effectiveStatus, "generic-default");
  assert.deepEqual(json(reconciledResponse).bindings, appliedBindings);

  assert.deepEqual(
    (
      db
        .prepare("SELECT id FROM ports WHERE deviceId = ? ORDER BY id")
        .all(device.id) as Array<{ id: string }>
    ).map((row) => row.id),
    [firstPort.id, secondPort.id, thirdPort.id, virtualPort.id].sort(),
  );
  assert.deepEqual(
    db
      .prepare("SELECT id, fromPortId, toPortId FROM portLinks WHERE id = ?")
      .get(link.id),
    { id: link.id, fromPortId: firstPort.id, toPortId: peerPort.id },
  );
  assert.ok(
    db
      .prepare(
        "SELECT id FROM auditLog WHERE action = 'physical-layout.apply' AND entityId = ?",
      )
      .get(device.id),
  );
});

test("physical layout reads and previews never persist compatibility fallbacks", async () => {
  const adminToken = await bootstrapAdmin();
  const viewerToken = await createUserAndLogin(adminToken, {
    username: "pure-layout-viewer",
    password: "pure-layout-viewer-password",
    role: "viewer",
    labRole: "viewer",
  });
  const device = await createDevice(adminToken, "pure-layout-read");
  db.prepare("DELETE FROM devicePhysicalLayouts WHERE deviceId = ?").run(
    device.id,
  );
  const beforeAuditCount = (
    db.prepare("SELECT COUNT(*) AS count FROM auditLog").get() as {
      count: number;
    }
  ).count;

  const getResponse = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${device.id}`,
    headers: authHeaders(viewerToken),
  });
  assert.equal(getResponse.statusCode, 200, getResponse.body);
  assert.equal(json(getResponse).sourceTemplateId, "generic-auto-v1");

  const previewResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/preview`,
    headers: authHeaders(adminToken),
    payload: { templateId: "generic-auto-v1" },
  });
  assert.equal(previewResponse.statusCode, 200, previewResponse.body);
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM devicePhysicalLayouts WHERE deviceId = ?",
        )
        .get(device.id) as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS count FROM auditLog").get() as {
        count: number;
      }
    ).count,
    beforeAuditCount,
  );

  await createPort(adminToken, device.id, "NIC 1", "rear");
  db.prepare("UPDATE ports SET kind = 'power' WHERE deviceId = ?").run(
    device.id,
  );
  const beforePureReads = {
    layouts: db
      .prepare("SELECT * FROM devicePhysicalLayouts ORDER BY deviceId")
      .all(),
    ports: db.prepare("SELECT * FROM ports ORDER BY id").all(),
    links: db.prepare("SELECT * FROM portLinks ORDER BY id").all(),
    audit: db.prepare("SELECT * FROM auditLog ORDER BY id").all(),
  };

  const staleGetResponse = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${device.id}`,
    headers: authHeaders(viewerToken),
  });
  assert.equal(staleGetResponse.statusCode, 200, staleGetResponse.body);
  assert.equal(json(staleGetResponse).effectiveStatus, "needs-mapping");
  const stalePreviewResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/preview`,
    headers: authHeaders(adminToken),
    payload: { templateId: "generic-auto-v1" },
  });
  assert.equal(
    stalePreviewResponse.statusCode,
    200,
    stalePreviewResponse.body,
  );
  assert.deepEqual(
    {
      layouts: db
        .prepare("SELECT * FROM devicePhysicalLayouts ORDER BY deviceId")
        .all(),
      ports: db.prepare("SELECT * FROM ports ORDER BY id").all(),
      links: db.prepare("SELECT * FROM portLinks ORDER BY id").all(),
      audit: db.prepare("SELECT * FROM auditLog ORDER BY id").all(),
    },
    beforePureReads,
  );
});

test("approved physical ports follow all existing canonical port positions", async () => {
  const adminToken = await bootstrapAdmin();
  const template = sixPortServerTemplate();
  const createTemplateResponse = await app.inject({
    method: "POST",
    url: "/api/hardware-templates",
    headers: authHeaders(adminToken),
    payload: template,
  });
  assert.equal(createTemplateResponse.statusCode, 201, createTemplateResponse.body);
  const device = await createDevice(adminToken, "logical-port-ordering");
  const logicalPort = await createPort(
    adminToken,
    device.id,
    "bond0",
    "front",
    "virtual",
  );
  const previewResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/preview`,
    headers: authHeaders(adminToken),
    payload: { templateId: template.id },
  });
  assert.equal(previewResponse.statusCode, 200, previewResponse.body);
  const preview = json(previewResponse) as {
    portsToCreate: Array<{ slotId: string; position: number }>;
  };
  assert.equal(preview.portsToCreate[0]?.position, 2);
  const applyResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/apply`,
    headers: authHeaders(adminToken),
    payload: {
      ...json(previewResponse),
      approvedPortSlotIds: [preview.portsToCreate[0]!.slotId],
    },
  });
  assert.equal(applyResponse.statusCode, 200, applyResponse.body);
  assert.deepEqual(
    db
      .prepare("SELECT id, position FROM ports WHERE deviceId = ? ORDER BY position")
      .all(device.id),
    [
      { id: logicalPort.id, position: 1 },
      {
        id: (json(applyResponse).createdPortIds as string[])[0],
        position: 2,
      },
    ],
  );
});

test("original six-port templates retain exact slots after their source template is deleted", async () => {
  const adminToken = await bootstrapAdmin();
  const viewerToken = await createUserAndLogin(adminToken, {
    username: "template-viewer",
    password: "template-viewer-password",
    role: "viewer",
    labRole: "viewer",
  });
  const template = sixPortServerTemplate();

  const viewerCreate = await app.inject({
    method: "POST",
    url: "/api/hardware-templates",
    headers: authHeaders(viewerToken),
    payload: template,
  });
  assert.equal(viewerCreate.statusCode, 403);

  const unsafeTemplate = structuredClone(template);
  unsafeTemplate.id = "unsafe-template";
  unsafeTemplate.name = "Unsafe template";
  (
    unsafeTemplate.rear.elements as unknown as Array<Record<string, unknown>>
  ).push({
    kind: "label",
    id: "unsafe-label",
    x: 10,
    y: 10,
    text: "<script>alert(1)</script>",
  });
  const unsafeCreate = await app.inject({
    method: "POST",
    url: "/api/hardware-templates",
    headers: authHeaders(adminToken),
    payload: unsafeTemplate,
  });
  assert.equal(unsafeCreate.statusCode, 400);

  const unsafeUrlTemplate = structuredClone(template);
  unsafeUrlTemplate.id = "unsafe-url-template";
  unsafeUrlTemplate.name = "Unsafe URL template";
  (
    unsafeUrlTemplate as unknown as {
      portBlueprints: Array<Record<string, unknown>>;
    }
  ).portBlueprints = [{ url: "https://example.invalid/faceplate.svg" }];
  const unsafeUrlCreate = await app.inject({
    method: "POST",
    url: "/api/hardware-templates",
    headers: authHeaders(adminToken),
    payload: unsafeUrlTemplate,
  });
  assert.equal(unsafeUrlCreate.statusCode, 400);

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/hardware-templates",
    headers: authHeaders(adminToken),
    payload: template,
  });
  assert.equal(createResponse.statusCode, 201, createResponse.body);
  const portCreationDevice = await createDevice(
    adminToken,
    "approved-port-creation-server",
  );
  const creationPreviewResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${portCreationDevice.id}/preview`,
    headers: authHeaders(adminToken),
    payload: { templateId: template.id },
  });
  const creationPreview = json(creationPreviewResponse) as {
    templateId: string;
    portFingerprint: string;
    bindings: Array<{ portId: string; slotId: string }>;
    portsToCreate: Array<{ slotId: string }>;
  };
  assert.equal(creationPreview.portsToCreate.length, 6);
  const approvedCreation = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${portCreationDevice.id}/apply`,
    headers: authHeaders(adminToken),
    payload: {
      ...creationPreview,
      approvedPortSlotIds: [creationPreview.portsToCreate[0].slotId],
    },
  });
  assert.equal(approvedCreation.statusCode, 200, approvedCreation.body);
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM ports WHERE deviceId = ?")
        .get(portCreationDevice.id) as { count: number }
    ).count,
    1,
  );
  const defaultResponse = await app.inject({
    method: "PUT",
    url: "/api/hardware-templates/defaults/server",
    headers: authHeaders(adminToken),
    payload: { templateId: template.id },
  });
  assert.equal(defaultResponse.statusCode, 200, defaultResponse.body);
  const device = await createDevice(adminToken, "six-port-server");
  const ports = [];
  for (let index = 1; index <= 6; index += 1) {
    ports.push(await createPort(adminToken, device.id, `NIC ${index}`, "rear"));
  }
  const defaultLayoutResponse = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${device.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(
    defaultLayoutResponse.statusCode,
    200,
    defaultLayoutResponse.body,
  );
  assert.equal(json(defaultLayoutResponse).sourceTemplateId, template.id);
  assert.equal(json(defaultLayoutResponse).status, "needs-mapping");
  const previewResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/preview`,
    headers: authHeaders(adminToken),
    payload: { templateId: template.id },
  });
  assert.equal(previewResponse.statusCode, 200, previewResponse.body);
  const preview = json(previewResponse) as {
    templateId: string;
    portFingerprint: string;
    bindings: Array<{ portId: string; slotId: string }>;
    snapshot: { portSlots: Array<{ id: string; x: number; face: string }> };
  };
  assert.equal(preview.bindings.length, 6);
  assert.deepEqual(
    preview.snapshot.portSlots.map((slot) => slot.x),
    [90, 150, 430, 490, 780, 840],
  );
  assert.ok(preview.snapshot.portSlots.every((slot) => slot.face === "rear"));

  const applyResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/apply`,
    headers: authHeaders(adminToken),
    payload: preview,
  });
  assert.equal(applyResponse.statusCode, 200, applyResponse.body);
  const deleteResponse = await app.inject({
    method: "DELETE",
    url: `/api/hardware-templates/${template.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(deleteResponse.statusCode, 204);
  assert.ok(
    db
      .prepare(
        "SELECT id FROM auditLog WHERE action = 'hardware-template.delete' AND entityId = ?",
      )
      .get(template.id),
  );
  const layoutResponse = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${device.id}`,
    headers: authHeaders(adminToken),
  });
  const layout = json(layoutResponse) as {
    status: string;
    sourceTemplateId: string;
    bindings: Array<{ portId: string }>;
    snapshot: { portSlots: Array<{ x: number }> };
  };
  assert.equal(layout.status, "accurate");
  assert.equal(layout.sourceTemplateId, template.id);
  assert.equal(layout.bindings.length, ports.length);
  assert.deepEqual(
    layout.snapshot.portSlots.map((slot) => slot.x),
    [90, 150, 430, 490, 780, 840],
  );

  const exportResponse = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: authHeaders(adminToken),
  });
  assert.equal(exportResponse.statusCode, 200, exportResponse.body);
  const restoreResponse = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers: authHeaders(adminToken),
    payload: json(exportResponse),
  });
  assert.equal(restoreResponse.statusCode, 200, restoreResponse.body);
  const restoredLayout = db
    .prepare(
      "SELECT sourceTemplateId, status, snapshot, bindings FROM devicePhysicalLayouts WHERE deviceId = ?",
    )
    .get(device.id) as {
    sourceTemplateId: string;
    status: string;
    snapshot: string;
    bindings: string;
  };
  assert.equal(restoredLayout.sourceTemplateId, template.id);
  assert.equal(restoredLayout.status, "accurate");
  assert.deepEqual(
    JSON.parse(restoredLayout.snapshot).portSlots.map(
      (slot: { x: number }) => slot.x,
    ),
    [90, 150, 430, 490, 780, 840],
  );
  assert.equal(JSON.parse(restoredLayout.bindings).length, 6);
  assert.equal(
    db
      .prepare("SELECT id FROM hardwareTemplates WHERE id = ?")
      .get(template.id),
    undefined,
  );
});

test("hardware templates and defaults follow the complete device type lineage", async () => {
  const adminToken = await bootstrapAdmin();
  for (const definition of [
    { id: "mini_server", label: "Mini server", parentType: "server" },
    {
      id: "custom_enclosure",
      label: "Custom enclosure",
      parentType: "storage_enclosure",
    },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/device-types",
      headers: authHeaders(adminToken),
      payload: definition,
    });
    assert.equal(response.statusCode, 201, response.body);
  }

  const parentTemplate = sixPortServerTemplate();
  const childTemplate = {
    ...sixPortServerTemplate(),
    id: "mini-server-override-v1",
    name: "Mini server override",
  };
  const enclosureTemplate = {
    ...sixPortServerTemplate(),
    id: "storage-enclosure-v1",
    name: "Storage enclosure",
    category: "storage",
    deviceTypes: ["storage_enclosure"],
  };
  for (const template of [parentTemplate, childTemplate, enclosureTemplate]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/hardware-templates",
      headers: authHeaders(adminToken),
      payload: template,
    });
    assert.equal(response.statusCode, 201, response.body);
  }

  const miniServer = await createDevice(
    adminToken,
    "inherited-template-server",
    "mini_server",
  );
  const compatiblePreview = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${miniServer.id}/preview`,
    headers: authHeaders(adminToken),
    payload: { templateId: parentTemplate.id },
  });
  assert.equal(compatiblePreview.statusCode, 200, compatiblePreview.body);
  const incompatiblePreview = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${miniServer.id}/preview`,
    headers: authHeaders(adminToken),
    payload: { templateId: enclosureTemplate.id },
  });
  assert.equal(incompatiblePreview.statusCode, 400, incompatiblePreview.body);

  const parentDefault = await app.inject({
    method: "PUT",
    url: "/api/hardware-templates/defaults/server",
    headers: authHeaders(adminToken),
    payload: { templateId: parentTemplate.id },
  });
  assert.equal(parentDefault.statusCode, 200, parentDefault.body);
  const inheritedDevice = await createDevice(
    adminToken,
    "parent-default-server",
    "mini_server",
  );
  const inheritedLayout = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${inheritedDevice.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(inheritedLayout.statusCode, 200, inheritedLayout.body);
  assert.equal(json(inheritedLayout).sourceTemplateId, parentTemplate.id);

  const childDefault = await app.inject({
    method: "PUT",
    url: "/api/hardware-templates/defaults/mini_server",
    headers: authHeaders(adminToken),
    payload: { templateId: childTemplate.id },
  });
  assert.equal(childDefault.statusCode, 200, childDefault.body);
  const overriddenDevice = await createDevice(
    adminToken,
    "child-default-server",
    "mini_server",
  );
  const overriddenLayout = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${overriddenDevice.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(overriddenLayout.statusCode, 200, overriddenLayout.body);
  assert.equal(json(overriddenLayout).sourceTemplateId, childTemplate.id);

  const resetDefault = await app.inject({
    method: "DELETE",
    url: "/api/hardware-templates/defaults/mini_server",
    headers: authHeaders(adminToken),
  });
  assert.equal(resetDefault.statusCode, 204, resetDefault.body);
  const fallbackDevice = await createDevice(
    adminToken,
    "fallback-default-server",
    "mini_server",
  );
  const fallbackLayout = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${fallbackDevice.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(fallbackLayout.statusCode, 200, fallbackLayout.body);
  assert.equal(json(fallbackLayout).sourceTemplateId, parentTemplate.id);

  const enclosureDefault = await app.inject({
    method: "PUT",
    url: "/api/hardware-templates/defaults/storage_enclosure",
    headers: authHeaders(adminToken),
    payload: { templateId: enclosureTemplate.id },
  });
  assert.equal(enclosureDefault.statusCode, 200, enclosureDefault.body);
  const nestedDevice = await createDevice(
    adminToken,
    "nested-default-enclosure",
    "custom_enclosure",
  );
  const nestedLayout = await app.inject({
    method: "GET",
    url: `/api/physical-layouts/${nestedDevice.id}`,
    headers: authHeaders(adminToken),
  });
  assert.equal(nestedLayout.statusCode, 200, nestedLayout.body);
  assert.equal(json(nestedLayout).sourceTemplateId, enclosureTemplate.id);
});

test("module variants and device-owned custom layouts preserve exact linked-port bindings", async () => {
  const adminToken = await bootstrapAdmin();
  const template = moduleServerTemplate();
  const createTemplateResponse = await app.inject({
    method: "POST",
    url: "/api/hardware-templates",
    headers: authHeaders(adminToken),
    payload: template,
  });
  assert.equal(
    createTemplateResponse.statusCode,
    201,
    createTemplateResponse.body,
  );

  const device = await createDevice(adminToken, "module-server");
  const peer = await createDevice(adminToken, "module-peer", "switch");
  const firstPort = await createPort(adminToken, device.id, "NIC 1", "rear");
  const secondPort = await createPort(adminToken, device.id, "NIC 2", "rear");
  const peerPort = await createPort(adminToken, peer.id, "Port 1", "front");
  const linkResponse = await app.inject({
    method: "POST",
    url: "/api/port-links",
    headers: authHeaders(adminToken),
    payload: { fromPortId: firstPort.id, toPortId: peerPort.id },
  });
  assert.equal(linkResponse.statusCode, 201, linkResponse.body);

  const previewResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/preview`,
    headers: authHeaders(adminToken),
    payload: {
      templateId: template.id,
      moduleIds: ["two-port-nic"],
      preserveBindings: true,
    },
  });
  assert.equal(previewResponse.statusCode, 200, previewResponse.body);
  const preview = json(previewResponse) as {
    templateId: string;
    moduleIds: string[];
    portFingerprint: string;
    bindings: Array<{ portId: string; slotId: string }>;
    linkedUnmappedPortIds: string[];
    snapshot: {
      moduleIds: string[];
      portSlots: Array<{ id: string; x: number }>;
      faces: Record<string, { elements: Array<{ id: string }> }>;
    };
  };
  assert.deepEqual(preview.moduleIds, ["two-port-nic"]);
  assert.deepEqual(preview.snapshot.moduleIds, ["two-port-nic"]);
  assert.deepEqual(
    preview.snapshot.portSlots.map((slot) => [slot.id, slot.x]),
    [
      ["module-nic-1", 650],
      ["module-nic-2", 710],
    ],
  );
  assert.ok(
    preview.snapshot.faces.rear.elements.some(
      (element) => element.id === "two-port-nic-panel",
    ),
  );
  assert.deepEqual(preview.linkedUnmappedPortIds, []);

  const applyResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/apply`,
    headers: authHeaders(adminToken),
    payload: preview,
  });
  assert.equal(applyResponse.statusCode, 200, applyResponse.body);
  const applied = json(applyResponse) as {
    bindings: Array<{ portId: string; slotId: string }>;
    snapshot: typeof preview.snapshot;
  };

  const removalPreviewResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/preview`,
    headers: authHeaders(adminToken),
    payload: {
      templateId: template.id,
      moduleIds: [],
      preserveBindings: true,
    },
  });
  assert.equal(
    removalPreviewResponse.statusCode,
    200,
    removalPreviewResponse.body,
  );
  const removalPreview = json(removalPreviewResponse) as {
    linkedUnmappedPortIds: string[];
    comparison: { removedSlotIds: string[] };
  };
  assert.deepEqual(removalPreview.linkedUnmappedPortIds, [firstPort.id]);
  assert.deepEqual(removalPreview.comparison.removedSlotIds.sort(), [
    "module-nic-1",
    "module-nic-2",
  ]);
  const blockedApplyResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/apply`,
    headers: authHeaders(adminToken),
    payload: json(removalPreviewResponse),
  });
  assert.equal(blockedApplyResponse.statusCode, 422, blockedApplyResponse.body);
  assert.equal(
    json(blockedApplyResponse).code,
    "PHYSICAL_LAYOUT_LINKED_PORT_UNMAPPED",
  );

  const unpreservedRemovalPreviewResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/preview`,
    headers: authHeaders(adminToken),
    payload: { templateId: template.id, moduleIds: [] },
  });
  assert.equal(
    unpreservedRemovalPreviewResponse.statusCode,
    200,
    unpreservedRemovalPreviewResponse.body,
  );
  assert.deepEqual(
    json(unpreservedRemovalPreviewResponse).linkedUnmappedPortIds,
    [firstPort.id],
  );
  const unpreservedBlockedApplyResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/apply`,
    headers: authHeaders(adminToken),
    payload: json(unpreservedRemovalPreviewResponse),
  });
  assert.equal(
    unpreservedBlockedApplyResponse.statusCode,
    422,
    unpreservedBlockedApplyResponse.body,
  );

  const customSnapshot = structuredClone(applied.snapshot);
  customSnapshot.portSlots[0].x = 612;
  const customPreviewResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/preview`,
    headers: authHeaders(adminToken),
    payload: {
      customSnapshot,
      bindings: applied.bindings,
      preserveBindings: true,
    },
  });
  assert.equal(
    customPreviewResponse.statusCode,
    200,
    customPreviewResponse.body,
  );
  const customPreview = json(customPreviewResponse);
  const customApplyResponse = await app.inject({
    method: "POST",
    url: `/api/physical-layouts/${device.id}/apply`,
    headers: authHeaders(adminToken),
    payload: { ...customPreview, customSnapshot },
  });
  assert.equal(customApplyResponse.statusCode, 200, customApplyResponse.body);
  assert.equal(json(customApplyResponse).sourceTemplateId, "device-custom-v1");
  assert.equal(json(customApplyResponse).snapshot.portSlots[0].x, 612);
  assert.deepEqual(json(customApplyResponse).bindings, applied.bindings);
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM ports WHERE deviceId = ?")
        .get(device.id) as {
        count: number;
      }
    ).count,
    2,
  );
  assert.ok(
    db
      .prepare("SELECT id FROM portLinks WHERE fromPortId = ? OR toPortId = ?")
      .get(firstPort.id, firstPort.id),
  );
  assert.ok(secondPort.id);
});

test("bulk hardware profile assignment is permission-aware, atomic, and keeps unique inventory IDs", async () => {
  const adminToken = await bootstrapAdmin();
  const viewerToken = await createUserAndLogin(adminToken, {
    username: "bulk-layout-viewer",
    password: "bulk-layout-viewer-password",
    role: "viewer",
    labRole: "viewer",
  });
  const template = sixPortServerTemplate();
  const createTemplateResponse = await app.inject({
    method: "POST",
    url: "/api/hardware-templates",
    headers: authHeaders(adminToken),
    payload: template,
  });
  assert.equal(
    createTemplateResponse.statusCode,
    201,
    createTemplateResponse.body,
  );
  const firstDevice = await createDevice(adminToken, "bulk-layout-a");
  const secondDevice = await createDevice(adminToken, "bulk-layout-b");
  const firstPort = await createPort(
    adminToken,
    firstDevice.id,
    "NIC 1",
    "rear",
  );
  const secondPort = await createPort(
    adminToken,
    secondDevice.id,
    "NIC 1",
    "rear",
  );

  const viewerPreviewResponse = await app.inject({
    method: "POST",
    url: "/api/physical-layouts/bulk-preview",
    headers: authHeaders(viewerToken),
    payload: {
      deviceIds: [firstDevice.id, secondDevice.id],
      templateId: template.id,
    },
  });
  assert.equal(viewerPreviewResponse.statusCode, 403);

  const previewResponse = await app.inject({
    method: "POST",
    url: "/api/physical-layouts/bulk-preview",
    headers: authHeaders(adminToken),
    payload: {
      deviceIds: [firstDevice.id, secondDevice.id],
      templateId: template.id,
    },
  });
  assert.equal(previewResponse.statusCode, 200, previewResponse.body);
  const previews = json(previewResponse).previews as Array<{
    deviceId: string;
    bindings: Array<{ portId: string }>;
  }>;
  assert.deepEqual(
    previews.map((preview) => preview.bindings[0].portId),
    [firstPort.id, secondPort.id],
  );

  const applyResponse = await app.inject({
    method: "POST",
    url: "/api/physical-layouts/bulk-apply",
    headers: authHeaders(adminToken),
    payload: { previews },
  });
  assert.equal(applyResponse.statusCode, 200, applyResponse.body);
  assert.equal(json(applyResponse).updated, 2);
  assert.deepEqual(
    (
      db
        .prepare("SELECT id FROM ports WHERE deviceId IN (?, ?) ORDER BY id")
        .all(firstDevice.id, secondDevice.id) as Array<{ id: string }>
    ).map((row) => row.id),
    [firstPort.id, secondPort.id].sort(),
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM auditLog WHERE action = 'physical-layout.bulk.apply'",
        )
        .get() as { count: number }
    ).count,
    2,
  );
});

test("schema 45 migration preserves inventory and cabling while creating legacy layouts", () => {
  const legacyPath = path.join(tempDir, "physical-layout-source-v45.db");
  initializeDatabase(legacyPath);
  const legacy = new Database(legacyPath);
  legacy.exec(`
    INSERT INTO labs (id, name) VALUES ('lab_layout_v45', 'Layout migration');
    INSERT INTO racks (id, labId, name, totalU) VALUES ('rack_layout_v45', 'lab_layout_v45', 'Rack A', 42);
    INSERT INTO devices (
      id, labId, rackId, hostname, deviceType, status, placement,
      startU, heightU, face, rackSlot
    ) VALUES
      ('device_layout_v45', 'lab_layout_v45', 'rack_layout_v45', 'legacy-server', 'server', 'online', 'rack', 10, 2, 'rear', 'right'),
      ('peer_layout_v45', 'lab_layout_v45', NULL, 'legacy-switch', 'switch', 'online', 'room', NULL, NULL, NULL, 'full');
    INSERT INTO ports (id, deviceId, name, position, kind, linkState, face)
    VALUES
      ('port_layout_v45', 'device_layout_v45', 'NIC 1', 1, 'rj45', 'up', 'rear'),
      ('peer_port_layout_v45', 'peer_layout_v45', 'Port 1', 1, 'rj45', 'up', 'front');
    INSERT INTO portLinks (id, fromPortId, toPortId, cableType, color)
    VALUES ('link_layout_v45', 'port_layout_v45', 'peer_port_layout_v45', 'cat6a', '#22d3ee');

    DROP TABLE devicePhysicalLayouts;
    DROP TABLE hardwareTemplateDefaults;
    DROP TABLE hardwareTemplates;
    ALTER TABLE devices DROP COLUMN rackMountKind;
    ALTER TABLE devices DROP COLUMN rackColumn;
    ALTER TABLE devices DROP COLUMN rackColumnSpan;
    ALTER TABLE devices DROP COLUMN shelfX;
    ALTER TABLE devices DROP COLUMN shelfY;
    ALTER TABLE devices DROP COLUMN shelfWidth;
    ALTER TABLE devices DROP COLUMN shelfHeight;
    ALTER TABLE devices DROP COLUMN shelfOrientation;
    ALTER TABLE devices DROP COLUMN rackSide;
    ALTER TABLE racks DROP COLUMN studioX;
    ALTER TABLE racks DROP COLUMN studioY;
    ALTER TABLE portLinks DROP COLUMN label;
    ALTER TABLE portLinks DROP COLUMN visible;
    ALTER TABLE portLinks DROP COLUMN routeWaypoints;
    UPDATE schemaVersion SET version = 45, updatedAt = '2026-08-30T00:00:00.000Z' WHERE id = 1;
  `);
  const before = {
    device: legacy
      .prepare(
        "SELECT id, labId, rackId, hostname, startU, heightU, face, rackSlot FROM devices WHERE id = 'device_layout_v45'",
      )
      .get(),
    ports: legacy.prepare("SELECT * FROM ports ORDER BY id").all(),
    links: legacy
      .prepare(
        "SELECT id, fromPortId, toPortId, cableType, cableLength, color, notes FROM portLinks ORDER BY id",
      )
      .all(),
  };
  legacy.close();

  initializeDatabase(legacyPath);
  const migrated = new Database(legacyPath, { readonly: true });
  assert.deepEqual(
    migrated
      .prepare(
        "SELECT id, labId, rackId, hostname, startU, heightU, face, rackSlot FROM devices WHERE id = 'device_layout_v45'",
      )
      .get(),
    before.device,
  );
  assert.deepEqual(
    migrated.prepare("SELECT * FROM ports ORDER BY id").all(),
    before.ports,
  );
  assert.deepEqual(
    migrated
      .prepare(
        "SELECT id, fromPortId, toPortId, cableType, cableLength, color, notes FROM portLinks ORDER BY id",
      )
      .all(),
    before.links,
  );
  assert.deepEqual(
    migrated
      .prepare(
        "SELECT label, visible, routeWaypoints FROM portLinks WHERE id = 'link_layout_v45'",
      )
      .get(),
    { label: null, visible: 1, routeWaypoints: "[]" },
  );
  assert.deepEqual(
    migrated
      .prepare(
        "SELECT rackColumn, rackColumnSpan FROM devices WHERE id = 'device_layout_v45'",
      )
      .get(),
    { rackColumn: 6, rackColumnSpan: 6 },
  );
  const layout = migrated
    .prepare(
      "SELECT status, snapshot, bindings FROM devicePhysicalLayouts WHERE deviceId = 'device_layout_v45'",
    )
    .get() as { status: string; snapshot: string; bindings: string };
  assert.equal(layout.status, "legacy-default");
  assert.equal(JSON.parse(layout.snapshot).sourceTemplateId, "legacy-auto-v1");
  assert.deepEqual(JSON.parse(layout.bindings), [
    { portId: "port_layout_v45", slotId: "slot:port_layout_v45" },
  ]);
  assert.equal(
    (
      migrated
        .prepare("SELECT version FROM schemaVersion WHERE id = 1")
        .get() as {
        version: number;
      }
    ).version,
    CURRENT_SCHEMA_VERSION,
  );
  migrated.close();
});

test("schema 46 migration adds nullable shared room-canvas coordinates without changing racks", () => {
  const legacyPath = path.join(tempDir, "rack-studio-source-v46.db");
  initializeDatabase(legacyPath);
  const legacy = new Database(legacyPath);
  legacy.exec(`
    INSERT INTO labs (id, name) VALUES ('lab_studio_v46', 'Studio migration');
    INSERT INTO rooms (id, labId, name) VALUES ('room_studio_v46', 'lab_studio_v46', 'Server room');
    INSERT INTO racks (id, labId, name, totalU, roomId)
    VALUES ('rack_studio_v46', 'lab_studio_v46', 'Rack A', 42, 'room_studio_v46');
    INSERT INTO devices (
      id, labId, rackId, hostname, deviceType, status, placement,
      startU, heightU, face, rackSlot, rackMountKind, rackColumn, rackColumnSpan
    ) VALUES (
      'shelf_studio_v46', 'lab_studio_v46', 'rack_studio_v46', 'Shelf',
      'rack_shelf', 'online', 'rack', 10, 2, 'front', 'full', 'direct', 0, 12
    );
    INSERT INTO devices (
      id, labId, rackId, hostname, deviceType, status, placement,
      parentDeviceId, heightU, face, rackSlot, rackMountKind
    ) VALUES (
      'child_studio_v46', 'lab_studio_v46', 'rack_studio_v46', 'Shelf child',
      'server', 'online', 'shelf', 'shelf_studio_v46', 1, 'front', 'full', 'shelf'
    );
    ALTER TABLE racks DROP COLUMN studioX;
    ALTER TABLE racks DROP COLUMN studioY;
    ALTER TABLE portLinks DROP COLUMN label;
    ALTER TABLE portLinks DROP COLUMN visible;
    ALTER TABLE portLinks DROP COLUMN routeWaypoints;
    UPDATE schemaVersion SET version = 46, updatedAt = '2026-08-31T00:00:00.000Z' WHERE id = 1;
  `);
  legacy.close();

  initializeDatabase(legacyPath);
  const migrated = new Database(legacyPath, { readonly: true });
  assert.deepEqual(
    migrated
      .prepare(
        "SELECT id, labId, name, totalU, roomId, studioX, studioY FROM racks WHERE id = 'rack_studio_v46'",
      )
      .get(),
    {
      id: "rack_studio_v46",
      labId: "lab_studio_v46",
      name: "Rack A",
      totalU: 42,
      roomId: "room_studio_v46",
      studioX: null,
      studioY: null,
    },
  );
  assert.equal(
    (
      migrated
        .prepare("SELECT version FROM schemaVersion WHERE id = 1")
        .get() as {
        version: number;
      }
    ).version,
    CURRENT_SCHEMA_VERSION,
  );
  assert.deepEqual(
    migrated
      .prepare(
        "SELECT shelfX, shelfY, shelfWidth, shelfHeight, shelfOrientation FROM devices WHERE id = 'child_studio_v46'",
      )
      .get(),
    {
      shelfX: 20,
      shelfY: 20,
      shelfWidth: 176,
      shelfHeight: 176,
      shelfOrientation: 0,
    },
  );
  migrated.close();
});

test("schema 48 migration adds cable inspection defaults without changing inventory or links", () => {
  const legacyPath = path.join(tempDir, "cable-studio-source-v47.db");
  initializeDatabase(legacyPath);
  const legacy = new Database(legacyPath);
  legacy.exec(`
    INSERT INTO labs (id, name) VALUES ('lab_cable_v47', 'Cable migration');
    INSERT INTO devices (id, labId, hostname, deviceType, status, placement)
    VALUES
      ('device_cable_a', 'lab_cable_v47', 'cable-a', 'server', 'online', 'room'),
      ('device_cable_b', 'lab_cable_v47', 'cable-b', 'switch', 'online', 'room');
    INSERT INTO ports (id, deviceId, name, position, kind, linkState, face)
    VALUES
      ('port_cable_a', 'device_cable_a', 'NIC 1', 1, 'rj45', 'up', 'rear'),
      ('port_cable_b', 'device_cable_b', 'Port 1', 1, 'rj45', 'up', 'rear');
    INSERT INTO portLinks (
      id, fromPortId, toPortId, cableType, cableLength, color, notes
    ) VALUES (
      'link_cable_v47', 'port_cable_a', 'port_cable_b',
      'Cat6A', '3m', '#22d3ee', 'Existing documented cable'
    );
    ALTER TABLE portLinks DROP COLUMN label;
    ALTER TABLE portLinks DROP COLUMN visible;
    ALTER TABLE portLinks DROP COLUMN routeWaypoints;
    UPDATE schemaVersion
    SET version = 47, updatedAt = '2026-08-31T00:00:00.000Z'
    WHERE id = 1;
  `);
  const beforeDevices = legacy.prepare("SELECT * FROM devices ORDER BY id").all();
  const beforePorts = legacy.prepare("SELECT * FROM ports ORDER BY id").all();
  const beforeLink = legacy
    .prepare("SELECT * FROM portLinks WHERE id = 'link_cable_v47'")
    .get();
  legacy.close();

  initializeDatabase(legacyPath);
  const migrated = new Database(legacyPath, { readonly: true });
  assert.deepEqual(
    migrated.prepare("SELECT * FROM devices ORDER BY id").all(),
    beforeDevices,
  );
  assert.deepEqual(
    migrated.prepare("SELECT * FROM ports ORDER BY id").all(),
    beforePorts,
  );
  assert.deepEqual(
    migrated
      .prepare(
        `SELECT id, fromPortId, toPortId, cableType, cableLength, color, notes
         FROM portLinks WHERE id = 'link_cable_v47'`,
      )
      .get(),
    beforeLink,
  );
  assert.deepEqual(
    migrated
      .prepare(
        "SELECT label, visible, routeWaypoints FROM portLinks WHERE id = 'link_cable_v47'",
      )
      .get(),
    { label: null, visible: 1, routeWaypoints: "[]" },
  );
  assert.equal(
    (
      migrated
        .prepare("SELECT version FROM schemaVersion WHERE id = 1")
        .get() as { version: number }
    ).version,
    CURRENT_SCHEMA_VERSION,
  );
  migrated.close();
});

function initializeDatabase(databasePath: string) {
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "await import('./server/db.ts')",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_PATH: databasePath, NODE_ENV: "test" },
      stdio: "pipe",
    },
  );
}

function moduleServerTemplate() {
  const template = sixPortServerTemplate();
  return {
    ...template,
    id: "module-server-v1",
    name: "Original modular server",
    portSlots: [],
    moduleSlots: [
      {
        id: "rear-nic-module",
        face: "rear" as const,
        x: 620,
        y: 90,
        width: 150,
        height: 100,
      },
    ],
    modules: [
      {
        id: "two-port-nic",
        name: "Two-port NIC",
        slotId: "rear-nic-module",
        face: "rear" as const,
        elements: [
          {
            kind: "panel" as const,
            id: "two-port-nic-panel",
            x: 620,
            y: 90,
            width: 150,
            height: 100,
            tone: "light" as const,
          },
        ],
        portSlots: [650, 710].map((x, index) => ({
          id: `module-nic-${index + 1}`,
          face: "rear" as const,
          x,
          y: 125,
          width: 42,
          height: 36,
          rotation: 0 as const,
          connector: "rj45",
          acceptedPortKinds: ["rj45"],
          groupId: "module-nic",
          label: `NIC ${index + 1}`,
        })),
      },
    ],
  };
}

function sixPortServerTemplate() {
  const face = {
    schemaVersion: 1 as const,
    width: 1000 as const,
    height: 300,
    elements: [
      {
        kind: "panel" as const,
        id: "panel",
        x: 20,
        y: 20,
        width: 960,
        height: 260,
        tone: "mid" as const,
      },
    ],
  };
  return {
    schemaVersion: 1 as const,
    id: "six-port-server-v1",
    name: "Original six-port server",
    description:
      "Two rear ports on the left, two in the center, and two on the right.",
    category: "server",
    deviceTypes: ["server"],
    mountDefaults: { kind: "direct" as const, heightU: 2, columnSpan: 12 },
    front: structuredClone(face),
    rear: structuredClone(face),
    portSlots: [90, 150, 430, 490, 780, 840].map((x, index) => ({
      id: `rear-nic-${index + 1}`,
      face: "rear" as const,
      x,
      y: 130,
      width: 42,
      height: 36,
      rotation: 0 as const,
      connector: "rj45",
      acceptedPortKinds: ["rj45"],
      groupId: index < 2 ? "left" : index < 4 ? "center" : "right",
      label: `NIC ${index + 1}`,
    })),
    moduleSlots: [],
    modules: [],
    portBlueprints: [],
    driveBayBlueprints: [],
  };
}

async function bootstrapAdmin() {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      displayName: "Physical Layout Admin",
      password: "super-secret-1",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (json(response) as { token: string }).token;
}

async function createDevice(
  token: string,
  hostname: string,
  deviceType = "server",
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: authHeaders(token),
    payload: {
      labId: "lab_home",
      hostname,
      deviceType,
      status: "online",
      placement: "room",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return json(response) as { id: string };
}

async function createPort(
  token: string,
  deviceId: string,
  name: string,
  face: "front" | "rear",
  kind = "rj45",
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/ports",
    headers: authHeaders(token),
    payload: { deviceId, name, kind, face },
  });
  assert.equal(response.statusCode, 201, response.body);
  return json(response) as { id: string };
}

async function createUserAndLogin(
  adminToken: string,
  input: {
    username: string;
    password: string;
    role: "editor" | "viewer";
    labRole: "editor" | "viewer";
  },
) {
  const createResponse = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: authHeaders(adminToken),
    payload: {
      username: input.username,
      displayName: input.username,
      password: input.password,
      role: input.role,
      labAccess: [{ labId: "lab_home", role: input.labRole }],
    },
  });
  assert.equal(createResponse.statusCode, 201, createResponse.body);
  const loginResponse = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: input.username, password: input.password },
  });
  assert.equal(loginResponse.statusCode, 200, loginResponse.body);
  return (json(loginResponse) as { token: string }).token;
}

function resetDatabase() {
  db.exec(`
    DELETE FROM userSessions;
    DELETE FROM oidcIdentities;
    DELETE FROM userLabAccess;
    DELETE FROM devicePhysicalLayouts;
    DELETE FROM hardwareTemplateDefaults;
    DELETE FROM hardwareTemplates;
    DELETE FROM portLinks;
    DELETE FROM ports;
    DELETE FROM auditLog;
    DELETE FROM devices;
    DELETE FROM racks;
    DELETE FROM rooms;
    DELETE FROM users;
    DELETE FROM labs;
  `);
  setBootstrapState(null);
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function json(response: { body: string }) {
  return JSON.parse(response.body);
}

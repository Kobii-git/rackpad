import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "rackpad-tests-"));
const spaDistDir = path.resolve(process.cwd(), "dist");
const spaIndexFile = path.join(spaDistDir, "index.html");
process.env.DATABASE_PATH = path.join(tempDir, "rackpad-test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";

const { createApp } = await import("../app.js");
const { db } = await import("../db.js");
const { setBootstrapState } = await import("../lib/auth.js");
const { parseIeeeOuiText } = await import("../lib/oui.js");
const { parseArpScanOutput, parseNmapPingScanOutput } =
  await import("../routes/discovery.js");

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

test("bootstrap creates the first admin account and session", async () => {
  const statusRes = await app.inject({
    method: "GET",
    url: "/api/auth/status",
  });
  assert.equal(statusRes.statusCode, 200);
  assert.deepEqual(readJson(statusRes), {
    needsBootstrap: true,
    oidc: { enabled: false, label: "OIDC" },
  });

  const bootstrapRes = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      displayName: "Rack Admin",
      password: "super-secret-1",
    },
  });

  assert.equal(bootstrapRes.statusCode, 201);
  const session = readJson(bootstrapRes) as {
    token: string;
    user: { role: string; username: string };
  };
  assert.equal(session.user.username, "admin");
  assert.equal(session.user.role, "admin");
  assert.ok(session.token);

  const meRes = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: {
      authorization: `Bearer ${session.token}`,
    },
  });

  assert.equal(meRes.statusCode, 200);
  const me = readJson(meRes) as { user: { username: string } };
  assert.equal(me.user.username, "admin");
});

test("non-api app routes serve the SPA index on refresh", async () => {
  ensureSpaIndex();

  const res = await app.inject({
    method: "GET",
    url: "/compute",
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] ?? "", /text\/html/i);
  assert.ok(
    /rackpad spa fallback/i.test(res.body) ||
      /<div id="root"><\/div>/i.test(res.body),
    "expected a SPA index document",
  );
});

test("IEEE OUI parser supports MA-L, MA-M, and MA-S prefixes", () => {
  const entries = parseIeeeOuiText(`
    F0-18-98   (hex)        Apple, Inc.
    F01898     (base 16)    Apple, Inc.
    28D2440    (base 16)    Example MA-M Vendor
    8C1F64012  (base 16)    Example MA-S Vendor
  `);

  assert.equal(entries.f01898, "Apple, Inc.");
  assert.equal(entries["28d2440"], "Example MA-M Vendor");
  assert.equal(entries["8c1f64012"], "Example MA-S Vendor");
});

test("discovery MAC parsers support arp-scan and nmap output", () => {
  const arpScanEntries = parseArpScanOutput(`
    Interface: eth0, type: EN10MB, MAC: 02:42:ac:11:00:02, IPv4: 192.168.1.10
    192.168.1.1     f0:18:98:44:55:66       Apple, Inc.
    192.168.1.20    d8-3a-dd-ab-cd-ef       TP-Link Corporation Limited
  `);
  assert.equal(arpScanEntries.get("192.168.1.1"), "f0:18:98:44:55:66");
  assert.equal(arpScanEntries.get("192.168.1.20"), "d8:3a:dd:ab:cd:ef");

  const nmapEntries = parseNmapPingScanOutput(`
    Nmap scan report for 192.168.1.1
    Host is up (0.0030s latency).
    MAC Address: F0:18:98:44:55:66 (Apple)
    Nmap scan report for printer.local (192.168.1.20)
    Host is up.
    MAC Address: D8:3A:DD:AB:CD:EF (TP-Link)
  `);
  assert.equal(nmapEntries.get("192.168.1.1"), "f0:18:98:44:55:66");
  assert.equal(nmapEntries.get("192.168.1.20"), "d8:3a:dd:ab:cd:ef");
});

test("bootstrap can start with an empty lab or load demo data on demand", async () => {
  const emptyBootstrapRes = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      displayName: "Rack Admin",
      password: "super-secret-1",
      loadDemoData: false,
    },
  });

  assert.equal(emptyBootstrapRes.statusCode, 201);

  const emptyState = {
    labs: db.prepare("SELECT COUNT(*) AS count FROM labs").get() as {
      count: number;
    },
    racks: db.prepare("SELECT COUNT(*) AS count FROM racks").get() as {
      count: number;
    },
    devices: db.prepare("SELECT COUNT(*) AS count FROM devices").get() as {
      count: number;
    },
    vlanRanges: db
      .prepare("SELECT COUNT(*) AS count FROM vlanRanges")
      .get() as { count: number },
  };

  assert.equal(emptyState.labs.count, 1);
  assert.equal(emptyState.racks.count, 0);
  assert.equal(emptyState.devices.count, 0);
  assert.equal(emptyState.vlanRanges.count, 0);

  resetDatabase();

  const demoBootstrapRes = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      displayName: "Rack Admin",
      password: "super-secret-1",
      loadDemoData: true,
    },
  });

  assert.equal(demoBootstrapRes.statusCode, 201);

  const demoState = {
    labs: db.prepare("SELECT COUNT(*) AS count FROM labs").get() as {
      count: number;
    },
    racks: db.prepare("SELECT COUNT(*) AS count FROM racks").get() as {
      count: number;
    },
    devices: db.prepare("SELECT COUNT(*) AS count FROM devices").get() as {
      count: number;
    },
    vlanRanges: db
      .prepare("SELECT COUNT(*) AS count FROM vlanRanges")
      .get() as { count: number },
  };

  assert.ok(demoState.labs.count > 0);
  assert.ok(demoState.racks.count > 0);
  assert.ok(demoState.devices.count > 0);
  assert.ok(demoState.vlanRanges.count > 0);
});

test("viewer accounts are read-only", async () => {
  const adminToken = await bootstrapAdmin();

  const viewerRes = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      username: "viewer1",
      displayName: "Viewer User",
      password: "viewer-password-1",
      role: "viewer",
    },
  });

  assert.equal(viewerRes.statusCode, 201);

  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "viewer1",
      password: "viewer-password-1",
    },
  });

  assert.equal(loginRes.statusCode, 200);
  const viewerToken = (readJson(loginRes) as { token: string }).token;

  const readRes = await app.inject({
    method: "GET",
    url: "/api/racks",
    headers: {
      authorization: `Bearer ${viewerToken}`,
    },
  });
  assert.equal(readRes.statusCode, 200);

  const writeRes = await app.inject({
    method: "POST",
    url: "/api/racks",
    headers: {
      authorization: `Bearer ${viewerToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Should Fail",
      totalU: 42,
    },
  });
  assert.equal(writeRes.statusCode, 403);
  assert.match(writeRes.body, /read-only/i);
});

test("documentation pages and device images can be created", async () => {
  const adminToken = await bootstrapAdmin();

  const docRes = await app.inject({
    method: "POST",
    url: "/api/documentation",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      title: "Rack notes",
      content: "# Rack notes\n\n![rack](data:image/png;base64,iVBORw0KGgo=)",
    },
  });
  assert.equal(docRes.statusCode, 201);
  const doc = readJson(docRes) as { id: string; title: string };
  assert.equal(doc.title, "Rack notes");

  const docsRes = await app.inject({
    method: "GET",
    url: "/api/documentation?labId=lab_home",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(docsRes.statusCode, 200);
  assert.equal((readJson(docsRes) as unknown[]).length, 1);

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "switch-doc-01",
      deviceType: "switch",
      status: "unknown",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const imageRes = await app.inject({
    method: "POST",
    url: "/api/device-images",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      label: "Front view",
      fileName: "front.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      notes: "Rack front reference",
    },
  });
  assert.equal(imageRes.statusCode, 201);

  const imagesRes = await app.inject({
    method: "GET",
    url: `/api/device-images?deviceId=${device.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(imagesRes.statusCode, 200);
  const images = readJson(imagesRes) as Array<{ label: string }>;
  assert.equal(images.length, 1);
  assert.equal(images[0].label, "Front view");
});

test("admin export returns a backup snapshot and blocks viewer access", async () => {
  const adminToken = await bootstrapAdmin();

  const alertSettingsRes = await app.inject({
    method: "PUT",
    url: "/api/admin/alert-settings",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      enabled: true,
      notifyOnDown: true,
      notifyOnRecovery: true,
      repeatWhileOffline: false,
      repeatIntervalMinutes: 60,
      discordWebhookUrl: "https://discord.example/webhook/secret",
      telegramBotToken: "telegram-secret-token",
      telegramChatId: "-1001234567890",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpUsername: "rackpad@example.com",
      smtpPassword: "smtp-secret-password",
      smtpFrom: "rackpad@example.com",
      smtpTo: "ops@example.com",
    },
  });
  assert.equal(alertSettingsRes.statusCode, 200);

  const exportRes = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(exportRes.statusCode, 200);
  assert.match(
    exportRes.headers["content-disposition"] ?? "",
    /rackpad-backup-.*\.json/i,
  );

  const snapshot = readJson(exportRes) as {
    format: string;
    appVersion: string;
    secretsRedacted: boolean;
    data: {
      labs: unknown[];
      users: Array<{ username: string }>;
      userSessions?: unknown[];
    };
  };

  assert.equal(snapshot.format, "rackpad-backup-v1");
  assert.ok(snapshot.appVersion);
  assert.equal(snapshot.secretsRedacted, true);
  assert.equal(snapshot.data.labs.length, 1);
  assert.equal(snapshot.data.users[0]?.username, "admin");
  assert.equal(snapshot.data.userSessions, undefined);

  const alertSettingsRow = (
    snapshot as {
      data: { appSettings?: Array<{ key: string; value: string }> };
    }
  ).data.appSettings?.find((entry) => entry.key === "alertSettings");
  assert.ok(alertSettingsRow);
  const exportedAlertSettings = JSON.parse(alertSettingsRow!.value) as Record<
    string,
    unknown
  >;
  assert.equal(exportedAlertSettings.discordWebhookUrl, null);
  assert.equal(exportedAlertSettings.telegramBotToken, null);
  assert.equal(exportedAlertSettings.smtpPassword, null);
  assert.equal(exportedAlertSettings.smtpHost, "smtp.example.com");

  const viewerRes = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      username: "viewer-export",
      displayName: "Viewer Export",
      password: "viewer-export-1",
      role: "viewer",
    },
  });

  assert.equal(viewerRes.statusCode, 201);

  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "viewer-export",
      password: "viewer-export-1",
    },
  });

  assert.equal(loginRes.statusCode, 200);
  const viewerToken = (readJson(loginRes) as { token: string }).token;

  const forbiddenRes = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: {
      authorization: `Bearer ${viewerToken}`,
    },
  });

  assert.equal(forbiddenRes.statusCode, 403);
  assert.match(forbiddenRes.body, /administrator/i);
});

test("admin restore reloads a backup snapshot and invalidates the previous session", async () => {
  const adminToken = await bootstrapAdmin();

  const templateRes = await app.inject({
    method: "POST",
    url: "/api/ports/templates",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      name: "Custom restore template",
      description: "Template created before backup export.",
      deviceTypes: ["switch"],
      ports: [
        { name: "1", kind: "rj45", speed: "1G", face: "front" },
        { name: "2", kind: "rj45", speed: "1G", face: "front" },
      ],
    },
  });
  assert.equal(templateRes.statusCode, 201);

  const rackRes = await app.inject({
    method: "POST",
    url: "/api/racks",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Exported Rack",
      totalU: 42,
    },
  });
  assert.equal(rackRes.statusCode, 201);

  const exportRes = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(exportRes.statusCode, 200);
  const snapshot = readJson(exportRes) as Record<string, unknown>;

  const postExportRackRes = await app.inject({
    method: "POST",
    url: "/api/racks",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Should disappear",
      totalU: 42,
    },
  });
  assert.equal(postExportRackRes.statusCode, 201);

  const restoreRes = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: snapshot,
  });
  assert.equal(restoreRes.statusCode, 200);

  const oldSessionRes = await app.inject({
    method: "GET",
    url: "/api/racks",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(oldSessionRes.statusCode, 401);

  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "super-secret-1",
    },
  });
  assert.equal(loginRes.statusCode, 200);
  const refreshedToken = (readJson(loginRes) as { token: string }).token;

  const racksAfterRestoreRes = await app.inject({
    method: "GET",
    url: "/api/racks",
    headers: {
      authorization: `Bearer ${refreshedToken}`,
    },
  });
  assert.equal(racksAfterRestoreRes.statusCode, 200);
  const racksAfterRestore = readJson(racksAfterRestoreRes) as Array<{
    name: string;
  }>;
  assert.equal(
    racksAfterRestore.some((rack) => rack.name === "Exported Rack"),
    true,
  );
  assert.equal(
    racksAfterRestore.some((rack) => rack.name === "Should disappear"),
    false,
  );

  const templatesAfterRestoreRes = await app.inject({
    method: "GET",
    url: "/api/ports/templates",
    headers: {
      authorization: `Bearer ${refreshedToken}`,
    },
  });
  assert.equal(templatesAfterRestoreRes.statusCode, 200);
  const templatesAfterRestore = readJson(templatesAfterRestoreRes) as Array<{
    name: string;
  }>;
  assert.equal(
    templatesAfterRestore.some(
      (template) => template.name === "Custom restore template",
    ),
    true,
  );
});

test("admin restore preserves parent-linked devices even when children sort before their host", async () => {
  const adminToken = await bootstrapAdmin();

  const hostRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "zz-host-01",
      displayName: "Restore Host",
      deviceType: "server",
      status: "online",
      placement: "room",
    },
  });
  assert.equal(hostRes.statusCode, 201);
  const host = readJson(hostRes) as { id: string };

  const childRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "aa-vm-01",
      displayName: "Restore Child VM",
      deviceType: "vm",
      status: "online",
      placement: "virtual",
      parentDeviceId: host.id,
    },
  });
  assert.equal(childRes.statusCode, 201);
  const child = readJson(childRes) as { id: string };

  const exportRes = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(exportRes.statusCode, 200);
  const snapshot = readJson(exportRes) as Record<string, unknown>;

  const restoreRes = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: snapshot,
  });
  assert.equal(restoreRes.statusCode, 200);

  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "super-secret-1",
    },
  });
  assert.equal(loginRes.statusCode, 200);
  const refreshedToken = (readJson(loginRes) as { token: string }).token;

  const devicesRes = await app.inject({
    method: "GET",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${refreshedToken}`,
    },
  });
  assert.equal(devicesRes.statusCode, 200);
  const devices = readJson(devicesRes) as Array<{
    id: string;
    hostname: string;
    parentDeviceId?: string;
  }>;

  const restoredHost = devices.find((device) => device.id === host.id);
  const restoredChild = devices.find((device) => device.id === child.id);
  assert.ok(restoredHost);
  assert.ok(restoredChild);
  assert.equal(restoredChild?.parentDeviceId, restoredHost?.id);
});

test("creating a device with a port template creates its ports", async () => {
  const adminToken = await bootstrapAdmin();

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "sw-template-01",
      deviceType: "switch",
      status: "unknown",
      portTemplateId: "switch-24g-4sfp+",
    },
  });

  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const portsRes = await app.inject({
    method: "GET",
    url: `/api/ports?deviceId=${device.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(portsRes.statusCode, 200);
  const ports = readJson(portsRes) as Array<{ name: string }>;
  assert.equal(ports.length, 28);
  assert.equal(ports[0]?.name, "1");
  assert.equal(ports.at(-1)?.name, "SFP+4");
});

test("custom device types can be created and used by devices and templates", async () => {
  const adminToken = await bootstrapAdmin();

  const unknownDeviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "camera-before-type",
      deviceType: "camera",
      status: "unknown",
    },
  });
  assert.equal(unknownDeviceRes.statusCode, 400);
  assert.match(unknownDeviceRes.body, /custom device type/i);

  const typeRes = await app.inject({
    method: "POST",
    url: "/api/device-types",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      label: "IP Camera",
    },
  });
  assert.equal(typeRes.statusCode, 201);
  const deviceType = readJson(typeRes) as {
    id: string;
    label: string;
    builtIn: boolean;
  };
  assert.equal(deviceType.id, "ip_camera");
  assert.equal(deviceType.label, "IP Camera");
  assert.equal(deviceType.builtIn, false);

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "camera-01",
      deviceType: deviceType.id,
      status: "online",
      placement: "room",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { deviceType: string };
  assert.equal(device.deviceType, "ip_camera");

  const templateRes = await app.inject({
    method: "POST",
    url: "/api/ports/templates",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      name: "Camera PoE",
      description: "Single PoE camera port.",
      deviceTypes: [deviceType.id],
      ports: [{ name: "eth0", kind: "rj45", speed: "1G", face: "front" }],
    },
  });
  assert.equal(templateRes.statusCode, 201);
  const template = readJson(templateRes) as { deviceTypes: string[] };
  assert.deepEqual(template.deviceTypes, ["ip_camera"]);

  const listRes = await app.inject({
    method: "GET",
    url: "/api/device-types",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(listRes.statusCode, 200);
  const deviceTypes = readJson(listRes) as Array<{ id: string; label: string }>;
  assert.equal(
    deviceTypes.some(
      (entry) => entry.id === "ip_camera" && entry.label === "IP Camera",
    ),
    true,
  );
});

test("custom port templates can be created, updated, and deleted", async () => {
  const adminToken = await bootstrapAdmin();

  const createRes = await app.inject({
    method: "POST",
    url: "/api/ports/templates",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      name: "Template CRUD",
      description: "Editable custom template.",
      deviceTypes: ["server", "storage"],
      ports: [
        { name: "eno1", kind: "rj45", speed: "1G", face: "front" },
        { name: "eno2", kind: "rj45", speed: "1G", face: "front" },
      ],
    },
  });
  assert.equal(createRes.statusCode, 201);
  const created = readJson(createRes) as {
    id: string;
    ports: Array<{ name: string }>;
  };
  assert.equal(created.ports.length, 2);

  const updateRes = await app.inject({
    method: "PATCH",
    url: `/api/ports/templates/${created.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      description: "Updated template.",
      ports: [
        { name: "eno1", kind: "rj45", speed: "1G", face: "front" },
        { name: "eno2", kind: "rj45", speed: "1G", face: "front" },
        { name: "enp1s0f0", kind: "sfp_plus", speed: "10G", face: "front" },
      ],
    },
  });
  assert.equal(updateRes.statusCode, 200);
  const updated = readJson(updateRes) as {
    description: string;
    ports: Array<{ name: string }>;
  };
  assert.equal(updated.description, "Updated template.");
  assert.equal(updated.ports.length, 3);

  const deleteRes = await app.inject({
    method: "DELETE",
    url: `/api/ports/templates/${created.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(deleteRes.statusCode, 204);
});

test("rack placement validation rejects overlapping devices", async () => {
  const adminToken = await bootstrapAdmin();

  const rackRes = await app.inject({
    method: "POST",
    url: "/api/racks",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Validation Rack",
      totalU: 42,
    },
  });

  assert.equal(rackRes.statusCode, 201);
  const rack = readJson(rackRes) as { id: string };

  const firstDeviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      rackId: rack.id,
      hostname: "rack-device-01",
      deviceType: "server",
      status: "unknown",
      startU: 10,
      heightU: 2,
      face: "front",
    },
  });

  assert.equal(firstDeviceRes.statusCode, 201);

  const overlapRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      rackId: rack.id,
      hostname: "rack-device-02",
      deviceType: "server",
      status: "unknown",
      startU: 11,
      heightU: 1,
      face: "front",
    },
  });

  assert.equal(overlapRes.statusCode, 400);
  assert.match(overlapRes.body, /overlap/i);
});

test("monitoring endpoints validate config, persist results, and stay admin-only", async () => {
  const adminToken = await bootstrapAdmin();

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "monitor-01",
      deviceType: "server",
      status: "unknown",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const editorToken = await createUserAndLogin(adminToken, {
    username: "editor-monitor",
    displayName: "Editor Monitor",
    password: "editor-monitor-1",
    role: "editor",
  });

  const editorCreateRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${editorToken}`,
    },
    payload: {
      deviceId: device.id,
      type: "icmp",
      target: "10.0.10.10",
      enabled: true,
    },
  });
  assert.equal(editorCreateRes.statusCode, 403);
  assert.match(editorCreateRes.body, /administrator/i);

  const invalidMonitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      type: "tcp",
      enabled: true,
    },
  });
  assert.equal(invalidMonitorRes.statusCode, 400);
  assert.match(invalidMonitorRes.body, /target/i);

  const validMonitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      name: "SSH",
      type: "tcp",
      target: "127.0.0.1",
      port: 1,
      intervalMs: 1000,
      enabled: true,
    },
  });
  assert.equal(validMonitorRes.statusCode, 200);
  const monitor = readJson(validMonitorRes) as { id: string; type: string };
  assert.equal(monitor.type, "tcp");

  const runRes = await app.inject({
    method: "POST",
    url: `/api/device-monitors/${monitor.id}/run`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(runRes.statusCode, 200);

  const result = readJson(runRes) as {
    lastCheckAt?: string;
    lastResult?: string;
    type: string;
  };
  assert.equal(result.type, "tcp");
  assert.ok(result.lastCheckAt);
  assert.ok(result.lastResult === "online" || result.lastResult === "offline");
});

test("discovery scans are restricted to administrators", async () => {
  const adminToken = await bootstrapAdmin();
  const editorToken = await createUserAndLogin(adminToken, {
    username: "editor-discovery",
    displayName: "Editor Discovery",
    password: "editor-discovery-1",
    role: "editor",
  });

  const scanRes = await app.inject({
    method: "POST",
    url: "/api/discovery/scan",
    headers: {
      authorization: `Bearer ${editorToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.0.10.0/24",
    },
  });

  assert.equal(scanRes.statusCode, 403);
  assert.match(scanRes.body, /administrator/i);
});

test("vlan range patch rejects inverted ranges", async () => {
  const adminToken = await bootstrapAdmin();

  const createRangeRes = await app.inject({
    method: "POST",
    url: "/api/vlans/ranges",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Range validation",
      startVlan: 100,
      endVlan: 200,
    },
  });
  assert.equal(createRangeRes.statusCode, 201);
  const range = readJson(createRangeRes) as { id: string };

  const invalidPatchRes = await app.inject({
    method: "PATCH",
    url: `/api/vlans/ranges/${range.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      startVlan: 300,
    },
  });
  assert.equal(invalidPatchRes.statusCode, 400);
  assert.match(invalidPatchRes.body, /startVlan/i);
});

test("ip assignment patch rejects empty ips and subnet mismatches", async () => {
  const adminToken = await bootstrapAdmin();

  const subnetARes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.0.10.0/24",
      name: "Subnet A",
    },
  });
  assert.equal(subnetARes.statusCode, 201);
  const subnetA = readJson(subnetARes) as { id: string };

  const subnetBRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.0.20.0/24",
      name: "Subnet B",
    },
  });
  assert.equal(subnetBRes.statusCode, 201);
  const subnetB = readJson(subnetBRes) as { id: string };

  const assignmentRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnetA.id,
      ipAddress: "10.0.10.25",
      assignmentType: "reserved",
      hostname: "reserved-host",
    },
  });
  assert.equal(assignmentRes.statusCode, 201);
  const assignment = readJson(assignmentRes) as { id: string };

  const emptyIpRes = await app.inject({
    method: "PATCH",
    url: `/api/ip-assignments/${assignment.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      ipAddress: "",
    },
  });
  assert.equal(emptyIpRes.statusCode, 400);
  assert.match(emptyIpRes.body, /ipAddress cannot be empty/i);

  const mismatchRes = await app.inject({
    method: "PATCH",
    url: `/api/ip-assignments/${assignment.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnetB.id,
    },
  });
  assert.equal(mismatchRes.statusCode, 400);
  assert.match(mismatchRes.body, /does not belong/i);
});

function resetDatabase() {
  db.exec(`
    DELETE FROM userSessions;
    DELETE FROM oidcIdentities;
    DELETE FROM wifiClientAssociations;
    DELETE FROM wifiRadioSsids;
    DELETE FROM wifiRadios;
    DELETE FROM wifiAccessPoints;
    DELETE FROM wifiSsids;
    DELETE FROM wifiControllers;
    DELETE FROM deviceMonitors;
    DELETE FROM appSettings;
    DELETE FROM auditLog;
    DELETE FROM deviceImages;
    DELETE FROM documentationPages;
    DELETE FROM ipAssignments;
    DELETE FROM discoveredDevices;
    DELETE FROM portLinks;
    DELETE FROM ports;
    DELETE FROM virtualSwitches;
    DELETE FROM ipZones;
    DELETE FROM dhcpScopes;
    DELETE FROM subnets;
    DELETE FROM vlanRanges;
    DELETE FROM vlans;
    DELETE FROM portTemplates;
    DELETE FROM devices;
    DELETE FROM racks;
    DELETE FROM users;
    DELETE FROM labs;
  `);
  setBootstrapState(null);
}

async function bootstrapAdmin() {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      displayName: "Admin User",
      password: "super-secret-1",
    },
  });

  assert.equal(res.statusCode, 201);
  return (readJson(res) as { token: string }).token;
}

function readJson(response: { body: string }) {
  return JSON.parse(response.body);
}

async function createUserAndLogin(
  adminToken: string,
  payload: {
    username: string;
    displayName: string;
    password: string;
    role: "editor" | "viewer";
  },
) {
  const createRes = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload,
  });
  assert.equal(createRes.statusCode, 201);

  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: payload.username,
      password: payload.password,
    },
  });
  assert.equal(loginRes.statusCode, 200);
  return (readJson(loginRes) as { token: string }).token;
}

function ensureSpaIndex() {
  if (!existsSync(spaDistDir)) {
    mkdirSync(spaDistDir, { recursive: true });
  }
  if (!existsSync(spaIndexFile)) {
    writeFileSync(
      spaIndexFile,
      "<!doctype html><html><head><title>Rackpad SPA Fallback</title></head><body>rackpad spa fallback</body></html>",
      "utf8",
    );
  }
}

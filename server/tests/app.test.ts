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
import dgram from "node:dgram";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "rackpad-tests-"));
const spaDistDir = path.resolve(process.cwd(), "dist");
const spaIndexFile = path.join(spaDistDir, "index.html");
process.env.DATABASE_PATH = path.join(tempDir, "rackpad-test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "rackpad-test-secret-key";
process.env.SNMP_INVENTORY_SYNC = "1";

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
    uiSettings: { defaultLanguage: "en" },
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

test("admin UI settings expose and update the instance language default", async () => {
  const initialStatusRes = await app.inject({
    method: "GET",
    url: "/api/auth/status",
  });
  assert.equal(initialStatusRes.statusCode, 200);
  assert.deepEqual(
    (readJson(initialStatusRes) as { uiSettings: { defaultLanguage: string } })
      .uiSettings,
    { defaultLanguage: "en" },
  );

  const adminToken = await bootstrapAdmin();

  const unauthorizedRes = await app.inject({
    method: "PUT",
    url: "/api/admin/ui-settings",
    payload: { defaultLanguage: "fr" },
  });
  assert.equal(unauthorizedRes.statusCode, 401);

  const updateRes = await app.inject({
    method: "PUT",
    url: "/api/admin/ui-settings",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: { defaultLanguage: "fr" },
  });
  assert.equal(updateRes.statusCode, 200);
  assert.deepEqual(readJson(updateRes), { defaultLanguage: "fr" });

  const statusRes = await app.inject({
    method: "GET",
    url: "/api/auth/status",
  });
  assert.equal(statusRes.statusCode, 200);
  assert.deepEqual(
    (readJson(statusRes) as { uiSettings: { defaultLanguage: string } })
      .uiSettings,
    { defaultLanguage: "fr" },
  );

  const zhUpdateRes = await app.inject({
    method: "PUT",
    url: "/api/admin/ui-settings",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: { defaultLanguage: "zh" },
  });
  assert.equal(zhUpdateRes.statusCode, 200);
  assert.deepEqual(readJson(zhUpdateRes), { defaultLanguage: "zh" });

  const zhStatusRes = await app.inject({
    method: "GET",
    url: "/api/auth/status",
  });
  assert.equal(zhStatusRes.statusCode, 200);
  assert.deepEqual(
    (readJson(zhStatusRes) as { uiSettings: { defaultLanguage: string } })
      .uiSettings,
    { defaultLanguage: "zh" },
  );

  const esUpdateRes = await app.inject({
    method: "PUT",
    url: "/api/admin/ui-settings",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: { defaultLanguage: "es" },
  });
  assert.equal(esUpdateRes.statusCode, 200);
  assert.deepEqual(readJson(esUpdateRes), { defaultLanguage: "es" });

  const esStatusRes = await app.inject({
    method: "GET",
    url: "/api/auth/status",
  });
  assert.equal(esStatusRes.statusCode, 200);
  assert.deepEqual(
    (readJson(esStatusRes) as { uiSettings: { defaultLanguage: string } })
      .uiSettings,
    { defaultLanguage: "es" },
  );

  const hiUpdateRes = await app.inject({
    method: "PUT",
    url: "/api/admin/ui-settings",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: { defaultLanguage: "hi" },
  });
  assert.equal(hiUpdateRes.statusCode, 200);
  assert.deepEqual(readJson(hiUpdateRes), { defaultLanguage: "hi" });

  const hiStatusRes = await app.inject({
    method: "GET",
    url: "/api/auth/status",
  });
  assert.equal(hiStatusRes.statusCode, 200);
  assert.deepEqual(
    (readJson(hiStatusRes) as { uiSettings: { defaultLanguage: string } })
      .uiSettings,
    { defaultLanguage: "hi" },
  );

  const arUpdateRes = await app.inject({
    method: "PUT",
    url: "/api/admin/ui-settings",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: { defaultLanguage: "ar" },
  });
  assert.equal(arUpdateRes.statusCode, 200);
  assert.deepEqual(readJson(arUpdateRes), { defaultLanguage: "ar" });

  const arStatusRes = await app.inject({
    method: "GET",
    url: "/api/auth/status",
  });
  assert.equal(arStatusRes.statusCode, 200);
  assert.deepEqual(
    (readJson(arStatusRes) as { uiSettings: { defaultLanguage: string } })
      .uiSettings,
    { defaultLanguage: "ar" },
  );

  const jaUpdateRes = await app.inject({
    method: "PUT",
    url: "/api/admin/ui-settings",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: { defaultLanguage: "ja" },
  });
  assert.equal(jaUpdateRes.statusCode, 200);
  assert.deepEqual(readJson(jaUpdateRes), { defaultLanguage: "ja" });

  const jaStatusRes = await app.inject({
    method: "GET",
    url: "/api/auth/status",
  });
  assert.equal(jaStatusRes.statusCode, 200);
  assert.deepEqual(
    (readJson(jaStatusRes) as { uiSettings: { defaultLanguage: string } })
      .uiSettings,
    { defaultLanguage: "ja" },
  );
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
  assert.match(writeRes.body, /write access/i);
});

test("per-lab access restricts users to assigned labs", async () => {
  const adminToken = await bootstrapAdmin();

  const createLabRes = await app.inject({
    method: "POST",
    url: "/api/labs",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      id: "lab_work",
      name: "Work Lab",
      location: "Office",
    },
  });
  assert.equal(createLabRes.statusCode, 201);

  const limitedUserRes = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      username: "workonly",
      displayName: "Work Only",
      password: "work-only-password",
      role: "editor",
      labAccess: [{ labId: "lab_work", role: "editor" }],
    },
  });
  assert.equal(limitedUserRes.statusCode, 201);

  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "workonly",
      password: "work-only-password",
    },
  });
  assert.equal(loginRes.statusCode, 200);
  const limitedToken = (readJson(loginRes) as { token: string }).token;

  const labsRes = await app.inject({
    method: "GET",
    url: "/api/labs",
    headers: {
      authorization: `Bearer ${limitedToken}`,
    },
  });
  assert.equal(labsRes.statusCode, 200);
  const labs = readJson(labsRes) as Array<{ id: string }>;
  assert.equal(labs.length, 1);
  assert.equal(labs[0]?.id, "lab_work");

  const homeRacksRes = await app.inject({
    method: "GET",
    url: "/api/racks?labId=lab_home",
    headers: {
      authorization: `Bearer ${limitedToken}`,
    },
  });
  assert.equal(homeRacksRes.statusCode, 403);

  const workRacksRes = await app.inject({
    method: "GET",
    url: "/api/racks?labId=lab_work",
    headers: {
      authorization: `Bearer ${limitedToken}`,
    },
  });
  assert.equal(workRacksRes.statusCode, 200);

  const homeDevicesRes = await app.inject({
    method: "GET",
    url: "/api/devices?labId=lab_home",
    headers: {
      authorization: `Bearer ${limitedToken}`,
    },
  });
  assert.equal(homeDevicesRes.statusCode, 403);

  const workDevicesRes = await app.inject({
    method: "GET",
    url: "/api/devices?labId=lab_work",
    headers: {
      authorization: `Bearer ${limitedToken}`,
    },
  });
  assert.equal(workDevicesRes.statusCode, 200);
});

test("bulk wireless placement requires an access point", async () => {
  const adminToken = await bootstrapAdmin();
  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      labId: "lab_home",
      hostname: "bulk-wireless-client",
      deviceType: "endpoint",
      status: "online",
      placement: "room",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const bulkRes = await app.inject({
    method: "POST",
    url: "/api/devices/bulk",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      deviceIds: [device.id],
      changes: { placement: "wireless" },
    },
  });
  assert.equal(bulkRes.statusCode, 400);
  assert.match(bulkRes.body, /access point/i);
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

test("bulk device updates accept custom types and wireless placement", async () => {
  const adminToken = await bootstrapAdmin();

  const typeRes = await app.inject({
    method: "POST",
    url: "/api/device-types",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      label: "IoT",
    },
  });
  assert.equal(typeRes.statusCode, 201);
  const iotType = readJson(typeRes) as { id: string };

  const apRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "bulk-ap",
      deviceType: "ap",
      status: "online",
      placement: "wireless",
    },
  });
  assert.equal(apRes.statusCode, 201);
  const ap = readJson(apRes) as { id: string };

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "bulk-client-a",
      deviceType: "endpoint",
      status: "online",
      placement: "room",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const bulkTypeRes = await app.inject({
    method: "POST",
    url: "/api/devices/bulk",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceIds: [device.id],
      changes: {
        deviceType: iotType.id,
      },
    },
  });
  assert.equal(bulkTypeRes.statusCode, 200);
  const bulkTyped = readJson(bulkTypeRes) as {
    devices: Array<{ deviceType: string; placement: string }>;
  };
  assert.equal(bulkTyped.devices[0]?.deviceType, iotType.id);
  assert.equal(bulkTyped.devices[0]?.placement, "room");

  const bulkWirelessRes = await app.inject({
    method: "POST",
    url: "/api/devices/bulk",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceIds: [device.id],
      changes: {
        placement: "wireless",
        parentDeviceId: ap.id,
      },
    },
  });
  assert.equal(bulkWirelessRes.statusCode, 200);
  const bulkWireless = readJson(bulkWirelessRes) as {
    devices: Array<{ placement: string; parentDeviceId: string | null }>;
  };
  assert.equal(bulkWireless.devices[0]?.placement, "wireless");
  assert.equal(bulkWireless.devices[0]?.parentDeviceId, ap.id);

  const associationRes = await app.inject({
    method: "GET",
    url: "/api/wifi/associations",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(associationRes.statusCode, 200);
  const associations = readJson(associationRes) as Array<{
    clientDeviceId: string;
    apDeviceId: string;
  }>;
  assert.ok(
    associations.some(
      (entry) =>
        entry.clientDeviceId === device.id && entry.apDeviceId === ap.id,
    ),
  );
});

test("bulk device updates roll back earlier writes when a later device fails validation", async () => {
  const adminToken = await bootstrapAdmin();

  const createLabRes = await app.inject({
    method: "POST",
    url: "/api/labs",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      id: "lab_bulk_atomic",
      name: "Bulk Atomic Lab",
    },
  });
  assert.equal(createLabRes.statusCode, 201);

  const apRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "bulk-atomic-ap",
      deviceType: "ap",
      status: "online",
      placement: "wireless",
    },
  });
  assert.equal(apRes.statusCode, 201);
  const ap = readJson(apRes) as { id: string };

  const homeDeviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "bulk-atomic-home",
      deviceType: "endpoint",
      status: "online",
      placement: "room",
      manufacturer: "Before",
    },
  });
  assert.equal(homeDeviceRes.statusCode, 201);
  const homeDevice = readJson(homeDeviceRes) as { id: string };

  const otherLabDeviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_bulk_atomic",
      hostname: "bulk-atomic-other",
      deviceType: "endpoint",
      status: "online",
      placement: "room",
      manufacturer: "Before",
    },
  });
  assert.equal(otherLabDeviceRes.statusCode, 201);
  const otherLabDevice = readJson(otherLabDeviceRes) as { id: string };

  const bulkRes = await app.inject({
    method: "POST",
    url: "/api/devices/bulk",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceIds: [homeDevice.id, otherLabDevice.id],
      changes: {
        manufacturer: "After",
        placement: "wireless",
        parentDeviceId: ap.id,
      },
    },
  });
  assert.equal(bulkRes.statusCode, 400);
  assert.match(bulkRes.body, /valid access point/i);

  const rolledBackHomeDevice = db
    .prepare(
      "SELECT manufacturer, placement, parentDeviceId FROM devices WHERE id = ?",
    )
    .get(homeDevice.id) as {
    manufacturer: string | null;
    placement: string | null;
    parentDeviceId: string | null;
  };
  assert.equal(rolledBackHomeDevice.manufacturer, "Before");
  assert.equal(rolledBackHomeDevice.placement, "room");
  assert.equal(rolledBackHomeDevice.parentDeviceId, null);

  const rolledBackAssociations = db
    .prepare(
      "SELECT COUNT(*) AS count FROM wifiClientAssociations WHERE clientDeviceId = ?",
    )
    .get(homeDevice.id) as { count: number };
  assert.equal(rolledBackAssociations.count, 0);
});

test("device import auto-places wireless clients on WiFi VLAN subnets", async () => {
  const adminToken = await bootstrapAdmin();

  db.prepare(
    `
    INSERT INTO vlans (id, labId, vlanId, name, description, color)
    VALUES ('vlan_wifi_bulk', 'lab_home', 31, 'Guest VLAN', NULL, NULL)
  `,
  ).run();
  db.prepare(
    `
    INSERT INTO subnets (id, labId, cidr, name, description, vlanId)
    VALUES ('subnet_wifi_bulk', 'lab_home', '192.168.31.0/24', 'Guest subnet', NULL, 'vlan_wifi_bulk')
  `,
  ).run();
  db.prepare(
    `
    INSERT INTO wifiSsids (id, labId, name, purpose, security, hidden, vlanId, color)
    VALUES ('ssid_guest_bulk', 'lab_home', 'GuestNet', NULL, NULL, 0, 'vlan_wifi_bulk', NULL)
  `,
  ).run();
  db.prepare(
    `
    INSERT INTO devices
      (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model,
       serial, managementIp, macAddress, status, placement, parentDeviceId, networkMode, roomId, cpuCores, memoryGb, storageGb, specs,
       startU, heightU, face, tags, notes, lastSeen)
    VALUES ('ap_guest_bulk', 'lab_home', NULL, 'guest-ap', NULL, 'ap', NULL, NULL,
       NULL, '192.168.1.50', NULL, 'online', 'wireless', NULL, 'normal', NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL)
  `,
  ).run();
  db.prepare(
    `
    INSERT INTO wifiRadios (id, apDeviceId, slotName, band, channel, channelWidth, txPower, notes)
    VALUES ('radio_guest_bulk', 'ap_guest_bulk', 'radio0', '5GHz', '36', NULL, NULL, NULL)
  `,
  ).run();
  db.prepare(
    `
    INSERT INTO wifiRadioSsids (radioId, ssidId)
    VALUES ('radio_guest_bulk', 'ssid_guest_bulk')
  `,
  ).run();

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "guest-phone",
      deviceType: "endpoint",
      status: "online",
      managementIp: "192.168.31.44",
      placement: "room",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as {
    id: string;
    placement: string;
    parentDeviceId: string | null;
  };
  assert.equal(device.placement, "wireless");
  assert.equal(device.parentDeviceId, "ap_guest_bulk");

  const association = db
    .prepare(
      "SELECT apDeviceId, ssidId FROM wifiClientAssociations WHERE clientDeviceId = ?",
    )
    .get(device.id) as { apDeviceId: string; ssidId: string };
  assert.equal(association.apDeviceId, "ap_guest_bulk");
  assert.equal(association.ssidId, "ssid_guest_bulk");

  const attachedDeviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "guest-tablet",
      deviceType: "endpoint",
      status: "online",
      managementIp: "192.168.31.45",
      placement: "wireless",
      parentDeviceId: "ap_guest_bulk",
    },
  });
  assert.equal(attachedDeviceRes.statusCode, 201);
  const attachedDevice = readJson(attachedDeviceRes) as {
    id: string;
    placement: string;
    parentDeviceId: string | null;
  };
  assert.equal(attachedDevice.placement, "wireless");
  assert.equal(attachedDevice.parentDeviceId, "ap_guest_bulk");

  const attachedAssociation = db
    .prepare(
      "SELECT apDeviceId, ssidId FROM wifiClientAssociations WHERE clientDeviceId = ?",
    )
    .get(attachedDevice.id) as { apDeviceId: string; ssidId: string };
  assert.equal(attachedAssociation.apDeviceId, "ap_guest_bulk");
  assert.equal(attachedAssociation.ssidId, "ssid_guest_bulk");
});

test("container is a built-in virtual workload device type", async () => {
  const adminToken = await bootstrapAdmin();

  const listRes = await app.inject({
    method: "GET",
    url: "/api/device-types",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(listRes.statusCode, 200);
  const deviceTypes = readJson(listRes) as Array<{
    id: string;
    builtIn: boolean;
  }>;
  assert.equal(
    deviceTypes.some((entry) => entry.id === "container" && entry.builtIn),
    true,
  );

  const hostRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "container-host-01",
      deviceType: "server",
      status: "online",
      placement: "room",
    },
  });
  assert.equal(hostRes.statusCode, 201);
  const host = readJson(hostRes) as { id: string };

  const containerRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "ct-dns-01",
      deviceType: "container",
      status: "online",
      parentDeviceId: host.id,
    },
  });
  assert.equal(containerRes.statusCode, 201);
  const container = readJson(containerRes) as {
    deviceType: string;
    placement: string;
    parentDeviceId: string;
  };
  assert.equal(container.deviceType, "container");
  assert.equal(container.placement, "virtual");
  assert.equal(container.parentDeviceId, host.id);
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

test("virtual switches can be attached to shelf-mounted physical hosts", async () => {
  const adminToken = await bootstrapAdmin();

  const rackRes = await app.inject({
    method: "POST",
    url: "/api/racks",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Compute Shelf Rack",
      totalU: 12,
    },
  });
  assert.equal(rackRes.statusCode, 201);
  const rack = readJson(rackRes) as { id: string };

  const shelfRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      rackId: rack.id,
      hostname: "pi-shelf",
      deviceType: "rack_shelf",
      status: "unknown",
      startU: 4,
      heightU: 1,
      face: "front",
    },
  });
  assert.equal(shelfRes.statusCode, 201);
  const shelf = readJson(shelfRes) as { id: string };

  const hostRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "raspberrypi",
      deviceType: "server",
      status: "online",
      placement: "shelf",
      parentDeviceId: shelf.id,
      managementIp: "192.168.0.1",
    },
  });
  assert.equal(hostRes.statusCode, 201);
  const host = readJson(hostRes) as { id: string };

  const bridgeRes = await app.inject({
    method: "POST",
    url: "/api/virtual-switches",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      hostDeviceId: host.id,
      name: "docker0",
      kind: "internal",
    },
  });
  assert.equal(bridgeRes.statusCode, 201);
  const bridge = readJson(bridgeRes) as { hostDeviceId: string; name: string };
  assert.equal(bridge.hostDeviceId, host.id);
  assert.equal(bridge.name, "docker0");

  const vmRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "guest-on-pi",
      deviceType: "vm",
      status: "online",
      placement: "virtual",
      parentDeviceId: host.id,
    },
  });
  assert.equal(vmRes.statusCode, 201);
  const vm = readJson(vmRes) as { id: string };

  const vmBridgeRes = await app.inject({
    method: "POST",
    url: "/api/virtual-switches",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      hostDeviceId: vm.id,
      name: "bad-bridge",
      kind: "internal",
    },
  });
  assert.equal(vmBridgeRes.statusCode, 400);
  assert.match(vmBridgeRes.body, /physical host/i);
});

test("shelf-mounted child devices keep their own footprint", async () => {
  const adminToken = await bootstrapAdmin();

  const rackRes = await app.inject({
    method: "POST",
    url: "/api/racks",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Shelf Footprint Rack",
      totalU: 12,
    },
  });
  assert.equal(rackRes.statusCode, 201);
  const rack = readJson(rackRes) as { id: string };

  const shelfRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      rackId: rack.id,
      hostname: "wide-shelf",
      deviceType: "rack_shelf",
      status: "unknown",
      startU: 4,
      heightU: 4,
      face: "front",
    },
  });
  assert.equal(shelfRes.statusCode, 201);
  const shelf = readJson(shelfRes) as { id: string };

  const childRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "two-u-nas",
      deviceType: "storage",
      status: "online",
      placement: "shelf",
      parentDeviceId: shelf.id,
      heightU: 2,
    },
  });
  assert.equal(childRes.statusCode, 201);
  const child = readJson(childRes) as {
    placement: string;
    parentDeviceId: string;
    heightU: number;
  };
  assert.equal(child.placement, "shelf");
  assert.equal(child.parentDeviceId, shelf.id);
  assert.equal(child.heightU, 2);
});

test("host-shared virtual devices can share parent management IP", async () => {
  const adminToken = await bootstrapAdmin();

  const hostRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "raspberrypi",
      deviceType: "server",
      status: "online",
      managementIp: "192.168.80.10",
    },
  });
  assert.equal(hostRes.statusCode, 201);
  const host = readJson(hostRes) as { id: string };

  const invalidHostSharedRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "bad-host-share",
      deviceType: "server",
      status: "online",
      parentDeviceId: host.id,
      networkMode: "host-shared",
      managementIp: "192.168.80.10",
    },
  });
  assert.equal(invalidHostSharedRes.statusCode, 400);
  assert.match(invalidHostSharedRes.body, /VMs and containers/i);

  const childRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "rackpad-container",
      deviceType: "container",
      status: "online",
      placement: "virtual",
      parentDeviceId: host.id,
      networkMode: "host-shared",
      managementIp: "192.168.80.10",
    },
  });
  assert.equal(childRes.statusCode, 201);
  const child = readJson(childRes) as {
    parentDeviceId: string;
    networkMode: string;
    managementIp: string;
  };
  assert.equal(child.parentDeviceId, host.id);
  assert.equal(child.networkMode, "host-shared");
  assert.equal(child.managementIp, "192.168.80.10");
});

test("deleting imported devices resets linked discovery rows", async () => {
  const adminToken = await bootstrapAdmin();

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "discovered-switch",
      deviceType: "switch",
      status: "online",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  db.prepare(
    `
    INSERT INTO discoveredDevices
      (id, labId, ipAddress, hostname, displayName, deviceType, placement, macAddress, vendor, source, status, notes, importedDeviceId, technicalRole, technicalReason, lastSeen, lastScannedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "disc_delete_reset",
    "lab_home",
    "192.168.88.20",
    "discovered-switch",
    null,
    "switch",
    "room",
    null,
    null,
    "test",
    "imported",
    null,
    device.id,
    null,
    null,
    new Date().toISOString(),
    new Date().toISOString(),
  );

  const deleteRes = await app.inject({
    method: "DELETE",
    url: `/api/devices/${device.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(deleteRes.statusCode, 204);

  const row = db
    .prepare(
      "SELECT status, importedDeviceId FROM discoveredDevices WHERE id = ?",
    )
    .get("disc_delete_reset") as {
    status: string;
    importedDeviceId: string | null;
  };
  assert.equal(row.status, "new");
  assert.equal(row.importedDeviceId, null);
});

test("orphaned imported discovery rows reset before listing", async () => {
  const adminToken = await bootstrapAdmin();
  const now = new Date().toISOString();
  const insertDiscovery = db.prepare(`
    INSERT INTO discoveredDevices
      (id, labId, ipAddress, hostname, displayName, deviceType, placement, macAddress, vendor, source, status, notes, importedDeviceId, technicalRole, technicalReason, lastSeen, lastScannedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertDiscovery.run(
    "disc_orphan_imported",
    "lab_home",
    "192.168.88.21",
    "orphan-imported",
    null,
    "switch",
    "room",
    null,
    null,
    "test",
    "imported",
    null,
    null,
    null,
    null,
    now,
    now,
  );
  const listRes = await app.inject({
    method: "GET",
    url: "/api/discovery?labId=lab_home&status=imported",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(listRes.statusCode, 200);
  assert.deepEqual(readJson(listRes), []);

  const rows = db
    .prepare(
      `
      SELECT id, status, importedDeviceId
      FROM discoveredDevices
      WHERE id = ?
      ORDER BY id ASC
    `,
    )
    .all("disc_orphan_imported") as Array<{
    id: string;
    status: string;
    importedDeviceId: string | null;
  }>;
  assert.deepEqual(
    rows.map((row) => ({
      id: row.id,
      status: row.status,
      importedDeviceId: row.importedDeviceId,
    })),
    [
      {
        id: "disc_orphan_imported",
        status: "new",
        importedDeviceId: null,
      },
    ],
  );
});

test("technical discovery rows cannot be imported", async () => {
  const adminToken = await bootstrapAdmin();

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "gateway-firewall",
      deviceType: "firewall",
      status: "online",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  db.prepare(
    `
    INSERT INTO discoveredDevices
      (id, labId, ipAddress, hostname, displayName, deviceType, placement, macAddress, vendor, source, status, notes, importedDeviceId, technicalRole, technicalReason, lastSeen, lastScannedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "disc_technical_protected",
    "lab_home",
    "192.168.88.1",
    "gateway",
    null,
    "router",
    "room",
    null,
    null,
    "test",
    "dismissed",
    null,
    null,
    "gateway",
    "Main DHCP gateway",
    new Date().toISOString(),
    new Date().toISOString(),
  );

  const importRes = await app.inject({
    method: "PATCH",
    url: "/api/discovery/disc_technical_protected",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      status: "imported",
      importedDeviceId: device.id,
    },
  });
  assert.equal(importRes.statusCode, 400);
  assert.match(importRes.body, /technical addresses/i);

  const notesRes = await app.inject({
    method: "PATCH",
    url: "/api/discovery/disc_technical_protected",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      status: "dismissed",
      notes: "Confirmed as a technical IP.",
    },
  });
  assert.equal(notesRes.statusCode, 200);
  const updated = readJson(notesRes) as { status: string; notes: string };
  assert.equal(updated.status, "dismissed");
  assert.equal(updated.notes, "Confirmed as a technical IP.");
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
  assert.ok(
    editorCreateRes.statusCode === 200 || editorCreateRes.statusCode === 201,
  );

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

  const invalidHostTargetRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      type: "tcp",
      target: "bad host",
      enabled: true,
    },
  });
  assert.equal(invalidHostTargetRes.statusCode, 400);
  assert.match(invalidHostTargetRes.body, /host target/i);

  const invalidSnmpMonitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      type: "snmp",
      target: "127.0.0.1",
      enabled: true,
    },
  });
  assert.equal(invalidSnmpMonitorRes.statusCode, 400);
  assert.match(invalidSnmpMonitorRes.body, /snmp oid/i);

  const validSnmpMonitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      name: "Interface 1",
      type: "snmp",
      target: "127.0.0.1",
      snmpVersion: "2c",
      snmpCommunity: "public",
      snmpOid: ".1.3.6.1.2.1.2.2.1.8.1",
      snmpExpectedValue: "1",
      enabled: true,
    },
  });
  assert.equal(validSnmpMonitorRes.statusCode, 200);
  const snmpMonitor = readJson(validSnmpMonitorRes) as {
    id: string;
    type: string;
    port: number;
    snmpVersion: string;
    snmpCommunity: string;
    snmpOid: string;
    snmpExpectedValue: string;
  };
  assert.equal(snmpMonitor.type, "snmp");
  assert.equal(snmpMonitor.port, 161);
  assert.equal(snmpMonitor.snmpVersion, "2c");
  assert.equal(snmpMonitor.snmpCommunity, "public");
  assert.equal(snmpMonitor.snmpOid, ".1.3.6.1.2.1.2.2.1.8.1");
  assert.equal(snmpMonitor.snmpExpectedValue, "1");

  const invalidPatchTargetRes = await app.inject({
    method: "PATCH",
    url: `/api/device-monitors/${snmpMonitor.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      target: "-bad-host",
    },
  });
  assert.equal(invalidPatchTargetRes.statusCode, 400);
  assert.match(invalidPatchTargetRes.body, /host target/i);

  const blockedHttpMonitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      type: "http",
      target: "127.0.0.1",
      enabled: true,
    },
  });
  assert.equal(blockedHttpMonitorRes.statusCode, 200);
  const blockedHttpMonitor = readJson(blockedHttpMonitorRes) as { id: string };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("fetch should not run for reserved monitor hosts");
  }) as typeof fetch;
  try {
    const runBlockedHttpRes = await app.inject({
      method: "POST",
      url: `/api/device-monitors/${blockedHttpMonitor.id}/run`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(runBlockedHttpRes.statusCode, 200);
    const runBlockedHttp = readJson(runBlockedHttpRes) as {
      lastResult?: string;
      lastMessage?: string;
    };
    assert.equal(runBlockedHttp.lastResult, "offline");
    assert.match(runBlockedHttp.lastMessage ?? "", /reserved ranges/i);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const switchRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "switch-snmp",
      deviceType: "switch",
      status: "unknown",
    },
  });
  assert.equal(switchRes.statusCode, 201);
  const switchDevice = readJson(switchRes) as { id: string };

  const switchPortRes = await app.inject({
    method: "POST",
    url: "/api/ports",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: switchDevice.id,
      name: "Gi0/1",
      kind: "rj45",
      linkState: "unknown",
    },
  });
  assert.equal(switchPortRes.statusCode, 201);
  const switchPort = readJson(switchPortRes) as { id: string };

  const linkedSnmpMonitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: switchDevice.id,
      name: "Uplink",
      type: "snmp",
      target: "127.0.0.1",
      snmpVersion: "2c",
      snmpCommunity: "public",
      snmpOid: "1.3.6.1.2.1.2.2.1.8.1",
      snmpExpectedValue: "1,2",
      snmpMatchMode: "in",
      portId: switchPort.id,
      snmpIfIndex: 1,
      enabled: true,
    },
  });
  assert.equal(linkedSnmpMonitorRes.statusCode, 200);
  const linkedSnmpMonitor = readJson(linkedSnmpMonitorRes) as {
    portId: string;
    snmpIfIndex: number;
    snmpMatchMode: string;
  };
  assert.equal(linkedSnmpMonitor.portId, switchPort.id);
  assert.equal(linkedSnmpMonitor.snmpIfIndex, 1);
  assert.equal(linkedSnmpMonitor.snmpMatchMode, "in");

  db.prepare(
    "UPDATE ports SET snmpIfIndex = ?, linkState = ? WHERE id = ?",
  ).run(1, "unknown", switchPort.id);

  const indexSyncServer = await createSnmpIntegerResponder(1);
  try {
    const indexSyncAddress = indexSyncServer.address();
    if (typeof indexSyncAddress === "string") {
      throw new Error("SNMP test server did not expose a UDP port.");
    }
    const indexOnlyMonitorRes = await app.inject({
      method: "POST",
      url: "/api/device-monitors",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        deviceId: switchDevice.id,
        name: "Gi0/1 index sync",
        type: "snmp",
        target: "127.0.0.1",
        port: indexSyncAddress.port,
        snmpVersion: "2c",
        snmpCommunity: "public",
        snmpOid: "1.3.6.1.2.1.2.2.1.8.1",
        snmpExpectedValue: "1",
        snmpIfIndex: 1,
        enabled: true,
      },
    });
    assert.equal(indexOnlyMonitorRes.statusCode, 200);
    const indexOnlyMonitor = readJson(indexOnlyMonitorRes) as { id: string };
    const indexSyncRunRes = await app.inject({
      method: "POST",
      url: `/api/device-monitors/${indexOnlyMonitor.id}/run`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(indexSyncRunRes.statusCode, 200);
    const syncedPort = db
      .prepare("SELECT linkState FROM ports WHERE id = ?")
      .get(switchPort.id) as { linkState?: string };
    assert.equal(syncedPort.linkState, "up");
  } finally {
    await closeUdpServer(indexSyncServer);
  }

  const snmpServer = await createSnmpIntegerResponder(1);
  try {
    const snmpAddress = snmpServer.address();
    if (typeof snmpAddress === "string") {
      throw new Error("SNMP test server did not expose a UDP port.");
    }
    const polledSnmpMonitorRes = await app.inject({
      method: "POST",
      url: "/api/device-monitors",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        deviceId: device.id,
        name: "SNMP poll",
        type: "snmp",
        target: "127.0.0.1",
        port: snmpAddress.port,
        snmpOid: "1.3.6.1.2.1.1.3.0",
        snmpExpectedValue: "1",
        enabled: true,
      },
    });
    assert.equal(polledSnmpMonitorRes.statusCode, 200);
    const polledSnmpMonitor = readJson(polledSnmpMonitorRes) as {
      id: string;
    };
    const snmpRunRes = await app.inject({
      method: "POST",
      url: `/api/device-monitors/${polledSnmpMonitor.id}/run`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(snmpRunRes.statusCode, 200);
    const snmpRun = readJson(snmpRunRes) as {
      lastResult?: string;
      lastMessage?: string;
    };
    assert.equal(snmpRun.lastResult, "online");
    assert.match(snmpRun.lastMessage ?? "", /matched expected value/i);
  } finally {
    await closeUdpServer(snmpServer);
  }

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

test("lab-scoped SNMP credentials store encrypted secrets and can be tested", async () => {
  const adminToken = await bootstrapAdmin();

  const createRes = await app.inject({
    method: "POST",
    url: "/api/snmp-credentials",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Lab SNMP",
      version: "2c",
      community: "homelab-ro",
    },
  });
  assert.equal(createRes.statusCode, 201);
  const credential = readJson(createRes) as {
    id: string;
    version: string;
    hasCommunity: boolean;
  };
  assert.equal(credential.version, "2c");
  assert.equal(credential.hasCommunity, true);

  const listRes = await app.inject({
    method: "GET",
    url: "/api/snmp-credentials?labId=lab_home",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(listRes.statusCode, 200);
  const listed = readJson(listRes) as Array<{ id: string }>;
  assert.equal(listed.length, 1);

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "snmp-switch",
      deviceType: "switch",
      status: "unknown",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const snmpServer = await createSnmpIntegerResponder(12345);
  try {
    const snmpAddress = snmpServer.address();
    if (typeof snmpAddress === "string") {
      throw new Error("SNMP test server did not expose a UDP port.");
    }

    const testRes = await app.inject({
      method: "POST",
      url: `/api/snmp-credentials/${credential.id}/test`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        target: "127.0.0.1",
        port: snmpAddress.port,
      },
    });
    assert.equal(testRes.statusCode, 200);
    const testResult = readJson(testRes) as { value: string; version: string };
    assert.equal(testResult.version, "2c");
    assert.equal(testResult.value, "12345");

    const monitorRes = await app.inject({
      method: "POST",
      url: "/api/device-monitors",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        deviceId: device.id,
        name: "Uptime",
        type: "snmp",
        target: "127.0.0.1",
        port: snmpAddress.port,
        snmpCredentialId: credential.id,
        snmpOid: "1.3.6.1.2.1.1.3.0",
        snmpMatchMode: "any",
        enabled: true,
      },
    });
    assert.equal(monitorRes.statusCode, 200);
    const monitor = readJson(monitorRes) as {
      id: string;
      snmpCredentialId: string;
    };
    assert.equal(monitor.snmpCredentialId, credential.id);

    const runRes = await app.inject({
      method: "POST",
      url: `/api/device-monitors/${monitor.id}/run`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(runRes.statusCode, 200);
    const run = readJson(runRes) as { lastResult?: string };
    assert.equal(run.lastResult, "online");
  } finally {
    await closeUdpServer(snmpServer);
  }
});

test("SNMP linkDown and linkUp traps update matching interface monitors", async () => {
  const adminToken = await bootstrapAdmin();
  const { handleTrapPacket } = await import("../lib/snmp-traps.js");
  const { buildSnmpV2TrapPacket, buildSnmpV3TrapPacket } =
    await import("../lib/snmp-trap-build.js");
  const { SNMP_TRAP_LINK_DOWN_OID, SNMP_TRAP_LINK_UP_OID } =
    await import("../lib/snmp-trap-parser.js");

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "trap-switch",
      deviceType: "switch",
      managementIp: "10.0.0.50",
      status: "unknown",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const monitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      name: "Port 3",
      type: "snmp",
      target: "10.0.0.50",
      snmpOid: "1.3.6.1.2.1.2.2.1.8.3",
      snmpExpectedValue: "1",
      snmpIfIndex: 3,
      enabled: true,
    },
  });
  assert.equal(monitorRes.statusCode, 200);
  const monitor = readJson(monitorRes) as { id: string };

  await handleTrapPacket(
    buildSnmpV2TrapPacket({ trapOid: SNMP_TRAP_LINK_DOWN_OID, ifIndex: 3 }),
    "10.0.0.50",
  );

  const downRes = await app.inject({
    method: "GET",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    query: { deviceId: device.id },
  });
  const downMonitors = readJson(downRes) as Array<{
    id: string;
    lastResult?: string;
  }>;
  assert.equal(
    downMonitors.find((entry) => entry.id === monitor.id)?.lastResult,
    "offline",
  );

  await handleTrapPacket(
    buildSnmpV2TrapPacket({ trapOid: SNMP_TRAP_LINK_UP_OID, ifIndex: 3 }),
    "10.0.0.50",
  );

  const upRes = await app.inject({
    method: "GET",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    query: { deviceId: device.id },
  });
  const upMonitors = readJson(upRes) as Array<{
    id: string;
    lastResult?: string;
  }>;
  assert.equal(
    upMonitors.find((entry) => entry.id === monitor.id)?.lastResult,
    "online",
  );

  const trapLogRes = await app.inject({
    method: "GET",
    url: "/api/snmp-traps/log?labId=lab_home",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(trapLogRes.statusCode, 200);
  const trapLog = readJson(trapLogRes) as Array<{ resultAction: string }>;
  assert.ok(trapLog.length >= 2);

  const trapSourcesRes = await app.inject({
    method: "GET",
    url: "/api/snmp-traps/sources?labId=lab_home",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(trapSourcesRes.statusCode, 200);
  const trapSources = readJson(trapSourcesRes) as Array<{
    id: string;
    sourceIp: string;
    credentialId?: string | null;
  }>;
  const trapSource = trapSources.find(
    (entry) => entry.sourceIp === "10.0.0.50",
  );
  assert.ok(trapSource);

  const homeCredentialRes = await app.inject({
    method: "POST",
    url: "/api/snmp-credentials",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Home traps",
      version: "2c",
      community: "public",
    },
  });
  assert.equal(homeCredentialRes.statusCode, 201);
  const homeCredential = readJson(homeCredentialRes) as { id: string };

  const sourceUpdateRes = await app.inject({
    method: "PATCH",
    url: `/api/snmp-traps/sources/${trapSource.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      credentialId: homeCredential.id,
    },
  });
  assert.equal(sourceUpdateRes.statusCode, 200);
  assert.equal(
    (readJson(sourceUpdateRes) as { credentialId?: string | null })
      .credentialId,
    homeCredential.id,
  );

  const labRes = await app.inject({
    method: "POST",
    url: "/api/labs",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      id: "lab_trap_other",
      name: "Trap Other",
    },
  });
  assert.equal(labRes.statusCode, 201);

  const otherCredentialRes = await app.inject({
    method: "POST",
    url: "/api/snmp-credentials",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_trap_other",
      name: "Other traps",
      version: "2c",
      community: "public",
    },
  });
  assert.equal(otherCredentialRes.statusCode, 201);
  const otherCredential = readJson(otherCredentialRes) as { id: string };

  const crossLabCredentialRes = await app.inject({
    method: "PATCH",
    url: `/api/snmp-traps/sources/${trapSource.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      credentialId: otherCredential.id,
    },
  });
  assert.equal(crossLabCredentialRes.statusCode, 400);
  assert.match(
    (readJson(crossLabCredentialRes) as { error: string }).error,
    /same lab/i,
  );

  const v3AuthCredentialRes = await app.inject({
    method: "POST",
    url: "/api/snmp-credentials",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Home v3 traps",
      version: "3",
      v3User: "trap-user",
      v3AuthProto: "SHA",
      v3AuthPassword: "authpass123",
      v3PrivProto: "none",
    },
  });
  assert.equal(v3AuthCredentialRes.statusCode, 201);
  const v3AuthCredential = readJson(v3AuthCredentialRes) as { id: string };

  const v3MonitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      name: "Port 4",
      type: "snmp",
      target: "10.0.0.50",
      snmpCredentialId: v3AuthCredential.id,
      snmpOid: "1.3.6.1.2.1.2.2.1.8.4",
      snmpExpectedValue: "1",
      snmpIfIndex: 4,
      enabled: true,
    },
  });
  assert.equal(v3MonitorRes.statusCode, 200);
  const v3Monitor = readJson(v3MonitorRes) as { id: string };

  await handleTrapPacket(
    buildSnmpV3TrapPacket({
      user: "trap-user",
      authPassword: "authpass123",
      trapOid: SNMP_TRAP_LINK_DOWN_OID,
      ifIndex: 4,
    }),
    "10.0.0.50",
  );

  const v3DownRes = await app.inject({
    method: "GET",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    query: { deviceId: device.id },
  });
  const v3DownMonitors = readJson(v3DownRes) as Array<{
    id: string;
    lastResult?: string;
  }>;
  assert.equal(
    v3DownMonitors.find((entry) => entry.id === v3Monitor.id)?.lastResult,
    "offline",
  );

  const v3PrivCredentialRes = await app.inject({
    method: "POST",
    url: "/api/snmp-credentials",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Home v3 private traps",
      version: "3",
      v3User: "trap-private",
      v3AuthProto: "SHA",
      v3AuthPassword: "authpass456",
      v3PrivProto: "AES128",
      v3PrivPassword: "privpass456",
    },
  });
  assert.equal(v3PrivCredentialRes.statusCode, 201);
  const v3PrivCredential = readJson(v3PrivCredentialRes) as { id: string };

  const v3PrivMonitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      name: "Port 5",
      type: "snmp",
      target: "10.0.0.50",
      snmpCredentialId: v3PrivCredential.id,
      snmpOid: "1.3.6.1.2.1.2.2.1.8.5",
      snmpExpectedValue: "1",
      snmpIfIndex: 5,
      enabled: true,
    },
  });
  assert.equal(v3PrivMonitorRes.statusCode, 200);
  const v3PrivMonitor = readJson(v3PrivMonitorRes) as { id: string };

  await handleTrapPacket(
    buildSnmpV3TrapPacket({
      user: "trap-private",
      authPassword: "authpass456",
      privProtocol: "AES128",
      privPassword: "privpass456",
      trapOid: SNMP_TRAP_LINK_UP_OID,
      ifIndex: 5,
    }),
    "10.0.0.50",
  );

  const v3PrivUpRes = await app.inject({
    method: "GET",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    query: { deviceId: device.id },
  });
  const v3PrivUpMonitors = readJson(v3PrivUpRes) as Array<{
    id: string;
    lastResult?: string;
  }>;
  assert.equal(
    v3PrivUpMonitors.find((entry) => entry.id === v3PrivMonitor.id)?.lastResult,
    "online",
  );
});

test("snmp inventory sync preview and merge apply require feature flag and admin apply", async () => {
  const adminToken = await bootstrapAdmin();
  const editorToken = await createUserAndLogin(adminToken, {
    username: "editor-snmp-sync",
    displayName: "Editor Sync",
    password: "editor-snmp-sync-1",
    role: "editor",
  });

  const disabledRes = await app.inject({
    method: "GET",
    url: "/api/snmp-sync/profiles",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(disabledRes.statusCode, 200);

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "sync-switch",
      deviceType: "switch",
      managementIp: "10.0.0.88",
      status: "unknown",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const { buildSnmpSyncPreview } = await import("../lib/snmp-sync.js");
  const preview = buildSnmpSyncPreview({
    profileId: "q-bridge-vlans",
    deviceId: device.id,
    labId: "lab_home",
    target: "10.0.0.88",
    policy: "merge",
    collection: {
      vlans: [{ vlanNumber: 44, name: "Sync VLAN" }],
      subnets: [],
      dhcpScopes: [],
    },
  });

  const editorApplyRes = await app.inject({
    method: "POST",
    url: "/api/snmp-sync/apply",
    headers: {
      authorization: `Bearer ${editorToken}`,
    },
    payload: { preview, policy: "merge" },
  });
  assert.equal(editorApplyRes.statusCode, 403);

  const applyRes = await app.inject({
    method: "POST",
    url: "/api/snmp-sync/apply",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: { preview, policy: "merge" },
  });
  assert.equal(applyRes.statusCode, 200);
  const applied = readJson(applyRes) as { createdVlanIds: string[] };
  assert.equal(applied.createdVlanIds.length, 1);

  const vlanRes = await app.inject({
    method: "GET",
    url: "/api/vlans?labId=lab_home",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  const vlans = readJson(vlanRes) as Array<{ vlanId: number; name: string }>;
  assert.ok(
    vlans.some((entry) => entry.vlanId === 44 && entry.name === "Sync VLAN"),
  );
});

test("ports can be updated and deleted with a custom MAC address", async () => {
  const adminToken = await bootstrapAdmin();

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "port-mac-test",
      deviceType: "switch",
      status: "online",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const createRes = await app.inject({
    method: "POST",
    url: "/api/ports",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      name: "Gi0/1",
      kind: "rj45",
      linkState: "down",
      mode: "access",
      macAddress: "aa:bb:cc:dd:ee:01",
    },
  });
  assert.equal(createRes.statusCode, 201);
  const created = readJson(createRes) as {
    id: string;
    macAddress?: string | null;
  };
  assert.equal(created.macAddress, "aa:bb:cc:dd:ee:01");

  const patchRes = await app.inject({
    method: "PATCH",
    url: `/api/ports/${created.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      name: "Gi0/1-updated",
      macAddress: "aabbccddeeff",
      linkState: "up",
      speed: "1G",
    },
  });
  assert.equal(patchRes.statusCode, 200);
  const updated = readJson(patchRes) as {
    name: string;
    macAddress?: string | null;
    linkState: string;
    speed?: string | null;
  };
  assert.equal(updated.name, "Gi0/1-updated");
  assert.equal(updated.macAddress, "aa:bb:cc:dd:ee:ff");
  assert.equal(updated.linkState, "up");
  assert.equal(updated.speed, "1G");

  const deleteRes = await app.inject({
    method: "DELETE",
    url: `/api/ports/${created.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(deleteRes.statusCode, 204);

  const listRes = await app.inject({
    method: "GET",
    url: `/api/ports?deviceId=${device.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(listRes.statusCode, 200);
  const ports = readJson(listRes) as Array<{ id: string }>;
  assert.equal(ports.length, 0);
});

test("wifi ports and device services can be managed", async () => {
  const adminToken = await bootstrapAdmin();

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "wifi-client",
      deviceType: "endpoint",
      status: "online",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const portRes = await app.inject({
    method: "POST",
    url: "/api/ports",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      name: "WiFi",
      kind: "wifi",
      linkState: "up",
      speed: "5GHz",
    },
  });
  assert.equal(portRes.statusCode, 201);
  const port = readJson(portRes) as { id: string; kind: string };
  assert.equal(port.kind, "wifi");

  const monitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      name: "HTTPS",
      type: "https",
      target: "192.168.80.20",
      port: 443,
      path: "/",
      enabled: true,
    },
  });
  assert.equal(monitorRes.statusCode, 200);
  const monitor = readJson(monitorRes) as { id: string };

  const serviceRes = await app.inject({
    method: "POST",
    url: "/api/device-services",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      name: "Web UI",
      serviceType: "https",
      portId: port.id,
      monitorId: monitor.id,
      url: "https://192.168.80.20/",
    },
  });
  assert.equal(serviceRes.statusCode, 201);
  const service = readJson(serviceRes) as {
    id: string;
    serviceType: string;
    portId: string;
    monitorId: string;
  };
  assert.equal(service.serviceType, "https");
  assert.equal(service.portId, port.id);
  assert.equal(service.monitorId, monitor.id);

  const servicesRes = await app.inject({
    method: "GET",
    url: `/api/device-services?deviceId=${device.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(servicesRes.statusCode, 200);
  assert.equal((readJson(servicesRes) as unknown[]).length, 1);

  const updateRes = await app.inject({
    method: "PATCH",
    url: `/api/device-services/${service.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      name: "Secure Web UI",
      serviceType: "app",
    },
  });
  assert.equal(updateRes.statusCode, 200);
  assert.equal(
    (readJson(updateRes) as { serviceType: string }).serviceType,
    "app",
  );

  const deleteRes = await app.inject({
    method: "DELETE",
    url: `/api/device-services/${service.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(deleteRes.statusCode, 204);
});

test("discovery scans require lab write access", async () => {
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

  assert.equal(scanRes.statusCode, 200);
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

test("ip assignments can be updated in place for device-linked addresses", async () => {
  const adminToken = await bootstrapAdmin();

  const subnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.0.30.0/24",
      name: "Device edit LAN",
    },
  });
  assert.equal(subnetRes.statusCode, 201);
  const subnet = readJson(subnetRes) as { id: string };

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "edit-ip-host",
      deviceType: "server",
      status: "online",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const createRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      ipAddress: "10.0.30.40",
      assignmentType: "device",
      deviceId: device.id,
      hostname: "edit-ip-host",
      description: "Initial management IP",
    },
  });
  assert.equal(createRes.statusCode, 201);
  const assignment = readJson(createRes) as { id: string; description: string };

  const updateRes = await app.inject({
    method: "PATCH",
    url: `/api/ip-assignments/${assignment.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      ipAddress: "10.0.30.41",
      description: "Updated management IP",
      assignmentType: "device",
    },
  });
  assert.equal(updateRes.statusCode, 200);
  const updated = readJson(updateRes) as {
    ipAddress: string;
    description: string;
  };
  assert.equal(updated.ipAddress, "10.0.30.41");
  assert.equal(updated.description, "Updated management IP");
});

test("ip assignments support DHCP reservations and protect technical IPs", async () => {
  const adminToken = await bootstrapAdmin();

  const subnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "192.168.50.0/24",
      name: "Reservation LAN",
    },
  });
  assert.equal(subnetRes.statusCode, 201);
  const subnet = readJson(subnetRes) as { id: string };

  const scopeRes = await app.inject({
    method: "POST",
    url: "/api/dhcp-scopes",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      name: "Main",
      startIp: "192.168.50.10",
      endIp: "192.168.50.20",
      gateway: "192.168.50.1",
      dnsServers: ["192.168.50.2"],
    },
  });
  assert.equal(scopeRes.statusCode, 201);
  const scope = readJson(scopeRes) as { id: string };

  const dhcpZoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-zones",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      kind: "dhcp",
      startIp: "192.168.50.15",
      endIp: "192.168.50.20",
      description: "Client DHCP pool",
    },
  });
  assert.equal(dhcpZoneRes.statusCode, 201);

  const staticInDhcpRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      ipAddress: "192.168.50.10",
      assignmentType: "device",
      hostname: "static-inside-dhcp",
    },
  });
  assert.equal(staticInDhcpRes.statusCode, 400);
  assert.match(staticInDhcpRes.body, /DHCP reservations/i);

  const reservationOutsideZoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      ipAddress: "192.168.50.10",
      assignmentType: "device",
      allocationMode: "dhcp-reservation",
      dhcpScopeId: scope.id,
      hostname: "reservation-outside-zone",
    },
  });
  assert.equal(reservationOutsideZoneRes.statusCode, 400);
  assert.match(reservationOutsideZoneRes.body, /DHCP IP zone/i);

  const reservationRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      ipAddress: "192.168.50.15",
      assignmentType: "device",
      allocationMode: "dhcp-reservation",
      dhcpScopeId: scope.id,
      hostname: "reserved-device",
    },
  });
  assert.equal(reservationRes.statusCode, 201);
  const reservation = readJson(reservationRes) as {
    assignmentType: string;
    allocationMode: string;
    dhcpScopeId: string;
  };
  assert.equal(reservation.assignmentType, "device");
  assert.equal(reservation.allocationMode, "dhcp-reservation");
  assert.equal(reservation.dhcpScopeId, scope.id);

  const gatewayDeviceRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      ipAddress: "192.168.50.1",
      assignmentType: "device",
      hostname: "gateway-overwrite",
    },
  });
  assert.equal(gatewayDeviceRes.statusCode, 400);
  assert.match(gatewayDeviceRes.body, /gateway/i);

  const dnsInterfaceRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      ipAddress: "192.168.50.2",
      assignmentType: "interface",
      hostname: "dns-overwrite",
    },
  });
  assert.equal(dnsInterfaceRes.statusCode, 201);
  const dnsInterface = readJson(dnsInterfaceRes) as {
    assignmentType: string;
    ipAddress: string;
  };
  assert.equal(dnsInterface.assignmentType, "interface");
  assert.equal(dnsInterface.ipAddress, "192.168.50.2");

  const firewallRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "gateway-firewall",
      deviceType: "firewall",
      status: "online",
    },
  });
  assert.equal(firewallRes.statusCode, 201);
  const firewall = readJson(firewallRes) as { id: string };

  const technicalLinkedRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      ipAddress: "192.168.50.1",
      assignmentType: "infrastructure",
      deviceId: firewall.id,
      hostname: "gateway-firewall",
      description: "Main gateway",
    },
  });
  assert.equal(technicalLinkedRes.statusCode, 201);
  const technicalLinked = readJson(technicalLinkedRes) as {
    assignmentType: string;
    deviceId: string;
  };
  assert.equal(technicalLinked.assignmentType, "infrastructure");
  assert.equal(technicalLinked.deviceId, firewall.id);
});

test("static IP zones override broad DHCP scopes for host assignments", async () => {
  const adminToken = await bootstrapAdmin();

  const subnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.0.21.0/24",
      name: "Server Network",
    },
  });
  assert.equal(subnetRes.statusCode, 201);
  const subnet = readJson(subnetRes) as { id: string };

  const scopeRes = await app.inject({
    method: "POST",
    url: "/api/dhcp-scopes",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      name: "general-client-pool",
      startIp: "10.0.21.1",
      endIp: "10.0.21.254",
      gateway: "10.0.21.1",
      dnsServers: ["1.1.1.1"],
    },
  });
  assert.equal(scopeRes.statusCode, 201);

  const staticZoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-zones",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      kind: "static",
      startIp: "10.0.21.30",
      endIp: "10.0.21.149",
      description: "Static addresses for infrastructure",
    },
  });
  assert.equal(staticZoneRes.statusCode, 201);

  const dhcpZoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-zones",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      kind: "dhcp",
      startIp: "10.0.21.150",
      endIp: "10.0.21.250",
      description: "General client pool",
    },
  });
  assert.equal(dhcpZoneRes.statusCode, 201);

  const staticAssignmentRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      ipAddress: "10.0.21.33",
      assignmentType: "device",
      allocationMode: "static",
      hostname: "server-static-33",
    },
  });
  assert.equal(staticAssignmentRes.statusCode, 201, staticAssignmentRes.body);
  const staticAssignment = readJson(staticAssignmentRes) as {
    allocationMode: string;
    dhcpScopeId: string | null;
  };
  assert.equal(staticAssignment.allocationMode, "static");
  assert.equal(staticAssignment.dhcpScopeId, null);

  const staticInsideDhcpZoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      ipAddress: "10.0.21.151",
      assignmentType: "device",
      allocationMode: "static",
      hostname: "client-static-151",
    },
  });
  assert.equal(staticInsideDhcpZoneRes.statusCode, 400);
  assert.match(staticInsideDhcpZoneRes.body, /DHCP reservations/i);
});

test("documentation pages can be linked to devices", async () => {
  const adminToken = await bootstrapAdmin();

  const pageRes = await app.inject({
    method: "POST",
    url: "/api/documentation",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      labId: "lab_home",
      title: "Switch runbook",
      content: "Console access notes",
    },
  });
  assert.equal(pageRes.statusCode, 201);
  const page = readJson(pageRes) as { id: string };

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      labId: "lab_home",
      hostname: "core-switch",
      deviceType: "switch",
      status: "online",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const linkRes = await app.inject({
    method: "POST",
    url: `/api/documentation/${page.id}/device-links`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { deviceId: device.id },
  });
  assert.equal(linkRes.statusCode, 201);

  const byDeviceRes = await app.inject({
    method: "GET",
    url: `/api/documentation/links?deviceId=${device.id}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(byDeviceRes.statusCode, 200);
  const links = readJson(byDeviceRes) as Array<{ deviceId: string }>;
  assert.equal(links.length, 1);
  assert.equal(links[0]?.deviceId, device.id);

  const unlinkRes = await app.inject({
    method: "DELETE",
    url: `/api/documentation/${page.id}/device-links/${device.id}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(unlinkRes.statusCode, 204);
});

test("netbox device import creates a device with ports", async () => {
  const adminToken = await bootstrapAdmin();
  const yaml = `
manufacturer: Cisco
model: Catalyst 9300-24T
u_height: 1
interfaces:
  - name: GigabitEthernet1/0/1
    type: 1000base-t
`.trim();

  const importRes = await app.inject({
    method: "POST",
    url: "/api/imports/netbox-device-type/import",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      yaml,
      mode: "device",
      labId: "lab_home",
      hostname: "c9300-lab",
    },
  });
  assert.equal(importRes.statusCode, 201);
  const imported = readJson(importRes) as {
    mode: string;
    device: { hostname: string; heightU: number; manufacturer: string };
    ports: Array<{ name: string }>;
  };
  assert.equal(imported.mode, "device");
  assert.equal(imported.device.hostname, "c9300-lab");
  assert.equal(imported.device.heightU, 1);
  assert.equal(imported.device.manufacturer, "Cisco");
  assert.equal(imported.ports.length, 1);
  assert.equal(imported.ports[0]?.name, "GigabitEthernet1/0/1");
});

test("netbox device import accepts 0U access points", async () => {
  const adminToken = await bootstrapAdmin();
  const yaml = `
manufacturer: Ubiquiti
model: UAP-AC-PRO
slug: ubiquiti-uap-ac-pro
u_height: 0
interfaces:
  - name: eth0
    type: 1000base-t
`.trim();

  const importRes = await app.inject({
    method: "POST",
    url: "/api/imports/netbox-device-type/import",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      yaml,
      mode: "device",
      labId: "lab_home",
      hostname: "uap-ac-pro",
    },
  });
  assert.equal(importRes.statusCode, 201);
  const imported = readJson(importRes) as {
    mode: string;
    device: {
      hostname: string;
      heightU: number | null;
      placement: string;
      deviceType: string;
    };
    ports: Array<{ name: string }>;
  };
  assert.equal(imported.mode, "device");
  assert.equal(imported.device.hostname, "uap-ac-pro");
  assert.equal(imported.device.heightU, null);
  assert.equal(imported.device.placement, "wireless");
  assert.equal(imported.device.deviceType, "ap");
  assert.equal(imported.ports.length, 1);
  assert.equal(imported.ports[0]?.name, "eth0");
});

test("docker import stores a sync source and refreshes container status", async () => {
  const adminToken = await bootstrapAdmin();
  const viewerToken = await createUserAndLogin(adminToken, {
    username: "viewer-docker",
    displayName: "Viewer Docker",
    password: "viewer-docker-1",
    role: "viewer",
  });
  const hostRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      labId: "lab_home",
      hostname: "docker-host-01",
      deviceType: "server",
      status: "online",
    },
  });
  assert.equal(hostRes.statusCode, 201);
  const host = readJson(hostRes) as { id: string };

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  const authHeaders: Array<string | null> = [];
  let state = "running";
  let status = "Up 3 minutes";
  globalThis.fetch = (async (url, init) => {
    requestedUrls.push(String(url));
    const headers = init?.headers as Record<string, string> | undefined;
    authHeaders.push(headers?.Authorization ?? null);
    return new Response(
      JSON.stringify([
        {
          Id: "container-abc123",
          Names: ["/paperless"],
          Image: "ghcr.io/paperless:latest",
          State: state,
          Status: status,
        },
      ]),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const viewerPreviewRes = await app.inject({
      method: "POST",
      url: "/api/imports/docker/preview",
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: {
        labId: "lab_home",
        endpoint: "https://8.8.8.8/api/endpoints/2/docker/",
      },
    });
    assert.equal(viewerPreviewRes.statusCode, 403);

    const importRes = await app.inject({
      method: "POST",
      url: "/api/imports/docker/import",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        endpoint: "https://8.8.8.8/api/endpoints/2/docker/",
        token: "portainer-token",
        containerId: "container-abc123",
        labId: "lab_home",
        hostDeviceId: host.id,
      },
    });
    assert.equal(importRes.statusCode, 201);
    const imported = readJson(importRes) as {
      id: string;
      hostname: string;
      status: string;
      specs: string;
    };
    assert.equal(imported.hostname, "paperless");
    assert.equal(imported.status, "online");
    assert.equal(imported.specs, "docker-image: ghcr.io/paperless:latest");
    assert.equal(
      requestedUrls[0],
      "https://8.8.8.8/api/endpoints/2/docker/containers/json?all=1",
    );
    assert.equal(authHeaders[0], "Bearer portainer-token");

    const source = db
      .prepare("SELECT * FROM dockerImportSources WHERE labId = ?")
      .get("lab_home") as {
      id: string;
      endpoint: string;
      tokenEnc: string | null;
    };
    assert.equal(
      source.endpoint,
      "https://8.8.8.8/api/endpoints/2/docker",
    );
    assert.ok(source.tokenEnc);
    assert.notEqual(source.tokenEnc, "portainer-token");

    const link = db
      .prepare("SELECT * FROM dockerContainerLinks WHERE deviceId = ?")
      .get(imported.id) as {
      sourceId: string;
      containerId: string;
      state: string;
    };
    assert.equal(link.sourceId, source.id);
    assert.equal(link.containerId, "container-abc123");
    assert.equal(link.state, "running");

    state = "exited";
    status = "Exited (0) 10 seconds ago";
    const syncRes = await app.inject({
      method: "POST",
      url: "/api/imports/docker/sync",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { labId: "lab_home" },
    });
    assert.equal(syncRes.statusCode, 200);
    const sync = readJson(syncRes) as {
      updated: number;
      missing: number;
      failed: number;
      devices: Array<{ id: string; status: string }>;
    };
    assert.equal(sync.updated, 1);
    assert.equal(sync.missing, 0);
    assert.equal(sync.failed, 0);
    assert.equal(sync.devices[0]?.id, imported.id);
    assert.equal(sync.devices[0]?.status, "offline");

    const updatedLink = db
      .prepare("SELECT state, status FROM dockerContainerLinks WHERE deviceId = ?")
      .get(imported.id) as { state: string; status: string };
    assert.equal(updatedLink.state, "exited");
    assert.equal(updatedLink.status, "Exited (0) 10 seconds ago");
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    DELETE FROM deviceServices;
    DELETE FROM deviceMonitors;
    DELETE FROM dockerContainerLinks;
    DELETE FROM dockerImportSources;
    DELETE FROM appSettings;
    DELETE FROM auditLog;
    DELETE FROM referenceImages;
    DELETE FROM deviceImages;
    DELETE FROM documentationPages;
    DELETE FROM documentationDeviceLinks;
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
    DELETE FROM rooms;
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

async function createSnmpIntegerResponder(value: number) {
  const server = dgram.createSocket("udp4");
  server.on("message", (packet, remote) => {
    try {
      const response = buildSnmpIntegerResponse(packet, value);
      server.send(response, remote.port, remote.address);
    } catch {
      // Ignore malformed SNMP packets in the test responder.
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.bind(0, "127.0.0.1");
  });

  return server;
}

function closeUdpServer(server: dgram.Socket) {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function buildSnmpIntegerResponse(request: Buffer, value: number) {
  const parsed = parseSnmpRequest(request);
  const variableBinding = testBerSequence(
    Buffer.concat([testBerTlv(0x06, parsed.oid), testBerInteger(value)]),
  );
  const variableBindings = testBerSequence(variableBinding);
  const pdu = testBerTlv(
    0xa2,
    Buffer.concat([
      testBerTlv(0x02, parsed.requestId),
      testBerInteger(0),
      testBerInteger(0),
      variableBindings,
    ]),
  );

  return testBerSequence(
    Buffer.concat([
      testBerTlv(0x02, parsed.version),
      testBerTlv(0x04, parsed.community),
      pdu,
    ]),
  );
}

function parseSnmpRequest(packet: Buffer) {
  const root = readTestTlv(packet, 0);
  if (root.tag !== 0x30) throw new Error("SNMP request root was invalid.");
  let offset = root.valueStart;
  const version = readTestTlv(packet, offset);
  offset = version.nextOffset;
  const community = readTestTlv(packet, offset);
  offset = community.nextOffset;
  const pdu = readTestTlv(packet, offset);
  offset = pdu.valueStart;
  const requestId = readTestTlv(packet, offset);
  offset = requestId.nextOffset;
  offset = readTestTlv(packet, offset).nextOffset;
  offset = readTestTlv(packet, offset).nextOffset;
  const variableBindings = readTestTlv(packet, offset);
  const variableBinding = readTestTlv(packet, variableBindings.valueStart);
  const oid = readTestTlv(packet, variableBinding.valueStart);
  return {
    version: version.value,
    community: community.value,
    requestId: requestId.value,
    oid: oid.value,
  };
}

function testBerInteger(value: number) {
  if (value === 0) return testBerTlv(0x02, Buffer.from([0]));
  const bytes: number[] = [];
  let next = value;
  while (next > 0) {
    bytes.unshift(next & 0xff);
    next >>= 8;
  }
  if (bytes[0] >= 0x80) bytes.unshift(0);
  return testBerTlv(0x02, Buffer.from(bytes));
}

function testBerSequence(value: Buffer) {
  return testBerTlv(0x30, value);
}

function testBerTlv(tag: number, value: Buffer) {
  return Buffer.concat([
    Buffer.from([tag]),
    testBerLength(value.length),
    value,
  ]);
}

function testBerLength(length: number) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let next = length;
  while (next > 0) {
    bytes.unshift(next & 0xff);
    next >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function readTestTlv(packet: Buffer, offset: number) {
  const tag = packet[offset];
  const lengthByte = packet[offset + 1];
  if (tag == null || lengthByte == null) {
    throw new Error("SNMP test packet was truncated.");
  }

  let length = lengthByte;
  let valueStart = offset + 2;
  if (lengthByte & 0x80) {
    const byteCount = lengthByte & 0x7f;
    length = 0;
    for (let index = 0; index < byteCount; index += 1) {
      const byte = packet[valueStart + index];
      if (byte == null)
        throw new Error("SNMP test packet length was truncated.");
      length = (length << 8) | byte;
    }
    valueStart += byteCount;
  }

  const nextOffset = valueStart + length;
  if (nextOffset > packet.length) {
    throw new Error("SNMP test packet value was truncated.");
  }
  return {
    tag,
    valueStart,
    nextOffset,
    value: packet.subarray(valueStart, nextOffset),
  };
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

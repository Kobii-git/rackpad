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
import { execFileSync } from "node:child_process";

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
const { setDockerHttpJsonFetcherForTests } =
  await import("../lib/docker-import.js");
const { resetLocalUserPassword } = await import("../lib/password-reset.js");
const { parseIeeeOuiText } = await import("../lib/oui.js");
const { cidrOverlaps, ipToInt } = await import("../lib/ip-cidr.js");
const { resolveSnmpSessionForTarget } = await import("../lib/snmp-session.js");
const {
  setNetworkHostLookupForTests,
  setPinnedRequestTransportForTests,
} = await import("../lib/net-guard.js");
const {
  expandDiscoveryCidrs,
  expandDiscoveryScanChunks,
  parseArpScanOutput,
  parseNmapPingScanOutput,
  resetDiscoveryScanJobsForTests,
  setDiscoveryScanRunnerForTests,
} = await import("../routes/discovery.js");

type AppInstance = Awaited<ReturnType<typeof createApp>>;

let app: AppInstance;

beforeEach(async () => {
  delete process.env.DISCOVERY_SCAN_MAX_ACTIVE;
  delete process.env.DISCOVERY_SCAN_MAX_ACTIVE_PER_LAB;
  delete process.env.DISCOVERY_SCAN_MAX_QUEUED;
  resetDatabase();
  ensureSpaIndex();
  app = await createApp();
});

afterEach(async () => {
  resetDiscoveryScanJobsForTests();
  setNetworkHostLookupForTests(null);
  setPinnedRequestTransportForTests(null);
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

test("CLI password reset rotates a local password and invalidates only that user's sessions", async () => {
  const adminToken = await bootstrapAdmin();
  const viewerToken = await createUserAndLogin(adminToken, {
    username: "viewer-reset",
    displayName: "Viewer Reset",
    password: "viewer-password-1",
    role: "viewer",
  });
  const editorToken = await createUserAndLogin(adminToken, {
    username: "editor-reset",
    displayName: "Editor Reset",
    password: "editor-password-1",
    role: "editor",
  });

  const result = resetLocalUserPassword({
    username: "VIEWER-RESET",
    password: "viewer-password-2",
  });

  assert.equal(result.username, "viewer-reset");
  assert.equal(result.sessionsInvalidated, 1);

  const oldLoginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "viewer-reset",
      password: "viewer-password-1",
    },
  });
  assert.equal(oldLoginRes.statusCode, 401);

  const newLoginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "viewer-reset",
      password: "viewer-password-2",
    },
  });
  assert.equal(newLoginRes.statusCode, 200);

  const oldSessionRes = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: {
      authorization: `Bearer ${viewerToken}`,
    },
  });
  assert.equal(oldSessionRes.statusCode, 401);

  const otherSessionRes = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: {
      authorization: `Bearer ${editorToken}`,
    },
  });
  assert.equal(otherSessionRes.statusCode, 200);

  const audit = db
    .prepare(
      `
      SELECT user, action, entityType, entityId, summary
      FROM auditLog
      WHERE action = 'user.password_reset.cli'
    `,
    )
    .get() as
    | {
        user: string;
        action: string;
        entityType: string;
        entityId: string;
        summary: string;
      }
    | undefined;

  assert.ok(audit);
  assert.equal(audit.user, "system");
  assert.equal(audit.entityType, "User");
  assert.equal(audit.entityId, result.userId);
  assert.match(audit.summary, /viewer-reset/);
});

test("CLI password reset rejects missing, weak, OIDC, and non-local users", () => {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO users (id, username, displayName, passwordHash, role, disabled, createdAt, lastLoginAt)
    VALUES (?, ?, ?, ?, ?, 0, ?, NULL)
  `,
  ).run(
    "u_oidc_reset",
    "oidc-reset",
    "OIDC Reset",
    "oidc:issuer:subject",
    "viewer",
    now,
  );
  db.prepare(
    `
    INSERT INTO oidcIdentities (issuer, subject, userId, email, displayName, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "https://idp.example.com",
    "subject-reset",
    "u_oidc_reset",
    "oidc-reset@example.com",
    "OIDC Reset",
    now,
    now,
  );
  db.prepare(
    `
    INSERT INTO users (id, username, displayName, passwordHash, role, disabled, createdAt, lastLoginAt)
    VALUES (?, ?, ?, ?, ?, 0, ?, NULL)
  `,
  ).run(
    "u_marker_reset",
    "marker-reset",
    "Marker Reset",
    "legacy:password-marker",
    "viewer",
    now,
  );

  assert.throws(
    () =>
      resetLocalUserPassword({
        username: "missing-reset",
        password: "new-password-1",
      }),
    /User not found/,
  );
  assert.throws(
    () =>
      resetLocalUserPassword({
        username: "oidc-reset",
        password: "new-password-1",
      }),
    /identity provider/,
  );
  assert.throws(
    () =>
      resetLocalUserPassword({
        username: "marker-reset",
        password: "new-password-1",
      }),
    /local password accounts/,
  );
  assert.throws(
    () =>
      resetLocalUserPassword({
        username: "marker-reset",
        password: "short",
      }),
    /at least 10 characters/,
  );
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
  const demoToken = (readJson(demoBootstrapRes) as { token: string }).token;

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

  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

  const builtInTypes = [
    "switch",
    "router",
    "firewall",
    "server",
    "rack_shelf",
    "ap",
    "endpoint",
    "vm",
    "container",
    "patch_panel",
    "brush_panel",
    "blanking_panel",
    "storage",
    "pdu",
    "ups",
    "kvm",
    "other",
  ];
  const seededTypes = new Set(
    (
      db.prepare("SELECT DISTINCT deviceType FROM devices").all() as Array<{
        deviceType: string;
      }>
    ).map((row) => row.deviceType),
  );
  for (const deviceType of builtInTypes) {
    assert.ok(seededTypes.has(deviceType), `missing device type ${deviceType}`);
  }
  assert.ok(seededTypes.has("laser_cutter"));
  assert.ok(
    db
      .prepare(
        "SELECT id FROM discoveredDevices WHERE importedDeviceId = 'd_laser_cutter' AND status = 'imported'",
      )
      .get(),
  );

  const requiredPortKinds = [
    "rj45",
    "sfp",
    "sfp_plus",
    "qsfp",
    "fiber",
    "power",
    "console",
    "usb",
    "virtual",
    "wifi",
  ];
  const seededPortKinds = new Set(
    (
      db.prepare("SELECT DISTINCT kind FROM ports").all() as Array<{
        kind: string;
      }>
    ).map((row) => row.kind),
  );
  for (const kind of requiredPortKinds) {
    assert.ok(seededPortKinds.has(kind), `missing port kind ${kind}`);
  }
  assert.ok(
    db
      .prepare(
        "SELECT id FROM ports WHERE mode = 'trunk' AND allowedVlanIds IS NOT NULL",
      )
      .get(),
  );
  assert.ok(
    db.prepare("SELECT id FROM ports WHERE portRole = 'aggregate'").get(),
  );
  assert.equal(
    Number(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM ports WHERE aggregatePortId IS NOT NULL",
          )
          .get() as { count: number }
      ).count,
    ),
    2,
  );
  assert.ok(
    db.prepare("SELECT id FROM virtualSwitches WHERE kind = 'external'").get(),
  );
  assert.ok(
    db.prepare("SELECT id FROM virtualSwitches WHERE kind = 'internal'").get(),
  );

  const requiredMonitorTypes = ["icmp", "tcp", "http", "https", "snmp"];
  const monitorTypes = new Set(
    (
      db.prepare("SELECT DISTINCT type FROM deviceMonitors").all() as Array<{
        type: string;
      }>
    ).map((row) => row.type),
  );
  for (const type of requiredMonitorTypes) {
    assert.ok(monitorTypes.has(type), `missing monitor type ${type}`);
  }
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM deviceMonitors WHERE enabled != 0",
        )
        .get() as { count: number }
    ).count,
    0,
  );
  const demoV3Before = db
    .prepare("SELECT * FROM deviceMonitors WHERE id = 'mon_ups_snmp_v3'")
    .get() as Record<string, unknown>;
  assert.equal(demoV3Before.snmpVersion, "3");
  assert.equal(demoV3Before.snmpCommunity, null);
  assert.equal(demoV3Before.snmpMatchMode, "any");
  const demoV3RoundTripRes = await app.inject({
    method: "PATCH",
    url: "/api/device-monitors/mon_ups_snmp_v3",
    headers: { authorization: `Bearer ${demoToken}` },
    payload: { enabled: false },
  });
  assert.equal(demoV3RoundTripRes.statusCode, 200, demoV3RoundTripRes.body);
  assert.deepEqual(
    db
      .prepare("SELECT * FROM deviceMonitors WHERE id = 'mon_ups_snmp_v3'")
      .get(),
    demoV3Before,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM deviceMonitors WHERE snmpCommunity IS NOT NULL AND TRIM(snmpCommunity) != ''",
        )
        .get() as { count: number }
    ).count,
    0,
  );
  assert.deepEqual(
    (
      db
        .prepare(
          "SELECT DISTINCT version FROM snmpCredentials ORDER BY version",
        )
        .all() as Array<{ version: string }>
    ).map((row) => row.version),
    ["1", "2c", "3"],
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM snmpCredentials WHERE communityEnc IS NOT NULL OR v3AuthPassEnc IS NOT NULL OR v3PrivPassEnc IS NOT NULL",
        )
        .get() as { count: number }
    ).count,
    0,
  );
  assert.ok(db.prepare("SELECT id FROM snmpTrapSources LIMIT 1").get());
  assert.ok(db.prepare("SELECT id FROM snmpTrapLog LIMIT 1").get());

  const requiredServiceTypes = [
    "dhcp",
    "dns",
    "vpn",
    "ntp",
    "snmp",
    "syslog",
    "http",
    "https",
    "database",
    "app",
    "custom",
  ];
  const serviceTypes = new Set(
    (
      db
        .prepare("SELECT DISTINCT serviceType FROM deviceServices")
        .all() as Array<{
        serviceType: string;
      }>
    ).map((row) => row.serviceType),
  );
  for (const type of requiredServiceTypes) {
    assert.ok(serviceTypes.has(type), `missing service type ${type}`);
  }

  const assignmentTypes = new Set(
    (
      db
        .prepare("SELECT DISTINCT assignmentType FROM ipAssignments")
        .all() as Array<{ assignmentType: string }>
    ).map((row) => row.assignmentType),
  );
  for (const type of [
    "device",
    "interface",
    "vm",
    "container",
    "reserved",
    "infrastructure",
  ]) {
    assert.ok(assignmentTypes.has(type), `missing assignment type ${type}`);
  }

  const semanticZones = db
    .prepare(
      "SELECT subnetId, kind, startIp, endIp FROM ipZones WHERE kind IN ('reserved', 'infrastructure')",
    )
    .all() as Array<{
    subnetId: string;
    kind: string;
    startIp: string;
    endIp: string;
  }>;
  const semanticAssignments = db
    .prepare(
      "SELECT id, subnetId, ipAddress, assignmentType FROM ipAssignments WHERE assignmentType IN ('reserved', 'infrastructure')",
    )
    .all() as Array<{
    id: string;
    subnetId: string;
    ipAddress: string;
    assignmentType: string;
  }>;
  for (const assignment of semanticAssignments) {
    const address = ipToInt(assignment.ipAddress);
    assert.ok(
      semanticZones.some(
        (zone) =>
          zone.subnetId === assignment.subnetId &&
          zone.kind === assignment.assignmentType &&
          address >= ipToInt(zone.startIp) &&
          address <= ipToInt(zone.endIp),
      ),
      `${assignment.id} is outside its ${assignment.assignmentType} zone`,
    );
  }
  assert.ok(
    db
      .prepare(
        "SELECT id FROM ipAssignments WHERE allocationMode = 'dhcp-reservation' AND dhcpScopeId IS NOT NULL",
      )
      .get(),
  );
  assert.equal(
    (
      db
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM ipAssignments a
          LEFT JOIN devices d ON d.id = a.vmId
          WHERE a.assignmentType = 'vm' AND d.id IS NULL
        `,
        )
        .get() as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM ipAssignments a
          LEFT JOIN devices d ON d.id = a.containerId
          WHERE a.assignmentType = 'container' AND d.id IS NULL
        `,
        )
        .get() as { count: number }
    ).count,
    0,
  );

  const subnets = db
    .prepare("SELECT id, labId, cidr FROM subnets ORDER BY labId, cidr")
    .all() as Array<{ id: string; labId: string; cidr: string }>;
  for (let left = 0; left < subnets.length; left += 1) {
    for (let right = left + 1; right < subnets.length; right += 1) {
      if (subnets[left].labId !== subnets[right].labId) continue;
      assert.equal(
        cidrOverlaps(subnets[left].cidr, subnets[right].cidr),
        false,
        `${subnets[left].id} overlaps ${subnets[right].id}`,
      );
    }
  }
  const dhcpZones = db
    .prepare(
      "SELECT subnetId, startIp, endIp FROM ipZones WHERE kind = 'dhcp'",
    )
    .all() as Array<{
    subnetId: string;
    startIp: string;
    endIp: string;
  }>;
  const demoDhcpScopes = db
    .prepare("SELECT id, subnetId, startIp, endIp FROM dhcpScopes")
    .all() as Array<{
    id: string;
    subnetId: string;
    startIp: string;
    endIp: string;
  }>;
  for (const scope of demoDhcpScopes) {
    assert.ok(
      dhcpZones.some(
        (zone) =>
          zone.subnetId === scope.subnetId &&
          ipToInt(scope.startIp) >= ipToInt(zone.startIp) &&
          ipToInt(scope.endIp) <= ipToInt(zone.endIp),
      ),
      `${scope.id} is not covered by a DHCP zone`,
    );
  }
  assert.equal(
    (
      db
        .prepare(
          `
          SELECT COUNT(*) AS count
          FROM devices a
          JOIN devices b ON a.id < b.id
            AND a.rackId = b.rackId
            AND COALESCE(a.face, 'front') = COALESCE(b.face, 'front')
            AND COALESCE(a.rackSlot, 'full') = COALESCE(b.rackSlot, 'full')
            AND a.startU <= b.startU + b.heightU - 1
            AND b.startU <= a.startU + a.heightU - 1
          WHERE a.rackId IS NOT NULL AND a.startU IS NOT NULL AND b.startU IS NOT NULL
        `,
        )
        .get() as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db
        .prepare(
          `
            SELECT COUNT(*) AS count FROM (
              SELECT subnetId, ipAddress
              FROM ipAssignments
              GROUP BY subnetId, ipAddress
              HAVING COUNT(*) > 1
            )
          `,
        )
        .get() as { count: number }
    ).count,
    0,
  );
  assert.deepEqual(
    (
      db
        .prepare(
          `
            SELECT DISTINCT d.id
            FROM devices d
            JOIN ports p ON p.deviceId = d.id AND p.kind = 'rj45'
            JOIN portLinks l ON l.fromPortId = p.id OR l.toPortId = p.id
            WHERE d.deviceType IN ('pdu', 'ups')
            ORDER BY d.id
          `,
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id),
    ["d_pdu_cmp", "d_pdu_net", "d_ups"],
  );
  assert.ok(
    db
      .prepare(
        `
          SELECT id
          FROM portLinks
          WHERE id = 'l_ups_pdu_power'
            AND fromPortId = 'p_d_ups_1'
            AND toPortId = 'p_d_pdu_net_input'
            AND cableType = 'IEC C19'
        `,
      )
      .get(),
  );
  assert.equal(
    (
      db
        .prepare(
          `
          SELECT COUNT(*) AS count FROM (
            SELECT portId FROM (
              SELECT fromPortId AS portId FROM portLinks
              UNION ALL
              SELECT toPortId AS portId FROM portLinks
            ) GROUP BY portId HAVING COUNT(*) > 1
          )
        `,
        )
        .get() as { count: number }
    ).count,
    0,
  );

  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM users WHERE username != 'admin' AND disabled != 1",
        )
        .get() as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM users WHERE username != 'admin' AND passwordHash LIKE 'scrypt:%'",
        )
        .get() as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM discoveryScanSchedules WHERE enabled != 0",
        )
        .get() as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM dockerImportSources WHERE enabled != 0 OR tokenEnc IS NOT NULL",
        )
        .get() as { count: number }
    ).count,
    0,
  );
  assert.ok(
    db
      .prepare(
        "SELECT id FROM discoveredDevices WHERE technicalRole IS NOT NULL",
      )
      .get(),
  );
  assert.ok(db.prepare("SELECT id FROM referenceImages LIMIT 1").get());
  assert.ok(
    db.prepare("SELECT id FROM documentationDeviceLinks LIMIT 1").get(),
  );
  const alertSettings = db
    .prepare("SELECT value FROM appSettings WHERE key = 'alertSettings'")
    .get() as { value: string };
  assert.equal(JSON.parse(alertSettings.value).enabled, false);
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

  const subnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.44.0.0/24",
      name: "Restore subnet",
      gateway: "10.44.0.1",
      dnsServers: ["10.44.0.10", "1.1.1.1"],
    },
  });
  assert.equal(subnetRes.statusCode, 201);

  const scheduleRes = await app.inject({
    method: "POST",
    url: "/api/discovery/schedules",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Restore scan",
      cidr: "10.44.0.0/24",
      intervalMs: 600_000,
      enabled: true,
    },
  });
  assert.equal(scheduleRes.statusCode, 201);

  const monitorDeviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "backup-tls-monitor",
      deviceType: "server",
      status: "unknown",
    },
  });
  assert.equal(monitorDeviceRes.statusCode, 201);
  const monitorDevice = readJson(monitorDeviceRes) as { id: string };

  const monitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: monitorDevice.id,
      name: "Self-signed backup target",
      type: "https",
      target: "self-signed-backup.example",
      ignoreTlsErrors: true,
      enabled: false,
    },
  });
  assert.equal(monitorRes.statusCode, 200);
  const monitor = readJson(monitorRes) as { id: string };

  const exportRes = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(exportRes.statusCode, 200);
  const snapshot = readJson(exportRes) as Record<string, unknown> & {
    data: {
      subnets: Array<{
        cidr: string;
        gateway?: string | null;
        dnsServers?: string[] | null;
      }>;
      discoveryScanSchedules: Array<{
        name?: string | null;
        cidr: string;
        intervalMs: number;
        enabled: number | boolean;
      }>;
      deviceMonitors: Array<{
        id: string;
        ignoreTlsErrors?: number | boolean;
      }>;
    };
  };
  const exportedSubnet = snapshot.data.subnets.find(
    (subnet) => subnet.cidr === "10.44.0.0/24",
  );
  assert.equal(exportedSubnet?.gateway, "10.44.0.1");
  assert.deepEqual(exportedSubnet?.dnsServers, ["10.44.0.10", "1.1.1.1"]);
  const exportedSchedule = snapshot.data.discoveryScanSchedules.find(
    (schedule) => schedule.cidr === "10.44.0.0/24",
  );
  assert.equal(exportedSchedule?.name, "Restore scan");
  assert.equal(exportedSchedule?.intervalMs, 600_000);
  const exportedMonitor = snapshot.data.deviceMonitors.find(
    (entry) => entry.id === monitor.id,
  );
  assert.equal(exportedMonitor?.ignoreTlsErrors, 1);

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
  assert.equal(restoreRes.statusCode, 200, restoreRes.body);

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

  const subnetsAfterRestoreRes = await app.inject({
    method: "GET",
    url: "/api/subnets?labId=lab_home",
    headers: {
      authorization: `Bearer ${refreshedToken}`,
    },
  });
  assert.equal(subnetsAfterRestoreRes.statusCode, 200);
  const subnetsAfterRestore = readJson(subnetsAfterRestoreRes) as Array<{
    cidr: string;
    gateway: string | null;
    dnsServers: string[] | null;
  }>;
  const restoredSubnet = subnetsAfterRestore.find(
    (subnet) => subnet.cidr === "10.44.0.0/24",
  );
  assert.equal(restoredSubnet?.gateway, "10.44.0.1");
  assert.deepEqual(restoredSubnet?.dnsServers, ["10.44.0.10", "1.1.1.1"]);

  const schedulesAfterRestoreRes = await app.inject({
    method: "GET",
    url: "/api/discovery/schedules?labId=lab_home",
    headers: {
      authorization: `Bearer ${refreshedToken}`,
    },
  });
  assert.equal(schedulesAfterRestoreRes.statusCode, 200);
  const schedulesAfterRestore = readJson(schedulesAfterRestoreRes) as Array<{
    name?: string | null;
    cidr: string;
    intervalMs: number;
    enabled: boolean;
  }>;
  const restoredSchedule = schedulesAfterRestore.find(
    (schedule) => schedule.cidr === "10.44.0.0/24",
  );
  assert.equal(restoredSchedule?.name, "Restore scan");
  assert.equal(restoredSchedule?.intervalMs, 600_000);
  assert.equal(restoredSchedule?.enabled, true);

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
  const restoredMonitor = db
    .prepare("SELECT ignoreTlsErrors FROM deviceMonitors WHERE id = ?")
    .get(monitor.id) as { ignoreTlsErrors: number };
  assert.equal(restoredMonitor.ignoreTlsErrors, 1);
});

test("admin restore rejects overlapping subnets without changing current data", async () => {
  const adminToken = await bootstrapAdmin();

  const subnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      labId: "lab_home",
      cidr: "10.66.0.0/24",
      name: "Restore integrity subnet",
    },
  });
  assert.equal(subnetRes.statusCode, 201);

  const exportRes = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(exportRes.statusCode, 200);
  const snapshot = readJson(exportRes) as Record<string, unknown> & {
    data: { subnets: Array<Record<string, unknown>> };
  };
  snapshot.data.subnets.push({
    ...snapshot.data.subnets[0],
    id: "subnet_restore_overlap",
    labId: "lab_home",
    cidr: "10.66.0.128/25",
    name: "Overlapping restore subnet",
  });

  const rackRes = await app.inject({
    method: "POST",
    url: "/api/racks",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      labId: "lab_home",
      name: "Must survive rejected restore",
      totalU: 42,
    },
  });
  assert.equal(rackRes.statusCode, 201);

  const restoreRes = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: snapshot,
  });
  assert.equal(restoreRes.statusCode, 409);
  assert.equal(
    (readJson(restoreRes) as { code: string }).code,
    "SUBNET_OVERLAP",
  );

  const racksRes = await app.inject({
    method: "GET",
    url: "/api/racks?labId=lab_home",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(racksRes.statusCode, 200);
  assert.equal(
    (readJson(racksRes) as Array<{ name: string }>).some(
      (rack) => rack.name === "Must survive rejected restore",
    ),
    true,
  );
});

test("admin restore rejects invalid IPAM children atomically with structured details", async () => {
  const adminToken = await bootstrapAdmin();
  const headers = { authorization: `Bearer ${adminToken}` };
  const subnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers,
    payload: {
      labId: "lab_home",
      cidr: "10.67.0.0/24",
      name: "Restore child validation",
      gateway: "10.67.0.1",
    },
  });
  assert.equal(subnetRes.statusCode, 201);
  const subnet = readJson(subnetRes) as { id: string };

  const exportRes = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers,
  });
  const snapshot = readJson(exportRes) as Record<string, unknown> & {
    data: {
      subnets: Array<Record<string, unknown>>;
      dhcpScopes: Array<Record<string, unknown>>;
      ipZones: Array<Record<string, unknown>>;
      ipAssignments: Array<Record<string, unknown>>;
    };
  };
  snapshot.data.dhcpScopes.push({
    id: "scope_restore_valid",
    subnetId: subnet.id,
    name: "Valid restore scope",
    startIp: "10.67.0.100",
    endIp: "10.67.0.150",
  });
  snapshot.data.ipZones.push({
    id: "zone_restore_valid",
    subnetId: subnet.id,
    kind: "dhcp",
    startIp: "10.67.0.100",
    endIp: "10.67.0.150",
  });
  snapshot.data.ipAssignments.push({
    id: "assignment_restore_valid",
    subnetId: subnet.id,
    ipAddress: "10.67.0.110",
    assignmentType: "device",
    allocationMode: "dhcp-reservation",
    dhcpScopeId: "scope_restore_valid",
  });

  const rackRes = await app.inject({
    method: "POST",
    url: "/api/racks",
    headers,
    payload: {
      labId: "lab_home",
      name: "Atomic restore sentinel",
      totalU: 42,
    },
  });
  assert.equal(rackRes.statusCode, 201);

  const cases: Array<{
    entityType: string;
    entityId: string;
    mutate: (copy: typeof snapshot) => void;
  }> = [
    {
      entityType: "subnet",
      entityId: subnet.id,
      mutate: (copy) => {
        copy.data.subnets.find((row) => row.id === subnet.id)!.gateway =
          "192.0.2.1";
      },
    },
    {
      entityType: "dhcpScope",
      entityId: "scope_restore_valid",
      mutate: (copy) => {
        copy.data.dhcpScopes.find(
          (row) => row.id === "scope_restore_valid",
        )!.startIp = "10.67.0.200";
      },
    },
    {
      entityType: "ipZone",
      entityId: "zone_restore_valid",
      mutate: (copy) => {
        copy.data.ipZones.find(
          (row) => row.id === "zone_restore_valid",
        )!.endIp = "10.68.0.10";
      },
    },
    {
      entityType: "ipAssignment",
      entityId: "assignment_restore_valid",
      mutate: (copy) => {
        copy.data.ipAssignments.find(
          (row) => row.id === "assignment_restore_valid",
        )!.dhcpScopeId = "missing_scope";
      },
    },
  ];

  for (const restoreCase of cases) {
    const invalidSnapshot = structuredClone(snapshot);
    restoreCase.mutate(invalidSnapshot);
    const restoreRes = await app.inject({
      method: "POST",
      url: "/api/admin/restore",
      headers,
      payload: invalidSnapshot,
    });
    assert.equal(restoreRes.statusCode, 422, restoreCase.entityType);
    const error = readJson(restoreRes) as {
      code: string;
      entityType: string;
      entityId: string;
      subnetId: string;
    };
    assert.equal(error.code, "BACKUP_INTEGRITY_INVALID");
    assert.equal(error.entityType, restoreCase.entityType);
    assert.equal(error.entityId, restoreCase.entityId);
    assert.equal(error.subnetId, subnet.id);
    const sentinel = db
      .prepare("SELECT id FROM racks WHERE name = ?")
      .get("Atomic restore sentinel");
    assert.ok(
      sentinel,
      `${restoreCase.entityType} rejection changed the database`,
    );
  }
});

test("admin restore accepts older backups without subnet, rack-slot, Docker enabled, or monitor TLS fields", async () => {
  const adminToken = await bootstrapAdmin();

  const rackRes = await app.inject({
    method: "POST",
    url: "/api/racks",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Legacy rack slot rack",
      totalU: 8,
    },
  });
  assert.equal(rackRes.statusCode, 201);
  const rack = readJson(rackRes) as { id: string };

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      rackId: rack.id,
      hostname: "legacy-rack-slot-device",
      deviceType: "server",
      status: "unknown",
      startU: 2,
      heightU: 1,
      face: "front",
      rackSlot: "left",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const legacyDevice = readJson(deviceRes) as { id: string };

  const documentationMonitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: legacyDevice.id,
      name: "Legacy documentation target",
      type: "none",
      enabled: true,
    },
  });
  assert.equal(documentationMonitorRes.statusCode, 200);
  const documentationMonitor = readJson(documentationMonitorRes) as {
    id: string;
  };

  const subnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.45.0.0/24",
      name: "Legacy restore subnet",
      gateway: "10.45.0.1",
      dnsServers: ["10.45.0.10"],
    },
  });
  assert.equal(subnetRes.statusCode, 201);

  const legacyDockerTimestamp = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO dockerImportSources
        (id, labId, name, endpoint, tokenEnc, lastSyncAt, lastSyncStatus, lastSyncMessage, enabled, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    "docker_legacy_enabled_default",
    "lab_home",
    "Legacy Docker source",
    "https://8.8.4.4:2376",
    null,
    null,
    null,
    null,
    0,
    legacyDockerTimestamp,
    legacyDockerTimestamp,
  );

  const exportRes = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(exportRes.statusCode, 200);
  const snapshot = readJson(exportRes) as Record<string, unknown> & {
    data: {
      devices: Array<Record<string, unknown>>;
      subnets: Array<Record<string, unknown>>;
      dockerImportSources: Array<Record<string, unknown>>;
      deviceMonitors: Array<Record<string, unknown>>;
    };
  };
  const legacySnapshot = {
    ...snapshot,
    data: {
      ...snapshot.data,
      devices: snapshot.data.devices.map((device) => {
        const legacyDevice = { ...device };
        delete legacyDevice.rackSlot;
        return legacyDevice;
      }),
      subnets: snapshot.data.subnets.map((subnet) => {
        const legacySubnet = { ...subnet };
        delete legacySubnet.gateway;
        delete legacySubnet.dnsServers;
        return legacySubnet;
      }),
      dockerImportSources: snapshot.data.dockerImportSources.map((source) => {
        const legacySource = { ...source };
        delete legacySource.enabled;
        return legacySource;
      }),
      deviceMonitors: snapshot.data.deviceMonitors.map((monitor) => {
        const legacyMonitor = { ...monitor };
        delete legacyMonitor.ignoreTlsErrors;
        if (legacyMonitor.id === documentationMonitor.id) {
          legacyMonitor.enabled = 1;
        }
        return legacyMonitor;
      }),
    },
  };

  const restoreRes = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: legacySnapshot,
  });
  assert.equal(restoreRes.statusCode, 200, restoreRes.body);

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

  const subnetsRes = await app.inject({
    method: "GET",
    url: "/api/subnets?labId=lab_home",
    headers: {
      authorization: `Bearer ${refreshedToken}`,
    },
  });
  assert.equal(subnetsRes.statusCode, 200);
  const subnets = readJson(subnetsRes) as Array<{
    cidr: string;
    gateway: string | null;
    dnsServers: string[] | null;
  }>;
  const restoredSubnet = subnets.find(
    (subnet) => subnet.cidr === "10.45.0.0/24",
  );
  assert.ok(restoredSubnet);
  assert.equal(restoredSubnet.gateway, null);
  assert.equal(restoredSubnet.dnsServers, null);

  const devicesRes = await app.inject({
    method: "GET",
    url: "/api/devices?labId=lab_home",
    headers: {
      authorization: `Bearer ${refreshedToken}`,
    },
  });
  assert.equal(devicesRes.statusCode, 200);
  const devices = readJson(devicesRes) as Array<{
    hostname: string;
    rackSlot: string;
  }>;
  const restoredDevice = devices.find(
    (device) => device.hostname === "legacy-rack-slot-device",
  );
  assert.ok(restoredDevice);
  assert.equal(restoredDevice.rackSlot, "full");

  const restoredDockerSource = db
    .prepare("SELECT enabled FROM dockerImportSources WHERE id = ?")
    .get("docker_legacy_enabled_default") as { enabled: number };
  assert.equal(restoredDockerSource.enabled, 1);
  const restoredDocumentationMonitor = db
    .prepare("SELECT enabled, ignoreTlsErrors FROM deviceMonitors WHERE id = ?")
    .get(documentationMonitor.id) as {
    enabled: number;
    ignoreTlsErrors: number;
  };
  assert.equal(restoredDocumentationMonitor.enabled, 0);
  assert.equal(restoredDocumentationMonitor.ignoreTlsErrors, 0);
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
      parentType: "endpoint",
    },
  });
  assert.equal(typeRes.statusCode, 201);
  const deviceType = readJson(typeRes) as {
    id: string;
    label: string;
    builtIn: boolean;
    parentType: string | null;
  };
  assert.equal(deviceType.id, "ip_camera");
  assert.equal(deviceType.label, "IP Camera");
  assert.equal(deviceType.builtIn, false);
  assert.equal(deviceType.parentType, "endpoint");

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
  const deviceTypes = readJson(listRes) as Array<{
    id: string;
    label: string;
    parentType?: string | null;
  }>;
  assert.equal(
    deviceTypes.some(
      (entry) =>
        entry.id === "ip_camera" &&
        entry.label === "IP Camera" &&
        entry.parentType === "endpoint",
    ),
    true,
  );

  const invalidParentRes = await app.inject({
    method: "POST",
    url: "/api/device-types",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      label: "Nested Camera",
      parentType: "ip_camera",
    },
  });
  assert.equal(invalidParentRes.statusCode, 400);
  assert.match(invalidParentRes.body, /built-in device type/i);

  const updateTypeRes = await app.inject({
    method: "PATCH",
    url: `/api/device-types/${deviceType.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      label: "PoE Camera",
      parentType: "ap",
    },
  });
  assert.equal(updateTypeRes.statusCode, 200);
  const updatedType = readJson(updateTypeRes) as {
    id: string;
    label: string;
    parentType: string | null;
  };
  assert.equal(updatedType.id, "ip_camera");
  assert.equal(updatedType.label, "PoE Camera");
  assert.equal(updatedType.parentType, "ap");

  const deleteUsedTypeRes = await app.inject({
    method: "DELETE",
    url: `/api/device-types/${deviceType.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(deleteUsedTypeRes.statusCode, 409);
  assert.match(deleteUsedTypeRes.body, /still used/i);

  const unusedTypeRes = await app.inject({
    method: "POST",
    url: "/api/device-types",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      label: "Unused Sensor",
      parentType: "endpoint",
    },
  });
  assert.equal(unusedTypeRes.statusCode, 201);
  const unusedType = readJson(unusedTypeRes) as { id: string };

  const deleteUnusedTypeRes = await app.inject({
    method: "DELETE",
    url: `/api/device-types/${unusedType.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(deleteUnusedTypeRes.statusCode, 204);

  const deleteBuiltInTypeRes = await app.inject({
    method: "DELETE",
    url: "/api/device-types/switch",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(deleteBuiltInTypeRes.statusCode, 400);
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

test("rack placement validation allows opposite half-width slots only", async () => {
  const adminToken = await bootstrapAdmin();

  const rackRes = await app.inject({
    method: "POST",
    url: "/api/racks",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Half Width Rack",
      totalU: 12,
    },
  });
  assert.equal(rackRes.statusCode, 201);
  const rack = readJson(rackRes) as { id: string };

  const leftRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      rackId: rack.id,
      hostname: "half-left-01",
      deviceType: "server",
      status: "unknown",
      startU: 5,
      heightU: 2,
      face: "front",
      rackSlot: "left",
    },
  });
  assert.equal(leftRes.statusCode, 201);
  const left = readJson(leftRes) as { id: string; rackSlot: string };
  assert.equal(left.rackSlot, "left");

  const rightRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      rackId: rack.id,
      hostname: "half-right-01",
      deviceType: "server",
      status: "unknown",
      startU: 5,
      heightU: 2,
      face: "front",
      rackSlot: "right",
    },
  });
  assert.equal(rightRes.statusCode, 201);
  const right = readJson(rightRes) as { id: string; rackSlot: string };
  assert.equal(right.rackSlot, "right");

  const leftConflictRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      rackId: rack.id,
      hostname: "half-left-conflict",
      deviceType: "server",
      status: "unknown",
      startU: 6,
      heightU: 1,
      face: "front",
      rackSlot: "left",
    },
  });
  assert.equal(leftConflictRes.statusCode, 400);
  assert.match(leftConflictRes.body, /overlap/i);

  const fullConflictRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      rackId: rack.id,
      hostname: "full-conflict",
      deviceType: "server",
      status: "unknown",
      startU: 5,
      heightU: 1,
      face: "front",
      rackSlot: "full",
    },
  });
  assert.equal(fullConflictRes.statusCode, 400);
  assert.match(fullConflictRes.body, /overlap/i);

  const rearFullRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      rackId: rack.id,
      hostname: "rear-full-ok",
      deviceType: "server",
      status: "unknown",
      startU: 5,
      heightU: 2,
      face: "rear",
      rackSlot: "full",
    },
  });
  assert.equal(rearFullRes.statusCode, 201);

  const patchConflictRes = await app.inject({
    method: "PATCH",
    url: `/api/devices/${right.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      rackSlot: "full",
    },
  });
  assert.equal(patchConflictRes.statusCode, 400);
  assert.match(patchConflictRes.body, /overlap/i);
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

test("SNMP exception responses stay unknown and never satisfy match modes", async () => {
  const adminToken = await bootstrapAdmin();
  const headers = { authorization: `Bearer ${adminToken}` };

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers,
    payload: {
      labId: "lab_home",
      hostname: "snmp-exception-switch",
      deviceType: "switch",
      status: "online",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const portRes = await app.inject({
    method: "POST",
    url: "/api/ports",
    headers,
    payload: {
      deviceId: device.id,
      name: "Gi0/1",
      kind: "rj45",
      linkState: "up",
      snmpIfIndex: 1,
    },
  });
  assert.equal(portRes.statusCode, 201);
  const port = readJson(portRes) as { id: string };

  const exceptionCases = [
    { tag: 0x80 as const, name: "noSuchObject" },
    { tag: 0x81 as const, name: "noSuchInstance" },
    { tag: 0x82 as const, name: "endOfMibView" },
  ];

  for (const exceptionCase of exceptionCases) {
    const responder = await createSnmpExceptionResponder(exceptionCase.tag);
    try {
      const address = responder.server.address();
      if (typeof address === "string") {
        throw new Error("SNMP test server did not expose a UDP port.");
      }
      db.prepare("UPDATE ports SET linkState = 'up' WHERE id = ?").run(port.id);

      const monitorRes = await app.inject({
        method: "POST",
        url: "/api/device-monitors",
        headers,
        payload: {
          deviceId: device.id,
          name: `Missing OID ${exceptionCase.name}`,
          type: "snmp",
          target: "127.0.0.1",
          port: address.port,
          snmpVersion: "2c",
          snmpCommunity: "public",
          snmpOid: "1.3.6.1.2.1.2.2.1.8.1",
          snmpMatchMode: "any",
          portId: port.id,
          snmpIfIndex: 1,
          enabled: true,
        },
      });
      assert.equal(monitorRes.statusCode, 200);
      const monitor = readJson(monitorRes) as { id: string };

      const runRes = await app.inject({
        method: "POST",
        url: `/api/device-monitors/${monitor.id}/run`,
        headers,
      });
      assert.equal(runRes.statusCode, 200);
      const result = readJson(runRes) as {
        enabled: boolean;
        lastResult: string;
        lastMessage: string;
      };
      assert.equal(result.enabled, true);
      assert.equal(result.lastResult, "unknown");
      assert.match(result.lastMessage, /OID 1\.3\.6\.1\.2\.1\.2\.2\.1\.8\.1/);
      assert.match(result.lastMessage, new RegExp(exceptionCase.name));
      assert.equal(responder.requestCount(), 1);

      const storedPort = db
        .prepare("SELECT linkState FROM ports WHERE id = ?")
        .get(port.id) as { linkState: string };
      assert.equal(storedPort.linkState, "unknown");

      const storedDevice = db
        .prepare("SELECT status FROM devices WHERE id = ?")
        .get(device.id) as { status: string };
      assert.notEqual(storedDevice.status, "offline");
    } finally {
      await closeUdpServer(responder.server);
    }
  }
});

test("SNMP walks stop and credential tests fail clearly on exception responses", async () => {
  const { decodeSnmpResponseValue, snmpWalkColumn } = await import(
    "../lib/snmp.js"
  );
  const decodedValue = decodeSnmpResponseValue(
    "1.3.6.1.2.1.1.3.0",
    0x02,
    Buffer.from([1]),
  );
  assert.deepEqual(decodedValue, {
    kind: "value",
    oid: "1.3.6.1.2.1.1.3.0",
    value: "1",
    type: "integer",
  });
  const decodedException = decodeSnmpResponseValue(
    "1.3.6.1.2.1.1.3.0",
    0x81,
    Buffer.alloc(0),
  );
  assert.deepEqual(decodedException, {
    kind: "exception",
    oid: "1.3.6.1.2.1.1.3.0",
    exception: "noSuchInstance",
  });

  const adminToken = await bootstrapAdmin();
  const headers = { authorization: `Bearer ${adminToken}` };
  const credentialRes = await app.inject({
    method: "POST",
    url: "/api/snmp-credentials",
    headers,
    payload: {
      labId: "lab_home",
      name: "Missing uptime",
      version: "2c",
      community: "public",
    },
  });
  assert.equal(credentialRes.statusCode, 201);
  const credential = readJson(credentialRes) as { id: string };

  const responder = await createSnmpExceptionResponder(0x82);
  try {
    const address = responder.server.address();
    if (typeof address === "string") {
      throw new Error("SNMP test server did not expose a UDP port.");
    }
    const session = {
      host: "127.0.0.1",
      port: address.port,
      version: "2c" as const,
      community: "public",
      timeoutMs: 1000,
    };
    const rows = await snmpWalkColumn(
      session,
      "1.3.6.1.2.1.2.2.1.8",
      5,
    );
    assert.deepEqual(rows, []);
    assert.equal(responder.requestCount(), 1);

    const testRes = await app.inject({
      method: "POST",
      url: `/api/snmp-credentials/${credential.id}/test`,
      headers,
      payload: {
        target: "127.0.0.1",
        port: address.port,
        timeoutMs: 1000,
      },
    });
    assert.equal(testRes.statusCode, 502);
    assert.match(testRes.body, /endOfMibView/);
  } finally {
    await closeUdpServer(responder.server);
  }
});

test("scheduled monitoring contains rejected checks and continues the cycle", async () => {
  const { runDueChecks } = await import("../lib/monitoring.js");
  const adminToken = await bootstrapAdmin();
  const headers = { authorization: `Bearer ${adminToken}` };

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers,
    payload: {
      labId: "lab_home",
      hostname: "monitor-cycle-switch",
      deviceType: "switch",
      status: "unknown",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const exceptionResponder = await createSnmpExceptionResponder(0x81);
  const malformedServer = await createMalformedSnmpResponder();
  const healthyServer = await createSnmpIntegerResponder(1);
  try {
    const exceptionAddress = exceptionResponder.server.address();
    const malformedAddress = malformedServer.address();
    const healthyAddress = healthyServer.address();
    if (
      typeof exceptionAddress === "string" ||
      typeof malformedAddress === "string" ||
      typeof healthyAddress === "string"
    ) {
      throw new Error("SNMP test server did not expose a UDP port.");
    }

    const monitorIds: string[] = [];
    for (const monitorConfig of [
      {
        name: "A missing OID",
        port: exceptionAddress.port,
      },
      {
        name: "B malformed response",
        port: malformedAddress.port,
      },
      {
        name: "C forced persistence failure",
        port: healthyAddress.port,
      },
      {
        name: "D healthy response",
        port: healthyAddress.port,
      },
    ]) {
      const monitorRes = await app.inject({
        method: "POST",
        url: "/api/device-monitors",
        headers,
        payload: {
          deviceId: device.id,
          name: monitorConfig.name,
          type: "snmp",
          target: "127.0.0.1",
          port: monitorConfig.port,
          snmpVersion: "2c",
          snmpCommunity: "public",
          snmpOid: "1.3.6.1.2.1.1.3.0",
          snmpMatchMode: "any",
          intervalMs: 1000,
          enabled: true,
        },
      });
      assert.equal(monitorRes.statusCode, 200);
      monitorIds.push((readJson(monitorRes) as { id: string }).id);
    }

    db.exec(`
      CREATE TRIGGER fail_scheduled_monitor_update
      BEFORE UPDATE OF lastCheckAt ON deviceMonitors
      WHEN OLD.name = 'C forced persistence failure'
      BEGIN
        SELECT RAISE(ABORT, 'forced scheduled monitor failure');
      END;
    `);

    const monitorErrors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      monitorErrors.push(args.map(String).join(" "));
    };
    try {
      await runDueChecks(1000);
    } finally {
      console.error = originalConsoleError;
      db.exec("DROP TRIGGER fail_scheduled_monitor_update;");
    }

    const missingOidMonitor = db
      .prepare(
        "SELECT lastCheckAt, lastResult, lastMessage FROM deviceMonitors WHERE id = ?",
      )
      .get(monitorIds[0]) as {
      lastCheckAt: string;
      lastResult: string;
      lastMessage: string;
    };
    assert.ok(missingOidMonitor.lastCheckAt);
    assert.equal(missingOidMonitor.lastResult, "unknown");
    assert.match(missingOidMonitor.lastMessage, /noSuchInstance/);
    assert.equal(exceptionResponder.requestCount(), 1);

    const malformedMonitor = db
      .prepare(
        "SELECT lastCheckAt, lastResult, lastMessage FROM deviceMonitors WHERE id = ?",
      )
      .get(monitorIds[1]) as {
      lastCheckAt: string;
      lastResult: string;
      lastMessage: string;
    };
    assert.ok(malformedMonitor.lastCheckAt);
    assert.equal(malformedMonitor.lastResult, "offline");
    assert.match(malformedMonitor.lastMessage, /SNMP packet/);

    const failedPersistenceMonitor = db
      .prepare(
        "SELECT lastCheckAt, lastResult FROM deviceMonitors WHERE id = ?",
      )
      .get(monitorIds[2]) as {
      lastCheckAt: string | null;
      lastResult: string | null;
    };
    assert.equal(failedPersistenceMonitor.lastCheckAt, null);
    assert.equal(failedPersistenceMonitor.lastResult, null);
    assert.equal(monitorErrors.length, 1);
    assert.match(monitorErrors[0] ?? "", new RegExp(monitorIds[2] ?? ""));
    assert.match(monitorErrors[0] ?? "", /forced scheduled monitor failure/);

    const healthyMonitor = db
      .prepare(
        "SELECT lastCheckAt, lastResult FROM deviceMonitors WHERE id = ?",
      )
      .get(monitorIds[3]) as {
      lastCheckAt: string;
      lastResult: string;
    };
    assert.ok(healthyMonitor.lastCheckAt);
    assert.equal(healthyMonitor.lastResult, "online");
  } finally {
    await closeUdpServer(exceptionResponder.server);
    await closeUdpServer(malformedServer);
    await closeUdpServer(healthyServer);
  }
});

test("HTTPS monitors keep certificate verification secure by default and can opt out per target", async () => {
  const adminToken = await bootstrapAdmin();
  const headers = { authorization: `Bearer ${adminToken}` };

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers,
    payload: {
      labId: "lab_home",
      hostname: "tls-monitor-01",
      deviceType: "server",
      status: "unknown",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const secureRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers,
    payload: {
      deviceId: device.id,
      name: "Verified HTTPS",
      type: "https",
      target: "secure-monitor.example",
      path: "/health",
      enabled: true,
    },
  });
  assert.equal(secureRes.statusCode, 200);
  const secureMonitor = readJson(secureRes) as {
    id: string;
    ignoreTlsErrors: boolean;
  };
  assert.equal(secureMonitor.ignoreTlsErrors, false);

  const insecureRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers,
    payload: {
      deviceId: device.id,
      name: "Self-signed HTTPS",
      type: "https",
      target: "self-signed-monitor.example",
      path: "/health",
      ignoreTlsErrors: true,
      enabled: true,
    },
  });
  assert.equal(insecureRes.statusCode, 200);
  const insecureMonitor = readJson(insecureRes) as {
    id: string;
    ignoreTlsErrors: boolean;
  };
  assert.equal(insecureMonitor.ignoreTlsErrors, true);
  assert.equal(
    (
      db
        .prepare("SELECT ignoreTlsErrors FROM deviceMonitors WHERE id = ?")
        .get(insecureMonitor.id) as { ignoreTlsErrors: number }
    ).ignoreTlsErrors,
    1,
  );

  const certificateChecks: boolean[] = [];
  setNetworkHostLookupForTests(async () => [
    { address: "10.20.30.40", family: 4 },
  ]);
  setPinnedRequestTransportForTests(async (_url, _resolved, options) => {
    certificateChecks.push(options.rejectUnauthorized);
    return { statusCode: 204 };
  });

  for (const monitorId of [secureMonitor.id, insecureMonitor.id]) {
    const runRes = await app.inject({
      method: "POST",
      url: `/api/device-monitors/${monitorId}/run`,
      headers,
    });
    assert.equal(runRes.statusCode, 200);
    assert.equal(
      (readJson(runRes) as { lastResult: string }).lastResult,
      "online",
    );
  }
  assert.deepEqual(certificateChecks, [true, false]);

  const clearRes = await app.inject({
    method: "PATCH",
    url: `/api/device-monitors/${insecureMonitor.id}`,
    headers,
    payload: {
      type: "http",
    },
  });
  assert.equal(clearRes.statusCode, 200);
  assert.equal(
    (readJson(clearRes) as { ignoreTlsErrors: boolean }).ignoreTlsErrors,
    false,
  );
});

test("inline SNMPv3 sessions never fall back to v2c public", () => {
  assert.throws(
    () =>
      resolveSnmpSessionForTarget({
        deviceId: "missing-device",
        labId: "lab_home",
        host: "192.0.2.12",
        snmpVersion: "3",
        snmpCommunity: null,
      }),
    /usable SNMPv3 credential/i,
  );
});

test("disabled monitors preserve configuration and reject manual runs without changing state", async () => {
  const adminToken = await bootstrapAdmin();
  const headers = { authorization: `Bearer ${adminToken}` };

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers,
    payload: {
      labId: "lab_home",
      hostname: "disabled-monitor-switch",
      deviceType: "switch",
      status: "online",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const portRes = await app.inject({
    method: "POST",
    url: "/api/ports",
    headers,
    payload: {
      deviceId: device.id,
      name: "Gi0/24",
      kind: "rj45",
      linkState: "up",
      snmpIfIndex: 24,
    },
  });
  assert.equal(portRes.statusCode, 201);
  const port = readJson(portRes) as { id: string };

  const credentialRes = await app.inject({
    method: "POST",
    url: "/api/snmp-credentials",
    headers,
    payload: {
      labId: "lab_home",
      name: "Disabled monitor credential",
      version: "2c",
      community: "test-readonly",
    },
  });
  assert.equal(credentialRes.statusCode, 201);
  const credential = readJson(credentialRes) as { id: string };

  const httpMonitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers,
    payload: {
      deviceId: device.id,
      name: "Disabled management UI",
      type: "https",
      target: "192.0.2.10",
      port: 8443,
      path: "/healthz",
      intervalMs: 180_000,
      enabled: false,
    },
  });
  assert.equal(httpMonitorRes.statusCode, 200);
  const httpMonitor = readJson(httpMonitorRes) as { id: string };
  const httpUpdateRes = await app.inject({
    method: "PATCH",
    url: `/api/device-monitors/${httpMonitor.id}`,
    headers,
    payload: {
      name: "Disabled management UI example",
      type: "https",
      target: "192.0.2.10",
      port: 8443,
      path: "/ready",
      intervalMs: 240_000,
      enabled: false,
    },
  });
  assert.equal(httpUpdateRes.statusCode, 200);
  assert.deepEqual(
    (({ type, target, port, path, intervalMs, enabled }) => ({
      type,
      target,
      port,
      path,
      intervalMs,
      enabled,
    }))(readJson(httpUpdateRes) as Record<string, unknown>),
    {
      type: "https",
      target: "192.0.2.10",
      port: 8443,
      path: "/ready",
      intervalMs: 240_000,
      enabled: false,
    },
  );

  const monitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers,
    payload: {
      deviceId: device.id,
      name: "Disabled uplink",
      type: "snmp",
      target: "127.0.0.1",
      port: 1161,
      snmpVersion: "2c",
      snmpCommunity: "test-readonly",
      snmpOid: "1.3.6.1.2.1.2.2.1.8.24",
      snmpExpectedValue: "1",
      snmpMatchMode: "equals",
      portId: port.id,
      snmpIfIndex: 24,
      snmpCredentialId: credential.id,
      intervalMs: 120_000,
      enabled: false,
    },
  });
  assert.equal(monitorRes.statusCode, 200);
  const monitor = readJson(monitorRes) as { id: string };

  const historicalCheckAt = "2026-07-20T08:00:00.000Z";
  const historicalAlertAt = "2026-07-20T08:01:00.000Z";
  db.prepare(
    `
      UPDATE deviceMonitors
      SET lastCheckAt = ?, lastAlertAt = ?, lastResult = 'online',
          lastMessage = 'Historical interface result.'
      WHERE id = ?
    `,
  ).run(historicalCheckAt, historicalAlertAt, monitor.id);

  const updateRes = await app.inject({
    method: "PATCH",
    url: `/api/device-monitors/${monitor.id}`,
    headers,
    payload: {
      name: "Disabled uplink example",
      type: "snmp",
      target: "127.0.0.1",
      port: 1161,
      snmpVersion: "2c",
      snmpCommunity: "test-readonly",
      snmpOid: "1.3.6.1.2.1.2.2.1.8.24",
      snmpExpectedValue: "1",
      snmpMatchMode: "equals",
      portId: port.id,
      snmpIfIndex: 24,
      snmpCredentialId: credential.id,
      intervalMs: 120_000,
      enabled: false,
    },
  });
  assert.equal(updateRes.statusCode, 200);
  const updated = readJson(updateRes) as Record<string, unknown>;
  assert.deepEqual(
    {
      name: updated.name,
      type: updated.type,
      target: updated.target,
      port: updated.port,
      snmpVersion: updated.snmpVersion,
      snmpCommunity: updated.snmpCommunity,
      snmpOid: updated.snmpOid,
      snmpExpectedValue: updated.snmpExpectedValue,
      snmpMatchMode: updated.snmpMatchMode,
      portId: updated.portId,
      snmpIfIndex: updated.snmpIfIndex,
      snmpCredentialId: updated.snmpCredentialId,
      intervalMs: updated.intervalMs,
      enabled: updated.enabled,
      lastCheckAt: updated.lastCheckAt,
      lastAlertAt: updated.lastAlertAt,
      lastResult: updated.lastResult,
      lastMessage: updated.lastMessage,
    },
    {
      name: "Disabled uplink example",
      type: "snmp",
      target: "127.0.0.1",
      port: 1161,
      snmpVersion: "2c",
      snmpCommunity: "test-readonly",
      snmpOid: "1.3.6.1.2.1.2.2.1.8.24",
      snmpExpectedValue: "1",
      snmpMatchMode: "equals",
      portId: port.id,
      snmpIfIndex: 24,
      snmpCredentialId: credential.id,
      intervalMs: 120_000,
      enabled: false,
      lastCheckAt: historicalCheckAt,
      lastAlertAt: historicalAlertAt,
      lastResult: "online",
      lastMessage: "Historical interface result.",
    },
  );

  const stateBeforeRun = {
    monitor: db
      .prepare("SELECT * FROM deviceMonitors WHERE id = ?")
      .get(monitor.id),
    device: db.prepare("SELECT * FROM devices WHERE id = ?").get(device.id),
    port: db.prepare("SELECT * FROM ports WHERE id = ?").get(port.id),
  };
  const runRes = await app.inject({
    method: "POST",
    url: `/api/device-monitors/${monitor.id}/run`,
    headers,
  });
  assert.equal(runRes.statusCode, 409);
  assert.match(runRes.body, /disabled/i);
  assert.deepEqual(
    {
      monitor: db
        .prepare("SELECT * FROM deviceMonitors WHERE id = ?")
        .get(monitor.id),
      device: db.prepare("SELECT * FROM devices WHERE id = ?").get(device.id),
      port: db.prepare("SELECT * FROM ports WHERE id = ?").get(port.id),
    },
    stateBeforeRun,
  );

  const noneMonitorRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers,
    payload: {
      deviceId: device.id,
      name: "Documentation only",
      type: "none",
      enabled: true,
    },
  });
  assert.equal(noneMonitorRes.statusCode, 200);
  const noneMonitor = readJson(noneMonitorRes) as {
    id: string;
    enabled: boolean;
  };
  assert.equal(noneMonitor.enabled, false);
  const runNoneRes = await app.inject({
    method: "POST",
    url: `/api/device-monitors/${noneMonitor.id}/run`,
    headers,
  });
  assert.equal(runNoneRes.statusCode, 409);

  const v3ProfileRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers,
    payload: {
      deviceId: device.id,
      name: "Disabled SNMPv3 profile",
      type: "snmp",
      target: "192.0.2.12",
      port: 161,
      snmpVersion: "3",
      snmpCommunity: null,
      snmpOid: "1.3.6.1.2.1.33.1.2.4.0",
      snmpExpectedValue: null,
      snmpMatchMode: "any",
      portId: port.id,
      snmpIfIndex: 24,
      intervalMs: 300_000,
      enabled: false,
    },
  });
  assert.equal(v3ProfileRes.statusCode, 200, v3ProfileRes.body);
  const v3Profile = readJson(v3ProfileRes) as {
    id: string;
    snmpVersion: string;
    snmpCommunity: string | null;
  };
  assert.equal(v3Profile.snmpVersion, "3");
  assert.equal(v3Profile.snmpCommunity, null);

  const v3HistoricalCheckAt = "2026-07-20T09:00:00.000Z";
  db.prepare(
    `
      UPDATE deviceMonitors
      SET lastCheckAt = ?, lastResult = 'offline',
          lastMessage = 'Historical SNMPv3 result.'
      WHERE id = ?
    `,
  ).run(v3HistoricalCheckAt, v3Profile.id);
  const v3MonitorBeforeUpdate = db
    .prepare("SELECT * FROM deviceMonitors WHERE id = ?")
    .get(v3Profile.id);

  const v3PartialUpdateRes = await app.inject({
    method: "PATCH",
    url: `/api/device-monitors/${v3Profile.id}`,
    headers,
    payload: { enabled: false },
  });
  assert.equal(
    v3PartialUpdateRes.statusCode,
    200,
    v3PartialUpdateRes.body,
  );
  const v3PartialUpdate = readJson(v3PartialUpdateRes) as Record<
    string,
    unknown
  >;
  assert.equal(v3PartialUpdate.snmpVersion, "3");
  assert.equal(v3PartialUpdate.snmpCommunity, null);
  assert.equal(v3PartialUpdate.snmpOid, "1.3.6.1.2.1.33.1.2.4.0");
  assert.equal(v3PartialUpdate.snmpMatchMode, "any");
  assert.equal(v3PartialUpdate.portId, port.id);
  assert.equal(v3PartialUpdate.snmpIfIndex, 24);
  assert.equal(v3PartialUpdate.lastCheckAt, v3HistoricalCheckAt);
  assert.equal(v3PartialUpdate.lastResult, "offline");
  assert.deepEqual(
    db
      .prepare("SELECT * FROM deviceMonitors WHERE id = ?")
      .get(v3Profile.id),
    v3MonitorBeforeUpdate,
  );

  const v3EmptyCommunityRes = await app.inject({
    method: "PATCH",
    url: `/api/device-monitors/${v3Profile.id}`,
    headers,
    payload: { enabled: false, snmpCommunity: "" },
  });
  assert.equal(v3EmptyCommunityRes.statusCode, 200);
  assert.equal(
    (readJson(v3EmptyCommunityRes) as { snmpCommunity: string | null })
      .snmpCommunity,
    null,
  );

  const v3StateBeforeActivation = {
    monitor: db
      .prepare("SELECT * FROM deviceMonitors WHERE id = ?")
      .get(v3Profile.id),
    device: db.prepare("SELECT * FROM devices WHERE id = ?").get(device.id),
    port: db.prepare("SELECT * FROM ports WHERE id = ?").get(port.id),
  };
  const invalidV3ActivationRes = await app.inject({
    method: "PATCH",
    url: `/api/device-monitors/${v3Profile.id}`,
    headers,
    payload: { enabled: true },
  });
  assert.equal(invalidV3ActivationRes.statusCode, 400);
  assert.match(invalidV3ActivationRes.body, /usable SNMPv3 credential/i);
  assert.deepEqual(
    {
      monitor: db
        .prepare("SELECT * FROM deviceMonitors WHERE id = ?")
        .get(v3Profile.id),
      device: db.prepare("SELECT * FROM devices WHERE id = ?").get(device.id),
      port: db.prepare("SELECT * FROM ports WHERE id = ?").get(port.id),
    },
    v3StateBeforeActivation,
  );
  const invalidV3CreateCount = (
    db.prepare("SELECT COUNT(*) AS count FROM deviceMonitors").get() as {
      count: number;
    }
  ).count;
  const invalidV3CreateRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers,
    payload: {
      deviceId: device.id,
      name: "Invalid active SNMPv3",
      type: "snmp",
      target: "192.0.2.13",
      snmpVersion: "3",
      snmpOid: "1.3.6.1.2.1.1.3.0",
      enabled: true,
    },
  });
  assert.equal(invalidV3CreateRes.statusCode, 400);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS count FROM deviceMonitors").get() as {
        count: number;
      }
    ).count,
    invalidV3CreateCount,
  );

  const usableV3CredentialRes = await app.inject({
    method: "POST",
    url: "/api/snmp-credentials",
    headers,
    payload: {
      labId: "lab_home",
      name: "Usable monitor v3",
      version: "3",
      v3User: "monitor-user",
      v3AuthProto: "SHA",
      v3AuthPassword: "monitor-auth-pass",
      v3PrivProto: "none",
    },
  });
  assert.equal(usableV3CredentialRes.statusCode, 201);
  const usableV3Credential = readJson(usableV3CredentialRes) as { id: string };
  const validV3CreateRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers,
    payload: {
      deviceId: device.id,
      name: "Valid active SNMPv3",
      type: "snmp",
      target: "192.0.2.14",
      snmpVersion: "3",
      snmpCredentialId: usableV3Credential.id,
      snmpOid: "1.3.6.1.2.1.1.3.0",
      enabled: true,
    },
  });
  assert.equal(validV3CreateRes.statusCode, 200, validV3CreateRes.body);
  assert.deepEqual(
    (({ snmpVersion, snmpCommunity, snmpCredentialId, enabled }) => ({
      snmpVersion,
      snmpCommunity,
      snmpCredentialId,
      enabled,
    }))(
      readJson(validV3CreateRes) as {
        snmpVersion: string;
        snmpCommunity: string | null;
        snmpCredentialId: string;
        enabled: boolean;
      },
    ),
    {
      snmpVersion: "3",
      snmpCommunity: null,
      snmpCredentialId: usableV3Credential.id,
      enabled: true,
    },
  );

  const clearV3SecretRes = await app.inject({
    method: "PATCH",
    url: `/api/snmp-credentials/${usableV3Credential.id}`,
    headers,
    payload: { clearV3AuthPassword: true },
  });
  assert.equal(clearV3SecretRes.statusCode, 200);
  const invalidClearedCredentialCount = (
    db.prepare("SELECT COUNT(*) AS count FROM deviceMonitors").get() as {
      count: number;
    }
  ).count;
  const invalidClearedCredentialRes = await app.inject({
    method: "POST",
    url: "/api/device-monitors",
    headers,
    payload: {
      deviceId: device.id,
      name: "SNMPv3 with cleared secret",
      type: "snmp",
      target: "192.0.2.15",
      snmpVersion: "3",
      snmpCredentialId: usableV3Credential.id,
      snmpOid: "1.3.6.1.2.1.1.3.0",
      enabled: true,
    },
  });
  assert.equal(invalidClearedCredentialRes.statusCode, 400);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS count FROM deviceMonitors").get() as {
        count: number;
      }
    ).count,
    invalidClearedCredentialCount,
  );
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

test("port aggregates preserve physical member cables and a separate logical link", async () => {
  const adminToken = await bootstrapAdmin();

  async function createDevice(hostname: string, deviceType: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/devices",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { labId: "lab_home", hostname, deviceType, status: "online" },
    });
    assert.equal(res.statusCode, 201);
    return readJson(res) as { id: string };
  }

  async function createPort(
    deviceId: string,
    name: string,
    options: { face?: "front" | "rear"; position?: number } = {},
  ) {
    const res = await app.inject({
      method: "POST",
      url: "/api/ports",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        deviceId,
        name,
        kind: "rj45",
        linkState: "down",
        speed: "1G",
        ...options,
      },
    });
    assert.equal(res.statusCode, 201);
    return readJson(res) as {
      id: string;
      name: string;
      aggregatePortId?: string | null;
    };
  }

  async function createCable(fromPortId: string, toPortId: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/port-links",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { fromPortId, toPortId, cableType: "copper" },
    });
    assert.equal(res.statusCode, 201);
    return readJson(res) as { id: string };
  }

  const switchDevice = await createDevice("lag-switch", "switch");
  const serverDevice = await createDevice("lag-server", "server");
  const patchA = await createDevice("patch-a", "patch_panel");
  const patchB = await createDevice("patch-b", "patch_panel");
  const sw1 = await createPort(switchDevice.id, "Gi0/1");
  const sw2 = await createPort(switchDevice.id, "Gi0/2");
  const sw3 = await createPort(switchDevice.id, "Gi0/3");
  const sw4 = await createPort(switchDevice.id, "Gi0/4");
  const server1 = await createPort(serverDevice.id, "eno1");
  const server2 = await createPort(serverDevice.id, "eno2");
  const server3 = await createPort(serverDevice.id, "eno3");
  const patchAFront = await createPort(patchA.id, "F1", {
    face: "front",
    position: 1,
  });
  const patchARear = await createPort(patchA.id, "R1", {
    face: "rear",
    position: 1,
  });
  const patchBFront = await createPort(patchB.id, "F1", {
    face: "front",
    position: 1,
  });
  const patchBRear = await createPort(patchB.id, "R1", {
    face: "rear",
    position: 1,
  });
  const physicalCableIds = [
    (await createCable(sw1.id, patchAFront.id)).id,
    (await createCable(patchARear.id, server1.id)).id,
    (await createCable(sw2.id, patchBFront.id)).id,
    (await createCable(patchBRear.id, server2.id)).id,
  ];

  const createAggregateRes = await app.inject({
    method: "POST",
    url: "/api/port-aggregates",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: switchDevice.id,
      name: "Bond1",
      speed: "2G",
      memberPortIds: [sw1.id, sw2.id],
    },
  });
  assert.equal(createAggregateRes.statusCode, 201);
  const createdAggregate = readJson(createAggregateRes) as {
    aggregate: { id: string; name: string; portRole: string };
    members: Array<{ id: string; aggregatePortId: string }>;
  };
  assert.equal(createdAggregate.aggregate.name, "Bond1");
  assert.equal(createdAggregate.aggregate.portRole, "aggregate");
  assert.deepEqual(
    createdAggregate.members.map((port) => port.aggregatePortId),
    [createdAggregate.aggregate.id, createdAggregate.aggregate.id],
  );

  const serverAggregateRes = await app.inject({
    method: "POST",
    url: "/api/port-aggregates",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      deviceId: serverDevice.id,
      name: "Bond1",
      speed: "2G",
      memberPortIds: [server1.id, server2.id],
    },
  });
  assert.equal(serverAggregateRes.statusCode, 201);
  const serverAggregate = readJson(serverAggregateRes) as {
    aggregate: { id: string };
  };

  const genericMemberDeleteRes = await app.inject({
    method: "DELETE",
    url: `/api/ports/${sw1.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(genericMemberDeleteRes.statusCode, 409);
  assert.match(genericMemberDeleteRes.body, /member/i);

  const genericAggregateDeleteRes = await app.inject({
    method: "DELETE",
    url: `/api/ports/${createdAggregate.aggregate.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(genericAggregateDeleteRes.statusCode, 409);
  assert.match(genericAggregateDeleteRes.body, /aggregate delete flow/i);

  const logicalLinkRes = await app.inject({
    method: "POST",
    url: "/api/port-links",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      fromPortId: createdAggregate.aggregate.id,
      toPortId: serverAggregate.aggregate.id,
      cableType: "lacp",
    },
  });
  assert.equal(logicalLinkRes.statusCode, 201);
  const logicalLink = readJson(logicalLinkRes) as { id: string };

  const updateAggregateRes = await app.inject({
    method: "PATCH",
    url: `/api/port-aggregates/${createdAggregate.aggregate.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      memberPortIds: [sw2.id, sw3.id],
    },
  });
  assert.equal(updateAggregateRes.statusCode, 200);
  const updatedAggregate = readJson(updateAggregateRes) as {
    members: Array<{ id: string; aggregatePortId: string }>;
  };
  assert.deepEqual(
    updatedAggregate.members.map((port) => port.id).sort(),
    [sw2.id, sw3.id].sort(),
  );

  const postAggregateMemberCable = await createCable(sw3.id, server3.id);
  physicalCableIds.push(postAggregateMemberCable.id);
  const moveMemberCableRes = await app.inject({
    method: "PATCH",
    url: `/api/port-links/${postAggregateMemberCable.id}`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { fromPortId: sw4.id },
  });
  assert.equal(moveMemberCableRes.statusCode, 200);
  const restoreMemberCableRes = await app.inject({
    method: "PATCH",
    url: `/api/port-links/${postAggregateMemberCable.id}`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { fromPortId: sw3.id },
  });
  assert.equal(restoreMemberCableRes.statusCode, 200);

  const blockedDeleteRes = await app.inject({
    method: "DELETE",
    url: `/api/port-aggregates/${createdAggregate.aggregate.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(blockedDeleteRes.statusCode, 409);

  const deleteCableRes = await app.inject({
    method: "DELETE",
    url: `/api/port-links/${logicalLink.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(deleteCableRes.statusCode, 204);

  const deleteAggregateRes = await app.inject({
    method: "DELETE",
    url: `/api/port-aggregates/${createdAggregate.aggregate.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(deleteAggregateRes.statusCode, 204);

  const portsAfterDeleteRes = await app.inject({
    method: "GET",
    url: `/api/ports?deviceId=${switchDevice.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(portsAfterDeleteRes.statusCode, 200);
  const portsAfterDelete = readJson(portsAfterDeleteRes) as Array<{
    id: string;
    aggregatePortId?: string | null;
  }>;
  assert.equal(
    portsAfterDelete.some((port) => port.id === createdAggregate.aggregate.id),
    false,
  );
  assert.equal(
    portsAfterDelete.some((port) => port.aggregatePortId),
    false,
  );

  const linksAfterDeleteRes = await app.inject({
    method: "GET",
    url: "/api/port-links?labId=lab_home",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(linksAfterDeleteRes.statusCode, 200);
  const linksAfterDelete = readJson(linksAfterDeleteRes) as Array<{
    id: string;
  }>;
  assert.deepEqual(
    physicalCableIds.every((id) =>
      linksAfterDelete.some((link) => link.id === id),
    ),
    true,
  );
});

test("port aggregates are included in backup export and restore", async () => {
  const adminToken = await bootstrapAdmin();

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      hostname: "backup-lag-switch",
      deviceType: "switch",
      status: "online",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  async function createPort(name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/ports",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        deviceId: device.id,
        name,
        kind: "rj45",
        linkState: "down",
      },
    });
    assert.equal(res.statusCode, 201);
    return readJson(res) as { id: string };
  }

  const first = await createPort("Gi1");
  const second = await createPort("Gi2");

  const aggregateRes = await app.inject({
    method: "POST",
    url: "/api/port-aggregates",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      deviceId: device.id,
      name: "Bond1",
      memberPortIds: [first.id, second.id],
    },
  });
  assert.equal(aggregateRes.statusCode, 201);
  const aggregate = readJson(aggregateRes) as { aggregate: { id: string } };

  const peerDeviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      labId: "lab_home",
      hostname: "backup-lag-peer",
      deviceType: "switch",
      status: "online",
    },
  });
  assert.equal(peerDeviceRes.statusCode, 201);
  const peerDevice = readJson(peerDeviceRes) as { id: string };
  async function createPeerPort(name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/ports",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        deviceId: peerDevice.id,
        name,
        kind: "rj45",
        linkState: "down",
      },
    });
    assert.equal(res.statusCode, 201);
    return readJson(res) as { id: string };
  }
  const physicalPeer = await createPeerPort("Gi1");
  const logicalPeer = await createPeerPort("Port-channel1");
  async function createLink(
    fromPortId: string,
    toPortId: string,
    cableType: string,
  ) {
    const res = await app.inject({
      method: "POST",
      url: "/api/port-links",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { fromPortId, toPortId, cableType },
    });
    assert.equal(res.statusCode, 201);
    return readJson(res) as { id: string };
  }
  const physicalLink = await createLink(first.id, physicalPeer.id, "copper");
  const logicalLink = await createLink(
    aggregate.aggregate.id,
    logicalPeer.id,
    "lacp",
  );

  const exportRes = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(exportRes.statusCode, 200);
  const snapshot = readJson(exportRes) as {
    data: {
      ports: Array<{
        id: string;
        name: string;
        portRole?: string;
        aggregatePortId?: string | null;
      }>;
      portLinks: Array<{ id: string; fromPortId: string; toPortId: string }>;
    };
  };
  assert.equal(
    snapshot.data.ports.find((port) => port.id === aggregate.aggregate.id)
      ?.portRole,
    "aggregate",
  );
  assert.equal(
    snapshot.data.ports.find((port) => port.id === first.id)?.aggregatePortId,
    aggregate.aggregate.id,
  );
  assert.equal(
    snapshot.data.portLinks.some((link) => link.id === physicalLink.id),
    true,
  );
  assert.equal(
    snapshot.data.portLinks.some((link) => link.id === logicalLink.id),
    true,
  );

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

  const portsRes = await app.inject({
    method: "GET",
    url: `/api/ports?deviceId=${device.id}`,
    headers: {
      authorization: `Bearer ${refreshedToken}`,
    },
  });
  assert.equal(portsRes.statusCode, 200);
  const restoredPorts = readJson(portsRes) as Array<{
    id: string;
    portRole?: string;
    aggregatePortId?: string | null;
  }>;
  assert.equal(
    restoredPorts.find((port) => port.id === aggregate.aggregate.id)?.portRole,
    "aggregate",
  );
  assert.equal(
    restoredPorts.find((port) => port.id === second.id)?.aggregatePortId,
    aggregate.aggregate.id,
  );

  const linksRes = await app.inject({
    method: "GET",
    url: "/api/port-links?labId=lab_home",
    headers: { authorization: `Bearer ${refreshedToken}` },
  });
  assert.equal(linksRes.statusCode, 200);
  const restoredLinks = readJson(linksRes) as Array<{ id: string }>;
  assert.equal(
    restoredLinks.some((link) => link.id === physicalLink.id),
    true,
  );
  assert.equal(
    restoredLinks.some((link) => link.id === logicalLink.id),
    true,
  );
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

  assert.equal(scanRes.statusCode, 202);
});

test("discovery scan jobs return before the scan runner resolves", async () => {
  const adminToken = await bootstrapAdmin();
  const deferredScan = createDeferred(makeDiscoveryScanResult());
  setDiscoveryScanRunnerForTests(async (labId, cidr) => {
    assert.equal(labId, "lab_home");
    assert.equal(cidr, "10.0.10.0/24");
    return deferredScan.promise;
  });

  const startRes = await app.inject({
    method: "POST",
    url: "/api/discovery/scan",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.0.10.0/24",
    },
  });

  assert.equal(startRes.statusCode, 202);
  const started = readJson(startRes) as { job: { id: string; status: string } };
  assert.ok(started.job.id);
  assert.notEqual(started.job.status, "completed");

  const running = await waitForDiscoveryScanJobStatus(
    adminToken,
    started.job.id,
    "running",
  );
  assert.equal(running.result, null);

  deferredScan.resolve(makeDiscoveryScanResult({ discoveredCount: 2 }));
  const completed = await waitForDiscoveryScanJobStatus(
    adminToken,
    started.job.id,
    "completed",
  );
  assert.equal(completed.result?.discoveredCount, 2);
});

test("discovery scan jobs report runner failures", async () => {
  const adminToken = await bootstrapAdmin();
  setDiscoveryScanRunnerForTests(async () => {
    throw new Error("scan exploded");
  });

  const startRes = await app.inject({
    method: "POST",
    url: "/api/discovery/scan",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.0.10.0/24",
    },
  });

  assert.equal(startRes.statusCode, 202);
  const started = readJson(startRes) as { job: { id: string } };
  const failed = await waitForDiscoveryScanJobStatus(
    adminToken,
    started.job.id,
    "failed",
  );
  assert.equal(failed.error, "scan exploded");
  assert.equal(failed.result, null);
});

test("discovery scan job status requires lab read access", async () => {
  const adminToken = await bootstrapAdmin();
  const viewerToken = await createUserAndLogin(adminToken, {
    username: "viewer-no-discovery-job",
    displayName: "Viewer No Discovery Job",
    password: "viewer-no-discovery-job-1",
    role: "viewer",
  });
  const viewer = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get("viewer-no-discovery-job") as { id: string };
  db.prepare("DELETE FROM userLabAccess WHERE userId = ?").run(viewer.id);
  const deferredScan = createDeferred(makeDiscoveryScanResult());
  setDiscoveryScanRunnerForTests(async () => deferredScan.promise);

  const startRes = await app.inject({
    method: "POST",
    url: "/api/discovery/scan",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.0.10.0/24",
    },
  });

  assert.equal(startRes.statusCode, 202);
  const started = readJson(startRes) as { job: { id: string } };
  await waitForDiscoveryScanJobStatus(adminToken, started.job.id, "running");

  const forbiddenRes = await app.inject({
    method: "GET",
    url: `/api/discovery/scan-jobs/${started.job.id}`,
    headers: {
      authorization: `Bearer ${viewerToken}`,
    },
  });
  assert.equal(forbiddenRes.statusCode, 403);

  deferredScan.resolve(makeDiscoveryScanResult());
  await waitForDiscoveryScanJobStatus(adminToken, started.job.id, "completed");
});

test("discovery scan schedules can be managed per lab", async () => {
  const adminToken = await bootstrapAdmin();

  const createRes = await app.inject({
    method: "POST",
    url: "/api/discovery/schedules",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Routed pods",
      cidr: "10.42.0.0/20",
      intervalMs: 120_000,
      enabled: true,
    },
  });
  assert.equal(createRes.statusCode, 201);
  const created = readJson(createRes) as {
    id: string;
    name: string;
    cidr: string;
    intervalMs: number;
    enabled: boolean;
  };
  assert.equal(created.name, "Routed pods");
  assert.equal(created.cidr, "10.42.0.0/20");
  assert.equal(created.intervalMs, 120_000);
  assert.equal(created.enabled, true);

  const duplicateRes = await app.inject({
    method: "POST",
    url: "/api/discovery/schedules",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.42.0.0/20",
      intervalMs: 120_000,
      enabled: true,
    },
  });
  assert.equal(duplicateRes.statusCode, 409);

  const updateRes = await app.inject({
    method: "PATCH",
    url: `/api/discovery/schedules/${created.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      name: "Routed pods sweep",
      cidr: "10.42.0.0/23",
      intervalMs: 300_000,
      enabled: false,
    },
  });
  assert.equal(updateRes.statusCode, 200);
  const updated = readJson(updateRes) as {
    name: string;
    cidr: string;
    intervalMs: number;
    enabled: boolean;
  };
  assert.equal(updated.name, "Routed pods sweep");
  assert.equal(updated.cidr, "10.42.0.0/23");
  assert.equal(updated.intervalMs, 300_000);
  assert.equal(updated.enabled, false);

  const listRes = await app.inject({
    method: "GET",
    url: "/api/discovery/schedules?labId=lab_home",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(listRes.statusCode, 200);
  const schedules = readJson(listRes) as Array<{ id: string; cidr: string }>;
  assert.deepEqual(
    schedules.map((schedule) => schedule.id),
    [created.id],
  );

  const deleteRes = await app.inject({
    method: "DELETE",
    url: `/api/discovery/schedules/${created.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(deleteRes.statusCode, 204);

  const listAfterDeleteRes = await app.inject({
    method: "GET",
    url: "/api/discovery/schedules?labId=lab_home",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(listAfterDeleteRes.statusCode, 200);
  assert.deepEqual(readJson(listAfterDeleteRes), []);
});

test("running a discovery scan schedule starts a job and records success", async () => {
  const adminToken = await bootstrapAdmin();
  const scanResult = makeDiscoveryScanResult({
    scannedHostCount: 4,
    discoveredCount: 1,
  });
  const deferredScan = createDeferred(scanResult);
  setDiscoveryScanRunnerForTests(async (labId, cidr) => {
    assert.equal(labId, "lab_home");
    assert.equal(cidr, "10.42.0.0/30");
    return deferredScan.promise;
  });
  const schedule = await createDiscoveryScanScheduleForTest(adminToken);

  const runRes = await app.inject({
    method: "POST",
    url: `/api/discovery/schedules/${schedule.id}/run`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(runRes.statusCode, 202);
  const started = readJson(runRes) as {
    job: { id: string; cidr: string; status: string };
  };
  assert.equal(started.job.cidr, "10.42.0.0/30");
  assert.notEqual(started.job.status, "completed");

  await waitForDiscoveryScanJobStatus(adminToken, started.job.id, "running");
  deferredScan.resolve(scanResult);
  await waitForDiscoveryScanJobStatus(adminToken, started.job.id, "completed");

  const listRes = await app.inject({
    method: "GET",
    url: "/api/discovery/schedules?labId=lab_home",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(listRes.statusCode, 200);
  const schedules = readJson(listRes) as Array<{
    id: string;
    lastResult: string | null;
    lastMessage: string | null;
  }>;
  const updated = schedules.find((entry) => entry.id === schedule.id);
  assert.equal(updated?.lastResult, "success");
  assert.match(
    updated?.lastMessage ?? "",
    /Checked 4 hosts; found 1 reachable/,
  );
});

test("running a discovery scan schedule records job failures", async () => {
  const adminToken = await bootstrapAdmin();
  setDiscoveryScanRunnerForTests(async () => {
    throw new Error("schedule scan failed");
  });
  const schedule = await createDiscoveryScanScheduleForTest(adminToken);

  const runRes = await app.inject({
    method: "POST",
    url: `/api/discovery/schedules/${schedule.id}/run`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(runRes.statusCode, 202);
  const started = readJson(runRes) as { job: { id: string } };
  const failed = await waitForDiscoveryScanJobStatus(
    adminToken,
    started.job.id,
    "failed",
  );
  assert.equal(failed.error, "schedule scan failed");

  const listRes = await app.inject({
    method: "GET",
    url: "/api/discovery/schedules?labId=lab_home",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(listRes.statusCode, 200);
  const schedules = readJson(listRes) as Array<{
    id: string;
    lastResult: string | null;
    lastMessage: string | null;
  }>;
  const updated = schedules.find((entry) => entry.id === schedule.id);
  assert.equal(updated?.lastResult, "error");
  assert.equal(updated?.lastMessage, "schedule scan failed");
});

test("discovery CIDR expansion fans larger ranges into safe chunks", () => {
  assert.deepEqual(expandDiscoveryCidrs("10.42.0.0/24"), ["10.42.0.0/24"]);
  assert.deepEqual(expandDiscoveryCidrs("10.42.0.0/23"), [
    "10.42.0.0/24",
    "10.42.1.0/24",
  ]);
  assert.equal(expandDiscoveryCidrs("10.42.0.0/20").length, 16);
  assert.throws(
    () => expandDiscoveryCidrs("10.42.0.0/19"),
    /at most 16 \/24 chunks/,
  );
});

test("discovery fan-out scans every usable host in the original CIDR", () => {
  const chunk24 = expandDiscoveryScanChunks("10.42.0.0/24");
  assert.equal(chunk24.length, 1);
  assert.equal(chunk24[0].hosts.length, 254);
  assert.equal(chunk24[0].hosts[0], "10.42.0.1");
  assert.equal(chunk24[0].hosts.at(-1), "10.42.0.254");

  const chunks23 = expandDiscoveryScanChunks("10.42.0.0/23");
  assert.deepEqual(
    chunks23.map((chunk) => chunk.cidr),
    ["10.42.0.0/24", "10.42.1.0/24"],
  );
  assert.equal(
    chunks23.reduce((sum, chunk) => sum + chunk.hosts.length, 0),
    510,
  );
  assert(chunks23[0].hosts.includes("10.42.0.255"));
  assert(chunks23[1].hosts.includes("10.42.1.0"));

  const chunks20 = expandDiscoveryScanChunks("10.42.0.0/20");
  assert.equal(chunks20.length, 16);
  assert.equal(
    chunks20.reduce((sum, chunk) => sum + chunk.hosts.length, 0),
    4094,
  );
});

test("discovery scan schedules reject ranges larger than the fan-out cap", async () => {
  const adminToken = await bootstrapAdmin();

  const res = await app.inject({
    method: "POST",
    url: "/api/discovery/schedules",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.42.0.0/19",
      intervalMs: 120_000,
      enabled: true,
    },
  });

  assert.equal(res.statusCode, 400);
  assert.match(readJson(res).error, /at most 16 \/24 chunks/);
});

test("discovery scan schedules require lab write access", async () => {
  const adminToken = await bootstrapAdmin();
  const viewerToken = await createUserAndLogin(adminToken, {
    username: "viewer-discovery-schedule",
    displayName: "Viewer Discovery Schedule",
    password: "viewer-discovery-schedule-1",
    role: "viewer",
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/discovery/schedules",
    headers: {
      authorization: `Bearer ${viewerToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "10.42.0.0/30",
      intervalMs: 120_000,
      enabled: true,
    },
  });

  assert.equal(res.statusCode, 403);
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

test("network bundles create VLAN, subnet, DHCP, and zones atomically", async () => {
  const adminToken = await bootstrapAdmin();

  const createRes = await app.inject({
    method: "POST",
    url: "/api/networks",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      vlan: {
        vlanId: 777,
        name: "Bundle VLAN",
        description: "Created as one network bundle",
        color: "#4f8cff",
      },
      subnet: {
        cidr: "10.77.0.0/24",
        name: "Bundle subnet",
        gateway: "10.77.0.1",
        dnsServers: ["10.77.0.1", "1.1.1.1"],
      },
      dhcpScope: {
        name: "clients",
        startIp: "10.77.0.100",
        endIp: "10.77.0.150",
        gateway: "10.77.0.1",
        dnsServers: ["10.77.0.1"],
      },
      zones: [
        {
          kind: "dhcp",
          startIp: "10.77.0.100",
          endIp: "10.77.0.150",
          description: "Dynamic pool",
        },
        {
          kind: "static",
          startIp: "10.77.0.10",
          endIp: "10.77.0.49",
          description: "Static hosts",
        },
      ],
    },
  });
  assert.equal(createRes.statusCode, 201);
  const created = readJson(createRes) as {
    vlan: { id: string; vlanId: number; name: string };
    subnet: {
      id: string;
      cidr: string;
      vlanId: string;
      gateway: string;
      dnsServers: string[];
    };
    dhcpScope: { id: string; subnetId: string; startIp: string };
    ipZones: Array<{ subnetId: string; kind: string; startIp: string }>;
  };
  assert.equal(created.vlan.vlanId, 777);
  assert.equal(created.vlan.name, "Bundle VLAN");
  assert.equal(created.subnet.vlanId, created.vlan.id);
  assert.equal(created.subnet.gateway, "10.77.0.1");
  assert.deepEqual(created.subnet.dnsServers, ["10.77.0.1", "1.1.1.1"]);
  assert.equal(created.dhcpScope.subnetId, created.subnet.id);
  assert.equal(created.dhcpScope.startIp, "10.77.0.100");
  assert.equal(created.ipZones.length, 2);
  assert.ok(
    created.ipZones.every((zone) => zone.subnetId === created.subnet.id),
  );

  const badRes = await app.inject({
    method: "POST",
    url: "/api/networks",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      vlan: {
        vlanId: 778,
        name: "Bad bundle VLAN",
      },
      subnet: {
        cidr: "10.78.0.0/24",
        name: "Bad bundle subnet",
      },
      zones: [
        {
          kind: "static",
          startIp: "10.79.0.10",
          endIp: "10.79.0.20",
        },
      ],
    },
  });
  assert.equal(badRes.statusCode, 400);

  const vlansRes = await app.inject({
    method: "GET",
    url: "/api/vlans?labId=lab_home",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  const vlans = readJson(vlansRes) as Array<{ name: string }>;
  assert.equal(
    vlans.some((vlan) => vlan.name === "Bad bundle VLAN"),
    false,
  );

  const subnetsRes = await app.inject({
    method: "GET",
    url: "/api/subnets?labId=lab_home",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  const subnets = readJson(subnetsRes) as Array<{ cidr: string }>;
  assert.equal(
    subnets.some((subnet) => subnet.cidr === "10.78.0.0/24"),
    false,
  );
});

test("DHCP scopes and IP zones validate ranges and subnet containment", async () => {
  const adminToken = await bootstrapAdmin();

  const subnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      cidr: "172.20.0.0/24",
      name: "Validation LAN",
      gateway: "172.20.0.1",
      dnsServers: ["1.1.1.1"],
    },
  });
  assert.equal(subnetRes.statusCode, 201);
  const subnet = readJson(subnetRes) as { id: string; dnsServers: string[] };
  assert.deepEqual(subnet.dnsServers, ["1.1.1.1"]);

  const reversedScopeRes = await app.inject({
    method: "POST",
    url: "/api/dhcp-scopes",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      name: "reversed",
      startIp: "172.20.0.50",
      endIp: "172.20.0.20",
    },
  });
  assert.equal(reversedScopeRes.statusCode, 400);
  assert.match(reversedScopeRes.body, /start IP/i);

  const outsideScopeRes = await app.inject({
    method: "POST",
    url: "/api/dhcp-scopes",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      name: "outside",
      startIp: "172.21.0.10",
      endIp: "172.21.0.20",
    },
  });
  assert.equal(outsideScopeRes.statusCode, 400);
  assert.match(outsideScopeRes.body, /subnet/i);

  const outsideScopeGatewayRes = await app.inject({
    method: "POST",
    url: "/api/dhcp-scopes",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      name: "outside-gateway",
      startIp: "172.20.0.10",
      endIp: "172.20.0.20",
      gateway: "172.21.0.1",
      dnsServers: ["8.8.8.8"],
    },
  });
  assert.equal(outsideScopeGatewayRes.statusCode, 400);
  assert.match(outsideScopeGatewayRes.body, /gateway/i);

  const validScopeRes = await app.inject({
    method: "POST",
    url: "/api/dhcp-scopes",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      name: "valid",
      startIp: "172.20.0.10",
      endIp: "172.20.0.20",
      gateway: "172.20.0.1",
      dnsServers: ["8.8.8.8"],
    },
  });
  assert.equal(validScopeRes.statusCode, 201);
  const scope = readJson(validScopeRes) as { id: string; dnsServers: string[] };
  assert.deepEqual(scope.dnsServers, ["8.8.8.8"]);

  const invalidStartPatchRes = await app.inject({
    method: "PATCH",
    url: `/api/dhcp-scopes/${scope.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      startIp: "172.20.0.30",
    },
  });
  assert.equal(invalidStartPatchRes.statusCode, 400);
  assert.match(invalidStartPatchRes.body, /start IP/i);

  const invalidEndPatchRes = await app.inject({
    method: "PATCH",
    url: `/api/dhcp-scopes/${scope.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      endIp: "172.21.0.20",
    },
  });
  assert.equal(invalidEndPatchRes.statusCode, 400);
  assert.match(invalidEndPatchRes.body, /subnet/i);

  const reversedZoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-zones",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      kind: "static",
      startIp: "172.20.0.80",
      endIp: "172.20.0.70",
    },
  });
  assert.equal(reversedZoneRes.statusCode, 400);
  assert.match(reversedZoneRes.body, /start IP/i);

  const outsideZoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-zones",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      kind: "static",
      startIp: "172.21.0.70",
      endIp: "172.21.0.80",
    },
  });
  assert.equal(outsideZoneRes.statusCode, 400);
  assert.match(outsideZoneRes.body, /subnet/i);

  const validZoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-zones",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      kind: "static",
      startIp: "172.20.0.70",
      endIp: "172.20.0.80",
    },
  });
  assert.equal(validZoneRes.statusCode, 201);
  const zone = readJson(validZoneRes) as { id: string };

  const invalidZoneStartPatchRes = await app.inject({
    method: "PATCH",
    url: `/api/ip-zones/${zone.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      startIp: "172.20.0.90",
    },
  });
  assert.equal(invalidZoneStartPatchRes.statusCode, 400);
  assert.match(invalidZoneStartPatchRes.body, /start IP/i);

  const invalidZoneEndPatchRes = await app.inject({
    method: "PATCH",
    url: `/api/ip-zones/${zone.id}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      endIp: "172.21.0.80",
    },
  });
  assert.equal(invalidZoneEndPatchRes.statusCode, 400);
  assert.match(invalidZoneEndPatchRes.body, /subnet/i);
});

test("non-canonical CIDRs are stored as their canonical network", async () => {
  const adminToken = await bootstrapAdmin();
  const authHeaders = {
    authorization: `Bearer ${adminToken}`,
  };

  const subnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: authHeaders,
    payload: {
      labId: "lab_home",
      cidr: "192.168.1.42/24",
      name: "Non-canonical LAN",
      gateway: "192.168.1.1",
    },
  });
  assert.equal(subnetRes.statusCode, 201);
  const subnet = readJson(subnetRes) as {
    id: string;
    cidr: string;
    gateway: string;
  };
  assert.equal(subnet.cidr, "192.168.1.0/24");
  assert.equal(subnet.gateway, "192.168.1.1");

  const scopeRes = await app.inject({
    method: "POST",
    url: "/api/dhcp-scopes",
    headers: authHeaders,
    payload: {
      subnetId: subnet.id,
      name: "inside-pool",
      startIp: "192.168.1.50",
      endIp: "192.168.1.60",
      gateway: "192.168.1.1",
    },
  });
  assert.equal(scopeRes.statusCode, 201);

  const zoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-zones",
    headers: authHeaders,
    payload: {
      subnetId: subnet.id,
      kind: "static",
      startIp: "192.168.1.70",
      endIp: "192.168.1.80",
    },
  });
  assert.equal(zoneRes.statusCode, 201);

  const outsideScopeRes = await app.inject({
    method: "POST",
    url: "/api/dhcp-scopes",
    headers: authHeaders,
    payload: {
      subnetId: subnet.id,
      name: "outside-pool",
      startIp: "192.168.2.50",
      endIp: "192.168.2.60",
    },
  });
  assert.equal(outsideScopeRes.statusCode, 400);
  assert.match(outsideScopeRes.body, /subnet/i);

  const outsideZoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-zones",
    headers: authHeaders,
    payload: {
      subnetId: subnet.id,
      kind: "reserved",
      startIp: "192.168.2.70",
      endIp: "192.168.2.80",
    },
  });
  assert.equal(outsideZoneRes.statusCode, 400);
  assert.match(outsideZoneRes.body, /subnet/i);

  const assignmentRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: authHeaders,
    payload: {
      subnetId: subnet.id,
      ipAddress: "192.168.1.200",
      assignmentType: "reserved",
      hostname: "non-canonical-reservation",
    },
  });
  assert.equal(assignmentRes.statusCode, 201);

  const cidrPatchRes = await app.inject({
    method: "PATCH",
    url: `/api/subnets/${subnet.id}`,
    headers: authHeaders,
    payload: {
      cidr: "192.168.1.99/24",
    },
  });
  assert.equal(cidrPatchRes.statusCode, 200);
  assert.equal(
    (readJson(cidrPatchRes) as { cidr: string }).cidr,
    "192.168.1.0/24",
  );
});

test("subnet edits validate gateways and existing child records", async () => {
  const adminToken = await bootstrapAdmin();
  const authHeaders = {
    authorization: `Bearer ${adminToken}`,
  };

  async function createSubnet(cidr: string, name: string, gateway?: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/subnets",
      headers: authHeaders,
      payload: {
        labId: "lab_home",
        cidr,
        name,
        gateway,
      },
    });
    assert.equal(res.statusCode, 201);
    return readJson(res) as { id: string };
  }

  async function expectCidrPatchRejected(
    subnetId: string,
    cidr: string,
    pattern: RegExp,
  ) {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/subnets/${subnetId}`,
      headers: authHeaders,
      payload: { cidr },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, pattern);
  }

  const badGatewayCreateRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: authHeaders,
    payload: {
      labId: "lab_home",
      cidr: "10.80.0.0/24",
      name: "Bad gateway LAN",
      gateway: "10.81.0.1",
    },
  });
  assert.equal(badGatewayCreateRes.statusCode, 400);
  assert.match(badGatewayCreateRes.body, /gateway/i);

  const gatewaySubnet = await createSubnet(
    "10.81.0.0/24",
    "Gateway edit LAN",
    "10.81.0.1",
  );
  const badGatewayPatchRes = await app.inject({
    method: "PATCH",
    url: `/api/subnets/${gatewaySubnet.id}`,
    headers: authHeaders,
    payload: {
      gateway: "10.82.0.1",
    },
  });
  assert.equal(badGatewayPatchRes.statusCode, 400);
  assert.match(badGatewayPatchRes.body, /gateway/i);

  const assignmentSubnet = await createSubnet(
    "10.82.0.0/24",
    "Assignment child LAN",
    "10.82.0.1",
  );
  const assignmentRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: authHeaders,
    payload: {
      subnetId: assignmentSubnet.id,
      ipAddress: "10.82.0.200",
      assignmentType: "reserved",
      hostname: "reserved-child",
    },
  });
  assert.equal(assignmentRes.statusCode, 201);
  await expectCidrPatchRejected(
    assignmentSubnet.id,
    "10.82.0.0/25",
    /assignment/i,
  );

  const scopeSubnet = await createSubnet(
    "10.83.0.0/24",
    "Scope child LAN",
    "10.83.0.1",
  );
  const scopeRes = await app.inject({
    method: "POST",
    url: "/api/dhcp-scopes",
    headers: authHeaders,
    payload: {
      subnetId: scopeSubnet.id,
      name: "late-pool",
      startIp: "10.83.0.200",
      endIp: "10.83.0.210",
      gateway: "10.83.0.1",
    },
  });
  assert.equal(scopeRes.statusCode, 201);
  await expectCidrPatchRejected(scopeSubnet.id, "10.83.0.0/25", /DHCP scope/i);

  const zoneSubnet = await createSubnet(
    "10.84.0.0/24",
    "Zone child LAN",
    "10.84.0.1",
  );
  const zoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-zones",
    headers: authHeaders,
    payload: {
      subnetId: zoneSubnet.id,
      kind: "static",
      startIp: "10.84.0.200",
      endIp: "10.84.0.210",
    },
  });
  assert.equal(zoneRes.statusCode, 201);
  await expectCidrPatchRejected(zoneSubnet.id, "10.84.0.0/25", /IP zone/i);

  const successSubnet = await createSubnet(
    "10.85.0.0/24",
    "Shrinkable LAN",
    "10.85.0.1",
  );
  const successScopeRes = await app.inject({
    method: "POST",
    url: "/api/dhcp-scopes",
    headers: authHeaders,
    payload: {
      subnetId: successSubnet.id,
      name: "early-pool",
      startIp: "10.85.0.30",
      endIp: "10.85.0.40",
      gateway: "10.85.0.1",
    },
  });
  assert.equal(successScopeRes.statusCode, 201);
  const successZoneRes = await app.inject({
    method: "POST",
    url: "/api/ip-zones",
    headers: authHeaders,
    payload: {
      subnetId: successSubnet.id,
      kind: "static",
      startIp: "10.85.0.50",
      endIp: "10.85.0.60",
    },
  });
  assert.equal(successZoneRes.statusCode, 201);
  const shrinkRes = await app.inject({
    method: "PATCH",
    url: `/api/subnets/${successSubnet.id}`,
    headers: authHeaders,
    payload: {
      cidr: "10.85.0.0/25",
    },
  });
  assert.equal(shrinkRes.statusCode, 200);
  assert.equal((readJson(shrinkRes) as { cidr: string }).cidr, "10.85.0.0/25");
});

test("legacy off-subnet subnet gateways do not block unrelated edits", async () => {
  const adminToken = await bootstrapAdmin();
  const authHeaders = {
    authorization: `Bearer ${adminToken}`,
  };

  const vlanRes = await app.inject({
    method: "POST",
    url: "/api/vlans",
    headers: authHeaders,
    payload: {
      labId: "lab_home",
      vlanId: 186,
      name: "Legacy Gateway VLAN",
    },
  });
  assert.equal(vlanRes.statusCode, 201);
  const vlan = readJson(vlanRes) as { id: string };

  db.prepare(
    "INSERT INTO subnets (id, labId, cidr, name, description, gateway, dnsServers, vlanId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "s_legacy_gateway",
    "lab_home",
    "10.86.0.0/24",
    "Legacy gateway LAN",
    "Restored subnet",
    "10.87.0.1",
    JSON.stringify(["1.1.1.1"]),
    null,
  );

  const unrelatedEditRes = await app.inject({
    method: "PATCH",
    url: "/api/subnets/s_legacy_gateway",
    headers: authHeaders,
    payload: {
      name: "Legacy gateway LAN renamed",
      description: "Edited without touching gateway",
      dnsServers: ["8.8.8.8"],
      vlanId: vlan.id,
    },
  });
  assert.equal(unrelatedEditRes.statusCode, 200);
  const edited = readJson(unrelatedEditRes) as {
    name: string;
    description: string;
    gateway: string | null;
    dnsServers: string[];
    vlanId: string | null;
  };
  assert.equal(edited.name, "Legacy gateway LAN renamed");
  assert.equal(edited.description, "Edited without touching gateway");
  assert.equal(edited.gateway, "10.87.0.1");
  assert.deepEqual(edited.dnsServers, ["8.8.8.8"]);
  assert.equal(edited.vlanId, vlan.id);

  const cidrBlockedRes = await app.inject({
    method: "PATCH",
    url: "/api/subnets/s_legacy_gateway",
    headers: authHeaders,
    payload: {
      cidr: "10.86.0.0/25",
    },
  });
  assert.equal(cidrBlockedRes.statusCode, 400);
  assert.match(cidrBlockedRes.body, /gateway/i);

  const cidrClearGatewayRes = await app.inject({
    method: "PATCH",
    url: "/api/subnets/s_legacy_gateway",
    headers: authHeaders,
    payload: {
      cidr: "10.86.0.0/25",
      gateway: null,
    },
  });
  assert.equal(cidrClearGatewayRes.statusCode, 200);
  const shrunk = readJson(cidrClearGatewayRes) as {
    cidr: string;
    gateway: string | null;
  };
  assert.equal(shrunk.cidr, "10.86.0.0/25");
  assert.equal(shrunk.gateway, null);

  const badGatewayRes = await app.inject({
    method: "PATCH",
    url: "/api/subnets/s_legacy_gateway",
    headers: authHeaders,
    payload: {
      gateway: "10.87.0.1",
    },
  });
  assert.equal(badGatewayRes.statusCode, 400);
  assert.match(badGatewayRes.body, /gateway/i);
});

test("subnets and ports reject cross-lab VLAN links", async () => {
  const adminToken = await bootstrapAdmin();
  const authHeaders = {
    authorization: `Bearer ${adminToken}`,
  };

  const otherLabRes = await app.inject({
    method: "POST",
    url: "/api/labs",
    headers: authHeaders,
    payload: {
      id: "lab_vlan_other",
      name: "Other VLAN Lab",
    },
  });
  assert.equal(otherLabRes.statusCode, 201);

  const homeVlanRes = await app.inject({
    method: "POST",
    url: "/api/vlans",
    headers: authHeaders,
    payload: {
      labId: "lab_home",
      vlanId: 200,
      name: "Home VLAN",
    },
  });
  assert.equal(homeVlanRes.statusCode, 201);
  const homeVlan = readJson(homeVlanRes) as { id: string };

  const otherVlanRes = await app.inject({
    method: "POST",
    url: "/api/vlans",
    headers: authHeaders,
    payload: {
      labId: "lab_vlan_other",
      vlanId: 200,
      name: "Other VLAN",
    },
  });
  assert.equal(otherVlanRes.statusCode, 201);
  const otherVlan = readJson(otherVlanRes) as { id: string };

  const homeSubnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: authHeaders,
    payload: {
      labId: "lab_home",
      cidr: "10.90.0.0/24",
      name: "Home VLAN subnet",
      vlanId: homeVlan.id,
    },
  });
  assert.equal(homeSubnetRes.statusCode, 201);
  const homeSubnet = readJson(homeSubnetRes) as { id: string; vlanId: string };
  assert.equal(homeSubnet.vlanId, homeVlan.id);

  const crossLabSubnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: authHeaders,
    payload: {
      labId: "lab_home",
      cidr: "10.91.0.0/24",
      name: "Cross lab subnet",
      vlanId: otherVlan.id,
    },
  });
  assert.equal(crossLabSubnetRes.statusCode, 400);
  assert.match(crossLabSubnetRes.body, /same lab/i);

  const crossLabSubnetPatchRes = await app.inject({
    method: "PATCH",
    url: `/api/subnets/${homeSubnet.id}`,
    headers: authHeaders,
    payload: {
      vlanId: otherVlan.id,
    },
  });
  assert.equal(crossLabSubnetPatchRes.statusCode, 400);
  assert.match(crossLabSubnetPatchRes.body, /same lab/i);

  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: authHeaders,
    payload: {
      labId: "lab_home",
      hostname: "vlan-link-switch",
      deviceType: "switch",
      status: "online",
    },
  });
  assert.equal(deviceRes.statusCode, 201);
  const device = readJson(deviceRes) as { id: string };

  const accessPortRes = await app.inject({
    method: "POST",
    url: "/api/ports",
    headers: authHeaders,
    payload: {
      deviceId: device.id,
      name: "Gi0/10",
      kind: "rj45",
      mode: "access",
      vlanId: homeVlan.id,
    },
  });
  assert.equal(accessPortRes.statusCode, 201);
  const accessPort = readJson(accessPortRes) as { id: string; vlanId: string };
  assert.equal(accessPort.vlanId, homeVlan.id);

  const crossLabAccessPortRes = await app.inject({
    method: "POST",
    url: "/api/ports",
    headers: authHeaders,
    payload: {
      deviceId: device.id,
      name: "Gi0/11",
      kind: "rj45",
      mode: "access",
      vlanId: otherVlan.id,
    },
  });
  assert.equal(crossLabAccessPortRes.statusCode, 400);
  assert.match(crossLabAccessPortRes.body, /same lab/i);

  const crossLabAccessPatchRes = await app.inject({
    method: "PATCH",
    url: `/api/ports/${accessPort.id}`,
    headers: authHeaders,
    payload: {
      vlanId: otherVlan.id,
    },
  });
  assert.equal(crossLabAccessPatchRes.statusCode, 400);
  assert.match(crossLabAccessPatchRes.body, /same lab/i);

  const trunkPortRes = await app.inject({
    method: "POST",
    url: "/api/ports",
    headers: authHeaders,
    payload: {
      deviceId: device.id,
      name: "Gi0/12",
      kind: "rj45",
      mode: "trunk",
      vlanId: homeVlan.id,
      allowedVlanIds: [homeVlan.id],
    },
  });
  assert.equal(trunkPortRes.statusCode, 201);
  const trunkPort = readJson(trunkPortRes) as {
    id: string;
    vlanId: string;
    allowedVlanIds: string[];
  };
  assert.equal(trunkPort.vlanId, homeVlan.id);
  assert.deepEqual(trunkPort.allowedVlanIds, [homeVlan.id]);

  const missingTrunkVlanRes = await app.inject({
    method: "POST",
    url: "/api/ports",
    headers: authHeaders,
    payload: {
      deviceId: device.id,
      name: "Gi0/13",
      kind: "rj45",
      mode: "trunk",
      allowedVlanIds: ["vlan_missing"],
    },
  });
  assert.equal(missingTrunkVlanRes.statusCode, 400);
  assert.match(missingTrunkVlanRes.body, /does not exist/i);

  const crossLabTrunkPatchRes = await app.inject({
    method: "PATCH",
    url: `/api/ports/${trunkPort.id}`,
    headers: authHeaders,
    payload: {
      allowedVlanIds: [otherVlan.id],
    },
  });
  assert.equal(crossLabTrunkPatchRes.statusCode, 400);
  assert.match(crossLabTrunkPatchRes.body, /same lab/i);
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
      gateway: "192.168.50.1",
      dnsServers: ["192.168.50.3"],
    },
  });
  assert.equal(subnetRes.statusCode, 201);
  const subnet = readJson(subnetRes) as {
    id: string;
    gateway: string;
    dnsServers: string[];
  };
  assert.equal(subnet.gateway, "192.168.50.1");
  assert.deepEqual(subnet.dnsServers, ["192.168.50.3"]);

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

  const subnetDnsDeviceRes = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      subnetId: subnet.id,
      ipAddress: "192.168.50.3",
      assignmentType: "device",
      hostname: "subnet-dns-overwrite",
    },
  });
  assert.equal(subnetDnsDeviceRes.statusCode, 400);
  assert.match(subnetDnsDeviceRes.body, /DNS/i);

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

test("Docker and monitor TLS migrations default existing rows safely", async () => {
  const legacyPath = path.join(tempDir, "docker-source-v31.db");
  const { default: Database } = await import("better-sqlite3");
  const initializeDatabase = () =>
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
        env: {
          ...process.env,
          DATABASE_PATH: legacyPath,
          NODE_ENV: "test",
        },
        stdio: "pipe",
      },
    );

  initializeDatabase();
  const legacy = new Database(legacyPath);
  legacy.exec(`
    INSERT INTO labs (id, name, description, location)
    VALUES ('lab_home', 'Migration test', NULL, NULL);

    INSERT INTO dockerImportSources (
      id, labId, name, endpoint, enabled, createdAt, updatedAt
    ) VALUES (
      'docksrc_legacy', 'lab_home', 'Legacy Docker',
      'https://8.8.8.8:2376', 0, '2026-07-20T00:00:00.000Z',
      '2026-07-20T00:00:00.000Z'
    );

    DROP INDEX idx_docker_import_sources_enabled;
    DROP INDEX idx_docker_import_sources_lab_id;

    CREATE TABLE dockerImportSourcesV31 (
      id TEXT PRIMARY KEY,
      labId TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      tokenEnc TEXT,
      lastSyncAt TEXT,
      lastSyncStatus TEXT,
      lastSyncMessage TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(labId, endpoint)
    );
    INSERT INTO dockerImportSourcesV31 (
      id, labId, name, endpoint, tokenEnc, lastSyncAt, lastSyncStatus,
      lastSyncMessage, createdAt, updatedAt
    )
    SELECT id, labId, name, endpoint, tokenEnc, lastSyncAt, lastSyncStatus,
      lastSyncMessage, createdAt, updatedAt
    FROM dockerImportSources;
    DROP TABLE dockerImportSources;
    ALTER TABLE dockerImportSourcesV31 RENAME TO dockerImportSources;
    CREATE INDEX idx_docker_import_sources_lab_id
      ON dockerImportSources (labId);
    ALTER TABLE deviceMonitors DROP COLUMN ignoreTlsErrors;
    UPDATE schemaVersion
    SET version = 31, updatedAt = '2026-07-20T00:00:00.000Z'
    WHERE id = 1;
  `);
  legacy.close();

  initializeDatabase();

  const migrated = new Database(legacyPath, { readonly: true });
  const source = migrated
    .prepare("SELECT enabled FROM dockerImportSources WHERE id = ?")
    .get("docksrc_legacy") as { enabled: number };
  const version = migrated
    .prepare("SELECT version FROM schemaVersion WHERE id = 1")
    .get() as { version: number };
  const tlsColumn = (
    migrated.prepare("PRAGMA table_info(deviceMonitors)").all() as Array<{
      name: string;
      dflt_value: string | null;
    }>
  ).find((column) => column.name === "ignoreTlsErrors");
  assert.equal(source.enabled, 1);
  assert.equal(tlsColumn?.dflt_value, "0");
  assert.equal(version.version, 33);
  migrated.close();
});

test("docker import stores a sync source and refreshes container status", async () => {
  const adminToken = await bootstrapAdmin();
  const enabledColumn = (
    db.prepare("PRAGMA table_info(dockerImportSources)").all() as Array<{
      name: string;
      dflt_value: string | null;
    }>
  ).find((column) => column.name === "enabled");
  assert.equal(enabledColumn?.dflt_value, "1");
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

  const requestedUrls: string[] = [];
  const authHeaders: Array<string | null> = [];
  let state = "running";
  let status = "Up 3 minutes";
  let includeSecondContainer = false;
  setDockerHttpJsonFetcherForTests(async (url, headers) => {
    requestedUrls.push(url.toString());
    authHeaders.push(headers?.Authorization ?? null);
    return [
      {
        Id: "container-abc123",
        Names: ["/paperless"],
        Image: "ghcr.io/paperless:latest",
        State: state,
        Status: status,
      },
      ...(includeSecondContainer
        ? [
            {
              Id: "container-def456",
              Names: ["/homepage"],
              Image: "ghcr.io/gethomepage/homepage:latest",
              State: state,
              Status: status,
            },
          ]
        : []),
    ];
  });

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
      enabled: number;
    };
    assert.equal(source.endpoint, "https://8.8.8.8/api/endpoints/2/docker");
    assert.ok(source.tokenEnc);
    assert.notEqual(source.tokenEnc, "portainer-token");
    assert.equal(source.enabled, 1);

    const sourceBeforeInvalidPatches = db
      .prepare(
        "SELECT enabled, updatedAt FROM dockerImportSources WHERE id = ?",
      )
      .get(source.id);
    for (const payload of [
      {},
      { enabled: null },
      { enabled: "false" },
      { enabled: 0 },
    ]) {
      const invalidToggleRes = await app.inject({
        method: "PATCH",
        url: `/api/imports/docker/sources/${source.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload,
      });
      assert.equal(invalidToggleRes.statusCode, 400);
      assert.deepEqual(
        db
          .prepare(
            "SELECT enabled, updatedAt FROM dockerImportSources WHERE id = ?",
          )
          .get(source.id),
        sourceBeforeInvalidPatches,
      );
    }

    const sourcesRes = await app.inject({
      method: "GET",
      url: "/api/imports/docker/sources?labId=lab_home",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(sourcesRes.statusCode, 200);
    assert.equal(
      (readJson(sourcesRes) as Array<{ enabled: boolean }>)[0]?.enabled,
      true,
    );

    const disableRes = await app.inject({
      method: "PATCH",
      url: `/api/imports/docker/sources/${source.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: false },
    });
    assert.equal(disableRes.statusCode, 200);
    assert.equal((readJson(disableRes) as { enabled: boolean }).enabled, false);

    includeSecondContainer = true;
    const secondImportRes = await app.inject({
      method: "POST",
      url: "/api/imports/docker/import",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        endpoint: "https://8.8.8.8/api/endpoints/2/docker/",
        containerId: "container-def456",
        labId: "lab_home",
        hostDeviceId: host.id,
      },
    });
    assert.equal(secondImportRes.statusCode, 201);
    assert.equal(
      (
        db
          .prepare("SELECT enabled FROM dockerImportSources WHERE id = ?")
          .get(source.id) as { enabled: number }
      ).enabled,
      0,
    );

    const fetchCountBeforeBlockedSync = requestedUrls.length;
    const blockedManualSyncRes = await app.inject({
      method: "POST",
      url: "/api/imports/docker/sync",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { labId: "lab_home", sourceId: source.id },
    });
    assert.equal(blockedManualSyncRes.statusCode, 409);
    assert.match(blockedManualSyncRes.body, /disabled/i);

    const skippedBulkSyncRes = await app.inject({
      method: "POST",
      url: "/api/imports/docker/sync",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { labId: "lab_home" },
    });
    assert.equal(skippedBulkSyncRes.statusCode, 200);
    assert.equal(
      (readJson(skippedBulkSyncRes) as { sources: number }).sources,
      0,
    );
    assert.equal(requestedUrls.length, fetchCountBeforeBlockedSync);

    const enableRes = await app.inject({
      method: "PATCH",
      url: `/api/imports/docker/sources/${source.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: true },
    });
    assert.equal(enableRes.statusCode, 200);
    assert.equal((readJson(enableRes) as { enabled: boolean }).enabled, true);

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
    assert.equal(sync.updated, 2);
    assert.equal(sync.missing, 0);
    assert.equal(sync.failed, 0);
    assert.ok(
      sync.devices.some(
        (device) => device.id === imported.id && device.status === "offline",
      ),
    );

    const updatedLink = db
      .prepare(
        "SELECT state, status FROM dockerContainerLinks WHERE deviceId = ?",
      )
      .get(imported.id) as { state: string; status: string };
    assert.equal(updatedLink.state, "exited");
    assert.equal(updatedLink.status, "Exited (0) 10 seconds ago");
  } finally {
    setDockerHttpJsonFetcherForTests(null);
  }
});

test("global device type and port template mutations require an administrator", async () => {
  const adminToken = await bootstrapAdmin();
  const editorToken = await createUserAndLogin(adminToken, {
    username: "global-config-editor",
    displayName: "Global Config Editor",
    password: "global-config-editor-1",
    role: "editor",
  });
  const headers = { authorization: `Bearer ${editorToken}` };

  const deviceTypeRes = await app.inject({
    method: "POST",
    url: "/api/device-types",
    headers,
    payload: { label: "Unauthorized Type", parentType: "other" },
  });
  assert.equal(deviceTypeRes.statusCode, 403);

  const templateRes = await app.inject({
    method: "POST",
    url: "/api/ports/templates",
    headers,
    payload: {
      name: "Unauthorized Template",
      description: "Must not be created",
      deviceTypes: ["switch"],
      ports: [{ name: "eth0", kind: "rj45" }],
    },
  });
  assert.equal(templateRes.statusCode, 403);
});

test("IP assignments reject cross-lab references and make legacy references inert", async () => {
  const adminToken = await bootstrapAdmin();
  db.prepare("INSERT INTO labs (id, name) VALUES (?, ?)").run(
    "lab_hidden",
    "Hidden Lab",
  );
  const editorToken = await createUserAndLogin(adminToken, {
    username: "lab-a-editor",
    displayName: "Lab A Editor",
    password: "lab-a-editor-password",
    role: "editor",
  });
  const editor = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get("lab-a-editor") as { id: string };
  db.prepare("DELETE FROM userLabAccess WHERE userId = ? AND labId = ?").run(
    editor.id,
    "lab_hidden",
  );

  db.prepare(
    `
    INSERT INTO devices (id, labId, hostname, deviceType, managementIp, status, placement)
    VALUES ('device_hidden', 'lab_hidden', 'hidden-router', 'router', '10.60.0.10', 'online', 'room')
  `,
  ).run();
  const subnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      labId: "lab_home",
      cidr: "10.50.0.0/24",
      name: "Visible subnet",
    },
  });
  const subnet = readJson(subnetRes) as { id: string };

  const rejected = await app.inject({
    method: "POST",
    url: "/api/ip-assignments",
    headers: { authorization: `Bearer ${editorToken}` },
    payload: {
      subnetId: subnet.id,
      ipAddress: "10.50.0.10",
      assignmentType: "device",
      deviceId: "device_hidden",
    },
  });
  assert.equal(rejected.statusCode, 422);
  assert.equal(
    (readJson(rejected) as { code: string }).code,
    "CROSS_LAB_REFERENCE",
  );

  db.prepare(
    `
    INSERT INTO ipAssignments (id, subnetId, ipAddress, assignmentType, deviceId)
    VALUES ('legacy_cross_lab', ?, '10.50.0.11', 'device', 'device_hidden')
  `,
  ).run(subnet.id);
  const listRes = await app.inject({
    method: "GET",
    url: `/api/ip-assignments?subnetId=${subnet.id}`,
    headers: { authorization: `Bearer ${editorToken}` },
  });
  const listed = readJson(listRes) as Array<{
    deviceId: string | null;
    integrity: { state: string };
  }>;
  assert.equal(listed[0]?.deviceId, null);
  assert.equal(listed[0]?.integrity.state, "cross-lab-reference");

  const deleteRes = await app.inject({
    method: "DELETE",
    url: "/api/ip-assignments/legacy_cross_lab",
    headers: { authorization: `Bearer ${editorToken}` },
  });
  assert.equal(deleteRes.statusCode, 204);
  const hiddenDevice = db
    .prepare("SELECT managementIp FROM devices WHERE id = ?")
    .get("device_hidden") as { managementIp: string };
  assert.equal(hiddenDevice.managementIp, "10.60.0.10");

  db.prepare(
    `
    INSERT INTO devices (id, labId, hostname, deviceType, status, placement)
    VALUES (?, 'lab_home', ?, 'server', 'online', 'room')
  `,
  ).run("device_visible_a", "visible-a");
  db.prepare(
    `
    INSERT INTO devices (id, labId, hostname, deviceType, status, placement)
    VALUES (?, 'lab_home', ?, 'server', 'online', 'room')
  `,
  ).run("device_visible_b", "visible-b");
  db.prepare(
    `
    INSERT INTO ports (id, deviceId, name, position, kind, linkState)
    VALUES ('port_visible_b', 'device_visible_b', 'eth0', 1, 'rj45', 'up')
  `,
  ).run();
  db.prepare(
    `
    INSERT INTO ipAssignments (id, subnetId, ipAddress, assignmentType, deviceId, portId)
    VALUES ('legacy_port_mismatch', ?, '10.50.0.12', 'interface', 'device_visible_a', 'port_visible_b')
  `,
  ).run(subnet.id);

  const mismatchListRes = await app.inject({
    method: "GET",
    url: `/api/ip-assignments?subnetId=${subnet.id}`,
    headers: { authorization: `Bearer ${editorToken}` },
  });
  const mismatchList = readJson(mismatchListRes) as Array<{
    id: string;
    portId: string | null;
    integrity: { state: string; fields: string[] };
  }>;
  const mismatch = mismatchList.find(
    (row) => row.id === "legacy_port_mismatch",
  );
  assert.equal(mismatch?.portId, null);
  assert.equal(mismatch?.integrity.state, "reference-mismatch");
  assert.deepEqual(mismatch?.integrity.fields, ["portId"]);

  db.prepare(
    `
    INSERT INTO ipAssignments (id, subnetId, ipAddress, assignmentType, deviceId, portId)
    VALUES ('legacy_combined_invalid', ?, '10.50.0.13', 'interface', 'device_hidden', 'port_visible_b')
  `,
  ).run(subnet.id);
  const combinedListRes = await app.inject({
    method: "GET",
    url: `/api/ip-assignments?subnetId=${subnet.id}`,
    headers: { authorization: `Bearer ${editorToken}` },
  });
  const combined = (
    readJson(combinedListRes) as Array<{
      id: string;
      deviceId: string | null;
      portId: string | null;
      integrity: { state: string; fields: string[] };
    }>
  ).find((row) => row.id === "legacy_combined_invalid");
  assert.equal(combined?.deviceId, null);
  assert.equal(combined?.portId, null);
  assert.equal(combined?.integrity.state, "cross-lab-reference");
  assert.deepEqual(combined?.integrity.fields, ["deviceId", "portId"]);

  const reportRes = await app.inject({
    method: "GET",
    url: "/api/admin/integrity",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  const report = readJson(reportRes) as {
    assignmentReferences: Array<{ id: string; integrity: { state: string } }>;
  };
  assert.equal(
    report.assignmentReferences.find((row) => row.id === "legacy_port_mismatch")
      ?.integrity.state,
    "reference-mismatch",
  );

  const repairedRes = await app.inject({
    method: "PATCH",
    url: "/api/ip-assignments/legacy_port_mismatch",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { portId: null },
  });
  assert.equal(repairedRes.statusCode, 200);
  const repaired = readJson(repairedRes) as {
    portId: null;
    integrity: { state: string };
  };
  assert.equal(repaired.portId, null);
  assert.equal(repaired.integrity.state, "ok");
});

test("subnets are canonicalized, overlaps are rejected, and legacy conflicts are reported", async () => {
  const adminToken = await bootstrapAdmin();
  const headers = { authorization: `Bearer ${adminToken}` };
  const firstRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers,
    payload: { labId: "lab_home", cidr: "10.70.0.42/24", name: "Canonical" },
  });
  assert.equal(firstRes.statusCode, 201);
  assert.equal((readJson(firstRes) as { cidr: string }).cidr, "10.70.0.0/24");

  const overlapRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers,
    payload: { labId: "lab_home", cidr: "10.70.0.128/25", name: "Overlap" },
  });
  assert.equal(overlapRes.statusCode, 409);
  assert.equal(
    (readJson(overlapRes) as { code: string }).code,
    "SUBNET_OVERLAP",
  );

  db.prepare(
    "INSERT INTO subnets (id, labId, cidr, name) VALUES (?, ?, ?, ?)",
  ).run("legacy_overlap", "lab_home", "10.70.0.64/26", "Legacy overlap");
  const integrityRes = await app.inject({
    method: "GET",
    url: "/api/admin/integrity",
    headers,
  });
  assert.equal(integrityRes.statusCode, 200);
  const report = readJson(integrityRes) as {
    subnetConflicts: Array<{ id: string }>;
  };
  assert.ok(
    report.subnetConflicts.some((issue) => issue.id === "legacy_overlap"),
  );
});

test("conflicted subnet children are read-only for non-admins and repairable by admins", async () => {
  const adminToken = await bootstrapAdmin();
  const editorToken = await createUserAndLogin(adminToken, {
    username: "conflict-editor",
    displayName: "Conflict Editor",
    password: "conflict-editor-password",
    role: "editor",
  });
  const viewerToken = await createUserAndLogin(adminToken, {
    username: "conflict-viewer",
    displayName: "Conflict Viewer",
    password: "conflict-viewer-password",
    role: "viewer",
  });
  const createSubnetRes = await app.inject({
    method: "POST",
    url: "/api/subnets",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      labId: "lab_home",
      cidr: "10.71.0.0/24",
      name: "Conflict parent",
    },
  });
  const subnet = readJson(createSubnetRes) as { id: string };
  db.prepare(
    "INSERT INTO subnets (id, labId, cidr, name) VALUES (?, ?, ?, ?)",
  ).run(
    "legacy_conflict_child",
    "lab_home",
    "10.71.0.128/25",
    "Legacy conflict child",
  );
  db.prepare(
    `
    INSERT INTO devices (id, labId, hostname, deviceType, status, placement)
    VALUES ('device_conflict_child', 'lab_home', 'conflict-device', 'server', 'online', 'room')
  `,
  ).run();
  db.prepare(
    `
    INSERT INTO dhcpScopes (id, subnetId, name, startIp, endIp)
    VALUES ('scope_conflict_child', ?, 'Conflict scope', '10.71.0.100', '10.71.0.120')
  `,
  ).run(subnet.id);
  db.prepare(
    `
    INSERT INTO ipZones (id, subnetId, kind, startIp, endIp)
    VALUES ('zone_conflict_child', ?, 'static', '10.71.0.20', '10.71.0.80')
  `,
  ).run(subnet.id);
  db.prepare(
    `
    INSERT INTO ipAssignments (id, subnetId, ipAddress, assignmentType, deviceId, hostname)
    VALUES ('assignment_conflict_child', ?, '10.71.0.30', 'device', 'device_conflict_child', 'conflict-device')
  `,
  ).run(subnet.id);

  async function expectConflict(
    token: string,
    method: "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: Record<string, unknown>,
    expectedStatus = 403,
  ) {
    const response = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    assert.equal(response.statusCode, expectedStatus, `${method} ${url}`);
    assert.equal(
      (readJson(response) as { code: string }).code,
      "SUBNET_INTEGRITY_CONFLICT",
    );
  }

  await expectConflict(
    editorToken,
    "POST",
    "/api/ip-assignments",
    {
      subnetId: subnet.id,
      ipAddress: "10.71.0.40",
      assignmentType: "device",
    },
    409,
  );
  await expectConflict(
    editorToken,
    "PATCH",
    "/api/dhcp-scopes/scope_conflict_child",
    { name: "blocked" },
  );
  await expectConflict(
    editorToken,
    "DELETE",
    "/api/ip-zones/zone_conflict_child",
  );
  await expectConflict(
    editorToken,
    "PATCH",
    "/api/ip-assignments/assignment_conflict_child",
    { hostname: "blocked" },
  );
  await expectConflict(
    viewerToken,
    "DELETE",
    "/api/ip-assignments/assignment_conflict_child",
  );

  const metadataRes = await app.inject({
    method: "PATCH",
    url: "/api/devices/device_conflict_child",
    headers: { authorization: `Bearer ${editorToken}` },
    payload: { hostname: "conflict-device-renamed" },
  });
  assert.equal(metadataRes.statusCode, 200);
  await expectConflict(
    editorToken,
    "DELETE",
    "/api/devices/device_conflict_child",
  );

  const adminScopePatch = await app.inject({
    method: "PATCH",
    url: "/api/dhcp-scopes/scope_conflict_child",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: "Admin repaired scope" },
  });
  assert.equal(adminScopePatch.statusCode, 200);
  const adminAssignmentPatch = await app.inject({
    method: "PATCH",
    url: "/api/ip-assignments/assignment_conflict_child",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { hostname: "admin-repaired-reference" },
  });
  assert.equal(adminAssignmentPatch.statusCode, 200);
  const adminDeviceDelete = await app.inject({
    method: "DELETE",
    url: "/api/devices/device_conflict_child",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminDeviceDelete.statusCode, 204);
  const adminScopeDelete = await app.inject({
    method: "DELETE",
    url: "/api/dhcp-scopes/scope_conflict_child",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminScopeDelete.statusCode, 204);
  const adminZoneDelete = await app.inject({
    method: "DELETE",
    url: "/api/ip-zones/zone_conflict_child",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminZoneDelete.statusCode, 204);
});

test("discovery jobs enforce global, per-lab, and queued limits", async () => {
  process.env.DISCOVERY_SCAN_MAX_ACTIVE = "2";
  process.env.DISCOVERY_SCAN_MAX_ACTIVE_PER_LAB = "1";
  process.env.DISCOVERY_SCAN_MAX_QUEUED = "1";
  const adminToken = await bootstrapAdmin();
  db.prepare("INSERT INTO labs (id, name) VALUES (?, ?)").run(
    "lab_queue_b",
    "Queue B",
  );
  const deferred = new Map<
    string,
    ReturnType<
      typeof createDeferred<ReturnType<typeof makeDiscoveryScanResult>>
    >
  >();
  setDiscoveryScanRunnerForTests(async (_labId, cidr) => {
    const wait = createDeferred(makeDiscoveryScanResult());
    deferred.set(cidr, wait);
    return wait.promise;
  });
  const headers = { authorization: `Bearer ${adminToken}` };
  const start = (labId: string, cidr: string) =>
    app.inject({
      method: "POST",
      url: "/api/discovery/scan",
      headers,
      payload: { labId, cidr },
    });

  const first = await start("lab_home", "10.80.0.0/30");
  const queued = await start("lab_home", "10.80.0.4/30");
  const otherLab = await start("lab_queue_b", "10.90.0.0/30");
  assert.equal(first.statusCode, 202);
  assert.equal(otherLab.statusCode, 202);
  const queuedJob = (
    readJson(queued) as { job: { status: string; queuePosition: number } }
  ).job;
  assert.equal(queuedJob.status, "queued");
  assert.equal(queuedJob.queuePosition, 1);

  const full = await start("lab_home", "10.80.0.8/30");
  assert.equal(full.statusCode, 429);
  assert.equal(
    (readJson(full) as { code: string }).code,
    "DISCOVERY_QUEUE_FULL",
  );

  deferred.get("10.80.0.0/30")?.resolve();
  deferred.get("10.90.0.0/30")?.resolve();
  await wait(20);
  deferred.get("10.80.0.4/30")?.resolve();
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
    DELETE FROM discoveryScanSchedules;
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

function makeDiscoveryScanResult(
  overrides: Partial<{
    chunkCount: number;
    scannedHostCount: number;
    discoveredCount: number;
    macAddressCount: number;
    vendorCount: number;
    technicalCount: number;
    diagnostics: Array<{
      code: string;
      severity: "info" | "warning";
      message: string;
      detail?: string;
    }>;
    rows: unknown[];
  }> = {},
) {
  return {
    chunkCount: 1,
    scannedHostCount: 2,
    discoveredCount: 0,
    macAddressCount: 0,
    vendorCount: 0,
    technicalCount: 0,
    diagnostics: [],
    rows: [],
    ...overrides,
  };
}

function createDeferred<T>(value?: T) {
  let resolve!: (result: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve: (result = value as T) => resolve(result),
    reject,
  };
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getDiscoveryScanJobForTest(token: string, id: string) {
  const res = await app.inject({
    method: "GET",
    url: `/api/discovery/scan-jobs/${id}`,
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  assert.equal(res.statusCode, 200);
  return (
    readJson(res) as {
      job: {
        id: string;
        status: string;
        result: ReturnType<typeof makeDiscoveryScanResult> | null;
        error: string | null;
      };
    }
  ).job;
}

async function waitForDiscoveryScanJobStatus(
  token: string,
  id: string,
  status: string,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = await getDiscoveryScanJobForTest(token, id);
    if (job.status === status) return job;
    await wait(20);
  }
  const job = await getDiscoveryScanJobForTest(token, id);
  assert.fail(
    `Expected discovery scan job ${id} to reach ${status}, got ${job.status}.`,
  );
}

async function createDiscoveryScanScheduleForTest(adminToken: string) {
  const createRes = await app.inject({
    method: "POST",
    url: "/api/discovery/schedules",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    payload: {
      labId: "lab_home",
      name: "Async schedule",
      cidr: "10.42.0.0/30",
      intervalMs: 120_000,
      enabled: true,
    },
  });
  assert.equal(createRes.statusCode, 201);
  return readJson(createRes) as { id: string; cidr: string };
}

async function createSnmpIntegerResponder(value: number) {
  return createSnmpResponder((request) =>
    buildSnmpIntegerResponse(request, value),
  );
}

async function createSnmpExceptionResponder(
  exceptionTag: 0x80 | 0x81 | 0x82,
) {
  let requestCount = 0;
  const server = await createSnmpResponder((request) => {
    requestCount += 1;
    return buildSnmpExceptionResponse(request, exceptionTag);
  });
  return {
    server,
    requestCount: () => requestCount,
  };
}

async function createMalformedSnmpResponder() {
  return createSnmpResponder(() => Buffer.from([0]));
}

async function createSnmpResponder(
  buildResponse: (request: Buffer) => Buffer,
) {
  const server = dgram.createSocket("udp4");
  server.on("message", (packet, remote) => {
    try {
      const response = buildResponse(packet);
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
  // Test UDP sockets are local process resources; no filesystem path is checked.
  // codeql[js/file-system-race]
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function buildSnmpIntegerResponse(request: Buffer, value: number) {
  return buildSnmpResponse(request, testBerInteger(value));
}

function buildSnmpExceptionResponse(
  request: Buffer,
  exceptionTag: 0x80 | 0x81 | 0x82,
) {
  return buildSnmpResponse(
    request,
    testBerTlv(exceptionTag, Buffer.alloc(0)),
  );
}

function buildSnmpResponse(request: Buffer, value: Buffer) {
  const parsed = parseSnmpRequest(request);
  const variableBinding = testBerSequence(
    Buffer.concat([testBerTlv(0x06, parsed.oid), value]),
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
    // The fallback SPA fixture is created in the test workspace before app use.
    //
    // codeql[js/file-system-race]
    writeFileSync(
      spaIndexFile,
      "<!doctype html><html><head><title>Rackpad SPA Fallback</title></head><body>rackpad spa fallback</body></html>",
      "utf8",
    );
  }
}

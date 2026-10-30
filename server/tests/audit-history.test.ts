import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
const directory = mkdtempSync(path.join(os.tmpdir(), "rackpad-audit-history-"));
process.env.DATABASE_PATH = path.join(directory, "fixture.db");
process.env.NODE_ENV = "test";
const { db } = await import("../db.js");
const { createApp } = await import("../app.js");
const { writeAuditLogEntry } = await import("../lib/audit-log.js");
const { validateRackpadSqliteDatabase } =
  await import("../lib/native-backup-validation.js");
const app = await createApp();
let headers: Record<string, string>;
const password = "synthetic-audit-password";
before(async () => {
  const auth = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      displayName: "Admin",
      password,
      loadDemoData: false,
    },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  headers = { authorization: `Bearer ${auth.json().token}` };
});
beforeEach(() => {
  db.exec(
    "DELETE FROM labs; DELETE FROM auditLog; DELETE FROM hardwareTemplateDefaults; DELETE FROM users WHERE username != 'admin'; INSERT INTO labs(id,name) VALUES('a','A'),('b','B')",
  );
});
after(async () => {
  await app.close();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
async function user(name: string, labs: string[]) {
  const res = await app.inject({
    method: "POST",
    url: "/api/users",
    headers,
    payload: {
      username: name,
      displayName: name,
      password,
      role: "editor",
      labAccess: labs.map((labId) => ({ labId, role: "editor" })),
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  const auth = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: name, password },
  });
  assert.equal(auth.statusCode, 200, auth.body);
  return {
    id: res.json().id as string,
    headers: { authorization: `Bearer ${auth.json().token}` },
  };
}
function fixture(crossLab = false) {
  db.exec(`INSERT INTO devices(id,labId,hostname,deviceType) VALUES('one','a','one','server'),('two','${crossLab ? "b" : "a"}','two','server');
    INSERT INTO ports(id,deviceId,name,position,kind) VALUES('p1','one','1',1,'rj45'),('p2','two','2',1,'rj45');
    INSERT INTO portLinks(id,fromPortId,toPortId) VALUES('link','p1','p2')`);
  writeAuditLogEntry({
    user: "admin",
    action: "port.link",
    entityType: "PortLink",
    entityId: "link",
    summary: "Linked fixture",
  });
}
async function history(type: string, id: string, auth = headers) {
  return app.inject({
    url: `/api/audit-log?entityType=${type}&entityId=${id}`,
    headers: auth,
  });
}

test("cable deletion retains create/delete history and enforces current grants after deletion", async () => {
  fixture();
  const editor = await user("editor", ["a"]);
  const outsider = await user("outsider", ["b"]);
  const deleted = await app.inject({
    method: "DELETE",
    url: "/api/port-links/link",
    headers: editor.headers,
  });
  assert.equal(deleted.statusCode, 204, deleted.body);
  const result = await history("PortLink", "link", editor.headers);
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(
    result
      .json()
      .map((row: { action: string }) => row.action)
      .sort(),
    ["port.link", "port.unlink"],
  );
  for (const row of result.json()) assert.deepEqual(row.labIds, ["a"]);
  assert.equal(
    (await history("PortLink", "link", outsider.headers)).statusCode,
    403,
  );
  assert.deepEqual(
    (
      await app.inject({ url: "/api/audit-log", headers: editor.headers })
    ).json(),
    [],
  );
  db.prepare("DELETE FROM userLabAccess WHERE userId = ?").run(editor.id);
  assert.equal(
    (await history("PortLink", "link", editor.headers)).statusCode,
    403,
  );
});

test("cross-lab history requires both endpoint grants and ignores forged scope", async () => {
  fixture(true);
  const first = await user("first", ["a"]);
  const both = await user("both", ["a", "b"]);
  const forged = await app.inject({
    method: "POST",
    url: "/api/audit-log",
    headers: first.headers,
    payload: {
      action: "fixture",
      entityType: "PortLink",
      entityId: "link",
      summary: "fixture",
      labIds: ["a"],
    },
  });
  assert.equal(forged.statusCode, 403);
  const create = await app.inject({
    method: "POST",
    url: "/api/audit-log",
    headers,
    payload: {
      action: "fixture",
      entityType: "PortLink",
      entityId: "link",
      summary: "fixture",
      labIds: ["forged"],
    },
  });
  assert.equal(create.statusCode, 201, create.body);
  assert.deepEqual(create.json().labIds, ["a", "b"]);
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: "/api/port-links/link",
        headers: both.headers,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await history("PortLink", "link", first.headers)).statusCode,
    403,
  );
  assert.equal(
    (await history("PortLink", "link", both.headers)).json().length,
    3,
  );
});

for (const target of ["port", "device", "lab"] as const)
  test(`${target} cascade retains descendant history and records its own deletion`, async () => {
    fixture();
    const config = {
      port: ["/api/ports/p1", "Port", "p1", "port.delete"],
      device: ["/api/devices/one", "Device", "one", "device.delete"],
      lab: ["/api/labs/a", "Lab", "a", "lab.delete"],
    }[target];
    const response = await app.inject({
      method: "DELETE",
      url: config[0],
      headers,
    });
    assert.equal(response.statusCode, 204, response.body);
    const old = (await history("PortLink", "link")).json();
    assert.deepEqual(
      old.map((row: { labIds: string[] }) => row.labIds),
      [["a"]],
    );
    assert.ok(
      (await history(config[1], config[2]))
        .json()
        .some((row: { action: string }) => row.action === config[3]),
    );
    assert.equal(
      db.prepare("SELECT id FROM portLinks WHERE id = 'link'").get(),
      undefined,
    );
  });

test("subnet cascade keeps DHCP history", async () => {
  db.exec(
    "INSERT INTO subnets(id,labId,cidr,name) VALUES('subnet','a','10.20.30.0/24','Fixture'); INSERT INTO dhcpScopes(id,subnetId,name,startIp,endIp) VALUES('scope','subnet','Scope','10.20.30.10','10.20.30.20')",
  );
  writeAuditLogEntry({
    user: "admin",
    action: "dhcp.scope.create",
    entityType: "DhcpScope",
    entityId: "scope",
    summary: "Created scope",
  });
  const response = await app.inject({
    method: "DELETE",
    url: "/api/subnets/subnet",
    headers,
  });
  assert.equal(response.statusCode, 204, response.body);
  assert.deepEqual((await history("DhcpScope", "scope")).json()[0].labIds, [
    "a",
  ]);
  assert.equal(
    (await history("Subnet", "subnet")).json()[0].action,
    "subnet.delete",
  );
});

test("audit insertion failure rolls deletion and related changes back", async () => {
  fixture();
  db.exec(
    "CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON auditLog WHEN NEW.action='port.unlink' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  try {
    const response = await app.inject({
      method: "DELETE",
      url: "/api/port-links/link",
      headers,
    });
    assert.equal(response.statusCode, 500, response.body);
    assert.ok(db.prepare("SELECT id FROM portLinks WHERE id='link'").get());
    assert.equal((await history("PortLink", "link")).json().length, 1);
  } finally {
    db.exec("DROP TRIGGER fixture_audit_failure");
  }
});

test("documentation unlink names the relation and retains the page", async () => {
  fixture();
  const page = await app.inject({
    method: "POST",
    url: "/api/documentation",
    headers,
    payload: { labId: "a", title: "Fixture", content: "Fixture" },
  });
  assert.equal(page.statusCode, 201, page.body);
  const id = page.json().id;
  const linked = await app.inject({
    method: "POST",
    url: `/api/documentation/${id}/device-links`,
    headers,
    payload: { deviceId: "one" },
  });
  assert.equal(linked.statusCode, 201, linked.body);
  const removed = await app.inject({
    method: "DELETE",
    url: `/api/documentation/${id}/device-links/one`,
    headers,
  });
  assert.equal(removed.statusCode, 204, removed.body);
  assert.ok(db.prepare("SELECT id FROM documentationPages WHERE id=?").get(id));
  const entries = (await history("DocumentationPage", id)).json();
  assert.equal(entries.length, 1);
  assert.equal(
    entries[0].summary,
    `Unlinked documentation page ${id} from device one`,
  );
});

test("template-default removal emits exactly one event and none on a no-op", async () => {
  db.prepare(
    "INSERT INTO hardwareTemplateDefaults(deviceType,templateId,updatedAt) VALUES('server','fixture-template',?)",
  ).run(new Date().toISOString());
  for (let i = 0; i < 2; i++) {
    const removed = await app.inject({
      method: "DELETE",
      url: "/api/hardware-templates/defaults/server",
      headers,
    });
    assert.equal(removed.statusCode, 204, removed.body);
    const entries = (await history("DeviceType", "server")).json();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "hardware-template.default.remove");
    assert.deepEqual(entries[0].labIds, []);
    assert.equal(
      (await history("HardwareTemplateDefault", "server")).json().length,
      0,
    );
  }
});

test("unrecognized prototype-like entity types remain unscoped", async () => {
  const editor = await user("editor", ["a"]);
  for (const entityType of ["__proto__", "constructor"]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/audit-log",
      headers: editor.headers,
      payload: {
        action: "fixture",
        entityType,
        entityId: "one",
        summary: "Fixture",
      },
    });
    assert.equal(response.statusCode, 403, response.body);
  }
});

test("unknown ownership stays admin-only and logical recovery preserves deleted subjects", async () => {
  fixture();
  await app.inject({ method: "DELETE", url: "/api/port-links/link", headers });
  const unknown = writeAuditLogEntry({
    user: "admin",
    action: "fixture",
    entityType: "Device",
    entityId: "gone",
    summary: "Unknown legacy event",
  });
  assert.equal(unknown.labIds, null);
  const editor = await user("editor", ["a"]);
  assert.equal(
    (await history("Device", "gone", editor.headers)).statusCode,
    403,
  );
  // Reusing an ID must never assign the unrelated older event to the new lab.
  db.exec(
    "INSERT INTO devices(id,labId,hostname,deviceType) VALUES('gone','a','reused','server')",
  );
  const backup = (
    await app.inject({ url: "/api/admin/export", headers })
  ).json();
  const before = db
    .prepare("SELECT id, labIds FROM auditLog ORDER BY id")
    .all();
  const malformed = structuredClone(backup);
  malformed.data.auditLog[0].labIds = '["a",12]';
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/admin/restore",
        headers,
        payload: malformed,
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(
    db.prepare("SELECT id, labIds FROM auditLog ORDER BY id").all(),
    before,
  );
  const restore = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers,
    payload: backup,
  });
  assert.equal(restore.statusCode, 200, restore.body);
  const auth = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password },
  });
  headers = { authorization: `Bearer ${auth.json().token}` };
  assert.equal(
    (
      db.prepare("SELECT labIds FROM auditLog WHERE id=?").get(unknown.id) as {
        labIds: string | null;
      }
    ).labIds,
    null,
  );
  assert.equal(
    (await app.inject({ method: "DELETE", url: "/api/devices/gone", headers }))
      .statusCode,
    204,
  );
  assert.equal(
    (
      db.prepare("SELECT labIds FROM auditLog WHERE id=?").get(unknown.id) as {
        labIds: string | null;
      }
    ).labIds,
    null,
  );
  assert.deepEqual(
    (await history("PortLink", "link"))
      .json()
      .map((row: { labIds: string[] }) => row.labIds),
    [["a"], ["a"]],
  );
  assert.equal(validateRackpadSqliteDatabase(db, "Fixture"), 58);
});

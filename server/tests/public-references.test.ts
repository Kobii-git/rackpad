import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { bech32m } from "@scure/base";
import {
  assignPublicReference,
  encodePublicReference,
  parsePublicReference,
} from "../lib/public-references.js";
const directory = mkdtempSync(path.join(os.tmpdir(), "rackpad-references-"));
process.env.DATABASE_PATH = path.join(directory, "fixture.db");
process.env.NODE_ENV = "test";
const { db } = await import("../db.js");
const { createApp } = await import("../app.js");
const { validateRackpadSqliteDatabase } =
  await import("../lib/native-backup-validation.js");
const app = await createApp();
let headers: Record<string, string>;
before(async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      password: "synthetic-reference-password",
      displayName: "Admin",
      loadDemoData: false,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  headers = { authorization: `Bearer ${response.json().token}` };
});
beforeEach(() => {
  db.exec(
    "DELETE FROM labs; DELETE FROM auditLog; DELETE FROM users WHERE username!='admin'; INSERT INTO labs(id,name) VALUES('a','A'),('b','B'); INSERT INTO devices(id,labId,hostname,deviceType) VALUES('d1','a','one','server'),('d2','b','two','server'); INSERT INTO ports(id,deviceId,name,position,kind) VALUES('p1','d1','one',1,'rj45'),('p2','d2','two',1,'rj45'); INSERT INTO portLinks(id,fromPortId,toPortId) VALUES('c1','p1','p2');",
  );
});
after(async () => {
  await app.close();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
async function generate(kind = "device", id = "d1", auth = headers) {
  return app.inject({
    method: "POST",
    url: `/api/references/${kind}/${id}`,
    headers: auth,
  });
}

test("Bech32m checksum vectors, canonical case, printed groups, type and payload validation", () => {
  assert.equal(bech32m.decode("A1LQFN3A").prefix, "a"); // BIP-350 valid vector.
  assert.throws(() => bech32m.decode("A1G7SGD8")); // Bech32 checksum is not Bech32m.
  const value = encodePublicReference("device", new Uint8Array(10));
  assert.equal(value, "rpd1qqqqqqqqqqqqqqqq8yswcp");
  assert.equal(
    encodePublicReference("cable", new Uint8Array(10)),
    "rpc1qqqqqqqqqqqqqqqq3knynp",
  );
  assert.equal(value.length, 26);
  assert.equal(parsePublicReference(value.toUpperCase(), "device"), value);
  const grouped =
    value.slice(0, 4) +
    "-" +
    value
      .slice(4)
      .match(/.{1,4}/g)!
      .join("-");
  assert.equal(parsePublicReference(grouped.toUpperCase()), value);
  for (const invalid of [
    value.slice(0, -1) + (value.endsWith("q") ? "p" : "q"),
    value[0].toUpperCase() + value.slice(1),
    value.replace("r", "ｒ"),
    grouped.replace("-", "--"),
    ` ${value}`,
    bech32m.encode("rpd", bech32m.toWords(new Uint8Array(9))),
  ])
    assert.throws(() => parsePublicReference(invalid));
  assert.throws(() => parsePublicReference(value, "cable"));
});
test("generation is explicit, random, idempotent and assignment is audited once", async () => {
  assert.equal(
    (
      db.prepare("SELECT publicReference FROM devices WHERE id='d1'").get() as {
        publicReference: null;
      }
    ).publicReference,
    null,
  );
  const a = await generate();
  assert.equal(a.statusCode, 200, a.body);
  const b = await generate();
  assert.equal(b.statusCode, 200);
  assert.deepEqual(a.json(), b.json());
  const c = await generate("device", "d2");
  assert.notEqual(a.json().publicReference, c.json().publicReference);
  const audit = db
    .prepare("SELECT summary FROM auditLog WHERE entityId='d1'")
    .all();
  assert.deepEqual(audit, [
    { summary: `Assigned reference ${a.json().publicReference}` },
  ]);
  assert.throws(
    () =>
      db.prepare("UPDATE devices SET publicReference=NULL WHERE id='d1'").run(),
    /immutable/,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/devices/d1",
        headers,
        payload: { publicReference: c.json().publicReference },
      })
    ).statusCode,
    400,
  );
});
test("lookup requires authentication and both cable lab permissions; assignment requires write", async () => {
  const reference = (await generate("cable", "c1")).json().publicReference;
  const created = await app.inject({
    method: "POST",
    url: "/api/users",
    headers,
    payload: {
      username: "limited",
      password: "synthetic-reference-password",
      displayName: "Limited",
      role: "editor",
      labAccess: [{ labId: "a", role: "viewer" }],
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "limited", password: "synthetic-reference-password" },
  });
  const limited = { authorization: `Bearer ${login.json().token}` };
  assert.equal(
    (await app.inject({ method: "GET", url: `/api/references/${reference}` }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/references/${reference}`,
        headers: limited,
      })
    ).statusCode,
    403,
  );
  assert.equal((await generate("device", "d1", limited)).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/references/${reference.toUpperCase()}`,
        headers,
      })
    ).json().id,
    "c1",
  );
});
test("logical/native recovery retains references and atomically rejects bad checksums and duplicates", async () => {
  const device = (await generate()).json().publicReference;
  const cable = (await generate("cable", "c1")).json().publicReference;
  const exported = await app.inject({
    method: "GET",
    url: "/api/admin/export",
    headers,
  });
  assert.equal(exported.statusCode, 200, exported.body);
  const backup = exported.json();
  // Give records safe complete geometry/status through the public serializer.

  const restore = await app.inject({
    method: "POST",
    url: "/api/admin/restore",
    headers,
    payload: backup,
  });
  assert.equal(restore.statusCode, 200, restore.body);
  assert.equal(
    (
      db.prepare("SELECT publicReference FROM devices WHERE id='d1'").get() as {
        publicReference: string;
      }
    ).publicReference,
    device,
  );
  assert.equal(
    (
      db
        .prepare("SELECT publicReference FROM portLinks WHERE id='c1'")
        .get() as { publicReference: string }
    ).publicReference,
    cable,
  );
  assert.equal(validateRackpadSqliteDatabase(db, "Current"), 59);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "synthetic-reference-password" },
  });
  headers = { authorization: `Bearer ${login.json().token}` };
  for (const mutate of [
    (b: typeof backup) => {
      b.data.devices[0].publicReference = cable;
    },
    (b: typeof backup) => {
      b.data.devices[1].publicReference = device;
    },
  ]) {
    const bad = structuredClone(backup);
    mutate(bad);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/restore",
          headers,
          payload: bad,
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        db
          .prepare("SELECT publicReference FROM devices WHERE id='d1'")
          .get() as { publicReference: string }
      ).publicReference,
      device,
    );
  }
});
test("assigned device and cable references survive in deletion audit summaries", async () => {
  const device = (await generate()).json().publicReference;
  const cable = (await generate("cable", "c1")).json().publicReference;
  assert.equal(
    (await app.inject({ method: "DELETE", url: "/api/port-links/c1", headers }))
      .statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ method: "DELETE", url: "/api/devices/d1", headers }))
      .statusCode,
    204,
  );
  for (const [id, reference] of [
    ["d1", device],
    ["c1", cable],
  ])
    assert.match(
      (
        db
          .prepare(
            "SELECT summary FROM auditLog WHERE entityId=? AND action IN ('port.unlink','device.delete')",
          )
          .get(id) as { summary: string }
      ).summary,
      new RegExp(reference),
    );
});

test("collisions retry without replacing assigned references and exhaustion is atomic", () => {
  const occupied = encodePublicReference("device", new Uint8Array(10));
  const next = encodePublicReference("device", new Uint8Array(10).fill(1));
  db.prepare("UPDATE devices SET publicReference=? WHERE id='d2'").run(
    occupied,
  );
  let calls = 0;
  const result = db.transaction(() =>
    assignPublicReference(db, "device", "d1", () =>
      ++calls < 3 ? occupied : next,
    ),
  )();
  assert.equal(result.publicReference, next);
  assert.equal(calls, 3);
  assert.equal(
    assignPublicReference(db, "device", "d1", () => {
      throw new Error("Must not regenerate");
    }).assigned,
    false,
  );
  db.exec(
    "INSERT INTO devices(id,labId,hostname,deviceType) VALUES('d3','a','three','server')",
  );
  assert.throws(
    () =>
      db.transaction(() =>
        assignPublicReference(db, "device", "d3", () => occupied),
      )(),
    /generation failed/,
  );
  assert.deepEqual(
    db.prepare("SELECT publicReference FROM devices WHERE id='d3'").get(),
    { publicReference: null },
  );
});

test("native recovery rejects corrupt, wrong-type, noncanonical and duplicate references", async () => {
  const { default: Database } = await import("better-sqlite3");
  const reference = (await generate()).json().publicReference as string;
  for (const invalid of [
    reference.slice(0, -1) + (reference.endsWith("q") ? "p" : "q"),
    reference.toUpperCase(),
    encodePublicReference("cable", new Uint8Array(10)),
    reference,
  ]) {
    const file = path.join(directory, `invalid-${Math.random().toString(16).slice(2)}.db`);
    await db.backup(file);
    const snapshot = new Database(file);
    try {
      snapshot.exec(
        "PRAGMA ignore_check_constraints=ON; DROP TRIGGER device_reference_immutable; DROP INDEX idx_devices_publicReference",
      );
      snapshot
        .prepare("UPDATE devices SET publicReference=? WHERE id=?")
        .run(invalid, invalid === reference ? "d2" : "d1");
      assert.throws(
        () => validateRackpadSqliteDatabase(snapshot, "Invalid"),
        /invalid public references/,
      );
    } finally {
      snapshot.close();
    }
  }
});
test("a cable reference cannot be assigned with write access to only one endpoint", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/users",
    headers,
    payload: {
      username: "partial",
      password: "synthetic-reference-password",
      displayName: "Partial",
      role: "editor",
      labAccess: [{ labId: "a", role: "editor" }],
    },
  });
  assert.equal(created.statusCode, 201);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "partial", password: "synthetic-reference-password" },
  });
  const denied = await generate("cable", "c1", {
    authorization: `Bearer ${login.json().token}`,
  });
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(
    db.prepare("SELECT publicReference FROM portLinks WHERE id='c1'").get(),
    { publicReference: null },
  );
  assert.deepEqual(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM auditLog WHERE action='reference.assign'",
      )
      .get(),
    { n: 0 },
  );
});

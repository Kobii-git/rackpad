import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
const directory = mkdtempSync(path.join(os.tmpdir(), "rackpad-service-api-"));
process.env.DATABASE_PATH = path.join(directory, "fixture.db");
process.env.NODE_ENV = "test";
const { createApp } = await import("../app.js");
const { db } = await import("../db.js");
const app = await createApp();
after(async () => {
  await app.close();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

test("service endpoints retain lab scope and survive compatible, atomic logical restore", async () => {
  const password = "fixture-administrator-password";
  const auth = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      password,
      displayName: "Admin",
      loadDemoData: false,
    },
  });
  assert.equal(auth.statusCode, 201);
  let headers = { authorization: `Bearer ${auth.json().token}` };
  const call = (
    method: "POST" | "PATCH" | "GET",
    url: string,
    payload?: Record<string, unknown>,
  ) => app.inject({ method, url, headers, payload });
  const lab = (await call("POST", "/api/labs", { name: "Services" })).json();
  const device = (
    await call("POST", "/api/devices", {
      labId: lab.id,
      hostname: "fixture",
      deviceType: "server",
    })
  ).json();
  const port = (
    await call("POST", "/api/ports", {
      deviceId: device.id,
      name: "eth0",
      kind: "rj45",
    })
  ).json();
  const body = {
    deviceId: device.id,
    name: "Application",
    serviceType: "custom",
    portId: port.id,
    url: "https://example.test:3000",
  };
  const created = await call("POST", "/api/device-services", {
    ...body,
    networkPort: 3000,
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const url = `/api/device-services/${id}`;
  assert.equal(created.json().transportProtocol, "tcp");
  assert.equal(created.json().portId, port.id);
  for (const networkPort of [0, 65536, 1.5, "bad", true]) {
    assert.equal(
      (await call("POST", "/api/device-services", { ...body, networkPort }))
        .statusCode,
      400,
    );
    assert.equal((await call("PATCH", url, { networkPort })).statusCode, 400);
  }
  for (const networkPort of [1, 65535]) {
    const result = await call("PATCH", url, {
      networkPort,
      transportProtocol: "udp",
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().networkPort, networkPort);
  }
  assert.equal(
    (await call("PATCH", url, { transportProtocol: "sctp" })).statusCode,
    400,
  );
  assert.equal(
    (await call("PATCH", url, { name: "Renamed" })).json().transportProtocol,
    "udp",
  );
  assert.equal(
    (await call("PATCH", url, { networkPort: null, transportProtocol: "udp" }))
      .statusCode,
    400,
  );
  assert.equal(
    (await call("PATCH", url, { networkPort: null })).json().transportProtocol,
    null,
  );
  assert.equal(
    (await call("PATCH", url, { transportProtocol: "udp" })).statusCode,
    400,
  );
  assert.equal(
    (await call("PATCH", url, { networkPort: 53 })).json().transportProtocol,
    "tcp",
  );
  await call("PATCH", url, { transportProtocol: "udp" });
  const legacy = await call("POST", "/api/device-services", {
    ...body,
    name: "Legacy",
  });
  assert.equal(legacy.json().networkPort, null);
  assert.equal(legacy.json().transportProtocol, null);
  const otherLab = (await call("POST", "/api/labs", { name: "Other" })).json();
  const otherDevice = (
    await call("POST", "/api/devices", {
      labId: otherLab.id,
      hostname: "other",
      deviceType: "server",
    })
  ).json();
  for (const role of ["viewer", "editor"]) {
    const user = await call("POST", "/api/users", {
      username: role,
      displayName: role,
      password,
      role,
      labAccess: [{ labId: role === "viewer" ? lab.id : otherLab.id, role }],
    });
    assert.equal(user.statusCode, 201, user.body);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: role, password },
    });
    const restricted = { authorization: `Bearer ${login.json().token}` };
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url,
          headers: restricted,
          payload: { networkPort: 22 },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/device-services",
          headers: restricted,
          payload: body,
        })
      ).statusCode,
      403,
    );
    if (role === "editor") {
      assert.equal(
        (await app.inject({ url, headers: restricted })).statusCode,
        403,
      );
      assert.deepEqual(
        (
          await app.inject({ url: "/api/device-services", headers: restricted })
        ).json(),
        [],
      );
      const own = await app.inject({
        method: "POST",
        url: "/api/device-services",
        headers: restricted,
        payload: {
          ...body,
          deviceId: otherDevice.id,
          portId: null,
          networkPort: 443,
        },
      });
      assert.equal(own.statusCode, 201, own.body);
      assert.equal(
        (
          await app.inject({
            method: "PATCH",
            url: `/api/device-services/${own.json().id}`,
            headers: restricted,
            payload: { deviceId: device.id, networkPort: 80 },
          })
        ).statusCode,
        403,
      );
    }
  }
  assert.equal(
    (await app.inject({ method: "PATCH", url, payload: { networkPort: 22 } }))
      .statusCode,
    401,
  );
  const exported = await call("GET", "/api/admin/export");
  assert.equal(exported.statusCode, 200, exported.body);
  const backup = exported.json();
  const row = backup.data.deviceServices.find(
    (item: { id: string }) => item.id === id,
  );
  assert.equal(row.networkPort, 53);
  assert.equal(row.transportProtocol, "udp");
  const before = db.prepare("SELECT * FROM deviceServices ORDER BY id").all();
  for (const bad of [
    { networkPort: 0, transportProtocol: "tcp" },
    { networkPort: null, transportProtocol: "udp" },
    { networkPort: 53, transportProtocol: "bad" },
  ]) {
    const invalid = structuredClone(backup);
    Object.assign(
      invalid.data.deviceServices.find(
        (item: { id: string }) => item.id === id,
      ),
      bad,
    );
    const denied = await call("POST", "/api/admin/restore", invalid);
    assert.equal(denied.statusCode, 400, denied.body);
    assert.deepEqual(
      db.prepare("SELECT * FROM deviceServices ORDER BY id").all(),
      before,
    );
  }
  const restore = async (value: Record<string, unknown>) => {
    const result = await call("POST", "/api/admin/restore", value);
    assert.equal(result.statusCode, 200, result.body);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password },
    });
    headers = { authorization: `Bearer ${login.json().token}` };
  };
  await restore(backup);
  assert.deepEqual(
    db.prepare("SELECT * FROM deviceServices ORDER BY id").all(),
    before,
  );
  const oldBackup = structuredClone(backup);
  oldBackup.schemaVersion = 55;
  for (const item of oldBackup.data.deviceServices) {
    delete item.networkPort;
    delete item.transportProtocol;
  }
  await restore(oldBackup);
  const restored = (await call("GET", url)).json();
  assert.equal(restored.networkPort, null);
  assert.equal(restored.transportProtocol, null);
  assert.equal(restored.portId, port.id);
});

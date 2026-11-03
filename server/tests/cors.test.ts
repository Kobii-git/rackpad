import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";

const directory = mkdtempSync(path.join(os.tmpdir(), "rackpad-cors-"));
process.env.DATABASE_PATH = path.join(directory, "test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_RATE_LIMIT_DISABLED = "1";
process.env.RACKPAD_SECRET_KEY = "synthetic-cors-test-key";
const { createApp } = await import("../app.js");
const { db } = await import("../db.js");
let app: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  process.env.NODE_ENV = "production";
  process.env.TRUSTED_ORIGINS = "https://rackpad.example.test";
  app = await createApp();
  app.log.level = "silent";
  const status = await app.inject({ url: "/api/auth/status" });
  if (status.json().needsBootstrap) {
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: { username: "admin", password: "synthetic-cors-password" },
    });
    assert.equal(bootstrap.statusCode, 201, bootstrap.body);
  }
});

afterEach(async () => {
  await app.close();
  delete process.env.TRUSTED_ORIGINS;
});

after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

test("trusted preflights preserve every existing API method after the CORS upgrade", async () => {
  const methods = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"];
  for (const method of methods) {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/devices/synthetic",
      headers: {
        origin: "https://rackpad.example.test",
        "access-control-request-method": method,
        "access-control-request-headers": "authorization,content-type",
      },
    });
    assert.equal(response.statusCode, 204, response.body);
    assert.equal(
      response.headers["access-control-allow-origin"],
      "https://rackpad.example.test",
    );
    assert.deepEqual(
      String(response.headers["access-control-allow-methods"])
        .split(",")
        .map((method) => method.trim()),
      methods,
    );
    assert.equal(
      response.headers["access-control-allow-headers"],
      "authorization,content-type",
    );
    assert.equal(
      response.headers["access-control-allow-credentials"],
      undefined,
    );
  }
});

test("untrusted origins stay blocked and successful preflights do not authorize API writes", async () => {
  const response = await app.inject({
    method: "OPTIONS",
    url: "/api/devices/synthetic",
    headers: {
      origin: "https://attacker.example.test",
      "access-control-request-method": "PATCH",
    },
  });
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  for (const origin of [
    "https://rackpad.example.test",
    "https://attacker.example.test",
  ]) {
    const write = await app.inject({
      method: "PATCH",
      url: "/api/devices/synthetic",
      headers: { origin },
      payload: { hostname: "synthetic" },
    });
    assert.equal(
      write.statusCode,
      origin === "https://rackpad.example.test" ? 401 : 403,
      write.body,
    );
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "rackpad-rate-limit-tests-"));
process.env.DATABASE_PATH = path.join(tempDir, "rackpad-rate-limit-test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "rackpad-rate-limit-test-secret-key";

const { createApp, parseTrustProxySetting } = await import("../app.js");
const { db } = await import("../db.js");

type AppInstance = Awaited<ReturnType<typeof createApp>>;

let app: AppInstance | undefined;

beforeEach(() => {
  process.env.RACKPAD_RATE_LIMIT_DISABLED = "0";
  process.env.RACKPAD_RATE_LIMIT_MAX = "1";
  process.env.RACKPAD_RATE_LIMIT_WINDOW = "1 minute";
  process.env.TRUST_PROXY = "0";
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  delete process.env.RACKPAD_RATE_LIMIT_DISABLED;
  delete process.env.RACKPAD_RATE_LIMIT_MAX;
  delete process.env.RACKPAD_RATE_LIMIT_WINDOW;
  delete process.env.TRUST_PROXY;
});

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("parses only bounded proxy hop counts and compatibility aliases", () => {
  for (const value of [undefined, "", "0", "false", "no", "off"]) {
    assert.equal(parseTrustProxySetting(value), false);
  }

  for (const value of ["1", "true", "yes", "on"]) {
    assert.equal(parseTrustProxySetting(value), 1);
  }

  assert.equal(parseTrustProxySetting("2"), 2);
  assert.equal(parseTrustProxySetting("10"), 10);

  for (const value of ["-1", "01", "1.5", "11", "invalid"]) {
    assert.equal(parseTrustProxySetting(value), false);
  }
});

test("applies one global limiter across routes and preserves 429 headers", async () => {
  app = await createApp();

  const first = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(first.statusCode, 200);

  const limited = await app.inject({
    method: "GET",
    url: "/api/auth/status",
  });
  assert.equal(limited.statusCode, 429);
  assert.deepEqual(limited.json(), {
    error: "Too many requests. Try again later.",
  });
  assert.ok(limited.headers["retry-after"]);
  assert.equal(limited.headers["x-ratelimit-limit"], "1");
  assert.equal(limited.headers["x-ratelimit-remaining"], "0");
});

test("one trusted proxy ignores spoofed leftmost forwarded addresses", async () => {
  process.env.TRUST_PROXY = "1";
  app = await createApp();

  const first = await app.inject({
    method: "GET",
    url: "/api/health",
    remoteAddress: "172.18.0.2",
    headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.20" },
  });
  assert.equal(first.statusCode, 200);

  const limited = await app.inject({
    method: "GET",
    url: "/api/auth/status",
    remoteAddress: "172.18.0.2",
    headers: { "x-forwarded-for": "198.51.100.11, 203.0.113.20" },
  });
  assert.equal(limited.statusCode, 429);
});

test("one trusted proxy gives distinct real clients distinct buckets", async () => {
  process.env.TRUST_PROXY = "1";
  app = await createApp();

  const first = await app.inject({
    method: "GET",
    url: "/api/health",
    remoteAddress: "172.18.0.2",
    headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.20" },
  });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({
    method: "GET",
    url: "/api/auth/status",
    remoteAddress: "172.18.0.2",
    headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.21" },
  });
  assert.equal(second.statusCode, 200);
});

test("configured multi-hop trust selects the client before the proxy chain", async () => {
  process.env.TRUST_PROXY = "2";
  app = await createApp();

  const first = await app.inject({
    method: "GET",
    url: "/api/health",
    remoteAddress: "172.18.0.2",
    headers: {
      "x-forwarded-for": "198.51.100.10, 203.0.113.20, 172.18.0.3",
    },
  });
  assert.equal(first.statusCode, 200);

  const limited = await app.inject({
    method: "GET",
    url: "/api/auth/status",
    remoteAddress: "172.18.0.2",
    headers: {
      "x-forwarded-for": "198.51.100.11, 203.0.113.20, 172.18.0.3",
    },
  });
  assert.equal(limited.statusCode, 429);
});

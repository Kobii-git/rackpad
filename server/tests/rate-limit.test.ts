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

test("accepts explicit proxy IPs/CIDRs and disables legacy or invalid settings", () => {
  for (const value of [undefined, "", "0", "false", "no", "off", "1", "2", "10", "true", "yes", "on", "-1", "01", "1.5", "11", "invalid", "0.0.0.0/0", "::/0", "10.0.0.1,invalid", "127.1", "10.0.0.1/33"]) {
    assert.equal(parseTrustProxySetting(value), false, value);
  }
  assert.deepEqual(parseTrustProxySetting("172.18.0.2, 10.0.0.0/24 fd00::/64"), ["172.18.0.2", "10.0.0.0/24", "fd00::/64"]);
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
  process.env.TRUST_PROXY = "172.18.0.2";
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
  process.env.TRUST_PROXY = "172.18.0.2";
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
  process.env.TRUST_PROXY = "172.18.0.0/24";
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

test("untrusted direct peers cannot select a rate-limit bucket with forwarding headers", async () => {
  process.env.TRUST_PROXY = "172.18.0.2";
  app = await createApp();
  for (const [index, ip] of ["203.0.113.20", "203.0.113.21"].entries()) {
    const response: { statusCode: number } = await app.inject({ method: "GET", url: "/api/health", remoteAddress: "10.1.2.3", headers: { "x-forwarded-for": ip } });
    assert.equal(response.statusCode, index === 0 ? 200 : 429);
  }
});

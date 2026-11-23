import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
const directory = mkdtempSync(
  path.join(os.tmpdir(), "rackpad-notification-endpoint-"),
);
process.env.DATABASE_PATH = path.join(directory, "fixture.db");
process.env.NODE_ENV = "test";
process.env.RACKPAD_SECRET_KEY = "synthetic-endpoint-key";
const { db } = await import("../db.js");
const { DEFAULT_ALERT_SETTINGS, saveAlertSettings } =
  await import("../lib/alerts.js");
const { setNetworkHostLookupForTests, setPinnedRequestTransportForTests } =
  await import("../lib/net-guard.js");
const { createApp } = await import("../app.js");
const app = await createApp();
let headers: Record<string, string>;
let requests = 0;
before(async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      username: "admin",
      displayName: "Admin",
      password: "synthetic-admin-password",
      loadDemoData: false,
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  headers = { authorization: `Bearer ${res.json().token}` };
});
beforeEach(() => {
  saveAlertSettings({ ...DEFAULT_ALERT_SETTINGS, ntfyToken: null });
  db.prepare("DELETE FROM auditLog").run();
  requests = 0;
  setNetworkHostLookupForTests(async () => [
    { address: "10.20.30.40", family: 4 },
  ]);
  setPinnedRequestTransportForTests(async (_url, _address, options) => {
    requests++;
    assert.equal(options.headers.Authorization, "Bearer synthetic-topic-token");
    return { statusCode: 200 };
  });
});
after(async () => {
  setNetworkHostLookupForTests(null);
  setPinnedRequestTransportForTests(null);
  await app.close();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
const settingsUrl = "/api/admin/alert-settings";
async function save(payload: Record<string, unknown>) {
  const res = await app.inject({
    method: "PUT",
    url: settingsUrl,
    headers,
    payload,
  });
  assert.equal(res.statusCode, 200, res.body);
  return res;
}
async function send() {
  return app.inject({ method: "POST", url: `${settingsUrl}/test`, headers });
}

test("disabled persisted channels return a diagnostic and failure history without contacting providers", async () => {
  await save({
    enabled: false,
    ntfyTopicUrl: "https://ntfy.example.test/private-topic",
    ntfyToken: "synthetic-topic-token",
  });
  const saved = await app.inject({ url: settingsUrl, headers });
  assert.equal(saved.json().enabled, false);
  const response = await send();
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, "notification_disabled");
  assert.equal(
    response.json().error,
    "Enable notifications before sending a test alert.",
  );
  assert.equal(requests, 0);
  assert.doesNotMatch(response.body, /private-topic|synthetic-topic-token/);
  const history = await app.inject({
    url: "/api/audit-log?entityType=Alert",
    headers,
  });
  assert.equal(history.json()[0].action, "alert.error");
});

test("saved ntfy token delivers through the real endpoint and failed delivery stays classified", async () => {
  await save({
    enabled: true,
    ntfyTopicUrl: "https://ntfy.example.test/private-topic",
    ntfyToken: "synthetic-topic-token",
  });
  const saved = await app.inject({ url: settingsUrl, headers });
  assert.equal(saved.json().enabled, true);
  assert.equal(saved.json().ntfyTokenConfigured, true);
  assert.doesNotMatch(saved.body, /synthetic-topic-token/);
  const sent = await send();
  assert.equal(sent.statusCode, 200, sent.body);
  assert.deepEqual(sent.json(), {
    delivered: true,
    channels: [{ channel: "ntfy", delivered: true }],
  });
  assert.equal(requests, 1);
  for (const [statusCode, code] of [
    [401, "ntfy_rejection"],
    [429, "ntfy_rate_limit"],
  ] as const) {
    setPinnedRequestTransportForTests(async () => ({
      statusCode,
      bodyText: "private-provider-body",
    }));
    const result = await send();
    assert.equal(result.statusCode, 500);
    assert.equal(result.json().code, code);
    assert.doesNotMatch(
      result.body,
      /private-topic|private-provider-body|synthetic-topic-token/,
    );
  }
});

test("disabled SMTP settings receive the same diagnostic; enabled failures expose the safe SMTP category", async () => {
  await save({
    enabled: false,
    smtpHost: "127.0.0.1",
    smtpPort: 1,
    smtpFrom: "fixture@example.test",
    smtpTo: "recipient@example.test",
  });
  assert.equal((await send()).json().code, "notification_disabled");
  await save({
    enabled: true,
    smtpHost: "127.0.0.1",
    smtpPort: 1,
    smtpFrom: "fixture@example.test",
    smtpTo: "recipient@example.test",
  });
  const result = await send();
  assert.equal(result.statusCode, 500);
  assert.equal(result.json().code, "smtp_connection");
  assert.doesNotMatch(result.body, /127\.0\.0\.1|fixture@example|ECONNREFUSED/);
});

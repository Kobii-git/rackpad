import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const directory = mkdtempSync(path.join(os.tmpdir(), "rackpad-release-api-"));
process.env.DATABASE_PATH = path.join(directory, "rackpad.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "synthetic-release-api-key";
const { createApp } = await import("../app.js");
const { db, CURRENT_SCHEMA_VERSION } = await import("../db.js");
const { setNetworkHostLookupForTests, setPinnedRequestTransportForTests } = await import("../lib/net-guard.js");
const { exerciseApi } = await import(new URL("../../scripts/fixtures/release-image-api.mjs", import.meta.url).href) as {
  exerciseApi(input: {credentials: {username: string; password: string}; nonce: string; create: boolean; features: boolean; expectedSchema: number; expectedArchitecture: string; dataDirectory: string}): Promise<void>;
};
let app = await createApp();
const originalFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = originalFetch;
  setNetworkHostLookupForTests(null);
  setPinnedRequestTransportForTests(null);
  await app.close();
  db.close();
  rmSync(directory, {recursive: true, force: true});
});

test("release image API fixture exercises real routes and preserves audit history on replay", async () => {
  setNetworkHostLookupForTests(async () => [{address: "192.168.50.2", family: 4}]);
  setPinnedRequestTransportForTests(async url => ({statusCode: 200, bodyText: url.pathname === "/metrics"
    ? 'monitor_status{monitor_id="1",monitor_name="Fixture"} 1\n' : "fixture"}));
  const auditCalls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "http://127.0.0.1:3000");
    // Production asset delivery has separate browser/image gates. Only API calls
    // are routed through the real Fastify app and its temporary SQLite database.
    if (url.pathname === "/") return new Response('<script src="/assets/fixture.js"></script>');
    if (url.pathname === "/assets/fixture.js") return new Response("", {headers: {"content-type": "application/javascript"}});
    if (url.pathname.startsWith("/api/audit")) auditCalls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const response = await app.inject({method: (init?.method ?? "GET") as "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: url.pathname + url.search,
      headers, ...(init?.body === undefined ? {} : {payload: String(init.body)})});
    return new Response(response.statusCode === 204 ? null : response.body, {status: response.statusCode, headers: {"content-type": "application/json"}});
  };
  const input = {credentials: {username: "release-smoke", password: "synthetic-release-api-password"}, nonce: "synthetic-release-api", create: true,
    features: true, expectedSchema: CURRENT_SCHEMA_VERSION, expectedArchitecture: process.arch, dataDirectory: directory};
  await exerciseApi(input);
  for (let replay = 0; replay < 2; replay++) {
    await app.close();
    app = await createApp();
    const healthModule = new URL("../lib/integrations/external-health.ts", import.meta.url);
    if (existsSync(healthModule)) {
      const { requireFreshExternalReadings } = await import(healthModule.href) as {requireFreshExternalReadings(): void};
      requireFreshExternalReadings();
    }
    await exerciseApi({...input, create: false});
  }
  assert.ok(auditCalls.includes("POST /api/audit-log"));
  assert.ok(auditCalls.includes("GET /api/audit-log"));
  const deleted = db.prepare("SELECT COUNT(*) AS count FROM auditLog WHERE action='device.delete'").get() as {count: number};
  assert.equal(deleted.count, 1, "Repeated smoke must retain one durable deletion event.");
});

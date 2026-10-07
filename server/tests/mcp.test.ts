import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "rackpad-mcp-"));
process.env.DATABASE_PATH = path.join(tempDir, "mcp-test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "mcp-test-secret";
process.env.MCP_ENABLED = "1";
process.env.RACKPAD_NATIVE_BACKUP_DIR = tempDir;

const { createApp } = await import("../app.js");
const { db } = await import("../db.js");
const { createNativeBackup } = await import("../lib/native-backup.js");
const { validateRackpadSqliteDatabase } = await import("../lib/native-backup-validation.js");
const app = await createApp();

after(async () => {
  await app.close();
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.MCP_ENABLED;
  delete process.env.RACKPAD_NATIVE_BACKUP_DIR;
});

function json(response: { body: string }) { return JSON.parse(response.body) as Record<string, unknown>; }
function firstText(content: Array<{ type: string; text?: string }> | undefined) {
  const first = content?.[0];
  assert.equal(first?.type, "text");
  return first.text!;
}

test("real MCP SDK client previews one lab batch and a person applies it once", async () => {
  const bootstrap = await app.inject({ method: "POST", url: "/api/auth/bootstrap",
    payload: { username: "admin", displayName: "Admin", password: "super-secret-1" } });
  assert.equal(bootstrap.statusCode, 201, bootstrap.body);
  const session = (json(bootstrap) as { token: string }).token;
  const headers = { authorization: `Bearer ${session}` };
  const labResponse = await app.inject({ method: "POST", url: "/api/labs", headers, payload: { name: "MCP Lab" } });
  assert.equal(labResponse.statusCode, 201, labResponse.body);
  const labId = String(json(labResponse).id);
  const tokenResponse = await app.inject({ method: "POST", url: "/api/mcp-tokens", headers,
    payload: { name: "Test client", capability: "write", labIds: [labId], expiresInDays: 1 } });
  assert.equal(tokenResponse.statusCode, 201, tokenResponse.body);
  const issued = json(tokenResponse) as { id: string; token: string };
  const listed = await app.inject({ method: "GET", url: "/api/mcp-tokens", headers });
  assert.equal(listed.statusCode, 200);
  assert.ok(!listed.body.includes(issued.token));
  const logicalBackup = await app.inject({ method: "GET", url: "/api/admin/export", headers });
  assert.equal(logicalBackup.statusCode, 200);
  assert.ok(!logicalBackup.body.includes("mcpTokens"));
  assert.ok(!logicalBackup.body.includes(issued.token));
  const nativeBackup = await createNativeBackup("admin");
  const snapshot = new Database(path.join(tempDir, nativeBackup.name), { readonly: true });
  try {
    assert.equal((snapshot.prepare("SELECT COUNT(*) AS n FROM mcpTokens").get() as { n: number }).n, 0);
  } finally { snapshot.close(); }
  const storedHash = (db.prepare("SELECT tokenHash FROM mcpTokens WHERE id = ?").get(issued.id) as { tokenHash: string }).tokenHash;
  assert.equal(readFileSync(path.join(tempDir, nativeBackup.name)).includes(Buffer.from(storedHash)), false);
  const legacyPath = path.join(tempDir, "legacy-schema-52.db");
  await db.backup(legacyPath);
  const legacy = new Database(legacyPath);
  try {
    legacy.exec("DROP TABLE deviceStackMemberLayouts; DROP TABLE mcpTokens; UPDATE schemaVersion SET version = 52");
    assert.equal(validateRackpadSqliteDatabase(legacy, "Legacy snapshot"), 52);
  } finally { legacy.close(); }
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const client = new Client({ name: "rackpad-mcp-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  const transport = new StreamableHTTPClientTransport(new URL("/api/mcp", address), {
    requestInit: { headers: { authorization: `Bearer ${issued.token}` } },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "propose_inventory"));
    const labs = await client.callTool({ name: "list_labs", arguments: { limit: 1, cursor: 0 } });
    assert.equal(JSON.parse(firstText(labs.content)).items[0].id, labId);
    const overLimit = await client.callTool({ name: "list_labs", arguments: { limit: 101, cursor: 0 } });
    assert.equal(overLimit.isError, true);
    const batch = { labId,
      racks: [{ key: "rack", name: "Proposed Rack", totalU: 12 }],
      devices: [{ key: "device", hostname: "proposed-device", deviceType: "server", placement: {
        mountKind: "direct", rack: { key: "rack" }, startU: 2, heightU: 1, face: "front", column: 0, columnSpan: 12,
      } }],
      ports: [{ key: "port", device: { key: "device" }, name: "eth0", kind: "rj45", face: "front" }],
      connections: [],
    };
    const proposed = await client.callTool({ name: "propose_inventory", arguments: batch });
    assert.equal(proposed.isError, undefined, JSON.stringify(proposed));
    const draft = JSON.parse(firstText(proposed.content)) as { id: string; reviewLink: string; summary: { devices: unknown[]; ports: Array<{ id: string }> } };
    assert.equal(draft.summary.devices.length, 1);
    assert.equal(draft.reviewLink, `/mcp-proposals/${draft.id}`);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM devices WHERE labId = ?").get(labId) as { n: number }).n, 0);
    const applied = await app.inject({ method: "POST", url: `/api/mcp-proposals/${draft.id}/apply`, headers });
    assert.equal(applied.statusCode, 200, applied.body);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM devices WHERE labId = ?").get(labId) as { n: number }).n, 1);
    assert.deepEqual((db.prepare("SELECT action FROM auditLog WHERE action LIKE 'mcp.proposal.%' ORDER BY action").all() as Array<{ action: string }>).map(({ action }) => action),
      ["mcp.proposal.device.create", "mcp.proposal.port.create", "mcp.proposal.rack.create"]);
    const repeated = await app.inject({ method: "POST", url: `/api/mcp-proposals/${draft.id}/apply`, headers });
    assert.equal(repeated.statusCode, 404);

    const otherLab = await app.inject({ method: "POST", url: "/api/labs", headers, payload: { name: "Other Lab" } });
    assert.equal(otherLab.statusCode, 201);
    const otherLabId = String(json(otherLab).id);
    const crossLab = await client.callTool({ name: "list_rooms", arguments: { labId: otherLabId } });
    assert.equal(crossLab.isError, true);
    const otherDevice = await app.inject({ method: "POST", url: "/api/devices", headers,
      payload: { labId: otherLabId, hostname: "other-lab-device", deviceType: "server", placement: "room" } });
    assert.equal(otherDevice.statusCode, 201, otherDevice.body);
    const otherPort = await app.inject({ method: "POST", url: "/api/ports", headers,
      payload: { deviceId: String(json(otherDevice).id), name: "eth9", kind: "rj45" } });
    assert.equal(otherPort.statusCode, 201, otherPort.body);
    const crossLabLink = await app.inject({ method: "POST", url: "/api/port-links", headers,
      payload: { fromPortId: draft.summary.ports[0].id, toPortId: String(json(otherPort).id),
        label: "hidden-cross-lab-link" } });
    assert.equal(crossLabLink.statusCode, 201, crossLabLink.body);
    const scopedConnections = await client.callTool({ name: "list_connections", arguments: { labId } });
    assert.equal(scopedConnections.isError, undefined);
    assert.deepEqual(JSON.parse(firstText(scopedConnections.content)).items, []);
    const malformed = await fetch(new URL("/api/mcp", address), { method: "POST",
      headers: { authorization: "Bearer rpmcp_invalid", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    assert.equal(malformed.status, 401);
    const badOrigin = await fetch(new URL("/api/mcp", address), { method: "POST",
      headers: { authorization: `Bearer ${issued.token}`, origin: "https://untrusted.example",
        "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }) });
    assert.equal(badOrigin.status, 403);
    const badHost = await app.inject({ method: "POST", url: "/api/mcp",
      headers: { host: "untrusted.example", authorization: `Bearer ${issued.token}`,
        "content-type": "application/json", accept: "application/json, text/event-stream" },
      payload: { jsonrpc: "2.0", id: 3, method: "ping" } });
    assert.equal(badHost.statusCode, 403);

    const viewerResponse = await app.inject({ method: "POST", url: "/api/users", headers,
      payload: { username: "mcp-viewer", displayName: "MCP Viewer", password: "viewer-password-1", role: "viewer",
        labAccess: [{ labId, role: "viewer" }] } });
    assert.equal(viewerResponse.statusCode, 201, viewerResponse.body);
    const viewerId = String(json(viewerResponse).id);
    const viewerLogin = await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { username: "mcp-viewer", password: "viewer-password-1" } });
    assert.equal(viewerLogin.statusCode, 200);
    const viewerHeaders = { authorization: `Bearer ${String(json(viewerLogin).token)}` };
    const viewerWrite = await app.inject({ method: "POST", url: "/api/mcp-tokens", headers: viewerHeaders,
      payload: { name: "Denied", capability: "write", labIds: [labId], expiresInDays: 1 } });
    assert.equal(viewerWrite.statusCode, 403);
    const viewerRead = await app.inject({ method: "POST", url: "/api/mcp-tokens", headers: viewerHeaders,
      payload: { name: "Viewer read", capability: "read", labIds: [labId], expiresInDays: 1 } });
    assert.equal(viewerRead.statusCode, 201, viewerRead.body);
    const viewerToken = String(json(viewerRead).token);
    const viewerClient = new Client({ name: "viewer-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    await viewerClient.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", address), {
      requestInit: { headers: { authorization: `Bearer ${viewerToken}` } },
    }));
    try {
      assert.ok(!(await viewerClient.listTools()).tools.some((tool) => tool.name === "propose_inventory"));
    } finally { await viewerClient.close(); }

    db.prepare("DELETE FROM userLabAccess WHERE userId = ?").run(viewerId);
    const grantDenied = await fetch(new URL("/api/mcp", address), { method: "POST",
      headers: { authorization: `Bearer ${viewerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    assert.equal(grantDenied.status, 401);

    const badBatch = { labId, racks: [{ key: "rollback", name: "Rollback Rack" }], devices: [], ports: [],
      connections: [{ from: { id: "missing" }, to: { id: "also-missing" } }] };
    const rejected = await client.callTool({ name: "propose_inventory", arguments: badBatch });
    assert.equal(rejected.isError, true);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM racks WHERE name = 'Rollback Rack'").get() as { n: number }).n, 0);
    const duplicate = await client.callTool({ name: "propose_inventory", arguments: {
      labId, racks: [{ key: "duplicate", name: "First" }, { key: "duplicate", name: "Second" }],
      devices: [], ports: [], connections: [],
    } });
    assert.equal(duplicate.isError, true);
    const existingHostname = await client.callTool({ name: "propose_inventory", arguments: {
      labId, racks: [], devices: [{ key: "duplicate-device", hostname: "proposed-device", deviceType: "server" }],
      ports: [], connections: [],
    } });
    assert.equal(existingHostname.isError, true);

    const stale = await client.callTool({ name: "propose_inventory", arguments: {
      labId, racks: [{ key: "stale", name: "Stale Rack" }], devices: [], ports: [], connections: [],
    } });
    assert.equal(stale.isError, undefined);
    const staleId = (JSON.parse(firstText(stale.content)) as { id: string }).id;
    const wrongUserApply = await app.inject({ method: "POST", url: `/api/mcp-proposals/${staleId}/apply`, headers: viewerHeaders });
    assert.equal(wrongUserApply.statusCode, 404);
    const draftOwnerId = (db.prepare("SELECT userId FROM mcpTokens WHERE id = ?").get(issued.id) as { userId: string }).userId;
    db.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").run(draftOwnerId);
    try {
      const hidden = await app.inject({ method: "GET", url: `/api/mcp-proposals/${staleId}`, headers });
      assert.equal(hidden.statusCode, 404);
      const denied = await app.inject({ method: "POST", url: `/api/mcp-proposals/${staleId}/apply`, headers });
      assert.equal(denied.statusCode, 403);
    } finally {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(draftOwnerId);
    }
    const changed = await app.inject({ method: "POST", url: "/api/racks", headers,
      payload: { labId, name: "Concurrent Rack" } });
    assert.equal(changed.statusCode, 201, changed.body);
    const staleApply = await app.inject({ method: "POST", url: `/api/mcp-proposals/${staleId}/apply`, headers });
    assert.equal(staleApply.statusCode, 409);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM racks WHERE name = 'Stale Rack'").get() as { n: number }).n, 0);

    const rollbackDraftResponse = await client.callTool({ name: "propose_inventory", arguments: {
      labId, racks: [{ key: "atomic", name: "Atomic Rack" }],
      devices: [{ key: "failure", hostname: "forced-failure", deviceType: "server" }],
      ports: [], connections: [],
    } });
    assert.equal(rollbackDraftResponse.isError, undefined);
    const rollbackDraftId = (JSON.parse(firstText(rollbackDraftResponse.content)) as { id: string }).id;
    db.exec(`CREATE TRIGGER mcp_test_failure BEFORE INSERT ON devices
      WHEN NEW.hostname = 'forced-failure' BEGIN SELECT RAISE(ABORT, 'test apply failure'); END;`);
    try {
      const failedApply = await app.inject({ method: "POST", url: `/api/mcp-proposals/${rollbackDraftId}/apply`, headers });
      assert.equal(failedApply.statusCode, 500);
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM racks WHERE name = 'Atomic Rack'").get() as { n: number }).n, 0);
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM auditLog WHERE action = 'mcp.proposal.rack.create'").get() as { n: number }).n, 1);
    } finally { db.exec("DROP TRIGGER mcp_test_failure"); }

    const expiringDraftResponse = await client.callTool({ name: "propose_inventory", arguments: {
      labId, racks: [{ key: "expires", name: "Expired Draft Rack" }], devices: [], ports: [], connections: [],
    } });
    assert.equal(expiringDraftResponse.isError, undefined);
    const expiringDraftId = (JSON.parse(firstText(expiringDraftResponse.content)) as { id: string }).id;
    const realNow = Date.now;
    Date.now = () => realNow() + 60 * 60 * 1000 + 1;
    try {
      const expiredApply = await app.inject({ method: "POST", url: `/api/mcp-proposals/${expiringDraftId}/apply`, headers });
      assert.equal(expiredApply.statusCode, 404);
    } finally { Date.now = realNow; }
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM racks WHERE name = 'Expired Draft Rack'").get() as { n: number }).n, 0);

    const expiryResponse = await app.inject({ method: "POST", url: "/api/mcp-tokens", headers,
      payload: { name: "Expired", capability: "read", labIds: [labId], expiresInDays: 1 } });
    assert.equal(expiryResponse.statusCode, 201);
    const expiryToken = json(expiryResponse) as { id: string; token: string };
    db.prepare("UPDATE mcpTokens SET expiresAt = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", expiryToken.id);
    const expired = await fetch(new URL("/api/mcp", address), { method: "POST",
      headers: { authorization: `Bearer ${expiryToken.token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    assert.equal(expired.status, 401);

    const ownerId = (db.prepare("SELECT userId FROM mcpTokens WHERE id = ?").get(issued.id) as { userId: string }).userId;
    db.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").run(ownerId);
    const roleDenied = await fetch(new URL("/api/mcp", address), { method: "POST",
      headers: { authorization: `Bearer ${issued.token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    assert.equal(roleDenied.status, 401);
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(ownerId);
    process.env.MCP_ENABLED = "0";
    const disabled = await fetch(new URL("/api/mcp", address), { method: "POST",
      headers: { authorization: `Bearer ${issued.token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    assert.equal(disabled.status, 404);
    process.env.MCP_ENABLED = "1";
    const revoked = await app.inject({ method: "DELETE", url: `/api/mcp-tokens/${issued.id}`, headers });
    assert.equal(revoked.statusCode, 204);
    const denied = await fetch(new URL("/api/mcp", address), { method: "POST",
      headers: { authorization: `Bearer ${issued.token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    assert.equal(denied.status, 401);
  } finally {
    await client.close();
  }
});

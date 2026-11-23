import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const directory = mkdtempSync(path.join(os.tmpdir(), "rackpad-pve-host-api-"));
process.env.DATABASE_PATH = path.join(directory, "fixture.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "synthetic-pve-host-api-key";
const { createApp } = await import("../app.js");
const { db } = await import("../db.js");
const { setIntegrationHttpTransportForTests } = await import("../lib/integrations/http.js");
const app = await createApp();
after(async () => {
  setIntegrationHttpTransportForTests(null);
  await app.close();
  db.close();
  rmSync(directory, {recursive: true, force: true});
});

test("Proxmox API preview/apply imports host networking and repeat imports preserve manual ports and cables", async () => {
  let additionalAdapter = false;
  setIntegrationHttpTransportForTests(async request => {
    assert.equal(request.method, "GET");
    const route = request.url.pathname;
    const data = route.endsWith("/nodes") ? [{node: "pve1", status: "online"}]
      : route.endsWith("/network") ? [
        {iface: "eno1", type: "eth", active: 1, hwaddr: "AA:BB:CC:DD:EE:10"},
        {iface: "vmbr0", type: "bridge", active: 1, cidr: "10.2.3.10/24", gateway: "10.2.3.1", bridge_ports: "eno1"},
        ...(additionalAdapter ? [{iface: "eno2", type: "eth", active: 0}] : []),
      ] : [];
    return {status: 200, headers: {}, bodyText: JSON.stringify({data})};
  });
  const bootstrap = await app.inject({method: "POST", url: "/api/auth/bootstrap", payload: {
    username: "admin", password: "synthetic-pve-host-password", displayName: "Admin", loadDemoData: false,
  }});
  assert.equal(bootstrap.statusCode, 201, bootstrap.body);
  const headers = {authorization: `Bearer ${bootstrap.json().token}`};
  const labResponse = await app.inject({method: "POST", url: "/api/labs", headers, payload: {name: "PVE host fixture"}});
  assert.equal(labResponse.statusCode, 201, labResponse.body);
  const labId = labResponse.json().id as string;
  const connection = await app.inject({method: "POST", url: "/api/integrations/connections", headers, payload: {
    labId, provider: "proxmox", name: "PVE fixture", baseUrl: "https://pve.example.test:8006", authKind: "api-token",
    authId: "fixture@pam!read", authSecret: "synthetic-pve-host-token", syncGuests: false,
  }});
  assert.equal(connection.statusCode, 201, connection.body);
  const endpoint = `/api/integrations/connections/${connection.json().id}`;
  const pull = async () => {
    const response = await app.inject({method: "POST", url: `${endpoint}/inventory`, headers, payload: {}});
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const preview = await pull();
  assert.equal(preview.importableDevices[0].ipAddress, "10.2.3.10");
  assert.equal(preview.importableDevices[0].ports.length, 2);
  const network = await app.inject({method: "POST", url: `${endpoint}/apply`, headers, payload: {previewToken: preview.networkPreviewToken}});
  assert.equal(network.statusCode, 200, network.body);
  const selected = [...preview.deviceSync.devices, ...preview.deviceSync.virtualSwitches].filter((row: {action: string}) => row.action === "create").map((row: {providerRecordId: string}) => row.providerRecordId);
  const imported = await app.inject({method: "POST", url: `${endpoint}/apply-devices`, headers, payload: {
    snapshotToken: preview.deviceSnapshotToken, selectedProviderRecordIds: selected,
  }});
  assert.equal(imported.statusCode, 200, imported.body);
  const host = db.prepare("SELECT * FROM devices WHERE labId=? AND hostname='pve1'").get(labId) as {id: string; managementIp: string; macAddress: string};
  assert.equal(host.managementIp, "10.2.3.10");
  assert.equal(host.macAddress, "AA:BB:CC:DD:EE:10");
  const ports = db.prepare("SELECT * FROM ports WHERE deviceId=? ORDER BY name").all(host.id) as Array<{id: string; name: string}>;
  assert.equal(ports.length, 2);
  const physical = ports.find(row => row.name === "eno1")!;
  const changed = await app.inject({method: "PATCH", url: `/api/ports/${physical.id}`, headers, payload: {kind: "sfp_plus"}});
  assert.equal(changed.statusCode, 200, changed.body);
  const peer = await app.inject({method: "POST", url: "/api/devices", headers, payload: {labId, hostname: "peer", deviceType: "switch"}});
  assert.equal(peer.statusCode, 201, peer.body);
  const peerPort = await app.inject({method: "POST", url: "/api/ports", headers, payload: {deviceId: peer.json().id, name: "uplink", kind: "sfp_plus"}});
  assert.equal(peerPort.statusCode, 201, peerPort.body);
  const cable = await app.inject({method: "POST", url: "/api/port-links", headers, payload: {fromPortId: physical.id, toPortId: peerPort.json().id}});
  assert.equal(cable.statusCode, 201, cable.body);
  const originalPorts = db.prepare("SELECT * FROM ports WHERE deviceId=? ORDER BY id").all(host.id);
  const assignments = db.prepare("SELECT * FROM ipAssignments WHERE deviceId=? ORDER BY id").all(host.id);
  assert.equal(assignments.length, 1);
  additionalAdapter = true;
  const repeated = await pull();
  assert.ok(repeated.deviceSync.devices.every((row: {action: string}) => row.action === "exists"));
  const reapplied = await app.inject({method: "POST", url: `${endpoint}/apply-devices`, headers, payload: {snapshotToken: repeated.deviceSnapshotToken, selectedProviderRecordIds: []}});
  assert.equal(reapplied.statusCode, 400, reapplied.body);
  assert.match(reapplied.body, /nothing to import/);
  assert.deepEqual(db.prepare("SELECT * FROM ports WHERE deviceId=? ORDER BY id").all(host.id), originalPorts);
  assert.deepEqual(db.prepare("SELECT * FROM ipAssignments WHERE deviceId=? ORDER BY id").all(host.id), assignments);
  assert.ok(db.prepare("SELECT id FROM portLinks WHERE id=?").get(cable.json().id));
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM devices WHERE labId=? AND hostname='pve1'").get(labId) as {count: number}).count, 1);
});

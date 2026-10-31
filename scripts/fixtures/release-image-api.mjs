export async function exerciseApi({ credentials, nonce, create, features, expectedSchema, expectedArchitecture, dataDirectory = "/data" }) {
  const { default: assert } = await import("node:assert/strict");
  const fs = await import("node:fs");
  const { default: Database } = await import("better-sqlite3");
  assert.equal(process.arch, expectedArchitecture);
  const stateFile = `${dataDirectory}/.release-smoke.json`;
  let token;
  async function call(method, pathname, body, expectedStatus) {
    const response = await fetch(`http://127.0.0.1:3000${pathname}`, {
      method, signal: AbortSignal.timeout(15_000),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(expectedStatus ? response.status === expectedStatus : response.ok, `${method} ${pathname} returned HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }
  const unauthenticated = await fetch("http://127.0.0.1:3000/api/devices", { signal: AbortSignal.timeout(5000) });
  assert.equal(unauthenticated.status, create ? 503 : 401);
  const status = await call("GET", "/api/auth/status");
  assert.equal(status.needsBootstrap, create);
  if (create) await call("POST", "/api/auth/bootstrap", { ...credentials, displayName: "Disposable release smoke", loadDemoData: false }, 201);
  const afterBootstrap = await fetch("http://127.0.0.1:3000/api/devices", { signal: AbortSignal.timeout(5000) });
  assert.equal(afterBootstrap.status, 401);
  const login = await call("POST", "/api/auth/login", credentials, 200);
  assert.equal(typeof login.token, "string");
  token = login.token;
  assert.equal((await call("GET", "/api/auth/me")).user.username, credentials.username);

  const page = await fetch("http://127.0.0.1:3000/", { signal: AbortSignal.timeout(5000) });
  assert.equal(page.status, 200);
  const asset = (await page.text()).match(/<script[^>]+src="(\/assets\/[^"?]+\.js)"/);
  assert.ok(asset, "Production HTML must reference a bundled application script.");
  const bundle = await fetch(`http://127.0.0.1:3000${asset[1]}`, { signal: AbortSignal.timeout(5000) });
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get("content-type"), /javascript/);

  let state;
  if (create) {
    const lab = await call("POST", "/api/labs", { name: "Release fixture" }, 201);
    const room = await call("POST", "/api/rooms", { labId: lab.id, name: "Release room" }, 201);
    const rack = await call("POST", "/api/racks", { labId: lab.id, roomId: room.id, name: "Release rack", totalU: 12 }, 201);
    const stack = await call("POST", "/api/devices", { labId: lab.id, roomId: room.id, rackId: rack.id, hostname: "release-stack", deviceType: "switch_stack", placement: "rack", startU: 2, face: "front" }, 201);
    const peer = await call("POST", "/api/devices", { labId: lab.id, roomId: room.id, hostname: "release-peer", deviceType: "server", placement: "room" }, 201);
    const memberIds = [];
    const portIds = [];
    const templateIds = [];
    for (const [index, face, kind] of [[0, "front", "rj45"], [1, "rear", "sfp_plus"]]) {
      const member = await call("POST", `/api/devices/${stack.id}/stack-members`, { name: `Member ${index + 1}`, manufacturer: "Synthetic", model: `Model ${index + 1}` }, 201);
      const port = await call("POST", "/api/ports", { deviceId: stack.id, stackMemberId: member.id, name: `Port ${index + 1}`, face, kind }, 201);
      const template = await call("POST", "/api/hardware-templates/generic-auto-v1/duplicate", { id: `release-model-${index}`, name: `Release model ${index}` }, 201);
      template.portSlots = [{ id: "smoke-port", face, x: 100, y: 100, width: 50, height: 40, rotation: 0, connector: kind, acceptedPortKinds: [kind], label: port.name }];
      await call("PATCH", `/api/hardware-templates/${template.id}`, template, 200);
      memberIds.push(member.id); portIds.push(port.id); templateIds.push(template.id);
    }
    const peerPort = await call("POST", "/api/ports", { deviceId: peer.id, name: "Peer port", kind: "rj45", face: "front" }, 201);
    const cable = await call("POST", "/api/port-links", { fromPortId: portIds[0], toPortId: peerPort.id }, 201);
    const monitor = await call("POST", "/api/device-monitors", { deviceId: stack.id, name: "Fixture HTTP", type: "http", target: "release-smoke-peer", port: 8787, path: "/health", intervalMs: 86_400_000, enabled: true });
    const service = await call("POST", "/api/device-services", { deviceId: peer.id, name: "Release service", serviceType: "custom", portId: peerPort.id, monitorId: monitor.id, url: "https://service.example.test:8443/" }, 201);
    state = { serviceId: service.id, serviceEndpoint: false, nonce, labId: lab.id, roomId: room.id, rackId: rack.id, stackId: stack.id, peerId: peer.id, memberIds, portIds, peerPortId: peerPort.id, templateIds, cableId: cable.id, monitorId: monitor.id, features: false };
    if (expectedSchema >= 57) {
      const subject = await call("POST", "/api/devices", { labId: lab.id, hostname: "audit-delete-fixture", deviceType: "other" }, 201);
      const known = await call("POST", "/api/audit-log", { action: "fixture.audit", entityType: "Device", entityId: subject.id, summary: "Disposable pre-upgrade history" }, 201);
      const unknown = await call("POST", "/api/audit-log", { action: "fixture.audit", entityType: "Device", entityId: "missing-release-fixture", summary: "Disposable unresolved history" }, 201);
      state.audit = { subjectId: subject.id, knownId: known.id, unknownId: unknown.id };
    }
    fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  } else {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(state.nonce, nonce);
  }

  assert.equal((await call("GET", `/api/labs/${state.labId}`)).name, "Release fixture");
  assert.equal((await call("GET", `/api/racks/${state.rackId}`)).roomId, state.roomId);
  const stack = await call("GET", `/api/devices/${state.stackId}`);
  assert.equal(stack.hostname, "release-stack");
  assert.equal(stack.rackId, state.rackId);
  assert.equal(stack.startU, 2);
  assert.equal((await call("GET", `/api/devices/${state.peerId}`)).hostname, "release-peer");
  const members = await call("GET", `/api/devices/${state.stackId}/stack-members`);
  assert.equal(members.length, 2);
  for (let index = 0; index < state.portIds.length; index++) {
    const port = await call("GET", `/api/ports/${state.portIds[index]}`);
    assert.equal(port.stackMemberId, state.memberIds[index]);
  }
  const cable = await call("GET", `/api/port-links/${state.cableId}`);
  assert.equal(cable.fromPortId, state.portIds[0]);
  assert.equal(cable.toPortId, state.peerPortId);
  if (!create) {
    const savedMonitor = (await call("GET", `/api/device-monitors?deviceId=${state.stackId}`)).find(row => row.id === state.monitorId);
    assert.equal(savedMonitor?.lastResult, "online", "The previous monitor result must survive restart or upgrade.");
    assert.ok(savedMonitor.lastCheckAt);
  }
  const monitor = await call("POST", `/api/device-monitors/${state.monitorId}/run`, {});
  assert.equal(monitor.lastResult, "online", "The production monitor must reach only the isolated HTTP fixture.");
  assert.ok(monitor.lastCheckAt);
  assert.equal((await call("GET", `/api/device-monitors?deviceId=${state.stackId}`)).find(row => row.id === state.monitorId).lastResult, "online");

  const service = await call("GET", `/api/device-services/${state.serviceId}`);
  assert.equal(service.portId, state.peerPortId);
  assert.equal(service.monitorId, state.monitorId);
  assert.equal(service.url, "https://service.example.test:8443/");
  if (features && !state.serviceEndpoint) {
    await call("PATCH", `/api/device-services/${state.serviceId}`, { networkPort: 8443, transportProtocol: "tcp" });
    state.serviceEndpoint = true;
    fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  }
  if (state.serviceEndpoint) {
    const endpoint = await call("GET", `/api/device-services/${state.serviceId}`);
    assert.equal(endpoint.networkPort, 8443);
    assert.equal(endpoint.transportProtocol, "tcp");
  }

  if (features && !state.features) {
    for (let index = 0; index < state.memberIds.length; index++) {
      const library = await call("GET", "/api/hardware-templates");
      const template = library.templates.find(row => row.id === state.templateIds[index]);
      assert.ok(template);
      // Exercise save/reload of the editor's new artwork-order contract.
      template.front.artworkOrder = [...template.front.elements].reverse().map(element => ({ elementId: element.id }));
      await call("PATCH", `/api/hardware-templates/${template.id}`, template, 200);
      const reloaded = (await call("GET", "/api/hardware-templates")).templates.find(row => row.id === template.id);
      assert.deepEqual(reloaded.front.artworkOrder, template.front.artworkOrder);
      const endpoint = `/api/devices/${state.stackId}/stack-members/${state.memberIds[index]}/physical-layout`;
      const preview = await call("POST", `${endpoint}/preview`, { templateId: template.id, bindings: [{ portId: state.portIds[index], slotId: "smoke-port" }] });
      assert.equal(preview.conflicts.length, 0);
      assert.equal(preview.linkedUnmappedPortIds.length, 0);
      await call("POST", `${endpoint}/apply`, { ...preview, approvedPortSlotIds: [] });
    }
    await call("PUT", `/api/devices/${state.stackId}/stack-members/order`, { memberIds: [...state.memberIds].reverse() });
    state.features = true;
    fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  }
  if (state.features) {
    for (let index = 0; index < state.memberIds.length; index++) {
      const applied = await call("GET", `/api/devices/${state.stackId}/stack-members/${state.memberIds[index]}/physical-layout`);
      assert.equal(applied.sourceTemplateId, state.templateIds[index]);
      assert.ok(applied.bindings.some(binding => binding.portId === state.portIds[index]));
    }
    const composed = await call("GET", `/api/physical-layouts/${state.stackId}`);
    assert.equal(composed.bindings.length, 2);
    assert.ok(composed.snapshot.portSlots.some(slot => slot.face === "front"));
    assert.ok(composed.snapshot.portSlots.some(slot => slot.face === "rear"));
    assert.deepEqual((await call("GET", `/api/devices/${state.stackId}/stack-members`)).map(member => member.id), [...state.memberIds].reverse());
  }
  if (state.audit) {
    const known = await call("GET", `/api/audit-log?entityType=Device&entityId=${state.audit.subjectId}`);
    assert.ok(known.some(row => row.id === state.audit.knownId), "Pre-upgrade audit history must survive.");
    const unknown = await call("GET", "/api/audit-log?entityType=Device&entityId=missing-release-fixture");
    assert.ok(unknown.some(row => row.id === state.audit.unknownId));
    if (expectedSchema >= 58) {
      assert.deepEqual(known.find(row => row.id === state.audit.knownId).labIds, [state.labId]);
      assert.equal(unknown.find(row => row.id === state.audit.unknownId).labIds, null);
      // The server's persisted event makes this repeatable after restart without
      // rewriting API-derived fixture state merely to remember a deletion.
      if (!known.some(row => row.action === "device.delete")) {
        await call("DELETE", `/api/devices/${state.audit.subjectId}`, undefined, 204);
      }
      const history = await call("GET", `/api/audit-log?entityType=Device&entityId=${state.audit.subjectId}`);
      assert.ok(history.some(row => row.id === state.audit.knownId));
      assert.ok(history.some(row => row.action === "device.delete"));
      assert.ok(history.every(row => JSON.stringify(row.labIds) === JSON.stringify([state.labId])));
    } else {
      // Paired rollback uses the untouched old database, including the live subject.
      assert.equal((await call("GET", `/api/devices/${state.audit.subjectId}`)).hostname, "audit-delete-fixture");
    }
  }
  const database = new Database(`${dataDirectory}/rackpad.db`, { readonly: true, fileMustExist: true });
  try {
    assert.equal(database.prepare("SELECT version FROM schemaVersion WHERE id=1").get().version, expectedSchema);
    assert.equal(database.pragma("quick_check", { simple: true }), "ok");
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM deviceMonitors WHERE id=? AND lastResult='online'").get(state.monitorId).n, 1);
  } finally { database.close(); }
}

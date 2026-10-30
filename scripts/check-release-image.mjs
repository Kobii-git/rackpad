import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertPatchedImageRuntime } from "./image-runtime.mjs";

const usage = "node scripts/check-release-image.mjs --image ghcr.io/kobii-git/rackpad@sha256:DIGEST|sha256:LOCAL_IMAGE_ID --previous-image ghcr.io/kobii-git/rackpad@sha256:DIGEST [--previous-schema 51|53|55|57] --platform linux/amd64|linux/arm64 --revision COMMIT_SHA";
const options = {};
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log(usage);
  process.exit(0);
}
while (args.length) {
  const flag = args.shift();
  if (!["--image", "--previous-image", "--previous-schema", "--platform", "--revision"].includes(flag) || !args[0] || options[flag]) {
    throw new Error(usage);
  }
  options[flag] = args.shift();
}
const image = options["--image"];
const previousImage = options["--previous-image"];
const platform = options["--platform"];
const revision = options["--revision"];
const previousSchema = Number(options["--previous-schema"] ?? "53");
// The runner has Node but no installed application dependencies. Read the
// canonical declaration so new migrations cannot leave candidate smoke behind.
const schemaSource = readFileSync(new URL("../server/schema-version.ts", import.meta.url), "utf8");
const schemaMatch = schemaSource.match(/^export const CURRENT_SCHEMA_VERSION = ([1-9][0-9]*);\s*$/);
assert.ok(schemaMatch, "Current schema declaration is invalid.");
const currentSchema = Number(schemaMatch[1]);
assert.ok(Number.isSafeInteger(currentSchema), "Current schema version is invalid.");
assert.ok([51, 53, 55, 57].includes(previousSchema), "Previous schema must be 51, 53, 55 or 57.");
const immutableImage = /^ghcr\.io\/kobii-git\/rackpad@sha256:[a-f0-9]{64}$/;
const localImage = /^sha256:[a-f0-9]{64}$/;
assert.ok(immutableImage.test(image ?? "") || localImage.test(image ?? ""), "Candidate must be an immutable Rackpad GHCR digest or local image ID.");
assert.ok(immutableImage.test(previousImage ?? ""), "Previous image must be an immutable Rackpad GHCR digest.");
assert.ok(["linux/amd64", "linux/arm64"].includes(platform), "Select linux/amd64 or linux/arm64.");
assert.match(revision ?? "", /^[a-f0-9]{40}$/, "Provide the complete expected image revision.");

const nonce = randomUUID();
const prefix = `rackpad-release-smoke-${nonce}`;
const network = `${prefix}-network`;
const containers = [];
const volumes = [];
let networkCreated = false;
// These random credentials belong only to this run's disposable fixtures.
const credentials = { username: "release-smoke", password: randomUUID() + randomUUID() };
const secretKey = randomUUID() + randomUUID();
const isolation = ["--platform", platform, "--label", `rackpad.release-smoke=${nonce}`, "--read-only", "--tmpfs", "/tmp", "--cap-drop=ALL", "--security-opt=no-new-privileges"];

function docker(command, { timeout = 120_000, allowFailure = false, input } = {}) {
  const result = spawnSync("docker", command, { encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024, input });
  if (!allowFailure && (result.error || result.status !== 0)) {
    // No container logs or API response bodies: fixtures include auth material.
    throw new Error(`Release image smoke: Docker ${command[0]} failed (${result.error?.message ?? result.status}). ${result.stderr?.slice(-2000) ?? ""}`);
  }
  return result;
}

function createVolume(label) {
  const name = `${prefix}-${label}`;
  docker(["volume", "create", "--label", `rackpad.release-smoke=${nonce}`, name]);
  volumes.push(name);
  return name;
}

function start(appImage, volume) {
  const name = `${prefix}-app-${containers.length}`;
  containers.push(name);
  docker(["run", "-d", "--name", name, ...isolation, "--network", network,
    "--mount", `type=volume,src=${volume},dst=/data`,
    "-e", "OUI_AUTO_UPDATE=0", "-e", "OIDC_ENABLED=0", "-e", "SNMP_TRAP_ENABLED=0", "-e", "MCP_ENABLED=0",
    "-e", "TRUST_PROXY=0", "-e", `RACKPAD_SECRET_KEY=${secretKey}`, appImage]);
  execNode(name, async () => {
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.json()).ok === true) return;
      } catch { /* The server may still be starting or migrating. */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("Fixture health did not become ready within the bounded wait.");
  });
  return name;
}

function execNode(name, action, input = {}) {
  const code = `await (${action.toString()})(${JSON.stringify(input)});`;
  return docker(["exec", "-i", name, "node", "--input-type=module"], { input: code });
}

function stop(name) {
  docker(["stop", "-t", "15", name]);
}

function copyStoppedFixture(source, destination) {
  assert.ok(volumes.includes(source) && volumes.includes(destination) && source !== destination);
  const name = `${prefix}-copy-${containers.length}`;
  containers.push(name);
  const code = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { createHash } from 'node:crypto';
    const state = JSON.parse(fs.readFileSync('/source/.release-smoke.json', 'utf8'));
    assert.equal(state.nonce, ${JSON.stringify(nonce)});
    assert.equal(fs.readdirSync('/data').length, 0);
    const files = fs.readdirSync('/source');
    assert.ok(files.includes('rackpad.db'));
    for (const file of files) {
      assert.ok(['.release-smoke.json', '.release-smoke-pair.json'].includes(file) || /^rackpad\\.db(?:-wal|-shm)?$/.test(file));
      assert.ok(fs.lstatSync('/source/' + file).isFile());
      fs.copyFileSync('/source/' + file, '/data/' + file);
      fs.chmodSync('/data/' + file, 0o600);
      const hash = name => createHash('sha256').update(fs.readFileSync(name)).digest('hex');
      assert.equal(hash('/source/' + file), hash('/data/' + file));
    }
  `;
  docker(["run", "--rm", "-i", "--name", name, ...isolation, "--network", "none",
    "--mount", `type=volume,src=${source},dst=/source,readonly`,
    "--mount", `type=volume,src=${destination},dst=/data`, image, "node", "--input-type=module"], { input: code });
}

async function exerciseApi({ credentials, nonce, create, features, expectedSchema, expectedArchitecture }) {
  const { default: assert } = await import("node:assert/strict");
  const fs = await import("node:fs");
  const { default: Database } = await import("better-sqlite3");
  assert.equal(process.arch, expectedArchitecture);
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
      const known = await call("POST", "/api/audit", { action: "fixture.audit", entityType: "Device", entityId: subject.id, summary: "Disposable pre-upgrade history" }, 201);
      const unknown = await call("POST", "/api/audit", { action: "fixture.audit", entityType: "Device", entityId: "missing-release-fixture", summary: "Disposable unresolved history" }, 201);
      state.audit = { subjectId: subject.id, knownId: known.id, unknownId: unknown.id, deleted: false };
    }
    fs.writeFileSync("/data/.release-smoke.json", JSON.stringify(state), { mode: 0o600 });
  } else {
    state = JSON.parse(fs.readFileSync("/data/.release-smoke.json", "utf8"));
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
    fs.writeFileSync("/data/.release-smoke.json", JSON.stringify(state), { mode: 0o600 });
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
    fs.writeFileSync("/data/.release-smoke.json", JSON.stringify(state), { mode: 0o600 });
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
    const known = await call("GET", `/api/audit?entityType=Device&entityId=${state.audit.subjectId}`);
    assert.ok(known.some(row => row.id === state.audit.knownId), "Pre-upgrade audit history must survive.");
    const unknown = await call("GET", "/api/audit?entityType=Device&entityId=missing-release-fixture");
    assert.ok(unknown.some(row => row.id === state.audit.unknownId));
    if (expectedSchema >= 58) {
      assert.deepEqual(known.find(row => row.id === state.audit.knownId).labIds, [state.labId]);
      assert.equal(unknown.find(row => row.id === state.audit.unknownId).labIds, null);
      if (!state.audit.deleted) {
        await call("DELETE", `/api/devices/${state.audit.subjectId}`, undefined, 204);
        state.audit.deleted = true;
        fs.writeFileSync("/data/.release-smoke.json", JSON.stringify(state), { mode: 0o600 });
      }
      const history = await call("GET", `/api/audit?entityType=Device&entityId=${state.audit.subjectId}`);
      assert.ok(history.some(row => row.id === state.audit.knownId));
      assert.ok(history.some(row => row.action === "device.delete"));
      assert.ok(history.every(row => JSON.stringify(row.labIds) === JSON.stringify([state.labId])));
    } else {
      // Paired rollback uses the untouched old database, including the live subject.
      assert.equal((await call("GET", `/api/devices/${state.audit.subjectId}`)).hostname, "audit-delete-fixture");
    }
  }
  const database = new Database("/data/rackpad.db", { readonly: true, fileMustExist: true });
  try {
    assert.equal(database.prepare("SELECT version FROM schemaVersion WHERE id=1").get().version, expectedSchema);
    assert.equal(database.pragma("quick_check", { simple: true }), "ok");
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM deviceMonitors WHERE id=? AND lastResult='online'").get(state.monitorId).n, 1);
  } finally { database.close(); }
}

function exercise(name, create, features, expectedSchema) {
  execNode(name, exerciseApi, { credentials, nonce, create, features, expectedSchema, expectedArchitecture: platform === "linux/amd64" ? "x64" : "arm64" });
}

try {
  assert.equal(docker(["info", "--format", "{{.OSType}}"] ).stdout.trim(), "linux");
  for (const reference of new Set([image, previousImage])) {
    if (!localImage.test(reference)) docker(["pull", "--platform", platform, reference], { timeout: 600_000 });
    // Resolve the platform through a never-started container. Older Docker CLIs
    // lack image-inspect --platform, and inspecting a multi-platform reference
    // without selection can report the host architecture instead of the fixture.
    const name = `${prefix}-inspect-${containers.length}`;
    containers.push(name);
    docker(["create", "--name", name, ...isolation, "--network", "none", "--entrypoint", "node", reference, "--version"]);
    const selectedImage = docker(["inspect", "--format", "{{.Image}}", name]).stdout.trim();
    assert.match(selectedImage, localImage, "Selected container must resolve to an immutable image ID.");
    const details = JSON.parse(docker(["image", "inspect", selectedImage]).stdout)[0];
    assert.equal(details.Id, selectedImage);
    assert.equal(`${details.Os}/${details.Architecture}`, platform);
    if (reference === image) assert.equal(details.Config.Labels["org.opencontainers.image.revision"], revision);
  }
  // Check only the candidate; historical baselines remain isolated recovery fixtures.
  const runtime = docker(["run", "--rm", ...isolation, "--network", "none", "--entrypoint", "node", image, "--print", "process.versions.node"]).stdout.trim();
  assertPatchedImageRuntime(runtime);
  console.log(`Release image smoke ${platform}: candidate Node ${runtime}.`);
  docker(["network", "create", "--internal", "--label", `rackpad.release-smoke=${nonce}`, network]);
  networkCreated = true;
  const peer = `${prefix}-http`;
  containers.push(peer);
  docker(["run", "-d", "--name", peer, ...isolation, "--network", network, "--network-alias", "release-smoke-peer", image,
    "node", "--input-type=module", "-e", "import http from 'node:http'; http.createServer((req,res)=>{res.writeHead(req.url==='/health'?200:404,{'content-type':'text/plain'});res.end('fixture');}).listen(8787,'0.0.0.0');"]);
  execNode(peer, async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if ((await fetch("http://127.0.0.1:8787/health", { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for the isolated peer. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("HTTP fixture did not start.");
  });

  const freshVolume = createVolume("fresh");
  let app = start(image, freshVolume);
  exercise(app, true, true, currentSchema);
  stop(app);
  app = start(image, freshVolume);
  exercise(app, false, true, currentSchema);
  stop(app);
  console.log(`Release image smoke ${platform}: fresh schema ${currentSchema}, login, inventory, templates, mixed-member layouts, HTTP monitoring and restart persistence passed.`);

  const upgradeVolume = createVolume("upgrade");
  app = start(previousImage, upgradeVolume);
  exercise(app, true, false, previousSchema);
  execNode(app, async pair => {
    const fs = await import("node:fs");
    // Synthetic fixture configuration only; never print this paired recovery record.
    fs.writeFileSync("/data/.release-smoke-pair.json", JSON.stringify(pair), { mode: 0o600 });
  }, { nonce, previousImage, platform, schema: previousSchema, environment: { RACKPAD_SECRET_KEY: secretKey, OUI_AUTO_UPDATE: "0", OIDC_ENABLED: "0", SNMP_TRAP_ENABLED: "0", MCP_ENABLED: "0", TRUST_PROXY: "0" } });
  stop(app);
  const snapshotVolume = createVolume("pre-upgrade-pair");
  // The stopped copy stays paired with previousImage and the same synthetic config/key.
  copyStoppedFixture(upgradeVolume, snapshotVolume);
  app = start(image, upgradeVolume);
  exercise(app, false, true, currentSchema);
  stop(app);
  app = start(image, upgradeVolume);
  exercise(app, false, true, currentSchema);
  stop(app);
  console.log(`Release image smoke ${platform}: actual schema ${previousSchema} image upgraded to ${currentSchema}; inventory, cables, monitor and applied layouts survived restart.`);

  const rollbackVolume = createVolume("rollback");
  copyStoppedFixture(snapshotVolume, rollbackVolume);
  app = start(previousImage, rollbackVolume);
  execNode(app, async expected => {
    const { default: assert } = await import("node:assert/strict");
    const fs = await import("node:fs");
    const pair = JSON.parse(fs.readFileSync("/data/.release-smoke-pair.json", "utf8"));
    // Boolean assertion prevents mismatched fixture configuration from being printed.
    assert.ok(pair.nonce === expected.nonce && pair.previousImage === expected.previousImage && pair.platform === expected.platform && pair.schema === expected.previousSchema);
    for (const [name, value] of Object.entries(pair.environment)) assert.ok(process.env[name] === value, "Paired recovery configuration mismatch.");
  }, { nonce, previousImage, platform, previousSchema });
  exercise(app, false, false, previousSchema);
  stop(app);
  console.log(`Release image smoke ${platform}: previous image plus protected pre-upgrade fixture copy restored schema ${previousSchema} and its inventory.`);
  console.log(`Verified image revision ${revision} from ${image} on ${platform}. Browser interaction and real-device acceptance remain separate gates.`);
} finally {
  let cleanupFailed = false;
  for (const name of containers) {
    const removed = docker(["rm", "-f", "-v", name], { allowFailure: true, timeout: 30_000 });
    if (removed.status !== 0 && !removed.stderr?.includes("No such container")) cleanupFailed = true;
  }
  for (const name of volumes) if (docker(["volume", "rm", name], { allowFailure: true, timeout: 30_000 }).status !== 0) cleanupFailed = true;
  if (networkCreated && docker(["network", "rm", network], { allowFailure: true, timeout: 30_000 }).status !== 0) cleanupFailed = true;
  if (cleanupFailed) {
    console.error(`Fixture cleanup incomplete; inspect only resources labelled rackpad.release-smoke=${nonce}.`);
    process.exitCode = 1;
  }
}

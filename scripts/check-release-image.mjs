import assert from "node:assert/strict";
import { exerciseApi } from "./fixtures/release-image-api.mjs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertPatchedImageRuntime } from "./image-runtime.mjs";

const usage = "node scripts/check-release-image.mjs --image ghcr.io/kobii-git/rackpad@sha256:DIGEST|sha256:LOCAL_IMAGE_ID --previous-image ghcr.io/kobii-git/rackpad@sha256:DIGEST [--previous-schema 51|53|55|57|58|59|60|61|62] --platform linux/amd64|linux/arm64 --revision COMMIT_SHA";
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
assert.ok([51, 53, 55, 57, 58, 59, 60, 61, 62].includes(previousSchema), "Previous schema must be a supported published baseline or standalone schema 58–62.");
assert.ok(previousSchema <= currentSchema, "Previous schema cannot be newer than the candidate.");
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
    "node", "--input-type=module", "-e", "import http from 'node:http'; http.createServer((req,res)=>{const ok=req.url==='/health'||req.url==='/metrics';res.writeHead(ok?200:404,{'content-type':'text/plain'});res.end(req.url==='/metrics'?'monitor_status{monitor_id=\"1\",monitor_name=\"Release service\"} 1\\n':'fixture');}).listen(8787,'0.0.0.0');"]);
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

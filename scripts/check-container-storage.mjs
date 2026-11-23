import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
let suppliedImage;
let namedVolumeOnly = false;
while (args.length) {
  const option = args.shift();
  if (option === "--image" && args[0] && !suppliedImage) suppliedImage = args.shift();
  else if (option === "--named-volume-only" && !namedVolumeOnly) namedVolumeOnly = true;
  else throw new Error("Usage: node scripts/check-container-storage.mjs [--image LOCAL_IMAGE] [--named-volume-only]");
}
if (process.platform !== "linux" && !namedVolumeOnly) {
  throw new Error("Full container storage validation requires a Linux host for bind-mount ownership. Use --named-volume-only for the limited Docker Desktop check; CI must still run the full gate.");
}

const token = randomUUID();
const prefix = `rackpad-storage-${token}`;
const image = suppliedImage ?? `${prefix}:local`;
const volume = `${prefix}-data`;
const containers = [];
let fixtureRoot;
let fixtureReady = false;
let imageReady = false;
let volumeCreated = false;
const isolation = ["--network", "none", "--read-only", "--tmpfs", "/tmp", "--cap-drop=ALL", "--security-opt=no-new-privileges"];

function docker(args, { timeout = 30000, allowFailure = false, inherit = false } = {}) {
  const result = spawnSync("docker", args, {
    cwd: root, encoding: "utf8", timeout,
    stdio: inherit ? "inherit" : "pipe",
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`Container storage Docker ${args[0]} failed: ${result.error?.message || result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`}`);
  }
  return result;
}

function runNode(code, options = []) {
  const name = `${prefix}-${containers.length}`;
  containers.push(name);
  return docker(["run", "--rm", "--name", name, ...isolation, ...options,
    image, "node", "--input-type=module", "-e", code]);
}

function fixtureOperation(code) {
  // The root helper can only mount this newly generated fixture directory.
  // Its nonce check also refuses an unrelated directory on a remote daemon.
  return runNode(`
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    assert.equal(fs.readFileSync('/fixture/.fixture-id', 'utf8'), ${JSON.stringify(token)});
    ${code}
  `, ["--user", "0:0", "--cap-add=CHOWN", "--cap-add=FOWNER", "--cap-add=DAC_OVERRIDE",
    "--mount", `type=bind,src=${fixtureRoot},dst=/fixture`]);
}

function start(mount, user, environment = [], extraMounts = []) {
  const name = `${prefix}-${containers.length}`;
  containers.push(name);
  docker(["run", "-d", "--name", name, ...isolation, "--mount", mount,
    ...(user ? ["--user", user] : []),
    "-e", "OUI_AUTO_UPDATE=0", "-e", "SNMP_TRAP_ENABLED=0", "-e", "MCP_ENABLED=0",
    ...extraMounts.flatMap(value => ["--mount", value]), ...environment, image]);
  return name;
}

function waitHealthy(name) {
  const result = docker(["exec", name, "node", "--input-type=module", "-e", `
    let healthy = false;
    let lastFailure = 'No health response';
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(500) });
        if (response.ok && (await response.json()).ok === true) { healthy = true; break; }
        lastFailure = 'Health status ' + response.status;
      } catch (error) { lastFailure = error.message; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!healthy) { console.error(lastFailure); process.exit(1); }
  `], { timeout: 65000, allowFailure: true });
  if (result.error || result.status !== 0) {
    const logs = docker(["logs", "--tail", "30", name], { allowFailure: true });
    throw new Error(`Fixture health failed: ${result.error?.message || result.stderr || result.status}\n${logs.stdout}${logs.stderr}`);
  }
}

function checkData(name, expectedUser, existing) {
  const result = docker(["exec", name, "node", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const { db } = await import('./dist-server/db.js');
    try {
      assert.equal(process.getuid() + ':' + process.getgid(), ${JSON.stringify(expectedUser)});
      assert.equal(fs.statSync('/data/rackpad.db').uid, process.getuid());
      ${existing ? `assert.equal(db.prepare("SELECT value FROM appSettings WHERE key = 'containerStorageSmoke'").get()?.value, ${JSON.stringify(token)});` : ""}
      db.prepare("INSERT INTO appSettings (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run('containerStorageSmoke', ${JSON.stringify(token)}, new Date().toISOString());
      assert.equal(db.prepare("SELECT value FROM appSettings WHERE key = 'containerStorageSmoke'").get().value, ${JSON.stringify(token)});
    } finally { db.close(); }
  `]);
  assert.equal(result.status, 0);
}

function exercise(label, mount, user, expectedUser, backupMount) {
  const settings = backupMount ? ["-e", "RACKPAD_NATIVE_BACKUP_DIR=/backups"] : [];
  const mounts = backupMount ? [backupMount] : [];
  const first = start(mount, user, settings, mounts);
  waitHealthy(first);
  checkData(first, expectedUser, false);
  if (backupMount) checkNativeBackup(first, false);
  docker(["stop", "-t", "10", first]);
  const second = start(mount, user, settings, mounts);
  waitHealthy(second);
  checkData(second, expectedUser, true);
  if (backupMount) checkNativeBackup(second, true);
  docker(["stop", "-t", "10", second]);
  console.log(`Container storage: ${label}, health, writes and restart persistence passed.`);
}

function checkNativeBackup(name, existing, denied = false) {
  docker(["exec", name, "node", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    const {createNativeBackup,listNativeBackups} = await import('./dist-server/lib/native-backup.js');
    try {
      if (${existing}) assert.ok(listNativeBackups().length > 0, 'Native snapshot must survive restart');
      if (${denied}) await assert.rejects(createNativeBackup('storage-fixture'));
      else {await createNativeBackup('storage-fixture'); assert.ok(listNativeBackups().length > 0);}
    } finally {(await import('./dist-server/db.js')).db.close();}
  `]);
}

function expectAccessFailure(mount, user, environment = []) {
  const name = start(mount, user, environment);
  const result = docker(["wait", name], { timeout: 30000 });
  assert.notEqual(result.stdout.trim(), "0", "inaccessible storage must stop the app");
  const logs = docker(["logs", name]);
  assert.match(logs.stdout + logs.stderr, /\[rackpad\] Database access failed\./);
  assert.match(logs.stdout + logs.stderr, /INSTALL\.md#bind-mounts-and-container-users/);
}

try {
  assert.equal(docker(["info", "--format", "{{.OSType}}"] ).stdout.trim(), "linux");
  if (suppliedImage) docker(["image", "inspect", suppliedImage]);
  else docker(["build", "-t", image, "."], { timeout: 1200000, inherit: true });
  imageReady = true;
  const identity = runNode("console.log(process.getuid() + ':' + process.getgid())").stdout.trim();
  assert.match(identity, /^10001:\d+$/);
  assert.equal(runNode("console.log(process.getuid() + ':' + process.getgid())",
    ["-e", "PUID=1000", "-e", "PGID=1000"]).stdout.trim(), identity);
  docker(["volume", "create", volume]);
  volumeCreated = true;
  exercise("default user with a named volume", `type=volume,src=${volume},dst=/data`, undefined, identity);

  if (namedVolumeOnly) {
    console.log("Limited named-volume check passed; Linux bind-mount ownership cases were NOT run.");
  } else {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "rackpad-container-storage-"));
    writeFileSync(path.join(fixtureRoot, ".fixture-id"), token, { mode: 0o600 });
    fixtureReady = true;
    const [uid, gid] = identity.split(":").map(Number);
    fixtureOperation(`
      for (const [name, uid, gid] of [['default', ${uid}, ${gid}], ['custom', 1000, 1000], ['blocked', 0, 0], ['root-owned', 0, 0], ['native', 1000, 1000], ['native-blocked', 0, 0], ['native-data', 1000, 1000]]) {
        const directory = '/fixture/' + name;
        fs.mkdirSync(directory, { mode: 0o700 });
        fs.chownSync(directory, uid, gid);
      }
    `);
    const mount = (name) => `type=bind,src=${path.join(fixtureRoot, name)},dst=/data`;
    exercise("default user with a bind mount", mount("default"), undefined, identity);
    exercise("custom user with a bind mount", mount("custom"), "1000:1000", "1000:1000");
    exercise("custom user with native backups", mount("native-data"), "1000:1000", "1000:1000", `type=bind,src=${path.join(fixtureRoot,"native")},dst=/backups`);
    const deniedNative = start(mount("custom"), "1000:1000", ["-e", "RACKPAD_NATIVE_BACKUP_DIR=/backups"], [`type=bind,src=${path.join(fixtureRoot,"native-blocked")},dst=/backups`]);
    waitHealthy(deniedNative);
    checkNativeBackup(deniedNative, false, true);
    docker(["stop", "-t", "10", deniedNative]);
    expectAccessFailure(mount("blocked"));
    expectAccessFailure(mount("custom"), undefined, ["-e", "PUID=1000", "-e", "PGID=1000"]);
    // Rehearse a root-to-custom-user transition only in isolated fixture data.
    exercise("explicit root with isolated storage", mount("root-owned"), "0:0", "0:0");
    expectAccessFailure(mount("root-owned"), "1000:1000");
    fixtureOperation(`
      const directory = '/fixture/root-owned';
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^rackpad\\.db(?:-wal|-shm)?$/.test(entry.name)) throw new Error('Unexpected fixture entry');
        fs.chownSync(directory + '/' + entry.name, 1000, 1000);
      }
      fs.chownSync(directory, 1000, 1000);
    `);
    const repaired = start(mount("root-owned"), "1000:1000");
    waitHealthy(repaired);
    checkData(repaired, "1000:1000", true);
    docker(["stop", "-t", "10", repaired]);
    console.log("Container storage: access failures, ignored PUID/PGID and offline ownership correction passed.");
  }
} finally {
  for (const name of containers) docker(["rm", "-f", name], { allowFailure: true });
  if (volumeCreated) docker(["volume", "rm", volume], { allowFailure: true });
  if (fixtureRoot) {
    try {
      if (fixtureReady && imageReady) fixtureOperation(`
        for (const name of ['default', 'custom', 'blocked', 'root-owned', 'native', 'native-blocked', 'native-data']) fs.rmSync('/fixture/' + name, { recursive: true, force: true });
      `);
    } finally { rmSync(fixtureRoot, { recursive: true, force: true }); }
  }
  if (imageReady && !suppliedImage) docker(["image", "rm", image], { allowFailure: true });
}

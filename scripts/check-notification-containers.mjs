import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exerciseNotifications } from "./fixtures/notification-containers.mjs";

const usage = "node scripts/check-notification-containers.mjs --image sha256:LOCAL_IMAGE_ID --platform linux/amd64|linux/arm64";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") { console.log(usage); process.exit(0); }
const options = {};
while (args.length) {
  const flag = args.shift();
  assert.ok(["--image", "--platform"].includes(flag) && args[0] && !options[flag], usage);
  options[flag] = args.shift();
}
const image = options["--image"];
const platform = options["--platform"];
assert.match(image ?? "", /^sha256:[a-f0-9]{64}$/, "Use the built candidate's immutable local image ID.");
assert.ok(["linux/amd64", "linux/arm64"].includes(platform), usage);

// Upstream Mailpit v1.33.0 and ntfy v2.35.0 multi-platform manifests.
const mailpitImage = "docker.io/axllent/mailpit@sha256:9b3a463be15354c0f0eba91697d80e3e0d8a5623ef0e627cacc836bc17fd5231";
const ntfyImage = "docker.io/binwiederhier/ntfy@sha256:6f0c9abab7b99a978d816611cc90dabb4849b81f60c53114e91cd07931085dc0";
const nonce = randomUUID();
const prefix = `rackpad-notifications-${nonce}`;
const network = `${prefix}-network`;
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "rackpad-notifications-"));
const certDirectory = path.join(fixtureRoot, "certificates");
const containers = [];
const volumes = [];
let networkCreated = false;
const credentials = { username: "notification-fixture", password: randomUUID() + randomUUID() };
const smtp = { username: "smtp-fixture", password: randomUUID() + randomUUID() };
const secretKey = randomUUID() + randomUUID();
const topic = `fixture-${randomUUID()}`;
const isolation = ["--platform", platform, "--label", `rackpad.notification-test=${nonce}`, "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid", "--cap-drop=ALL", "--security-opt=no-new-privileges"];

function command(executable, argv, { input, timeout = 120_000, allowFailure = false } = {}) {
  const result = spawnSync(executable, argv, { encoding: "utf8", input, timeout, maxBuffer: 2 * 1024 * 1024 });
  // Commands, service logs and raw output can contain disposable credentials.
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`Notification acceptance: ${executable} ${argv[0]} failed (exit ${result.status ?? "unavailable"}).`);
  return result;
}
const docker = (argv, options) => command("docker", argv, options);
function volume(label) {
  const name = `${prefix}-${label}`;
  // No disk-backed fixture database is needed for provider interoperability.
  // A holder keeps this tmpfs mounted across service/container restarts.
  docker(["volume", "create", "--driver", "local", "--opt", "type=tmpfs", "--opt", "device=tmpfs",
    "--opt", "o=size=128m,uid=10001,gid=10001,mode=0700", "--label", `rackpad.notification-test=${nonce}`, name]);
  volumes.push(name);
  const holder = `${prefix}-${label}-holder-${containers.length}`;
  containers.push(holder);
  docker(["run", "-d", "--name", holder, ...isolation, "--network", "none", "--mount", `type=volume,src=${name},dst=/data`, image, "node", "-e", "setInterval(() => {}, 60000)"]);
  return name;
}
function run(label, appImage, argv, command = []) {
  const name = `${prefix}-${label}-${containers.length}`;
  containers.push(name);
  docker(["run", "-d", "--name", name, ...isolation, "--network", network, ...argv, appImage, ...command]);
  return name;
}
function execNode(name, action, input) {
  const result = docker(["exec", "-i", name, "node", "--input-type=module"], { input: `await (${action.toString()})(${JSON.stringify(input)});`, allowFailure: true });
  if (result.error || result.status !== 0) {
    const state = docker(["inspect", "--format", "{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}", name], { allowFailure: true }).stdout.trim();
    const logs = docker(["logs", "--tail", "20", name], { allowFailure: true });
    const storageFull = /no space left|database or disk is full|SQLITE_FULL/i.test(logs.stdout + logs.stderr);
    throw new Error(`Notification fixture ${action.name}${typeof input?.phase === "string" ? ` (${input.phase})` : ""} failed: exit ${result.status}; ${state}; storageFull=${storageFull}.`);
  }
}
function waitFor(app, url) {
  execNode(app, async url => {
    for (let attempt = 0; attempt < 90; attempt++) {
      try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Bounded readiness, no response bodies logged. */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("Notification fixture readiness timed out.");
  }, url);
}
const certMount = () => ["--mount", `type=bind,src=${certDirectory},dst=/fixture-certs,readonly`];
function startApp(dataVolume) {
  const app = run("app", image, ["--mount", `type=volume,src=${dataVolume},dst=/data`, ...certMount(),
    "-e", "NODE_EXTRA_CA_CERTS=/fixture-certs/ca.crt", "-e", `RACKPAD_SECRET_KEY=${secretKey}`,
    "-e", "OUI_AUTO_UPDATE=0", "-e", "SNMP_TRAP_ENABLED=0", "-e", "MCP_ENABLED=0", "-e", "OIDC_ENABLED=0", "-e", "TRUST_PROXY=0"]);
  waitFor(app, "http://127.0.0.1:3000/api/health");
  return app;
}

try {
  assert.equal(docker(["info", "--format", "{{.OSType}}"]).stdout.trim(), "linux");
  const details = JSON.parse(docker(["image", "inspect", image]).stdout)[0];
  assert.equal(`${details.Os}/${details.Architecture}`, platform);
  // Only this run's synthetic CA is trusted. Production TLS validation stays enabled.
  command("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(fixtureRoot, "ca.key"), "-out", path.join(fixtureRoot, "ca.crt"), "-days", "1", "-subj", "/CN=Rackpad disposable notification CA"]);
  command("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(fixtureRoot, "server.key"), "-out", path.join(fixtureRoot, "server.csr"), "-subj", "/CN=ntfy-fixture"]);
  writeFileSync(path.join(fixtureRoot, "extensions"), "subjectAltName=DNS:ntfy-fixture,DNS:mailpit-starttls,DNS:mailpit-smtps\nextendedKeyUsage=serverAuth\n", { mode: 0o600 });
  command("openssl", ["x509", "-req", "-in", path.join(fixtureRoot, "server.csr"), "-CA", path.join(fixtureRoot, "ca.crt"), "-CAkey", path.join(fixtureRoot, "ca.key"), "-CAcreateserial", "-out", path.join(fixtureRoot, "server.crt"), "-days", "1", "-extfile", path.join(fixtureRoot, "extensions")]);
  // Keep the host parent private. Only the public certs and disposable server
  // key enter the traversable, read-only container mount; never the CA key.
  mkdirSync(certDirectory, { mode: 0o755 });
  for (const name of ["server.key", "server.crt", "ca.crt"]) {
    renameSync(path.join(fixtureRoot, name), path.join(certDirectory, name));
    chmodSync(path.join(certDirectory, name), 0o444);
  }
  for (const reference of [mailpitImage, ntfyImage]) docker(["pull", "--platform", platform, reference], { timeout: 600_000 });
  docker(["network", "create", "--internal", "--label", `rackpad.notification-test=${nonce}`, network]);
  networkCreated = true;
  for (const [alias, tlsMode] of [["mailpit-starttls", "MP_SMTP_REQUIRE_STARTTLS=true"], ["mailpit-smtps", "MP_SMTP_REQUIRE_TLS=true"]]) {
    run(alias, mailpitImage, ["--user", "10001:10001", "--network-alias", alias,
      ...(alias === "mailpit-smtps" ? ["--network-alias", "mailpit-wrong-host"] : []),
      "--tmpfs", "/data:rw,noexec,nosuid,uid=10001,gid=10001,mode=0700", ...certMount(),
      "-e", "MP_DATABASE=/data/mailpit.db", "-e", "MP_SMTP_BIND_ADDR=0.0.0.0:1025", "-e", "MP_UI_BIND_ADDR=0.0.0.0:8025",
      "-e", "MP_SMTP_TLS_CERT=/fixture-certs/server.crt", "-e", "MP_SMTP_TLS_KEY=/fixture-certs/server.key",
      "-e", tlsMode, "-e", `MP_SMTP_AUTH=${smtp.username}:${smtp.password}`]);
  }
  const ntfyVolume = volume("ntfy");
  // Verify candidate-compatible ownership before provisioning the real service.
  // The service and initialization both use UID 10001, with no root helper.
  const initializer = `${prefix}-initialize-${containers.length}`;
  containers.push(initializer);
  docker(["run", "--rm", "--name", initializer, ...isolation, "--network", "none", "--mount", `type=volume,src=${ntfyVolume},dst=/data`, image, "node", "-e", "require('node:fs').accessSync('/data',require('node:fs').constants.W_OK)"]);
  const ntfy = run("ntfy", ntfyImage, ["--user", "10001:10001", "--network-alias", "ntfy-fixture", "--mount", `type=volume,src=${ntfyVolume},dst=/data`, ...certMount(),
    "-e", "NTFY_BASE_URL=https://ntfy-fixture:8443", "-e", "NTFY_LISTEN_HTTP=-", "-e", "NTFY_LISTEN_HTTPS=:8443",
    "-e", "NTFY_CERT_FILE=/fixture-certs/server.crt", "-e", "NTFY_KEY_FILE=/fixture-certs/server.key",
    "-e", "NTFY_AUTH_FILE=/data/auth.db", "-e", "NTFY_AUTH_DEFAULT_ACCESS=deny-all", "-e", "NTFY_CACHE_FILE=/data/cache.db"], ["serve"]);
  const dataVolume = volume("app");
  let app = startApp(dataVolume);
  waitFor(app, "http://mailpit-starttls:8025/api/v1/info");
  waitFor(app, "http://mailpit-smtps:8025/api/v1/info");
  waitFor(app, "https://ntfy-fixture:8443/v1/health");
  docker(["exec", "-e", `NTFY_PASSWORD=${randomUUID() + randomUUID()}`, ntfy, "ntfy", "user", "add", "fixture"]);
  docker(["exec", ntfy, "ntfy", "access", "fixture", topic, "rw"]);
  const tokenOutput = docker(["exec", ntfy, "ntfy", "token", "add", "fixture"]).stdout;
  const ntfyToken = tokenOutput.match(/\btk_[A-Za-z0-9]{29}\b/)?.[0];
  assert.ok(ntfyToken, "ntfy must generate a real access token.");
  docker(["restart", ntfy]);
  waitFor(app, "https://ntfy-fixture:8443/v1/health");
  const fixture = { credentials, smtp, topic, ntfyToken };
  execNode(app, exerciseNotifications, { ...fixture, phase: "smtp" });
  console.log("Notification acceptance: SMTP delivery and negative cases passed.");
  docker(["stop", "-t", "15", app]);
  app = startApp(dataVolume);
  execNode(app, exerciseNotifications, { ...fixture, phase: "ntfy" });
  console.log("Notification acceptance: saved SMTP survived restart; ntfy delivered over HTTPS.");
  docker(["stop", "-t", "15", app]);
  app = startApp(dataVolume);
  execNode(app, exerciseNotifications, { ...fixture, phase: "persisted-ntfy" });
  console.log("Notification acceptance: saved ntfy token survived restart and delivered.");
  docker(["exec", ntfy, "ntfy", "token", "remove", "fixture", ntfyToken]);
  docker(["restart", ntfy]);
  waitFor(app, "https://ntfy-fixture:8443/v1/health");
  execNode(app, exerciseNotifications, { ...fixture, phase: "revoked-ntfy" });
  console.log(`Notification acceptance ${platform}: Mailpit STARTTLS/SMTPS, saved settings/restart, SMTP authentication/TLS failures, ntfy HTTPS/token delivery/restart/revocation and safe diagnostics passed.`);
} finally {
  let cleanupFailed = false;
  for (const name of containers.reverse()) {
    const result = docker(["rm", "-f", "-v", name], { allowFailure: true, timeout: 30_000 });
    if (result.status !== 0 && !result.stderr?.includes("No such container")) cleanupFailed = true;
  }
  for (const name of volumes.reverse()) if (docker(["volume", "rm", name], { allowFailure: true, timeout: 30_000 }).status !== 0) cleanupFailed = true;
  if (networkCreated && docker(["network", "rm", network], { allowFailure: true, timeout: 30_000 }).status !== 0) cleanupFailed = true;
  rmSync(fixtureRoot, { recursive: true, force: true });
  if (cleanupFailed) {
    console.error(`Notification fixture cleanup incomplete; inspect only resources labelled rackpad.notification-test=${nonce}.`);
    process.exitCode = 1;
  }
}

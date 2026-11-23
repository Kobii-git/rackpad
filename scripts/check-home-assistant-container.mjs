import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const usage =
  "node scripts/check-home-assistant-container.mjs --image sha256:LOCAL_IMAGE_ID --platform linux/amd64|linux/arm64 --revision COMMIT_SHA";
const args = process.argv.slice(2),
  options = {};
if (args.length === 1 && args[0] === "--help") {
  console.log(usage);
  process.exit(0);
}
while (args.length) {
  const flag = args.shift();
  assert.ok(
    ["--image", "--platform", "--revision"].includes(flag) &&
      args[0] &&
      !options[flag],
    usage,
  );
  options[flag] = args.shift();
}
const image = options["--image"],
  platform = options["--platform"],
  revision = options["--revision"];
assert.match(image ?? "", /^sha256:[a-f0-9]{64}$/);
assert.ok(["linux/amd64", "linux/arm64"].includes(platform), usage);
assert.match(revision ?? "", /^[a-f0-9]{40}$/);
const haImage =
  "ghcr.io/home-assistant/home-assistant@sha256:23f4dfbb69ce76315dbc4de7915504f1c2dcecd7ca2648113a493a385972e133";
const nonce = randomUUID(),
  network = `rackpad-ha-live-${nonce}`,
  containers = [];
let networkCreated = false;
function docker(args, { input, allowFailure = false, timeout = 180000 } = {}) {
  const r = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (!allowFailure && (r.error || r.status !== 0))
    throw new Error(`HA acceptance Docker ${args[0]} failed (${r.status}).`);
  return r;
}
const isolation = [
  "--platform",
  platform,
  "--label",
  `rackpad.ha-live=${nonce}`,
  "--read-only",
  "--tmpfs",
  "/tmp:rw,nosuid",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--user",
  "10001:10001",
];
function run(label, ref, args, cmd) {
  const name = `${network}-${label}`;
  containers.push(name);
  docker([
    "run",
    "-d",
    "--name",
    name,
    ...isolation,
    "--network",
    network,
    ...args,
    ref,
    ...cmd,
  ]);
  return name;
}
async function exercise({ password }) {
  const { default: assert } = await import("node:assert/strict");
  const base = "http://ha-fixture:8123";
  for (let i = 0; i < 240; i++) {
    try {
      if (
        (
          await fetch(base + "/api/onboarding", {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      )
        break;
    } catch {
      // The isolated service may still be starting.
    }
    if (i === 239) throw new Error("HA startup timed out");
    await new Promise((r) => setTimeout(r, 500));
  }
  const clientId = base + "/";
  const user = await fetch(base + "/api/onboarding/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Disposable fixture",
      username: "fixture",
      password,
      client_id: clientId,
      language: "en",
    }),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(user.status, 200);
  const code = (await user.json()).auth_code;
  assert.ok(typeof code === "string");
  const auth = await fetch(base + "/auth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
    }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(auth.status, 200);
  const access = (await auth.json()).access_token;
  assert.ok(typeof access === "string");
  const config = await fetch(base + "/api/config", {
    headers: { authorization: `Bearer ${access}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(config.status, 200);
  assert.equal((await config.json()).version, "2026.10.4");
  async function command(type, fields = {}, token = access) {
    const socket = new WebSocket("ws://ha-fixture:8123/api/websocket");
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("HA setup WebSocket timed out")),
          15000,
        );
        socket.addEventListener("error", () =>
          reject(new Error("HA setup WebSocket failed")),
        );
        socket.addEventListener("message", (event) => {
          const m = JSON.parse(String(event.data));
          if (m.type === "auth_required")
            socket.send(JSON.stringify({ type: "auth", access_token: token }));
          else if (m.type === "auth_ok")
            socket.send(JSON.stringify({ id: 1, type, ...fields }));
          else if (m.type === "result" && m.id === 1) {
            if (m.success) resolve(m.result);
            else reject(new Error("HA setup command rejected"));
          } else if (m.type === "auth_invalid")
            reject(new Error("HA setup authentication rejected"));
        });
      });
    } finally {
      clearTimeout(timer);
      socket.close();
    }
  }
  const token = await command("auth/long_lived_access_token", {
    client_name: "Rackpad disposable acceptance",
    lifespan: 1,
  });
  assert.ok(typeof token === "string");
  const { homeAssistantIntegrationClient: client } =
    await import("/app/dist-server/lib/integrations/providers/home-assistant.js");
  const connection = {
    id: "fixture",
    labId: "fixture",
    provider: "home-assistant",
    name: "Fixture",
    baseUrl: base,
    authKind: "api-key",
    authId: null,
    authSecret: token,
    verifyTls: true,
    options: {},
  };
  async function state(entity, state, attributes) {
    const r = await fetch(base + "/api/states/" + entity, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ state, attributes }),
      signal: AbortSignal.timeout(5000),
    });
    assert.ok(r.status === 200 || r.status === 201);
  }
  await state("binary_sensor.rackpad_fixture", "on", {
    friendly_name: "Fixture connectivity",
    device_class: "connectivity",
  });
  await state("switch.rackpad_fixture", "off", {
    friendly_name: "Fixture intentional off",
  });
  await state("sensor.rackpad_fixture", "42", {
    friendly_name: "Fixture numeric",
    unit_of_measurement: "W",
  });
  let readings = await client.fetchReadings(connection);
  const selected = readings.readings.find(
    (r) => r.label === "Fixture connectivity",
  );
  assert.equal(selected?.health, "healthy");
  assert.ok(
    readings.readings.some(
      (r) => r.label === "Fixture intentional off" && r.health === "unknown",
    ),
  );
  assert.ok(
    readings.readings.some(
      (r) =>
        r.label === "Fixture numeric" &&
        r.value === 42 &&
        r.unit === "W" &&
        r.health === "unknown",
    ),
  );
  const record = selected.providerRecordId,
    key = selected.key;
  for (const [value, health] of [
    ["off", "unhealthy"],
    ["unavailable", "unknown"],
  ]) {
    await state("binary_sensor.rackpad_fixture", value, {
      friendly_name: "Fixture connectivity",
      device_class: "connectivity",
    });
    readings = await client.fetchReadings(connection);
    assert.equal(
      readings.readings.find(
        (r) => r.providerRecordId === record && r.key === key,
      )?.health,
      health,
    );
  }
  let groupedId;
  for (let attempt = 0; attempt < 60; attempt++) {
    const grouped = new Map();
    for (const r of readings.readings)
      if (r.providerRecordId.startsWith("device:"))
        grouped.set(
          r.providerRecordId,
          (grouped.get(r.providerRecordId) ?? 0) + 1,
        );
    groupedId = [...grouped].find(([, count]) => count > 1)?.[0];
    if (groupedId) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
    readings = await client.fetchReadings(connection);
  }
  assert.ok(
    groupedId,
    "Built-in demo must expose actual device-registry grouping.",
  );
  const before = await client.fetchInventory(connection);
  assert.ok(
    before.importableDevices.some((d) => d.providerRecordId === groupedId),
  );
  await command(
    "config/device_registry/update",
    {
      device_id: groupedId.slice(7),
      name_by_user: "Renamed disposable device",
    },
    token,
  );
  const after = await client.fetchInventory(connection);
  assert.equal(
    after.importableDevices.find((d) => d.providerRecordId === groupedId)?.name,
    "Renamed disposable device",
  );
  const invalid = { ...connection, authSecret: "invalid-disposable-token" };
  const rejectedSafely = (error) =>
    error.category === "authentication" &&
    [token, password, invalid.authSecret].every(
      (value) => !error.message.includes(value),
    );
  await assert.rejects(() => client.fetchReadings(invalid), rejectedSafely);
  const { readHomeAssistantRegistries } =
    await import("/app/dist-server/lib/integrations/home-assistant-websocket.js");
  await assert.rejects(
    () => readHomeAssistantRegistries(invalid),
    rejectedSafely,
  );
  const serialized = JSON.stringify({ readings, before, after });
  assert.ok(!serialized.includes(token));
  assert.ok(!serialized.includes(password));
  console.log(
    "Home Assistant 2026.10.4: real REST/WS authentication, registry grouping and rename stability, connectivity on/off/unavailable, numeric units, intentional-off unknown and invalid-token rejection passed. No MQTT/radio hardware claimed.",
  );
}
try {
  const details = JSON.parse(
    docker(["image", "inspect", "--platform", platform, image]).stdout,
  )[0];
  assert.equal(`${details.Os}/${details.Architecture}`, platform);
  assert.equal(
    details.Config.Labels["org.opencontainers.image.revision"],
    revision,
  );
  docker(["pull", "--platform", platform, haImage], { timeout: 600000 });
  docker([
    "network",
    "create",
    "--internal",
    "--label",
    `rackpad.ha-live=${nonce}`,
    network,
  ]);
  networkCreated = true;
  const config =
    "homeassistant:\n  name: Disposable fixture\n  latitude: 0\n  longitude: 0\n  elevation: 0\n  unit_system: metric\n  time_zone: UTC\nfrontend:\ndemo:\nhttp:\n  server_host: 0.0.0.0\n  server_port: 8123\n";
  run(
    "ha",
    haImage,
    [
      "--network-alias",
      "ha-fixture",
      "--tmpfs",
      "/config:rw,nosuid,size=256m,uid=10001,gid=10001,mode=0700",
      "-e",
      "HOME=/tmp/home",
      "-e",
      "USER=fixture",
      "--entrypoint",
      "python",
    ],
    [
      "-c",
      `import os,pathlib;os.makedirs('/tmp/home',exist_ok=True);pathlib.Path('/config/configuration.yaml').write_text(${JSON.stringify(config)});os.execvp('python',['python','-m','homeassistant','-c','/config','--skip-pip'])`,
    ],
  );
  const runner = run(
    "runner",
    image,
    ["--tmpfs", "/data:rw,nosuid,size=128m,uid=10001,gid=10001,mode=0700"],
    ["node", "-e", "setInterval(()=>{},60000)"],
  );
  const result = docker(["exec", "-i", runner, "node", "--input-type=module"], {
    input: `await (${exercise.toString()})(${JSON.stringify({ password: randomUUID() + randomUUID() })});`,
    allowFailure: true,
  });
  if (result.status !== 0) {
    // A redaction assertion may catch a secret-bearing provider error. Never
    // forward child stderr, source excerpts or assertion payloads to CI logs.
    console.error(`HA collector fixture failed (exit ${result.status}).`);
    throw new Error("HA acceptance did not pass.");
  }
  process.stdout.write(result.stdout);
} finally {
  let failed = false;
  for (const name of containers.reverse()) {
    const r = docker(["rm", "-f", "-v", name], { allowFailure: true });
    if (r.status !== 0 && !r.stderr.includes("No such container"))
      failed = true;
  }
  if (
    networkCreated &&
    docker(["network", "rm", network], { allowFailure: true }).status !== 0
  )
    failed = true;
  if (failed) {
    console.error(`Cleanup incomplete for rackpad.ha-live=${nonce}`);
    process.exitCode = 1;
  }
}

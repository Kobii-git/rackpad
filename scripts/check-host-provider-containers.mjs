import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  exerciseHostProviders,
  provisionKuma,
} from "./fixtures/host-provider-containers.mjs";

const usage =
  "node scripts/check-host-provider-containers.mjs --image sha256:LOCAL_IMAGE_ID --platform linux/amd64|linux/arm64";
const args = process.argv.slice(2),
  options = {};
if (args.length === 1 && args[0] === "--help") {
  console.log(usage);
  process.exit(0);
}
while (args.length) {
  const flag = args.shift();
  assert.ok(
    ["--image", "--platform"].includes(flag) && args[0] && !options[flag],
    usage,
  );
  options[flag] = args.shift();
}
const image = options["--image"],
  platform = options["--platform"];
const includeGlances = existsSync(
  new URL("../server/lib/integrations/providers/glances.ts", import.meta.url),
);
assert.match(image ?? "", /^sha256:[a-f0-9]{64}$/);
assert.ok(["linux/amd64", "linux/arm64"].includes(platform), usage);
// Official v4.5.8-full and v2.5.8 multi-platform releases.
const glancesImage =
  "docker.io/nicolargo/glances@sha256:63823bf68687b42afab3bced830d1f157447c0204476cb7a62cb1e5e65dc292c";
const kumaImage =
  "docker.io/louislam/uptime-kuma@sha256:20abea8c48a163cf0a7a5d5936ab418e4b742d908704e1f58f6c06e56a9c6b67";
const nonce = randomUUID(),
  prefix = `rackpad-host-providers-${nonce}`,
  network = `${prefix}-network`;
const containers = [];
let networkCreated = false;
const credentials = {
  username: "provider-fixture",
  password: randomUUID() + randomUUID(),
};
const glancesPassword = randomUUID() + randomUUID(),
  kumaPassword = randomUUID() + randomUUID();
const isolation = [
  "--platform",
  platform,
  "--label",
  `rackpad.host-provider-test=${nonce}`,
  "--read-only",
  "--tmpfs",
  "/tmp:rw,nosuid",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
];
function docker(args, { input, timeout = 120_000, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input,
    timeout,
    maxBuffer: 2 * 1024 * 1024,
  });
  // Never emit commands, service logs or API bodies that may contain fixture secrets.
  if (!allowFailure && (result.error || result.status !== 0))
    throw new Error(
      `Host provider acceptance: Docker ${args[0]} failed (${result.status ?? "unavailable"}).`,
    );
  return result;
}
function run(label, reference, extra = [], command = []) {
  const name = `${prefix}-${label}-${containers.length}`;
  containers.push(name);
  docker([
    "run",
    "-d",
    "--name",
    name,
    ...isolation,
    "--network",
    network,
    ...extra,
    reference,
    ...command,
  ]);
  return name;
}
function execNode(container, action, input) {
  const result = docker(
    ["exec", "-i", container, "node", "--input-type=module"],
    {
      input: `const value=await (${action.toString()})(${JSON.stringify(input)}); if(value!==undefined)console.log(JSON.stringify(value));`,
      allowFailure: true,
    },
  );
  if (result.error || result.status !== 0) {
    const diagnostic =
      /Kuma setup stage=[a-z]+ timedOut=(?:true|false)|Kuma setup must succeed\.|Kuma login must succeed\.|Kuma must create a real HTTP monitor\.|Kuma must create a real metrics API key\.|Kuma setup timed out\.|Expected real provider reading did not arrive\.|(?:GET|POST) \/api\/[a-zA-Z0-9/_-]+ returned HTTP [0-9]+, expected [0-9,]+\./.exec(
        result.stderr ?? "",
      )?.[0] ?? "No safe diagnostic.";
    throw new Error(
      `Host provider fixture ${action.name} (${input?.phase ?? "setup"}) failed (${result.status}): ${diagnostic}`,
    );
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
}
function wait(app, url) {
  execNode(
    app,
    async (url) => {
      for (let attempt = 0; attempt < 120; attempt++) {
        try {
          if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok)
            return;
        } catch {
          /* Bounded readiness. */
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error("Provider readiness timed out.");
    },
    url,
  );
}
try {
  assert.equal(
    docker(["info", "--format", "{{.OSType}}"]).stdout.trim(),
    "linux",
  );
  const details = JSON.parse(docker(["image", "inspect", image]).stdout)[0];
  assert.equal(`${details.Os}/${details.Architecture}`, platform);
  for (const reference of [
    ...(includeGlances ? [glancesImage] : []),
    kumaImage,
  ])
    docker(["pull", "--platform", platform, reference], { timeout: 600_000 });
  docker([
    "network",
    "create",
    "--internal",
    "--label",
    `rackpad.host-provider-test=${nonce}`,
    network,
  ]);
  networkCreated = true;
  const app = run("app", image, [
    "--tmpfs",
    "/data:rw,nosuid,uid=10001,gid=10001,mode=0700,size=128m",
    "-e",
    `RACKPAD_SECRET_KEY=${randomUUID() + randomUUID()}`,
    "-e",
    "OUI_AUTO_UPDATE=0",
    "-e",
    "OIDC_ENABLED=0",
    "-e",
    "SNMP_TRAP_ENABLED=0",
    "-e",
    "MCP_ENABLED=0",
    "-e",
    "TRUST_PROXY=0",
  ]);
  wait(app, "http://127.0.0.1:3000/api/health");
  const peer = run(
    "peer",
    image,
    [
      "--network-alias",
      "host-health-peer",
      "--tmpfs",
      "/data:rw,uid=10001,gid=10001,mode=0700",
    ],
    [
      "node",
      "--input-type=module",
      "-e",
      "import http from 'node:http';http.createServer((req,res)=>{res.writeHead(200);res.end('fixture');}).listen(8787,'0.0.0.0');",
    ],
  );
  wait(app, "http://host-health-peer:8787/health");
  const glances = includeGlances
    ? run(
        "glances",
        glancesImage,
        [
          "--network-alias",
          "glances-fixture",
          "--hostname",
          "glances-fixture",
          "--user",
          "10001:10001",
          "-e",
          "HOME=/tmp/home",
          "-e",
          "USER=reader",
          "-e",
          `FIXTURE_PASSWORD=${glancesPassword}`,
          "--entrypoint",
          "python",
        ],
        [
          "-c",
          "import os;os.makedirs('/tmp/home',exist_ok=True);from glances.password import GlancesPassword;p=GlancesPassword(username='reader');p.save_password(p.hash_password(p.get_hash(os.environ['FIXTURE_PASSWORD'])));os.execvp('glances',['glances','-w','--disable-webui','--password','-u','reader','-B','0.0.0.0'])",
        ],
      )
    : null;
  const kuma = run("kuma", kumaImage, [
    "--network-alias",
    "kuma-fixture",
    "--user",
    "1000:1000",
    "-e",
    "UPTIME_KUMA_DB_TYPE=sqlite",
    "--tmpfs",
    "/app/data:rw,nosuid,uid=1000,gid=1000,mode=0700",
  ]);
  wait(app, "http://kuma-fixture:3001/");
  // Authenticated Glances readiness is checked by the real API, not a public page.
  if (includeGlances)
    execNode(
      app,
      async (password) => {
        for (let attempt = 0; attempt < 120; attempt++) {
          try {
            if (
              (
                await fetch("http://glances-fixture:61208/api/4/system", {
                  headers: {
                    authorization: `Basic ${Buffer.from(`reader:${password}`).toString("base64")}`,
                  },
                  signal: AbortSignal.timeout(1000),
                })
              ).ok
            )
              return;
          } catch {
            /* Wait. */
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw new Error("Authenticated Glances did not become ready.");
      },
      glancesPassword,
    );
  const kumaKey = execNode(kuma, provisionKuma, { password: kumaPassword });
  const fixture = { credentials, glancesPassword, kumaKey, includeGlances };
  const state = execNode(app, exerciseHostProviders, {
    ...fixture,
    phase: "collect",
  });
  console.log(
    `Host provider acceptance: real ${includeGlances ? "Glances Basic/JWT and " : ""}Kuma metrics collected through saved Rackpad connections; explicit bindings retained.`,
  );
  docker(["stop", "-t", "15", peer]);
  execNode(app, exerciseHostProviders, {
    ...fixture,
    state,
    phase: "kuma-down",
  });
  if (glances) {
    docker(["stop", "-t", "15", glances]);
    execNode(app, exerciseHostProviders, {
      ...fixture,
      state,
      phase: "glances-down",
    });
  }
  console.log(
    `Host provider acceptance ${platform}: live Kuma healthy-to-unhealthy, ${includeGlances ? "Glances outage/unknown and wrong credentials, " : ""}stable identities and sanitized errors passed. Container metrics are not physical-host acceptance.`,
  );
  // Reference retained so cleanup covers even a failed service start.
  assert.ok(kuma);
} finally {
  let cleanupFailed = false;
  for (const name of containers.reverse()) {
    const result = docker(["rm", "-f", "-v", name], {
      allowFailure: true,
      timeout: 30_000,
    });
    if (result.status !== 0 && !result.stderr?.includes("No such container"))
      cleanupFailed = true;
  }
  if (
    networkCreated &&
    docker(["network", "rm", network], { allowFailure: true, timeout: 30_000 })
      .status !== 0
  )
    cleanupFailed = true;
  if (cleanupFailed) {
    console.error(
      `Host provider cleanup incomplete; inspect only resources labelled rackpad.host-provider-test=${nonce}.`,
    );
    process.exitCode = 1;
  }
}

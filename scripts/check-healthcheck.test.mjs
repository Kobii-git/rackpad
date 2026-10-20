import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import YAML from "yaml";
import { resolveRuntimeConfig } from "../server/lib/runtime-config.ts";

const readSource = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const dockerfile = readSource("Dockerfile").replace(/\\\r?\n\s*/g, " ");
const dockerHealthcheck = dockerfile.match(
  /^HEALTHCHECK (.+?) CMD node -e ("[^"\r\n]*")$/m,
);
assert(dockerHealthcheck, "Dockerfile must define a self-contained Node healthcheck");
assert.equal(
  dockerHealthcheck[1].trim(),
  "--interval=30s --timeout=5s --start-period=10s --retries=3",
);
const probes = new Map([["Dockerfile", JSON.parse(dockerHealthcheck[2])]]);

for (const file of [
  "docker-compose.yml",
  "docker-compose.release.yml",
  "docker-compose.host-discovery.yml",
]) {
  const { healthcheck } = YAML.parse(readSource(file)).services.rackpad;
  assert.deepEqual(healthcheck.test.slice(0, 3), ["CMD", "node", "-e"], file);
  assert.equal(healthcheck.test.length, 4, file);
  assert.deepEqual(
    { ...healthcheck, test: undefined },
    { test: undefined, interval: "30s", timeout: "5s", retries: 3, start_period: "10s" },
    file,
  );
  probes.set(file, healthcheck.test[3]);
}

// Execute the shipped expressions with isolated environment, HTTP and exit stubs.
// No Rackpad process, database, real endpoint or inherited environment is used.
async function executeProbe(code, environment, { status = 200, available = true } = {}) {
  const requests = [];
  const exits = [];
  await vm.runInNewContext(code, {
    process: { env: environment, exit: (value) => { exits.push(value); } },
    fetch: async (url) => {
      requests.push(url);
      if (!available) throw new Error("Connection refused in healthcheck fixture");
      return { ok: status >= 200 && status < 300 };
    },
  }, { timeout: 1000 });
  return { requests, exits };
}

async function assertProbe(code, environment, response, expectedExit = 0) {
  const result = await executeProbe(code, environment, response);
  assert.deepEqual(
    result.requests,
    [`http://127.0.0.1:${resolveRuntimeConfig(environment).port}/api/health`],
    "healthcheck target must match the server's listening port",
  );
  assert.deepEqual(result.exits, [expectedExit], "healthcheck must exit exactly once");
}

for (const [file, code] of probes) {
  test(`${file}: healthcheck follows runtime PORT normalization`, { timeout: 5000 }, async () => {
    await assertProbe(code, {});
    for (const PORT of [
      "", " ", "3000", "3006", " 3006 ", "03006", "0xbb8", "3e3",
      "invalid", "3006/path", "0", "-1", "1.5", "NaN", "Infinity",
      "9007199254740992",
    ]) {
      await assertProbe(code, { PORT });
    }
    // The published host port must not replace the container's listening port.
    await assertProbe(code, { RACKPAD_PORT: "3006", PORT: "3000" });
  });

  test(`${file}: healthcheck preserves HTTP success and failure exits`, { timeout: 5000 }, async () => {
    for (const PORT of ["3000", "3006"]) {
      for (const status of [200, 204, 404, 503]) {
        await assertProbe(code, { PORT }, { status }, status < 300 ? 0 : 1);
      }
      await assertProbe(code, { PORT }, { available: false }, 1);
    }
  });
}

test("custom-port assertion rejects the original hardcoded healthcheck", async () => {
  const original = "fetch('http://127.0.0.1:3000/api/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))";
  await assertProbe(original, { PORT: "3000" });
  await assert.rejects(assertProbe(original, { PORT: "3006" }), {
    name: "AssertionError",
    message: /healthcheck target must match the server's listening port/,
  });
});

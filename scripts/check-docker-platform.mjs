import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

function output(args) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 256 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error("Docker platform preflight could not inspect the selected Docker client and daemon.");
  }
}

assert.match(output(["image", "inspect", "--help"]), /--platform(?:\s|=|$)/,
  "Docker image inspect must support --platform; install a current stable Docker client.");
const versions = output(["version", "--format", "{{.Client.APIVersion}} {{.Server.APIVersion}}"]);
const match = /^(\d+)\.(\d+) (\d+)\.(\d+)$/.exec(versions);
assert.ok(match, "Docker platform preflight could not read both API versions.");
for (const offset of [1, 3]) {
  const major = Number(match[offset]), minor = Number(match[offset + 1]);
  assert.ok(major > 1 || (major === 1 && minor >= 49),
    "Docker platform inspection requires client and daemon API 1.49 or newer.");
}
console.log(`Docker platform preflight passed (client/daemon API ${versions}).`);

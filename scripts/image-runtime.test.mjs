import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertPatchedImageRuntime } from "./image-runtime.mjs";

test("candidate image rejects affected, unsupported and malformed runtime versions", () => {
  for (const version of ["22.23.2", "22.23.3", "22.22.9", "20.99.9", "24.22.1", "22.23.4-rc.1", "22.23.4\n", "invalid"])
    assert.throws(() => assertPatchedImageRuntime(version));
  for (const version of ["22.23.4", "22.23.5", "22.24.0"])
    assert.doesNotThrow(() => assertPatchedImageRuntime(version));
});

test("every Node Docker stage uses the patched base", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const stages = [...dockerfile.matchAll(/^FROM .*node:(\d+\.\d+\.\d+)-trixie-slim AS (\S+)$/gm)];
  assert.deepEqual(stages.map(match => match[2]), ["deps", "prod-deps", "runtime"]);
  for (const match of stages) assertPatchedImageRuntime(match[1]);
});

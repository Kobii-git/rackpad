import assert from "node:assert/strict";

// Node 22.23.4 includes the October 2026 Brotli security fix.
export function assertPatchedImageRuntime(version) {
  assert.match(version, /^22\.\d+\.\d+$/u, "Candidate image must use a supported Node 22 release.");
  const [, minor, patch] = version.split(".").map(Number);
  assert.ok(minor > 23 || (minor === 23 && patch >= 4), "Candidate image requires Node 22.23.4 or newer.");
}

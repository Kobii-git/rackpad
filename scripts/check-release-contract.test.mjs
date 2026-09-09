import assert from "node:assert/strict";
import test from "node:test";
import { classifyReleaseTag } from "./check-release-contract.mjs";

test("classifies a stable SemVer tag for main", () => {
  assert.deepEqual(classifyReleaseTag("v1.8.1", "1.8.1"), {
    prerelease: false,
    expectedBranch: "main",
    version: "1.8.1",
  });
});

test("classifies a prerelease SemVer tag for beta", () => {
  assert.deepEqual(classifyReleaseTag("v1.8.1-beta.1", "1.8.1-beta.1"), {
    prerelease: true,
    expectedBranch: "beta",
    version: "1.8.1-beta.1",
  });
});

test("rejects a tag and package version mismatch", () => {
  assert.throws(
    () => classifyReleaseTag("v1.8.1", "1.8.0"),
    /does not match package\.json version/,
  );
});

test("rejects non-SemVer and leading-zero prerelease tags", () => {
  assert.throws(
    () => classifyReleaseTag("v1.8", "1.8"),
    /not a valid v-prefixed SemVer/,
  );
  assert.throws(
    () => classifyReleaseTag("v1.8.1-beta.01", "1.8.1-beta.01"),
    /leading zero/,
  );
});

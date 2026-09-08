import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { headingAnchors, inspectOperatorDocs } from "./check-operator-docs.mjs";

test("GitHub heading punctuation and duplicate anchors", () => {
  assert.deepEqual([...headingAnchors("## Before upgrading to 1.8.2 beta\n## Test\n## Test\n")], ["before-upgrading-to-182-beta", "test", "test-1"]);
});
test("operator checks detect broken examples and links while retaining release history", () => {
  const root = mkdtempSync(path.join(tmpdir(), "rackpad-docs-test-"));
  try {
    mkdirSync(path.join(root, "docs/releases"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.8.2-beta.6", scripts: { check: "test" } }));
    for (const name of ["README", "INSTALL", "CONTRIBUTING", "SECURITY", "STYLE_NOTES"]) writeFileSync(path.join(root, `${name}.md`), "# Guide\n");
    writeFileSync(path.join(root, "INSTALL.md"), "# Install\nCurrent stable release: `v1.8.0`\n");
    writeFileSync(path.join(root, "docs/releases/old.md"), "Current stable release: `v0.1.0`\n");
    assert.deepEqual(inspectOperatorDocs(root), []);
    writeFileSync(path.join(root, "README.md"), "Stable: **v1.7.3**\n[bad](INSTALL.md#absent)\n[missing](missing.md)\nhttps://github.com/your-org/rackpad\nnpm run absent\n");
    const failures = inspectOperatorDocs(root).join("\n");
    for (const expected of ["placeholder", "unknown package command", "missing link", "missing anchor", "stable reference"]) assert(failures.includes(expected));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

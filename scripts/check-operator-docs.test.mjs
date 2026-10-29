import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { headingAnchors, inspectOperatorDocs } from "./check-operator-docs.mjs";

test("GitHub heading punctuation and duplicate anchors", () => {
  assert.deepEqual([...headingAnchors("## Before upgrading to 1.8.2 beta\n## Test\n## Test\n")], ["before-upgrading-to-182-beta", "test", "test-1"]);
  assert.deepEqual([...headingAnchors("## <span>Storage</span>\n## <scr<script>ipt>\n")], ["storage", "ipt"]);
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


test("current candidate schema is checked without rewriting historical releases", () => {
  const root = mkdtempSync(path.join(tmpdir(), "rackpad-current-schema-"));
  try {
    mkdirSync(path.join(root, "docs/releases"), {recursive:true});
    mkdirSync(path.join(root, "server"));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({version:"1.8.6-beta.1",scripts:{}}));
    for (const name of ["README","INSTALL","CONTRIBUTING","SECURITY","STYLE_NOTES"]) writeFileSync(path.join(root, `${name}.md`), "# Guide\n");
    writeFileSync(path.join(root,"INSTALL.md"),"Current stable release: `v1.8.5`\n");
    writeFileSync(path.join(root,"README.md"),"This branch prepares **v1.8.6-beta.1**\n");
    writeFileSync(path.join(root,"server/schema-version.ts"),"export const CURRENT_SCHEMA_VERSION = 57;\n");
    writeFileSync(path.join(root,"docs/releases/v1.8.5.md"),"Schema is **55**.\n");
    const current=path.join(root,"docs/releases/v1.8.6-beta.1.md");
    writeFileSync(current,"Schema is **55**.\n");
    assert.match(inspectOperatorDocs(root).join("\n"), /Current release schema/);
    writeFileSync(current,"Schema is **57**.\n");
    assert.deepEqual(inspectOperatorDocs(root), []);
  } finally {rmSync(root,{recursive:true,force:true});}
});

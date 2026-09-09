import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateAiDocs } from "./check-ai-docs.mjs";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rackpad-ai-docs-"));
  mkdirSync(path.join(root, "docs"), { recursive: true });
  mkdirSync(path.join(root, "server/lib"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { lint: "eslint ." } }),
  );
  writeFileSync(path.join(root, "docs/target.md"), "# Target\n");
  writeFileSync(
    path.join(root, "server/lib/guard.ts"),
    "export function criticalGuard() {}\n",
  );
  writeFileSync(
    path.join(root, "AGENTS.md"),
    [
      "# Fixture",
      "",
      "Run `npm run lint`.",
      "Read [target](docs/target.md).",
      "Inspect `server/lib/guard.ts`.",
      "`criticalGuard` from `server/lib/guard.ts`.",
    ].join("\n"),
  );
  return root;
}

function validate(root) {
  return validateAiDocs({
    root,
    requiredDocs: ["AGENTS.md"],
    criticalSymbolClaims: [
      {
        symbol: "criticalGuard",
        sourcePath: "server/lib/guard.ts",
        docPath: "AGENTS.md",
        documentationClaim: "`criticalGuard` from `server/lib/guard.ts`",
      },
    ],
  });
}

test("accepts valid scripts, links, source paths, and critical symbols", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(validate(root), []);
});

test("accepts explicitly documented local-only paths", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    path.join(root, "AGENTS.md"),
    readFileSync(path.join(root, "AGENTS.md"), "utf8") +
      "\nKeep `.ai/local/` out of repository source.\n",
  );
  assert.deepEqual(validate(root), []);
});

test("rejects a missing required document", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.match(
    validateAiDocs({
      root,
      requiredDocs: ["MISSING.md"],
      criticalSymbolClaims: [],
    }).join("\n"),
    /missing MISSING\.md/,
  );
});

test("rejects an unknown package script", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "AGENTS.md"), "Run `npm run missing`.\n");
  assert.match(validate(root).join("\n"), /missing package script missing/);
});

test("rejects broken Markdown and repository paths", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    path.join(root, "AGENTS.md"),
    "Read [missing](docs/missing.md) and `server/lib/missing.ts`.\n",
  );
  const failures = validate(root).join("\n");
  assert.match(failures, /broken link docs\/missing\.md/);
  assert.match(
    failures,
    /missing repository path server\/lib\/missing\.ts/,
  );
});

test("rejects a critical symbol moved away from its declared source", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    path.join(root, "server/lib/guard.ts"),
    "export const other = true;\n",
  );
  assert.match(
    validate(root).join("\n"),
    /critical symbol criticalGuard is missing/,
  );
});

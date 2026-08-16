#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredDocs = [
  "AGENTS.md",
  "CLAUDE.md",
  ".ai/INDEX.md",
  ".ai/GUARDRAILS.md",
  ".ai/ARCHITECTURE.md",
  ".ai/COMMANDS.md",
  ".ai/SECURITY.md",
  ".ai/TESTING.md",
  ".ai/DATA_MODEL.md",
  ".ai/DEPLOYMENT.md",
  ".ai/KNOWN_RISKS.md",
  ".ai/DECISIONS.md",
  ".ai/REVIEW_CHECKLIST.md",
];
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const failures = [];

for (const relativeFile of requiredDocs) {
  const absoluteFile = path.join(root, relativeFile);
  if (!existsSync(absoluteFile)) {
    failures.push(`missing ${relativeFile}`);
    continue;
  }
  const source = readFileSync(absoluteFile, "utf8");
  for (const match of source.matchAll(/`npm run ([a-z0-9:_-]+)`/g)) {
    if (!(match[1] in packageJson.scripts)) {
      failures.push(`${relativeFile} references missing package script ${match[1]}`);
    }
  }
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    if (!existsSync(path.resolve(path.dirname(absoluteFile), target))) {
      failures.push(`${relativeFile} contains broken link ${match[1]}`);
    }
  }
  for (const match of source.matchAll(/`([^`\n]+\.md)`/g)) {
    const target = match[1].split("#", 1)[0];
    const candidates = [
      path.resolve(path.dirname(absoluteFile), target),
      path.resolve(root, target),
    ];
    if (!candidates.some((candidate) => existsSync(candidate))) {
      failures.push(`${relativeFile} references missing Markdown path ${target}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`AI documentation contract failed:\n- ${failures.join("\n- ")}`);
}

console.log(`AI documentation contract valid: ${requiredDocs.length} required files and package-script references checked.`);

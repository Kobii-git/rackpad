#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

export const requiredAiDocs = [
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

export const criticalAiSymbolClaims = [
  {
    symbol: "requireAdmin",
    sourcePath: "server/lib/auth.ts",
    docPath: ".ai/GUARDRAILS.md",
    documentationClaim: "`requireAdmin` from `server/lib/auth.ts`",
  },
  {
    symbol: "assertLabWrite",
    sourcePath: "server/lib/lab-access.ts",
    docPath: ".ai/GUARDRAILS.md",
    documentationClaim:
      "`assertGlobalAdmin`, `assertLabRead`, `assertLabWrite`, and row-based variants from `server/lib/lab-access.ts`",
  },
  {
    symbol: "requestPinnedUrl",
    sourcePath: "server/lib/net-guard.ts",
    docPath: ".ai/GUARDRAILS.md",
    documentationClaim: "`requestPinnedUrl` in `server/lib/net-guard.ts`",
  },
  {
    symbol: "CURRENT_SCHEMA_VERSION",
    sourcePath: "server/schema-version.ts",
    docPath: ".ai/DATA_MODEL.md",
    documentationClaim:
      "`CURRENT_SCHEMA_VERSION` in `server/schema-version.ts`",
  },
];

const repositoryPathRoots = [
  ".ai/",
  ".github/",
  "deploy/",
  "docs/",
  "e2e/",
  "scripts/",
  "server/",
  "src/",
];
const repositoryRootFiles = new Set([
  ".dockerignore",
  ".env.example",
  ".gitignore",
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "Dockerfile",
  "INSTALL.md",
  "LICENSE",
  "README.md",
  "docker-compose.host-discovery.yml",
  "docker-compose.release.yml",
  "docker-compose.yml",
  "eslint.config.mjs",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "playwright.screenshots.config.ts",
  "tsconfig.json",
  "tsconfig.server.json",
  "tsconfig.test.json",
]);

function resolveDocumentedPath(root, docPath, target) {
  const withoutAnchor = target.split("#", 1)[0];
  if (!withoutAnchor) return null;
  const candidates = [
    path.resolve(path.dirname(path.join(root, docPath)), withoutAnchor),
    path.resolve(root, withoutAnchor),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function repositoryReferenceTarget(token) {
  if (repositoryRootFiles.has(token)) return token;
  if (!repositoryPathRoots.some((prefix) => token.startsWith(prefix))) {
    return null;
  }
  if (/\s|^(?:https?:|mailto:)/.test(token)) return null;
  return token;
}

function globAnchor(target) {
  const wildcardIndex = target.search(/[?*[]/);
  if (wildcardIndex === -1) return target;
  const prefix = target.slice(0, wildcardIndex);
  return prefix.endsWith("/") ? prefix : path.dirname(prefix);
}

function normalizedProse(source) {
  return source.replace(/\s+/g, " ").trim();
}

export function validateAiDocs({
  root = defaultRoot,
  requiredDocs = requiredAiDocs,
  criticalSymbolClaims = criticalAiSymbolClaims,
} = {}) {
  const packageJson = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
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
        failures.push(
          `${relativeFile} references missing package script ${match[1]}`,
        );
      }
    }
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:)/.test(target)) continue;
      if (!resolveDocumentedPath(root, relativeFile, target)) {
        failures.push(`${relativeFile} contains broken link ${target}`);
      }
    }
    for (const match of source.matchAll(/`([^`\n]+)`/g)) {
      const target = repositoryReferenceTarget(match[1].split("#", 1)[0]);
      if (!target) continue;
      const anchor = globAnchor(target);
      if (!existsSync(path.resolve(root, anchor))) {
        failures.push(
          `${relativeFile} references missing repository path ${target}`,
        );
      }
    }
  }

  for (const claim of criticalSymbolClaims) {
    const sourcePath = path.join(root, claim.sourcePath);
    const docPath = path.join(root, claim.docPath);
    if (!existsSync(sourcePath)) {
      failures.push(
        `critical symbol ${claim.symbol} references missing source ${claim.sourcePath}`,
      );
      continue;
    }
    if (
      !new RegExp(`\\b${claim.symbol}\\b`).test(
        readFileSync(sourcePath, "utf8"),
      )
    ) {
      failures.push(
        `critical symbol ${claim.symbol} is missing from ${claim.sourcePath}`,
      );
    }
    if (
      !existsSync(docPath) ||
      !normalizedProse(readFileSync(docPath, "utf8")).includes(
        normalizedProse(claim.documentationClaim),
      )
    ) {
      failures.push(
        `${claim.docPath} is missing critical claim ${claim.documentationClaim}`,
      );
    }
  }

  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const failures = validateAiDocs();
  if (failures.length > 0) {
    throw new Error(
      `AI documentation contract failed:\n- ${failures.join("\n- ")}`,
    );
  }
  console.log(
    `AI documentation contract valid: ${requiredAiDocs.length} required files, repository paths, package scripts, and critical symbol claims checked.`,
  );
}

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patterns = new Set(
  readFileSync(path.join(root, ".dockerignore"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")),
);

const requiredPatterns = [
  ".ai/local/",
  ".claude/",
  ".cache",
  ".env",
  ".env.*",
  ".git",
  ".github",
  ".tsbuild",
  "*.db",
  "*.db-shm",
  "*.db-wal",
  "*.key",
  "*.pem",
  "*.pfx",
  "coverage",
  "dist",
  "dist-server",
  "docs/reference-standard-analysis/",
  "node_modules",
  "rackpad-backup-*.json",
  "test-results/",
];
const missing = requiredPatterns.filter((pattern) => !patterns.has(pattern));

if (missing.length > 0) {
  throw new Error(`.dockerignore is missing required safety patterns: ${missing.join(", ")}`);
}

console.log(`.dockerignore safety contract valid: ${requiredPatterns.length} required patterns present.`);

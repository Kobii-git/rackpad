#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const translationsPath = join(root, "src/i18n/translations.ts");
const localesDir = join(root, "src/i18n/locales");

function parseObjectBody(body) {
  const entries = new Map();
  const regex = /^\s*"((?:\\.|[^"\\])*)"\s*:\s*"((?:\\.|[^"\\])*)"\s*,?\s*$/gm;
  let match;
  while ((match = regex.exec(body)) !== null) {
    entries.set(JSON.parse(`"${match[1]}"`), JSON.parse(`"${match[2]}"`));
  }
  return entries;
}

function escapeString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildLocaleObject(existing, exportName) {
  const lines = [`import type { TranslationMap } from "../translations";`, "", `export const ${exportName} = {`];
  for (const [key, fallback] of enEntries) {
    const value = existing.get(key) ?? fallback;
    lines.push(`  "${escapeString(key)}": "${escapeString(value)}",`);
  }
  lines.push("} satisfies TranslationMap;", "");
  return lines.join("\n");
}

const source = readFileSync(translationsPath, "utf8");
const enMatch = source.match(/export const en = \{([\s\S]*?)\} as const;/);
if (!enMatch) throw new Error("Could not parse en dictionary");
const enEntries = parseObjectBody(enMatch[1]);

for (const file of readdirSync(localesDir)) {
  if (!file.endsWith(".ts")) continue;
  const path = join(localesDir, file);
  const content = readFileSync(path, "utf8");
  const exportMatch = content.match(/export const (\w+) = \{/);
  if (!exportMatch) continue;
  const existing = parseObjectBody(content);
  writeFileSync(path, buildLocaleObject(existing, exportMatch[1]));
  console.log(`Synced ${file}`);
}

console.log(`Done (${enEntries.size} keys)`);

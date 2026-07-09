#!/usr/bin/env node
/**
 * Detect wrong-language i18n values: French copies in non-fr locales and marker hits.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const translationsPath = join(root, "src/i18n/base.ts");
const localesDir = join(root, "src/i18n/locales");

const FRENCH_MARKERS = [
  "sans fil",
  "diffusé",
  "diffusés",
  "réseau",
  "réseaux",
  "câble",
  "échec",
  "activer",
  "désactiver",
  "métadonnées",
  "point d'accès",
  "points d'accès",
  "canaux",
  "associé",
  "associés",
  "aucun",
  "reçu",
  "rapport d'inventaire",
  "surveillance",
  "équipement",
  "équipements",
];

function parseObjectBody(body) {
  const entries = new Map();
  const regex = /^\s*"((?:\\.|[^"\\])*)"\s*:\s*"((?:\\.|[^"\\])*)"\s*,?\s*$/gm;
  let match;
  while ((match = regex.exec(body)) !== null) {
    entries.set(JSON.parse(`"${match[1]}"`), JSON.parse(`"${match[2]}"`));
  }
  return entries;
}

function extractBlock(source, exportName) {
  const re = new RegExp(`export const ${exportName} = \\{([\\s\\S]*?)\\} ${exportName === "en" ? "as const;" : "satisfies TranslationMap;"}`);
  const match = source.match(re);
  if (!match) throw new Error(`Could not parse ${exportName}`);
  return match[1];
}

function markerHit(value) {
  const normalized = value.toLocaleLowerCase("fr-FR");
  return FRENCH_MARKERS.find((m) => normalized.includes(m));
}

const source = readFileSync(translationsPath, "utf8");
const en = parseObjectBody(extractBlock(source, "en"));
const fr = parseObjectBody(readFileSync(join(localesDir, "fr.ts"), "utf8"));

const findings = [];

function checkLocale(locale, entries) {
  if (locale === "fr") return;
  for (const [key, value] of entries) {
    const enValue = en.get(key);
    const frValue = fr.get(key);
    const exactFrenchHit = frValue && value === frValue && value !== enValue && markerHit(value);
    if (exactFrenchHit) {
      findings.push({ locale, key, value, reason: "matches-fr" });
      continue;
    }
    if (locale !== "fr") {
      const hit = markerHit(value);
      if (hit) findings.push({ locale, key, value, reason: `marker:${hit}` });
    }
  }
}

checkLocale("en", en);

for (const file of readdirSync(localesDir)) {
  if (!file.endsWith(".ts")) continue;
  const locale = file.replace(/\.ts$/, "");
  const content = readFileSync(join(localesDir, file), "utf8");
  const entries = parseObjectBody(content);
  const missing = [...en.keys()].filter((key) => !entries.has(key));
  const extra = [...entries.keys()].filter((key) => !en.has(key));
  for (const key of missing) findings.push({ locale, key, value: "", reason: "missing-key" });
  for (const key of extra) findings.push({ locale, key, value: entries.get(key), reason: "extra-key" });
  checkLocale(locale, entries);
}

const i18nRuntime = readFileSync(join(root, "src/i18n/index.tsx"), "utf8");
if (/MutationObserver|translateStaticDom|translateTextNodes/.test(i18nRuntime)) {
  findings.push({ locale: "runtime", key: "DOM translator", value: "", reason: "unsafe-dom-translation" });
}
if (/^import[\s\S]*?from\s+["']\.\/locales\//m.test(i18nRuntime)) {
  findings.push({ locale: "runtime", key: "locale imports", value: "", reason: "eager-locale-import" });
}

function scanUiDirectory(directory) {
  for (const name of readdirSync(directory)) {
    const filePath = join(directory, name);
    if (statSync(filePath).isDirectory()) {
      scanUiDirectory(filePath);
      continue;
    }
    if (!filePath.endsWith(".tsx")) continue;
    const content = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const skippedTags = new Set(["code", "pre", "kbd", "samp", "script", "style"]);
    function tagName(element) {
      return (element?.openingElement?.tagName ?? element?.tagName)?.getText().toLowerCase() ?? "";
    }
    function visit(node) {
      if (ts.isJsxText(node) && node.parent?.children?.length === 1) {
        const value = node.getText(sourceFile).replace(/\s+/g, " ").trim();
        if (/[\p{L}]/u.test(value) && !skippedTags.has(tagName(node.parent))) {
          findings.push({ locale: "ui", key: filePath.slice(root.length + 1), value, reason: "untranslated-jsx" });
        }
      }
      if (
        ts.isJsxAttribute(node) &&
        ["placeholder", "title", "aria-label", "alt"].includes(node.name.getText()) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        /[\p{L}]/u.test(node.initializer.text)
      ) {
        findings.push({
          locale: "ui",
          key: filePath.slice(root.length + 1),
          value: node.initializer.text,
          reason: `untranslated-${node.name.getText()}`,
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
}
scanUiDirectory(join(root, "src"));

if (findings.length === 0) {
  console.log("No i18n value contamination found.");
  process.exit(0);
}

for (const f of findings) {
  console.log(`${f.locale} | ${f.key} | ${f.value}`);
}
console.error(`\n${findings.length} i18n value issue(s) found.`);
process.exit(1);

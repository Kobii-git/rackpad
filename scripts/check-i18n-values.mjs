#!/usr/bin/env node
/**
 * Detect wrong-language i18n values: French copies in non-fr locales and marker hits.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const translationsPath = join(root, "src/i18n/translations.ts");
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

const INLINE_LOCALES = ["en", "fr", "zh", "es", "hi", "ar", "ja"];

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
const fr = parseObjectBody(extractBlock(source, "fr"));

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

for (const locale of INLINE_LOCALES) {
  checkLocale(locale, parseObjectBody(extractBlock(source, locale)));
}

for (const file of readdirSync(localesDir)) {
  if (!file.endsWith(".ts")) continue;
  const locale = file.replace(/\.ts$/, "");
  const content = readFileSync(join(localesDir, file), "utf8");
  checkLocale(locale, parseObjectBody(content));
}

if (findings.length === 0) {
  console.log("No i18n value contamination found.");
  process.exit(0);
}

for (const f of findings) {
  console.log(`${f.locale} | ${f.key} | ${f.value}`);
}
console.error(`\n${findings.length} i18n value issue(s) found.`);
process.exit(1);

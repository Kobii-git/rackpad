#!/usr/bin/env node
/** Validate locale parity, translation quality, placeholders, and explicit UI copy. */
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const translationsPath = join(root, "src/i18n/base.ts");
const localesDir = join(root, "src/i18n/locales");
const allowlistPath = join(root, "src/i18n/same-as-english-allowlist.json");
const visibleProps = new Set([
  "alt",
  "aria-label",
  "body",
  "description",
  "emptyText",
  "eyebrow",
  "heading",
  "hint",
  "label",
  "placeholder",
  "subtitle",
  "title",
]);
const skippedTags = new Set(["code", "pre", "kbd", "samp", "script", "style"]);
const findings = [];

function parseTranslationMap(source, fileName, exportName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        exportName &&
        (!ts.isIdentifier(declaration.name) ||
          declaration.name.text !== exportName)
      ) {
        continue;
      }
      let initializer = declaration.initializer;
      while (
        initializer &&
        (ts.isAsExpression(initializer) ||
          ts.isSatisfiesExpression(initializer))
      ) {
        initializer = initializer.expression;
      }
      if (!initializer || !ts.isObjectLiteralExpression(initializer)) continue;
      const entries = new Map();
      for (const property of initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = ts.isIdentifier(property.name)
          ? property.name.text
          : ts.isStringLiteral(property.name)
            ? property.name.text
            : null;
        if (key == null || !ts.isStringLiteral(property.initializer)) continue;
        entries.set(key, property.initializer.text);
      }
      return entries;
    }
  }
  throw new Error(`Could not parse translation map in ${fileName}`);
}

function placeholders(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

const en = parseTranslationMap(
  readFileSync(translationsPath, "utf8"),
  translationsPath,
  "en",
);
const allowlistEntries = JSON.parse(readFileSync(allowlistPath, "utf8"));
if (!Array.isArray(allowlistEntries))
  throw new Error("The i18n allowlist must be an array.");
const allowlist = new Map();
for (const entry of allowlistEntries) {
  if (
    !entry ||
    typeof entry.key !== "string" ||
    typeof entry.reason !== "string" ||
    !entry.reason.trim()
  ) {
    throw new Error(
      "Each i18n allowlist entry needs a key and a non-empty reason.",
    );
  }
  if (!en.has(entry.key))
    throw new Error(`Unknown i18n allowlist key: ${entry.key}`);
  const locales = Array.isArray(entry.locales) ? new Set(entry.locales) : null;
  if (!allowlist.has(entry.key) || locales === null) {
    allowlist.set(entry.key, locales);
  } else {
    const existingLocales = allowlist.get(entry.key);
    if (existingLocales !== null) {
      for (const locale of locales) existingLocales.add(locale);
    }
  }
}

function sameAsEnglishAllowed(key, locale) {
  if (!allowlist.has(key)) return false;
  const locales = allowlist.get(key);
  return locales === null || locales.has(locale);
}

for (const file of readdirSync(localesDir)) {
  if (!file.endsWith(".ts")) continue;
  const locale = file.replace(/\.ts$/, "");
  const localePath = join(localesDir, file);
  const entries = parseTranslationMap(
    readFileSync(localePath, "utf8"),
    localePath,
  );
  for (const key of en.keys()) {
    if (!entries.has(key)) {
      findings.push({ locale, key, value: "", reason: "missing-key" });
      continue;
    }
    const value = entries.get(key);
    const enValue = en.get(key);
    if (
      /[\p{L}]/u.test(value) &&
      value === enValue &&
      !sameAsEnglishAllowed(key, locale)
    ) {
      findings.push({ locale, key, value, reason: "same-as-english" });
    }
    if (placeholders(value).join("|") !== placeholders(enValue).join("|")) {
      findings.push({ locale, key, value, reason: "placeholder-mismatch" });
    }
  }
  for (const [key, value] of entries) {
    if (!en.has(key))
      findings.push({ locale, key, value, reason: "extra-key" });
  }
}

const i18nRuntime = readFileSync(join(root, "src/i18n/index.tsx"), "utf8");
if (
  /MutationObserver|translateStaticDom|translateTextNodes/.test(i18nRuntime)
) {
  findings.push({
    locale: "runtime",
    key: "DOM translator",
    value: "",
    reason: "unsafe-dom-translation",
  });
}
if (/^import[\s\S]*?from\s+["']\.\/locales\//m.test(i18nRuntime)) {
  findings.push({
    locale: "runtime",
    key: "locale imports",
    value: "",
    reason: "eager-locale-import",
  });
}

function scanUiDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      scanUiDirectory(filePath);
      continue;
    }
    if (!entry.isFile() || !filePath.endsWith(".tsx")) continue;

    let descriptor;
    try {
      descriptor = openSync(
        filePath,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
    } catch (error) {
      if (error?.code === "ELOOP") continue;
      throw error;
    }

    let content;
    try {
      if (!fstatSync(descriptor).isFile()) continue;
      content = readFileSync(descriptor, "utf8");
    } finally {
      closeSync(descriptor);
    }
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const relativePath = filePath.slice(root.length + 1);

    function tagName(element) {
      return (
        (element?.openingElement?.tagName ?? element?.tagName)
          ?.getText()
          .toLowerCase() ?? ""
      );
    }

    function isAnnotated(node) {
      const start = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      ).line;
      const lines = content.split(/\r?\n/);
      return [
        lines[start - 2],
        lines[start - 1],
        lines[start],
        lines[start + 1],
      ]
        .filter(Boolean)
        .some((line) => /i18n-ignore\s+--\s+\S/.test(line));
    }

    function record(value, reason, node) {
      const normalized = value.replace(/\s+/g, " ").trim();
      if (!/[\p{L}]/u.test(normalized) || isAnnotated(node)) return;
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;
      findings.push({
        locale: "ui",
        key: `${relativePath}:${line}`,
        value: normalized,
        reason,
      });
    }

    function expressionStrings(node) {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)
      ) {
        return [node.text];
      }
      if (ts.isTemplateExpression(node)) {
        return [
          `${node.head.text}${node.templateSpans
            .map((span) => `{value}${span.literal.text}`)
            .join("")}`,
        ];
      }
      if (ts.isConditionalExpression(node)) {
        return [
          ...expressionStrings(node.whenTrue),
          ...expressionStrings(node.whenFalse),
        ];
      }
      if (
        ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.PlusToken,
        ].includes(node.operatorToken.kind)
      ) {
        return [
          ...expressionStrings(node.left),
          ...expressionStrings(node.right),
        ];
      }
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
        return expressionStrings(node.expression);
      }
      return [];
    }

    function visit(node) {
      if (ts.isJsxText(node) && !skippedTags.has(tagName(node.parent))) {
        record(node.getText(sourceFile), "untranslated-jsx", node);
      }
      if (
        ts.isJsxExpression(node) &&
        node.expression &&
        !ts.isJsxAttribute(node.parent)
      ) {
        for (const value of expressionStrings(node.expression)) {
          record(value, "untranslated-jsx-expression", node);
        }
      }
      if (
        ts.isJsxAttribute(node) &&
        visibleProps.has(node.name.getText()) &&
        node.initializer
      ) {
        if (ts.isStringLiteral(node.initializer)) {
          record(
            node.initializer.text,
            `untranslated-${node.name.getText()}`,
            node,
          );
        } else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression
        ) {
          for (const value of expressionStrings(node.initializer.expression)) {
            record(value, `untranslated-${node.name.getText()}`, node);
          }
        }
      }
      if (
        ts.isCallExpression(node) &&
        ((ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(sourceFile) === "window" &&
          ["alert", "confirm", "prompt"].includes(node.expression.name.text)) ||
          (ts.isIdentifier(node.expression) &&
            ["alert", "confirm", "prompt"].includes(node.expression.text)))
      ) {
        for (const value of node.arguments.flatMap(expressionStrings)) {
          record(value, "untranslated-dialog", node);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
}
scanUiDirectory(join(root, "src"));

if (findings.length === 0) {
  console.log(
    "i18n parity, translation quality, placeholders, and UI copy are valid.",
  );
  process.exit(0);
}

for (const finding of findings) {
  console.log(
    `${finding.locale} | ${finding.key} | ${finding.reason} | ${finding.value}`,
  );
}
console.error(`\n${findings.length} i18n issue(s) found.`);
process.exit(1);

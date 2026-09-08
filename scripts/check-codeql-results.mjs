import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function resultRule(run, result) {
  const reference = result.rule ?? {};
  const componentReference = reference.toolComponent;
  const componentIndex = componentReference?.index ?? -1;
  if (!Number.isInteger(componentIndex) || componentIndex < -1) {
    throw new Error("Invalid CodeQL tool component index");
  }
  // SARIF rule indices are local to the driver or the referenced extension.
  const component = componentIndex === -1
    ? run.tool?.driver
    : run.tool?.extensions?.[componentIndex];
  if (!component || ["name", "guid"].some((key) =>
    componentReference?.[key] !== undefined && componentReference[key] !== component[key])) {
    throw new Error("CodeQL result has no matching tool component");
  }
  if (reference.id !== undefined && result.ruleId !== undefined && reference.id !== result.ruleId) {
    throw new Error("Conflicting CodeQL rule identifiers");
  }
  if (reference.index !== undefined && result.ruleIndex !== undefined && reference.index !== result.ruleIndex) {
    throw new Error("Conflicting CodeQL rule indices");
  }
  const id = reference.id ?? result.ruleId;
  const index = reference.index ?? result.ruleIndex;
  if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
    throw new Error("Invalid CodeQL rule index");
  }
  const matches = index === undefined
    ? (component.rules ?? []).filter((rule) => rule.id === id)
    : [component.rules?.[index]].filter(Boolean);
  if (matches.length !== 1 || (id !== undefined && matches[0].id !== id && !id.startsWith(`${matches[0].id}/`))) {
    throw new Error("CodeQL result has no unambiguous rule metadata");
  }
  return matches[0];
}

export function inspectSarif(document) {
  if (document.version !== "2.1.0" || !document.runs?.length) {
    throw new Error("Missing or invalid CodeQL SARIF runs");
  }
  let failures = 0;
  for (const run of document.runs) {
    if (!Array.isArray(run.results) || run.invocations?.some((item) => item.executionSuccessful === false)) {
      throw new Error("Incomplete CodeQL analysis");
    }
    for (const result of run.results) {
      if (result.suppressions?.some((item) => item.status === "accepted")) continue;
      const rule = resultRule(run, result);
      const severity = Number(rule.properties?.["security-severity"] ?? 0);
      if (!Number.isFinite(severity)) throw new Error("Invalid CodeQL severity");
      if (severity >= 7) failures += 1;
    }
  }
  return failures;
}

function scan(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? scan(file) : file.endsWith(".sarif") ? [file] : [];
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = scan(process.argv[2] ?? "codeql-results");
  if (!files.length) throw new Error("CodeQL produced no SARIF files");
  const count = files.reduce((total, file) => total + inspectSarif(JSON.parse(readFileSync(file, "utf8"))), 0);
  if (count) throw new Error(`${count} high/critical CodeQL findings block publication`);
  console.log("CodeQL publication gate: no unsuppressed high/critical findings.");
}

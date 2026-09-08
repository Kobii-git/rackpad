import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function inspectSarif(document) {
  if (document.version !== "2.1.0" || !document.runs?.length) {
    throw new Error("Missing or invalid CodeQL SARIF runs");
  }
  let failures = 0;
  for (const run of document.runs) {
    if (!Array.isArray(run.results) || run.invocations?.some((item) => item.executionSuccessful === false)) {
      throw new Error("Incomplete CodeQL analysis");
    }
    const rules = new Map((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]));
    for (const result of run.results) {
      if (result.suppressions?.some((item) => item.status === "accepted")) continue;
      const rule = rules.get(result.ruleId);
      if (!rule) throw new Error("CodeQL result has no rule metadata");
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

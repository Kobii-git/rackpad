import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv-draft-04";
import addFormats from "ajv-formats";
import { readSnmpReviewContext, reviewedSnmpLocation, SNMP_REVIEW } from "./codeql-snmp-review.mjs";

const validateSchema = addFormats(new Ajv({ strict: false })).compile(
  JSON.parse(readFileSync(new URL("./schemas/sarif-schema-2.1.0.json", import.meta.url), "utf8")),
);

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

function securitySeverity(rule) {
  const properties = rule.properties ?? {};
  if (!Object.hasOwn(properties, "security-severity")) {
    if (rule.id === SNMP_REVIEW.ruleId || properties.tags?.includes("security")) {
      throw new Error("Missing CodeQL security severity");
    }
    return 0;
  }
  // CodeQL scores are decimal strings in [0, 10], not coercible SARIF property values.
  const value = properties["security-severity"];
  if (typeof value !== "string" || value.trim() !== value || !/^(?:[0-9](?:\.\d+)?|10(?:\.0+)?)$/.test(value)) {
    throw new Error("Invalid CodeQL severity");
  }
  return Number(value);
}

export function reviewSarif(document, context, seen = new Set()) {
  if (document?.version !== "2.1.0" || !Array.isArray(document.runs) || !document.runs.length) {
    throw new Error("Missing or invalid CodeQL SARIF runs");
  }
  // Validate raw evidence before any finding can disappear from the upload copy.
  if (!validateSchema(document)) throw new Error("Invalid CodeQL SARIF schema");
  let failures = 0;
  const reviewed = [];
  const prepared = structuredClone(document);
  for (const run of prepared.runs) {
    if (!Array.isArray(run.results) || run.invocations?.some((item) => item.executionSuccessful === false)) {
      throw new Error("Incomplete CodeQL analysis");
    }
    for (const component of [run.tool.driver, ...(run.tool.extensions ?? [])]) {
      for (const rule of component.rules ?? []) securitySeverity(rule);
    }
    run.results = run.results.filter((result) => {
      const rule = resultRule(run, result);
      const severity = securitySeverity(rule);
      const line = reviewedSnmpLocation(run, result, rule, context);
      if (line !== null) {
        const key = `${SNMP_REVIEW.file}:${line}`;
        if (seen.has(key)) throw new Error("Duplicate reviewed CodeQL location");
        seen.add(key);
        reviewed.push({ ruleId: rule.id, file: SNMP_REVIEW.file, line });
        return false;
      }
      // An accepted annotation cannot bypass the exact SNMP source/expiry policy.
      if (rule.id !== SNMP_REVIEW.ruleId && result.suppressions?.some((item) => item.status === "accepted")) return true;
      if (severity >= 7) failures += 1;
      return true;
    });
  }
  return { failures, reviewed, prepared };
}

export function inspectSarif(document, context) {
  return reviewSarif(document, context).failures;
}

function scan(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error("CodeQL report symlinks are not supported");
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? scan(file) : file.endsWith(".sarif") ? [file] : [];
  });
}

export function prepareCodeqlReports(inputDirectory, outputDirectory, options = {}) {
  const input = realpathSync(inputDirectory);
  const output = path.join(realpathSync(path.dirname(path.resolve(outputDirectory))), path.basename(outputDirectory));
  if (input === output || input.startsWith(`${output}${path.sep}`) || output.startsWith(`${input}${path.sep}`)) {
    throw new Error("CodeQL raw and prepared report directories must be separate");
  }
  // Each attempt owns its evidence; a failed rerun never exposes an old approval.
  const directory = mkdtempSync(`${output}-`);
  const summary = { status: "blocked", policy: SNMP_REVIEW, reviewed: [], failures: null };
  try {
    writeFileSync(path.join(directory, "review-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    options.onDirectory?.(directory);
    const files = scan(input);
    if (!files.length) throw new Error("CodeQL produced no SARIF files");
    const context = readSnmpReviewContext(options.root ?? path.resolve(import.meta.dirname, ".."), options.now);
    const seen = new Set();
    // Validate the entire set before creating any prepared SARIF.
    const reports = files.map((file) => ({
      relative: path.relative(input, file),
      ...reviewSarif(JSON.parse(readFileSync(file, "utf8")), context, seen),
    }));
    summary.reviewed = reports.flatMap((report) => report.reviewed);
    summary.failures = reports.reduce((total, report) => total + report.failures, 0);
    if (summary.failures) throw new Error("Unreviewed high/critical CodeQL findings block publication");
    for (const report of reports) {
      const file = path.join(directory, "prepared", report.relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(report.prepared)}\n`);
    }
    summary.status = "passed";
    writeFileSync(path.join(directory, "review-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    return { ...summary, directory };
  } catch (error) {
    summary.status = "blocked";
    writeFileSync(path.join(directory, "review-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const summary = prepareCodeqlReports(process.argv[2] ?? "codeql-results", process.argv[3] ?? "codeql-review", {
      onDirectory(directory) {
        if (/[\r\n]/.test(directory)) throw new Error("Invalid review directory");
        if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `review_directory=${directory}\n`);
      },
    });
    for (const item of summary.reviewed) {
      console.log(`Reviewed exception: ${item.ruleId} ${item.file}:${item.line}; ${SNMP_REVIEW.owner}; expires ${SNMP_REVIEW.expiresAt}`);
    }
    console.log("CodeQL publication gate passed; complete raw analysis retained.");
  } catch {
    console.error("CodeQL publication blocked: report validation, source approval, or high/critical findings require attention. Raw analysis retained.");
    process.exitCode = 1;
  }
}

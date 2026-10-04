import path from "node:path";
import { pathToFileURL } from "node:url";
import { readSnmpReviewContext, SNMP_REVIEW } from "./codeql-snmp-review.mjs";

/** Report approval failures without echoing source, paths, or report contents. */
export function codeqlReviewProblems(context) {
  const problems = [];
  if (context?.clean !== true) problems.push("Server state is dirty or Git evidence is unavailable.");
  if (typeof context?.serverTree !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(context.serverTree))
    problems.push("Committed server-tree evidence is missing or malformed.");
  else if (context.serverTree !== SNMP_REVIEW.serverTree)
    problems.push("Committed server tree differs from the independently approved tree.");
  if (typeof context?.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(context.sourceSha256))
    problems.push("SNMP source-hash evidence is missing or malformed.");
  else if (context.sourceSha256 !== SNMP_REVIEW.sourceSha256)
    problems.push("SNMP source hash differs from the approved source.");
  if (!Number.isFinite(context?.now) || context.now < 0)
    problems.push("Approval time evidence is invalid.");
  else if (!Number.isFinite(Date.parse(SNMP_REVIEW.expiresAt)) || context.now >= Date.parse(SNMP_REVIEW.expiresAt))
    problems.push("SNMP review approval has expired or its expiry is invalid.");
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = codeqlReviewProblems(readSnmpReviewContext(path.resolve(import.meta.dirname, "..")));
  if (problems.length) {
    for (const problem of problems) console.error(`CodeQL review preflight: ${problem}`);
    process.exitCode = 1;
  } else console.log("CodeQL review preflight passed for the committed server tree.");
}

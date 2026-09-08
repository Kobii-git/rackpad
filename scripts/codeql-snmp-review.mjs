import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Explicitly approved RFC 3414 wire-key derivation, not password storage.
// Never refresh these identifiers or expiry without independent review and approval.
export const SNMP_REVIEW = Object.freeze({
  ruleId: "js/insufficient-password-hash",
  file: "server/lib/snmp-v3.ts",
  sourceSha256: "4029cff16fe59c2120322cf3340bc543564bd44f12835b57f20f27c2e35b3e63",
  serverTree: "29b7962b93a62fa05da1e4147afef36a68166827",
  owner: "@Kobii-git",
  expiresAt: "2026-11-30T00:00:00.000Z",
  rationale: "RFC 3414 A.2 requires MD5/SHA1 for configured SNMP interoperability; credential storage is separately encrypted.",
});

export function readSnmpReviewContext(root, now = Date.now()) {
  try {
    const git = (args) => execFileSync("git", args, {
      cwd: root, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"],
    });
    const serverTree = git(["rev-parse", "HEAD:server"]).trim();
    git(["diff", "--no-ext-diff", "--no-textconv", "--quiet", "HEAD", "--", "server"]);
    // Deliberately include ignored additions: an extra caller must not inherit approval.
    const clean = git(["ls-files", "--others", "-z", "--", "server"]).length === 0 &&
      git(["ls-files", "-v", "-z", "--", "server"]).split("\0").filter(Boolean).every((entry) => entry.startsWith("H "));
    return {
      clean, serverTree, now,
      sourceSha256: createHash("sha256").update(readFileSync(path.join(root, SNMP_REVIEW.file))).digest("hex"),
      rootUri: pathToFileURL(`${path.resolve(root)}${path.sep}`).href,
    };
  } catch {
    return { clean: false, now };
  }
}

export function reviewedSnmpLocation(run, result, rule, context) {
  if (!context?.clean || context.sourceSha256 !== SNMP_REVIEW.sourceSha256 ||
      context.serverTree !== SNMP_REVIEW.serverTree || !Number.isFinite(context.now) ||
      context.now < 0 || context.now >= Date.parse(SNMP_REVIEW.expiresAt)) return null;
  const ids = [result.ruleId, result.rule?.id].filter((id) => id !== undefined);
  if (rule.id !== SNMP_REVIEW.ruleId || !ids.length || ids.some((id) => id !== SNMP_REVIEW.ruleId)) return null;
  if (result.locations?.length !== 1) return null;
  const physical = result.locations[0].physicalLocation;
  const artifact = physical?.artifactLocation;
  const region = physical?.region;
  if (!artifact || artifact.uri !== SNMP_REVIEW.file || !region ||
      ![83, 90].includes(region.startLine) || (region.endLine ?? region.startLine) !== region.startLine ||
      ["charOffset", "charLength", "byteOffset", "byteLength"].some((key) => region[key] !== undefined)) return null;
  if (artifact.index !== undefined) {
    const indexed = run.artifacts?.[artifact.index]?.location;
    if (!Number.isInteger(artifact.index) || artifact.index < 0 || !indexed ||
        indexed.uri !== artifact.uri || indexed.uriBaseId !== artifact.uriBaseId ||
        (indexed.index !== undefined && indexed.index !== artifact.index)) return null;
    const contents = run.artifacts[artifact.index].contents;
    if (contents !== undefined && (typeof contents.text !== "string" || contents.binary !== undefined ||
        createHash("sha256").update(contents.text, "utf8").digest("hex") !== SNMP_REVIEW.sourceSha256)) return null;
  }
  if (artifact.uriBaseId !== undefined) {
    if (artifact.uriBaseId !== "%SRCROOT%" || !context.rootUri) return null;
    const base = run.originalUriBaseIds?.["%SRCROOT%"];
    if (base !== undefined) {
      if (base.uri !== context.rootUri || base.uriBaseId !== undefined) return null;
    } else {
      // Native CodeQL omits absolute roots. Require the analyzed file itself as
      // additional evidence, emitted by --sarif-add-file-contents; never infer
      // approval from the unresolved placeholder or the checkout path alone.
      const indexed = run.artifacts?.[artifact.index];
      const matches = run.artifacts?.filter((entry) => entry.location?.uri === artifact.uri &&
        entry.location.uriBaseId === artifact.uriBaseId);
      if (!Number.isInteger(artifact.index) || !indexed || matches?.length !== 1 ||
          typeof indexed.contents?.text !== "string" || indexed.contents.binary !== undefined ||
          createHash("sha256").update(indexed.contents.text, "utf8").digest("hex") !== SNMP_REVIEW.sourceSha256) return null;
    }
  }
  return region.startLine;
}

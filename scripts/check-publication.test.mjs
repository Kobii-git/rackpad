import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { inspectSarif, prepareCodeqlReports, reviewSarif } from "./check-codeql-results.mjs";
import { readSnmpReviewContext, SNMP_REVIEW } from "./codeql-snmp-review.mjs";

const workflow = (name) => YAML.parse(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"));
const sarif = (severity, results = [{ ruleId: "test-rule" }]) => ({
  version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL", rules: [{ id: "test-rule", properties: { "security-severity": severity } }] } }, results: results.map((result) => ({ message: { text: "Fixture" }, ...result })) }],
});

test("CodeQL blocks high/critical findings and fails closed on missing analysis", () => {
  assert.equal(inspectSarif(sarif("7.5")), 1);
  assert.equal(inspectSarif(sarif("9.8")), 1);
  assert.equal(inspectSarif(sarif("6.9")), 0);
  assert.equal(inspectSarif(sarif("9.8", [{ ruleId: "test-rule", suppressions: [{ kind: "external", status: "accepted" }] }])), 0);
  assert.throws(() => inspectSarif({ runs: [] }));
  assert.throws(() => inspectSarif(sarif("invalid")));
  assert.throws(() => inspectSarif(sarif("9.8", [{ ruleId: "unknown" }])));
});

test("CodeQL resolves extension-local rule metadata and rejects ambiguous references", () => {
  // Matches CodeQL 4.37.9's hosted SARIF shape: metadata lives in an extension.
  const document = sarif("1.0", [{ ruleId: "test-rule", rule: { id: "test-rule", index: 0, toolComponent: { index: 1 } } }]);
  const run = document.runs[0];
  run.tool.extensions = [{ name: "pr-diff-range", rules: [] }, {
    name: "codeql/javascript-queries", rules: [{ id: "test-rule", properties: { "security-severity": "8.1" } }],
  }];
  assert.equal(inspectSarif(document), 1, "must use extension severity instead of a same-named driver rule");
  run.results[0].rule.toolComponent.index = 9;
  assert.throws(() => inspectSarif(document), /tool component/);
  run.results[0].rule.toolComponent.index = 1;
  run.results[0].rule.index = 9;
  assert.throws(() => inspectSarif(document), /rule metadata/);
  run.results[0].rule.index = 0;
  run.results[0].rule.id = "different-rule";
  assert.throws(() => inspectSarif(document), /identifiers/);
  run.results[0].rule.id = "test-rule";
  run.results[0].ruleIndex = 1;
  assert.throws(() => inspectSarif(document), /indices/);
  delete run.results[0].ruleIndex;
  run.results[0].suppressions = [{ kind: "inSource" }];
  assert.equal(inspectSarif(document), 1, "an unaccepted suppression must still block publication");
});

test("each required check blocks image and release jobs on failure", () => {
  const { jobs } = workflow("docker-publish");
  assert.deepEqual(jobs.build.needs, ["quality", "codeql", "security"]);
  assert.equal(jobs.build.if, undefined, "must retain implicit success() prerequisite");
  assert.equal(jobs.release.needs, "build");
  assert(!jobs.release.if.includes("always()"));
  for (const failed of jobs.build.needs) {
    const states = Object.fromEntries(jobs.build.needs.map((name) => [name, name === failed ? "failure" : "success"]));
    const buildRuns = jobs.build.needs.every((name) => states[name] === "success");
    assert.equal(buildRuns, false);
  }
  assert(workflow("codeql").jobs.analyze.steps.some((step) => step.run?.includes("check-codeql-results.mjs")));
});

test("fork PRs cannot publish; scans retain transition, scheduled, and manual entry points", () => {
  const { jobs } = workflow("docker-publish");
  const build = jobs.build.steps.find((step) => step.name === "Build and push");
  assert.equal(build.with.push, "${{ github.event_name != 'pull_request' }}");
  assert(jobs.release.if.includes("github.event_name == 'push'"));
  assert(jobs.release.if.includes("refs/tags/v"));
  assert(jobs.build.steps.find((step) => step.name === "Log in to GHCR").if.includes("!= 'pull_request'"));
  for (const name of ["codeql", "security-scan"]) {
    const triggers = workflow(name).on;
    for (const trigger of ["workflow_call", "push", "pull_request", "schedule", "workflow_dispatch"]) assert(trigger in triggers);
  }
});

const reviewedContext = () => ({
  clean: true, sourceSha256: SNMP_REVIEW.sourceSha256, serverTree: SNMP_REVIEW.serverTree,
  now: Date.parse("2026-11-29T23:59:59.999Z"), rootUri: "file:///reviewed/",
});
function snmpSarif() {
  return {
    version: "2.1.0", runs: [{
      automationDetails: { id: "unchanged-analysis/" },
      tool: { driver: { name: "CodeQL" }, extensions: [{ name: "pr-diff", rules: [] }, {
        name: "codeql/javascript-queries", rules: [
          { id: SNMP_REVIEW.ruleId, properties: { "security-severity": "8.1" } },
          { id: "other-rule", properties: { "security-severity": "9.8" } },
        ],
      }] },
      artifacts: [{ location: { uri: SNMP_REVIEW.file } }],
      results: [83, 90].map((line) => ({
        ruleId: SNMP_REVIEW.ruleId,
        rule: { id: SNMP_REVIEW.ruleId, index: 0, toolComponent: { index: 1 } },
        message: { text: "RFC wire-key derivation" },
        partialFingerprints: { primaryLocationLineHash: `fixture-${line}` },
        locations: [{ physicalLocation: {
          artifactLocation: { uri: SNMP_REVIEW.file, index: 0 },
          region: { startLine: line, endLine: line },
        } }],
      })),
    }],
  };
}

test("exact RFC exceptions preserve raw reports and every retained result and metadata", () => {
  const document = snmpSarif();
  const run = document.runs[0];
  run.results.push({ ruleId: "other-rule", rule: { index: 1, toolComponent: { index: 1 } }, message: { text: "Still blocks" } });
  const original = structuredClone(document);
  const reviewed = reviewSarif(document, reviewedContext());
  assert.deepEqual(document, original);
  assert.equal(reviewed.failures, 1);
  assert.deepEqual(reviewed.reviewed.map((item) => item.line), [83, 90]);
  const expected = structuredClone(original);
  expected.runs[0].results.splice(0, 2);
  assert.deepEqual(reviewed.prepared, expected);
  assert.equal(inspectSarif(snmpSarif()), 2, "missing evidence cannot authorize exceptions");
});

test("reviewed exceptions reject changed evidence and expire at the exact UTC boundary", () => {
  for (const change of [
    { clean: false }, { clean: undefined }, { sourceSha256: "changed" }, { serverTree: "changed" },
    { now: Date.parse(SNMP_REVIEW.expiresAt) }, { now: NaN }, { now: -1 },
  ]) assert.equal(inspectSarif(snmpSarif(), { ...reviewedContext(), ...change }), 2);
  const annotated = snmpSarif();
  for (const result of annotated.runs[0].results) result.suppressions = [{ status: "accepted", kind: "inSource" }];
  assert.equal(inspectSarif(annotated, { ...reviewedContext(), clean: false }), 2);
});

test("only the exact rule and unambiguous single primary location are eligible", () => {
  const mutations = [
    (r) => { r.ruleId += "/alias"; r.rule.id = r.ruleId; },
    (r) => { r.ruleId = r.rule.id = "other-rule"; r.rule.index = 1; },
    (r) => { r.locations.push(structuredClone(r.locations[0])); },
    (r) => { r.relatedLocations = r.locations; delete r.locations; },
    (r) => { r.locations[0].physicalLocation.region.startLine = 82; },
    (r) => { r.locations[0].physicalLocation.region.endLine = 90; },
    (r) => { r.locations[0].physicalLocation.region.charLength = 1000; },
    (r) => { r.locations[0].physicalLocation.artifactLocation.index = 99; },
    (r) => { r.locations[0].physicalLocation.artifactLocation.uriBaseId = "elsewhere"; },
    ...["../server/lib/snmp-v3.ts", "file:///server/lib/snmp-v3.ts", "server\\lib\\snmp-v3.ts", "server/lib/%73nmp-v3.ts", "server/lib/snmp-v3.ts?x"].map((uri) =>
      (r) => { r.locations[0].physicalLocation.artifactLocation.uri = uri; }),
  ];
  for (const mutate of mutations) {
    const document = snmpSarif();
    mutate(document.runs[0].results[0]);
    try {
      assert.equal(inspectSarif(document, reviewedContext()), 1);
    } catch (error) {
      assert.match(error.message, /Invalid CodeQL SARIF schema/);
    }
  }
  const redirected = snmpSarif();
  const run = redirected.runs[0];
  run.originalUriBaseIds = { "%SRCROOT%": { uri: "file:///elsewhere/" } };
  for (const result of run.results) result.locations[0].physicalLocation.artifactLocation.uriBaseId = "%SRCROOT%";
  run.artifacts[0].location.uriBaseId = "%SRCROOT%";
  assert.equal(inspectSarif(redirected, reviewedContext()), 2);
  run.originalUriBaseIds["%SRCROOT%"].uri = reviewedContext().rootUri;
  assert.equal(inspectSarif(redirected, reviewedContext()), 0);
  run.artifacts[0].location.uri = "server/another-file.ts";
  assert.equal(inspectSarif(redirected, reviewedContext()), 2);
});

test("duplicate reviewed results across runs or files fail closed", () => {
  const duplicate = snmpSarif();
  duplicate.runs.push(structuredClone(duplicate.runs[0]));
  assert.throws(() => reviewSarif(duplicate, reviewedContext()), /Duplicate/);
  const seen = new Set();
  reviewSarif(snmpSarif(), reviewedContext(), seen);
  assert.throws(() => reviewSarif(snmpSarif(), reviewedContext(), seen), /Duplicate/);
});

test("Git evidence detects staged, unstaged and ignored additions and missing repository state", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "rackpad-codeql-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  assert.equal(readSnmpReviewContext(root).clean, false);
  git("init", "--initial-branch=fixture");
  mkdirSync(path.join(root, "server/lib"), { recursive: true });
  const file = path.join(root, SNMP_REVIEW.file);
  writeFileSync(file, "fixture\n");
  writeFileSync(path.join(root, ".gitignore"), "server/ignored.ts\n");
  git("add", "server", ".gitignore");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Fixture");
  assert.equal(readSnmpReviewContext(root).clean, true);
  assert.equal(inspectSarif(snmpSarif(), readSnmpReviewContext(root)), 2, "different committed source is not approved");
  git("update-index", "--assume-unchanged", SNMP_REVIEW.file);
  assert.equal(readSnmpReviewContext(root).clean, false, "index flags cannot hide changed callers");
  git("update-index", "--no-assume-unchanged", SNMP_REVIEW.file);
  git("update-index", "--skip-worktree", SNMP_REVIEW.file);
  assert.equal(readSnmpReviewContext(root).clean, false);
  git("update-index", "--no-skip-worktree", SNMP_REVIEW.file);
  writeFileSync(file, "changed\n");
  assert.equal(readSnmpReviewContext(root).clean, false);
  git("add", "server");
  assert.equal(readSnmpReviewContext(root).clean, false);
  writeFileSync(file, "fixture\n");
  git("add", "server");
  writeFileSync(path.join(root, "server/ignored.ts"), "new caller\n");
  assert.equal(readSnmpReviewContext(root).clean, false);
  rmSync(path.join(root, "server/ignored.ts"));
  writeFileSync(path.join(root, "server/untracked.ts"), "new caller\n");
  assert.equal(readSnmpReviewContext(root).clean, false);
});

test("report preparation is atomic, preserves raw bytes and isolates reruns from stale approval", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "rackpad-codeql-reports-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "raw");
  mkdirSync(input);
  const file = path.join(input, "first.sarif");
  const original = JSON.stringify(sarif("1.0"), null, 4);
  writeFileSync(file, original);
  const output = path.join(root, "review");
  const first = prepareCodeqlReports(input, output, { root });
  assert.equal(first.status, "passed");
  assert.equal(readFileSync(file, "utf8"), original);
  assert.deepEqual(JSON.parse(readFileSync(path.join(first.directory, "prepared/first.sarif"))), JSON.parse(original));
  assert.throws(() => prepareCodeqlReports(input, input, { root }), /separate/);
  assert.throws(() => prepareCodeqlReports(input, path.join(input, "nested"), { root }), /separate/);
  symlinkSync(input, path.join(root, "alias"));
  assert.throws(() => prepareCodeqlReports(input, path.join(root, "alias/nested"), { root }), /separate/);
  writeFileSync(path.join(input, "second.sarif"), "invalid JSON");
  let failed;
  assert.throws(() => prepareCodeqlReports(input, output, { root, onDirectory(directory) { failed = directory; } }));
  assert.notEqual(failed, first.directory);
  assert.equal(existsSync(path.join(failed, "prepared")), false);
  assert.equal(JSON.parse(readFileSync(path.join(failed, "review-summary.json"))).status, "blocked");
  assert.equal(JSON.parse(readFileSync(path.join(first.directory, "review-summary.json"))).status, "passed", "historical evidence remains separate");
  assert.equal(readFileSync(file, "utf8"), original);
  rmSync(path.join(input, "second.sarif"));
  writeFileSync(file, JSON.stringify(sarif("9.8")));
  assert.throws(() => prepareCodeqlReports(input, path.join(root, "high"), { root }), /high\/critical/);
  const symlinkInput = path.join(root, "symlink-raw");
  mkdirSync(symlinkInput);
  symlinkSync(file, path.join(symlinkInput, "linked.sarif"));
  assert.throws(() => prepareCodeqlReports(symlinkInput, path.join(root, "symlink-review"), { root }), /symlinks/);
});

test("CodeQL post-processing keeps failures blocking and uploads raw fallback with full evidence", () => {
  const steps = workflow("codeql").jobs.analyze.steps;
  const analysis = steps.find((step) => step.id === "analysis");
  const policy = steps.find((step) => step.id === "policy");
  const upload = steps.find((step) => step.uses?.startsWith("github/codeql-action/upload-sarif@"));
  const artifact = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(analysis.with.upload, "failure-only");
  assert.equal(policy["continue-on-error"], undefined);
  assert.equal(upload["continue-on-error"], undefined);
  assert.equal(upload.if, "always() && steps.analysis.outcome == 'success'");
  assert(upload.with.sarif_file.includes("steps.policy.outcome == 'success'"));
  assert(upload.with.sarif_file.includes("|| format('{0}/rackpad-codeql-raw'"));
  assert.equal(upload.with["wait-for-processing"], true);
  assert.equal(artifact.if, "always()");
  assert(artifact.with.path.includes("rackpad-codeql-raw"));
  assert(artifact.with.path.includes("review-summary.json"));
  assert(artifact.with.path.includes("steps.policy.outputs.review_directory"));
});

test("malformed findings cannot be removed to turn invalid raw evidence into valid prepared output", (t) => {
  const mutations = [
    (result) => { delete result.message; },
    (result) => { result.message.text = 1; },
    (result) => { result.locations[0].physicalLocation.region.startColumn = 0; },
    (result) => { result.locations[0].physicalLocation.region.endLine = null; },
    (result) => { result.locations = { 0: result.locations[0], length: 1 }; },
    (result) => { result.codeFlows = [{ threadFlows: "invalid" }]; },
  ];
  const root = mkdtempSync(path.join(tmpdir(), "rackpad-codeql-invalid-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "raw");
  mkdirSync(input);
  for (const mutate of mutations) {
    const document = snmpSarif();
    mutate(document.runs[0].results[0]);
    assert.throws(() => reviewSarif(document, reviewedContext()), /SARIF schema/);
    const bytes = JSON.stringify(document);
    const file = path.join(input, "invalid.sarif");
    writeFileSync(file, bytes);
    let directory;
    assert.throws(() => prepareCodeqlReports(input, path.join(root, "review"), {
      onDirectory(value) { directory = value; },
    }), /SARIF schema/);
    assert.equal(existsSync(path.join(directory, "prepared")), false);
    assert.equal(JSON.parse(readFileSync(path.join(directory, "review-summary.json"))).status, "blocked");
    assert.equal(readFileSync(file, "utf8"), bytes);
  }
});

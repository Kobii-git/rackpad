import assert from "node:assert/strict";
import { exerciseApi } from "./fixtures/release-image-api.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import YAML from "yaml";
import { inspectSarif, prepareCodeqlReports, reviewSarif } from "./check-codeql-results.mjs";
import { codeqlReviewProblems } from "./check-codeql-review.mjs";
import { readSnmpReviewContext, SNMP_REVIEW } from "./codeql-snmp-review.mjs";
import { assertPatchedImageRuntime } from "./image-runtime.mjs";

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

test("CodeQL rejects malformed severity before suppressions or reviewed exceptions", () => {
  for (const severity of [[], [8.1], {}, true, false, null, undefined, 0, 8.1, -1,
    "", " ", " 8.1", "8.1 ", "8.1\n", "8.1\r", "8.1\u2028", "-1", "10.1", "10.0000000000000001", "Infinity", "NaN", "1e1", "0x8", "+8", ".8", "8.", "08"]) {
    assert.throws(() => inspectSarif(sarif(severity)), /CodeQL severity/);
    assert.throws(() => inspectSarif(sarif(severity, [
      { ruleId: "test-rule", suppressions: [{ kind: "external", status: "accepted" }] },
    ])), /CodeQL severity/);
    const document = snmpSarif();
    document.runs[0].tool.extensions[1].rules[0].properties["security-severity"] = severity;
    assert.throws(() => reviewSarif(document, reviewedContext()), /CodeQL severity/);
  }
  for (const [severity, failures] of [["0", 0], ["0.0", 0], ["5", 0], ["6.9", 0], ["7", 1], ["8.1", 1], ["10", 1], ["10.0", 1]]) {
    assert.equal(inspectSarif(sarif(severity)), failures);
  }
});

test("only non-security rules may omit severity metadata", () => {
  const document = sarif("5");
  const rule = document.runs[0].tool.driver.rules[0];
  delete rule.properties["security-severity"];
  assert.equal(inspectSarif(document), 0);
  rule.properties.tags = ["maintainability"];
  assert.equal(inspectSarif(document), 0);
  rule.properties.tags.push("security");
  assert.throws(() => inspectSarif(document), /Missing CodeQL security severity/);
  delete rule.properties;
  assert.equal(inspectSarif(document), 0);
  const snmp = snmpSarif();
  snmp.runs[0].tool.extensions[1].rules[0].properties = { tags: ["security"] };
  assert.throws(() => reviewSarif(snmp, reviewedContext()), /Missing CodeQL security severity/);
  delete snmp.runs[0].tool.extensions[1].rules[0].properties;
  for (const context of [reviewedContext(), { ...reviewedContext(), clean: false },
    { ...reviewedContext(), now: Date.parse(SNMP_REVIEW.expiresAt) }]) {
    assert.throws(() => reviewSarif(snmp, context), /Missing CodeQL security severity/);
  }
});

test("unused driver and extension descriptors also require valid security metadata", () => {
  for (const location of ["driver", "extension"]) {
    for (const properties of [{ "security-severity": [] }, { tags: ["security"] }]) {
      const document = snmpSarif();
      const component = location === "driver" ? document.runs[0].tool.driver : document.runs[0].tool.extensions[0];
      component.rules = [{ id: "unreferenced-rule", properties }];
      assert.throws(() => reviewSarif(document, reviewedContext()), /CodeQL (?:security )?severity/);
      component.rules[0].properties = { tags: ["maintainability"] };
      assert.equal(reviewSarif(document, reviewedContext()).reviewed.length, 2);
    }
  }
});

test("malformed severity leaves raw evidence intact and preparation blocked", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "rackpad-codeql-severity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "raw");
  mkdirSync(input);
  const file = path.join(input, "report.sarif");
  const original = JSON.stringify(sarif([]), null, 2);
  writeFileSync(file, original);
  let output;
  assert.throws(() => prepareCodeqlReports(input, path.join(root, "review"), {
    root, onDirectory(directory) { output = directory; },
  }), /Invalid CodeQL severity/);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.equal(JSON.parse(readFileSync(path.join(output, "review-summary.json"))).status, "blocked");
  assert.equal(existsSync(path.join(output, "prepared")), false);
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
  assert.deepEqual(jobs.release.needs, ["build", "smoke"]);
  assert.equal(jobs.smoke.needs, "build");
  assert(!jobs.smoke.if.includes("always()"));
  assert.deepEqual(jobs.smoke.strategy.matrix.platform, ["linux/amd64", "linux/arm64"]);
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
  assert.equal(jobs.smoke.if, "github.event_name == 'push'");
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

test("native rootless reports require the complete analyzed source matching the approved hash", () => {
  const document = snmpSarif();
  const run = document.runs[0];
  for (const result of run.results) result.locations[0].physicalLocation.artifactLocation.uriBaseId = "%SRCROOT%";
  run.artifacts[0].location.uriBaseId = "%SRCROOT%";
  assert.equal(inspectSarif(document, reviewedContext()), 2, "the unresolved placeholder alone is insufficient");
  run.artifacts[0].contents = { text: readFileSync(new URL(`../${SNMP_REVIEW.file}`, import.meta.url), "utf8") };
  const original = structuredClone(document);
  const review = reviewSarif(document, reviewedContext());
  assert.equal(review.failures, 0);
  assert.deepEqual(review.reviewed.map((item) => item.line), [83, 90]);
  assert.deepEqual(document, original);
  const expected = structuredClone(document);
  expected.runs[0].results = [];
  assert.deepEqual(review.prepared, expected);
  for (const mutate of [
    (r) => { r.artifacts[0].contents.text += "\n"; },
    (r) => { r.artifacts[0].contents.text = r.artifacts[0].contents.text.slice(0, 100); },
    (r) => { delete r.artifacts[0].contents; },
    (r) => { r.artifacts[0].contents.binary = "YQ=="; },
    (r) => { r.artifacts[0].location.index = 1; },
    (r) => { r.artifacts.push(structuredClone(r.artifacts[0])); },
    (r) => { r.originalUriBaseIds = { "%SRCROOT%": { uri: "file:///elsewhere/" } }; },
    (r) => { r.originalUriBaseIds = { "%SRCROOT%": {} }; },
    (r) => { for (const result of r.results) delete result.locations[0].physicalLocation.artifactLocation.index; },
  ]) {
    const changed = structuredClone(document);
    mutate(changed.runs[0]);
    try {
      assert.equal(inspectSarif(changed, reviewedContext()), 2);
    } catch (error) {
      assert.match(error.message, /Invalid CodeQL SARIF schema/);
    }
  }
  assert.equal(inspectSarif(document, { ...reviewedContext(), clean: false }), 2);
  assert.equal(inspectSarif(document, { ...reviewedContext(), serverTree: "changed" }), 2);
  assert.equal(inspectSarif(document, { ...reviewedContext(), rootUri: undefined }), 2);
  assert.equal(inspectSarif(document, { ...reviewedContext(), now: Date.parse(SNMP_REVIEW.expiresAt) }), 2);
  run.originalUriBaseIds = { "%SRCROOT%": { uri: reviewedContext().rootUri } };
  run.artifacts[0].contents.text += "changed";
  assert.equal(inspectSarif(document, reviewedContext()), 2, "a root mapping cannot override contradictory analyzed contents");
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
  assert.deepEqual(JSON.parse(analysis.env.CODEQL_ACTION_EXTRA_OPTIONS), { database: { "interpret-results": ["--sarif-add-file-contents"] } });
  assert.equal(steps.find((step) => step.uses?.startsWith("github/codeql-action/init@")).with["source-root"], "${{ github.workspace }}");
  assert.equal(upload.with.checkout_path, "${{ github.workspace }}");
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

test("CodeQL review preflight fails closed with specific bounded diagnostics", () => {
  const valid = reviewedContext();
  assert.deepEqual(codeqlReviewProblems(valid), []);
  for (const [patch, message] of [
    [{ clean: false }, "Server state is dirty"],
    [{ serverTree: "a".repeat(40) }, "Committed server tree differs"],
    [{ sourceSha256: "a".repeat(64) }, "SNMP source hash differs"],
    [{ now: Date.parse(SNMP_REVIEW.expiresAt) }, "approval has expired"],
    [{ now: NaN }, "time evidence is invalid"],
    [{ now: -1 }, "time evidence is invalid"],
    [{ serverTree: "malformed" }, "server-tree evidence is missing or malformed"],
    [{ sourceSha256: null }, "source-hash evidence is missing or malformed"],
  ]) assert(codeqlReviewProblems({ ...valid, ...patch }).some(problem => problem.includes(message)));
  assert.equal(codeqlReviewProblems(undefined).length, 4);
  const workflowText = readFileSync(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");
  assert(workflowText.indexOf("npm run check:codeql-review") < workflowText.indexOf("npm ci"));
});

test("CodeQL preflight observes actual committed Git evidence and dirty server state", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "rackpad-codeql-preflight-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  git("init", "--initial-branch=fixture");
  mkdirSync(path.join(root, "server/lib"), { recursive: true });
  const source = path.join(root, SNMP_REVIEW.file);
  writeFileSync(source, readFileSync(new URL(`../${SNMP_REVIEW.file}`, import.meta.url)));
  git("add", "server");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Fixture");
  const actual = readSnmpReviewContext(root);
  assert.equal(actual.clean, true);
  assert.equal(actual.serverTree, git("rev-parse", "HEAD:server").trim());
  assert.equal(actual.sourceSha256, SNMP_REVIEW.sourceSha256);
  assert(codeqlReviewProblems(actual).some(problem => problem.includes("tree differs")));
  writeFileSync(source, "changed source\n");
  assert(codeqlReviewProblems(readSnmpReviewContext(root)).some(problem => problem.includes("dirty")));
  git("add", "server");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Changed");
  assert(codeqlReviewProblems(readSnmpReviewContext(root)).some(problem => problem.includes("source hash differs")));
});

test("image smoke installs and verifies platform-aware Docker before image work", () => {
  for (const name of ["candidate-smoke", "smoke"]) {
    const steps = workflow("docker-publish").jobs[name].steps;
    const setup = steps.findIndex(step => step.uses === "docker/setup-docker-action@v5");
    const preflight = steps.findIndex(step => step.run === "node scripts/check-docker-platform.mjs");
    const qemu = steps.findIndex(step => step.uses?.startsWith("docker/setup-qemu-action@"));
    assert.ok(setup >= 0 && setup < preflight && preflight < qemu);
    assert.equal(steps[setup].with.version, "latest");
    assert.equal(steps[setup].with.channel, "stable");
    assert.equal(steps[setup].with["tcp-port"], undefined);
    assert.equal(JSON.parse(steps[setup].with["daemon-config"]).features["containerd-snapshotter"], true);
    assert.equal(steps[preflight]["continue-on-error"], undefined);
  }
  const source = readFileSync(new URL("./check-docker-platform.mjs", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "");
  const run = (help, versions, failed = false) => runInNewContext(source, {
    assert, console: {log() {}},
    execFileSync: (command, args) => {
      assert.equal(command, "docker");
      if (failed) throw new Error("Synthetic daemon failure");
      return args[0] === "version" ? versions : help;
    },
  });
  run("--platform string", "1.49 1.49");
  run("--platform string", "1.54 1.54");
  assert.throws(() => run("no platform option", "1.54 1.54"), /must support --platform/);
  for (const versions of ["1.48 1.54", "1.54 1.48", "1.54", "invalid", "1.54 1.54 extra"]) {
    assert.throws(() => run("--platform string", versions), /API|versions/);
  }
  assert.throws(() => run("--platform string", "1.54 1.54", true), /could not inspect/);
});

test("pre-merge smoke builds unpublished immutable candidates and tests stable and beta recovery", () => {
  const job = workflow("docker-publish").jobs["candidate-smoke"];
  assert.equal(job.if, "github.event_name == 'pull_request'");
  assert.deepEqual(job.needs, ["quality", "codeql", "security"]);
  assert.deepEqual(job.strategy.matrix.platform, ["linux/amd64", "linux/arm64"]);
  assert.equal(job.permissions.packages, "read");
  const build = job.steps.find(step => step.id === "candidate");
  assert.equal(build.with.push, false);
  assert.equal(build.with.load, true);
  assert.equal(build.with.labels, "org.opencontainers.image.revision=${{ github.sha }}");
  const smoke = job.steps.find(step => step.env?.CANDIDATE_IMAGE);
  assert.equal(smoke.env.CANDIDATE_IMAGE, "${{ steps.candidate.outputs.imageid }}");
  for (const key of ["STABLE_IMAGE", "BETA_IMAGE", "SCHEMA55_IMAGE", "SCHEMA57_IMAGE"]) assert.match(smoke.env[key], /^ghcr\.io\/kobii-git\/rackpad@sha256:[a-f0-9]{64}$/);
  assert(smoke.run.includes('--previous-image "$STABLE_IMAGE" --previous-schema 51'));
  assert(smoke.run.includes('--previous-image "$BETA_IMAGE" --previous-schema 53'));
  assert(smoke.run.includes('--previous-image "$SCHEMA57_IMAGE" --previous-schema 57'));
  assert.equal(smoke.env.SCHEMA57_IMAGE, "ghcr.io/kobii-git/rackpad@sha256:a9652c980a17ae0ce4638492402d1cab54f876a3b6901bd8cf906eed18889ff5");
  assert(!job.steps.some(step => step.uses?.startsWith("docker/login-action")));
});


test("candidate smoke follows current schema across migrations while retaining pinned recovery baselines", () => {
  const source = readFileSync(new URL("./check-release-image.mjs", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replaceAll("import.meta.url", JSON.stringify("file:///rackpad-fixture/scripts/check-release-image.mjs"));
  for (const currentSchema of [58, 59, 60, 61, 62]) for (const previousSchema of [51, 53, 55, 57, 58, 59, 60, 61, 62].filter(value => value <= currentSchema)) for (const platform of ["linux/amd64", "linux/arm64"]) {
    const exercises = [];
    const selectedImages = new Map();
    let nonce = 0;
    runInNewContext(source, {
      assert, URL, assertPatchedImageRuntime, exerciseApi,
      process: {argv: ["node", "fixture.mjs", "--image", `sha256:${"a".repeat(64)}`,
        "--previous-image", `ghcr.io/kobii-git/rackpad@sha256:${"b".repeat(64)}`,
        "--previous-schema", String(previousSchema), "--platform", platform, "--revision", "c".repeat(40)]},
      console: {log() {}, error() {}},
      randomUUID: () => `synthetic-${++nonce}`,
      readFileSync: (url, encoding) => {
        assert.equal(String(url), "file:///rackpad-fixture/server/schema-version.ts");
        assert.equal(encoding, "utf8");
        return `export const CURRENT_SCHEMA_VERSION = ${currentSchema};\n`;
      },
      // No Docker process, API call, database, or volume is created in this fixture.
      spawnSync: (command, args, options) => {
        assert.equal(command, "docker");
        if (args[0] === "run" && args.includes("-e") && args.at(-1).includes("monitor_status")) {
          let handler;
          runInNewContext(args.at(-1).replace("import http from 'node:http';", ""), {
            http: {createServer(callback) { handler = callback; return {listen(port, host) {assert.equal(port, 8787); assert.equal(host, "0.0.0.0");}};}},
          });
          let status, body;
          handler({url: "/metrics"}, {writeHead(code) {status = code;}, end(value) {body = value;}});
          assert.equal(status, 200);
          assert.equal(body, 'monitor_status{monitor_id="1",monitor_name="Release service"} 1\n');
        }
        if (args[0] === "create") {
          assert.equal(args[args.indexOf("--platform") + 1], platform);
          assert.equal(args[args.indexOf("--network") + 1], "none");
          selectedImages.set(args[2], `sha256:${(args.at(-2).startsWith("ghcr.io/") ? "e" : "d").repeat(64)}`);
        }
        if (args[0] === "image" && args[1] === "inspect") {
          assert.equal(args[args.indexOf("--platform")+1],platform,"inspect the selected architecture even when both variants are cached");
          assert([...selectedImages.values()].includes(args.at(-1)), "inspect the selected container's image, not a multi-platform reference");
        }
        if (options.input?.startsWith("await (async function exerciseApi(")) {
          const body = options.input;
          const input = JSON.parse(body.slice(body.lastIndexOf("})(") + 3, -2));
          exercises.push({schema: input.expectedSchema, features: input.features, create: input.create});
        }
        const stdout = args.includes("process.versions.node") ? "22.23.4\n" : args[0] === "info" ? "linux\n"
          : args[0] === "inspect" ? `${selectedImages.get(args.at(-1))}\n`
          : args[0] === "image" && args[1] === "inspect"
            ? JSON.stringify([{Id: `sha256:${"f".repeat(64)}`, Os: "linux", Architecture: platform.split("/")[1], Config: {Labels: {"org.opencontainers.image.revision": "c".repeat(40)}}}]) : "";
        return {status: 0, stdout, stderr: ""};
      },
    });
    assert.deepEqual(exercises, [
      {schema: currentSchema, features: true, create: true},
      {schema: currentSchema, features: true, create: false},
      {schema: previousSchema, features: false, create: true},
      {schema: currentSchema, features: true, create: false},
      {schema: currentSchema, features: true, create: false},
      {schema: previousSchema, features: false, create: false},
    ]);
  }
});

test("candidate smoke rejects unsupported and newer predecessor schemas before Docker runs", () => {
  const source = readFileSync(new URL("./check-release-image.mjs", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replaceAll("import.meta.url", JSON.stringify("file:///rackpad-fixture/scripts/check-release-image.mjs"));
  for (const previousSchema of [56, 59, 63]) {
    assert.throws(() => runInNewContext(source, {
      assert, URL,
      process: {argv: ["node", "fixture.mjs", "--image", `sha256:${"a".repeat(64)}`,
        "--previous-image", `ghcr.io/kobii-git/rackpad@sha256:${"b".repeat(64)}`,
        "--previous-schema", String(previousSchema), "--platform", "linux/amd64", "--revision", "c".repeat(40)]},
      readFileSync: () => "export const CURRENT_SCHEMA_VERSION = 58;\n",
      spawnSync: () => assert.fail("Invalid schemas must not start Docker."),
    }), /Previous schema/);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";
import { inspectSarif } from "./check-codeql-results.mjs";

const workflow = (name) => YAML.parse(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"));
const sarif = (severity, results = [{ ruleId: "test-rule" }]) => ({
  version: "2.1.0", runs: [{ tool: { driver: { rules: [{ id: "test-rule", properties: { "security-severity": severity } }] } }, results }],
});

test("CodeQL blocks high/critical findings and fails closed on missing analysis", () => {
  assert.equal(inspectSarif(sarif("7.5")), 1);
  assert.equal(inspectSarif(sarif("9.8")), 1);
  assert.equal(inspectSarif(sarif("6.9")), 0);
  assert.equal(inspectSarif(sarif("9.8", [{ ruleId: "test-rule", suppressions: [{ status: "accepted" }] }])), 0);
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

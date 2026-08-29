#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");
const releaseTagPattern = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function classifyReleaseTag(tag, packageVersion) {
  const match = releaseTagPattern.exec(tag);
  if (!match) {
    throw new Error(`${tag} is not a valid v-prefixed SemVer release tag`);
  }

  const prereleaseIdentifiers = match[4]?.split(".") ?? [];
  for (const identifier of prereleaseIdentifiers) {
    if (/^[0-9]+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
      throw new Error(`${tag} contains a numeric prerelease identifier with a leading zero`);
    }
  }

  const tagVersion = tag.slice(1);
  if (tagVersion !== packageVersion) {
    throw new Error(
      `Release tag ${tag} does not match package.json version ${packageVersion}`,
    );
  }

  const prerelease = prereleaseIdentifiers.length > 0;
  return {
    prerelease,
    expectedBranch: prerelease ? "beta" : "main",
    version: tagVersion,
  };
}

export function validateReleaseCommit({ root = defaultRoot, tag, expectedBranch }) {
  const tagCommit = execFileSync(
    "git",
    ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`],
    { cwd: root, encoding: "utf8" },
  ).trim();

  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", tagCommit, `refs/remotes/origin/${expectedBranch}`],
      { cwd: root, stdio: "ignore" },
    );
  } catch {
    throw new Error(
      `Release tag ${tag} commit ${tagCommit} does not belong to ${expectedBranch}`,
    );
  }

  return tagCommit;
}

function run() {
  const tag = process.env.GITHUB_REF_NAME;
  if (!tag) throw new Error("GITHUB_REF_NAME is required");

  const packageJson = JSON.parse(
    readFileSync(path.join(defaultRoot, "package.json"), "utf8"),
  );
  const release = classifyReleaseTag(tag, packageJson.version);
  validateReleaseCommit({
    root: defaultRoot,
    tag,
    expectedBranch: release.expectedBranch,
  });

  if (!process.env.GITHUB_OUTPUT) {
    throw new Error("GITHUB_OUTPUT is required");
  }
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `prerelease=${release.prerelease}\nexpected_branch=${release.expectedBranch}\n`,
  );
  console.log(
    `Release contract valid: ${tag} matches package.json and belongs to ${release.expectedBranch}.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) run();

#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFiles = [
  "docker-compose.yml",
  "docker-compose.release.yml",
  "docker-compose.host-discovery.yml",
];

// These are runtime-owned container settings, not operator-facing contract
// variables. Compose deliberately supplies them directly.
const runtimeOnly = new Map([
  ["DATABASE_PATH", "fixed container persistence path"],
  ["HOST", "fixed container listen address"],
  ["NODE_ENV", "fixed production mode"],
  ["PORT", "fixed internal container port"],
]);

// PUBLIC_URL remains a compatibility alias for APP_URL. New deployments must
// document and pass APP_URL instead of extending the legacy surface.
runtimeOnly.set("PUBLIC_URL", "legacy alias for APP_URL");

// These variables control Compose/image selection rather than Rackpad runtime.
const deploymentOnly = new Map([
  ["GITHUB_REPO_OWNER", "source-build image owner"],
  ["RACKPAD_IMAGE", "release image repository"],
  ["RACKPAD_PORT", "host-to-container port mapping"],
  ["RACKPAD_TAG", "container image channel or version"],
]);

function walkTypeScript(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "tests") files.push(...walkTypeScript(entryPath));
    } else if (entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

function runtimeVariables() {
  const names = new Set();
  const direct = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])/g;
  const injectedEnvironment = /environment\.([A-Z][A-Z0-9_]*)/g;
  const namedHelper = /(?:envFlag|envInteger|parseDelimitedEnv|splitEnv|discoveryQueueLimit)\(\s*["']([A-Z][A-Z0-9_]*)["']/g;

  for (const file of walkTypeScript(path.join(root, "server"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(direct)) names.add(match[1] ?? match[2]);
    for (const match of source.matchAll(injectedEnvironment)) names.add(match[1]);
    for (const match of source.matchAll(namedHelper)) names.add(match[1]);
  }
  return names;
}

function exampleVariables() {
  const values = new Map();
  for (const line of readFileSync(path.join(root, ".env.example"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function interpolations(value) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-(.*?))?\}/g)].map(
    (match) => ({ name: match[1], defaultValue: match[2] }),
  );
}

function walkInterpolations(value, visit, location) {
  if (typeof value === "string") {
    for (const interpolation of interpolations(value)) {
      visit(interpolation, location);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      walkInterpolations(entry, visit, `${location}[${index}]`),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      walkInterpolations(entry, visit, `${location}.${key}`);
    }
  }
}

const runtime = runtimeVariables();
const example = exampleVariables();
const exampleSet = new Set(example.keys());
const failures = [];

for (const name of runtime) {
  if (!runtimeOnly.has(name) && !exampleSet.has(name)) {
    failures.push(`${name} is read by server code but missing from .env.example`);
  }
}
for (const name of example.keys()) {
  if (!runtime.has(name) && !deploymentOnly.has(name)) {
    failures.push(`${name} is in .env.example without a runtime or deployment decision`);
  }
}
for (const name of deploymentOnly.keys()) {
  if (!exampleSet.has(name)) {
    failures.push(`${name} is a Compose-only variable but missing from .env.example`);
  }
}

for (const composeFile of composeFiles) {
  const document = YAML.parse(readFileSync(path.join(root, composeFile), "utf8"));
  const service = document?.services?.rackpad ?? {};
  const environment = service.environment ?? {};
  for (const name of runtime) {
    if (runtimeOnly.has(name)) continue;
    if (!(name in environment)) {
      failures.push(`${name} is missing from ${composeFile} service environment`);
      continue;
    }
    if (!String(environment[name]).includes(`\${${name}`)) {
      failures.push(`${name} is not passed through from the host in ${composeFile}`);
    }
  }

  walkInterpolations(
    service,
    ({ name }) => {
      if (
        !runtime.has(name) &&
        !runtimeOnly.has(name) &&
        !deploymentOnly.has(name)
      ) {
        failures.push(`${name} is used by ${composeFile} without a contract classification`);
      }
    },
    `${composeFile}.services.rackpad`,
  );

  const defaultCheckedSurfaces = {
    image: service.image,
    ports: service.ports,
    environment,
  };
  walkInterpolations(
    defaultCheckedSurfaces,
    ({ name, defaultValue }, location) => {
      if (defaultValue === undefined || !example.has(name)) return;
      const documentedDefault = example.get(name);
      if (defaultValue !== documentedDefault) {
        failures.push(
          `${name} defaults to ${JSON.stringify(defaultValue)} in ${location} but ${JSON.stringify(documentedDefault)} in .env.example`,
        );
      }
    },
    `${composeFile}.services.rackpad`,
  );
}

if (failures.length > 0) {
  throw new Error(`Environment contract drift:\n- ${failures.join("\n- ")}`);
}

console.log(
  `Environment contract valid: ${runtime.size - runtimeOnly.size} runtime and ${deploymentOnly.size} Compose-only variables across ${composeFiles.length} Compose files.`,
);

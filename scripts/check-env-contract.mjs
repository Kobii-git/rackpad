#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");
const composeFiles = [
  "docker-compose.yml",
  "docker-compose.release.yml",
  "docker-compose.host-discovery.yml",
];
const nativeEnvironmentFile = "deploy/proxmox/rackpad.env.example";

// These settings are owned by each runtime rather than exposed as equivalent
// Docker operator variables. The native template pins its own values below.
const runtimeOnly = new Map([
  ["DATABASE_PATH", "fixed persistence path"],
  ["HOST", "fixed listen address"],
  ["NODE_ENV", "fixed production mode"],
  ["PORT", "fixed internal port"],
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

const nativeFixed = new Map([
  ["NODE_ENV", "production"],
  ["HOST", "0.0.0.0"],
  ["PORT", "3000"],
  ["DATABASE_PATH", "/opt/rackpad_data/rackpad.db"],
  ["RACKPAD_NATIVE_BACKUP_DIR", "/opt/rackpad_data/backups"],
]);

// These are the only operator-facing defaults that intentionally differ from
// .env.example. They keep a fresh unprivileged LXC within its safer baseline.
const nativeDefaultOverrides = new Map([
  ["DISCOVERY_MAC_SCAN_MODE", "neighbor"],
  ["SNMP_TRAP_ENABLED", "0"],
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

function runtimeVariables(root) {
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

function environmentVariables(file, failures, label) {
  const values = new Map();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    if (values.has(match[1])) failures.push(`${match[1]} is duplicated in ${label}`);
    values.set(match[1], match[2]);
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
    for (const interpolation of interpolations(value)) visit(interpolation, location);
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

export function inspectEnvironmentContract(root = defaultRoot) {
  const runtime = runtimeVariables(root);
  const failures = [];
  const example = environmentVariables(
    path.join(root, ".env.example"),
    failures,
    ".env.example",
  );
  const native = environmentVariables(
    path.join(root, nativeEnvironmentFile),
    failures,
    nativeEnvironmentFile,
  );
  const exampleSet = new Set(example.keys());

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
        if (!runtime.has(name) && !runtimeOnly.has(name) && !deploymentOnly.has(name)) {
          failures.push(`${name} is used by ${composeFile} without a contract classification`);
        }
      },
      `${composeFile}.services.rackpad`,
    );

    walkInterpolations(
      { image: service.image, ports: service.ports, environment },
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

  for (const name of runtime) {
    if (name === "PUBLIC_URL") continue;
    if (!native.has(name)) {
      failures.push(`${name} is missing from ${nativeEnvironmentFile}`);
    }
  }
  for (const name of native.keys()) {
    if (!runtime.has(name)) {
      failures.push(`${name} is in ${nativeEnvironmentFile} but is not read by server code`);
    }
  }
  for (const [name, expected] of nativeFixed) {
    if (native.get(name) !== expected) {
      failures.push(
        `${name} must be ${JSON.stringify(expected)} in ${nativeEnvironmentFile}`,
      );
    }
  }
  for (const name of runtime) {
    if (!example.has(name) || nativeFixed.has(name)) continue;
    const expected = nativeDefaultOverrides.get(name) ?? example.get(name);
    if (native.get(name) !== expected) {
      const qualifier = nativeDefaultOverrides.has(name)
        ? "approved native default"
        : ".env.example default";
      failures.push(
        `${name} defaults to ${JSON.stringify(native.get(name))} in ${nativeEnvironmentFile} but must match the ${qualifier} ${JSON.stringify(expected)}`,
      );
    }
  }

  return {
    failures,
    runtimeCount: runtime.size - runtimeOnly.size,
    nativeCount: native.size,
  };
}

export function validateEnvironmentContract(root = defaultRoot) {
  const result = inspectEnvironmentContract(root);
  if (result.failures.length > 0) {
    throw new Error(`Environment contract drift:\n- ${result.failures.join("\n- ")}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const result = validateEnvironmentContract();
  console.log(
    `Environment contract valid: ${result.runtimeCount} operator runtime variables across ${composeFiles.length} Compose files; native template has ${result.nativeCount} fixed and operator variables.`,
  );
}

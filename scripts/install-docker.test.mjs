import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import YAML from "yaml";

const root = path.resolve(import.meta.dirname, "..");
const canonical = readFileSync(path.join(root, "docker-compose.release.yml"), "utf8");
const legacy = readFileSync(path.join(root, "scripts/fixtures/installer-legacy.yml"), "utf8");
const docker = spawnSync("which", ["docker"], { encoding: "utf8" }).stdout.trim();
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function fixture(options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "rackpad-installer-test-"));
  const install = path.join(directory, "deployment");
  mkdirSync(path.join(directory, "bin"));
  mkdirSync(install);
  writeFileSync(path.join(directory, "manifest.yml"), options.invalid ? "services: [invalid" : canonical);
  writeFileSync(path.join(directory, "bin/docker"), `#!/usr/bin/env bash
set -eu
if [[ "$1" == compose ]]; then
  if [[ "\u0024{ALTER_KEY_READBACK:-}" == yes && " $* " == *' config --environment '* ]]; then
    count=0
    [[ ! -f "$FIXTURE/key-reads" ]] || count="$(cat "$FIXTURE/key-reads")"
    count=$((count + 1))
    echo "$count" >"$FIXTURE/key-reads"
    if (( count == 2 )); then echo 'RACKPAD_SECRET_KEY=fixture-altered-key'; exit 0; fi
  fi
  case " $* " in
    *' pull '*) echo pull >> "$FIXTURE/actions"; exit 0 ;;
    *' up '*) echo up >> "$FIXTURE/actions"; exit 0 ;;
  esac
  exec ${quote(docker)} "$@"
fi
case "$1" in
  info) exit 0 ;;
  volume) [[ "\u0024{HAS_VOLUME:-}" != yes ]] || echo deployment_rackpad_data ;;
  ps) exit 0 ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
  writeFileSync(path.join(directory, "bin/curl"), `#!/usr/bin/env bash
set -eu
[[ "\u0024{FAIL_DOWNLOAD:-}" != yes ]] || exit 22
while (( $# )); do
  if [[ "$1" == https:* ]]; then echo "$1" > "$FIXTURE/url"; fi
  if [[ "$1" == -o ]]; then cp "$FIXTURE/manifest.yml" "$2"; exit; fi
  shift
done
exit 1
`, { mode: 0o700 });
  if (options.env !== undefined) writeFileSync(path.join(install, ".env"), options.env);
  if (options.compose) writeFileSync(path.join(install, "compose.yml"), options.compose);
  if (options.managed) writeFileSync(path.join(install, "compose.yml.installer.sha256"), createHash("sha256").update(options.compose).digest("hex") + "\n");
  const result = spawnSync("bash", ["-c", 'source "$1"; run() { "$@"; }; install_rackpad', "fixture", path.join(root, "scripts/install-docker.sh")], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${directory}/bin:${process.env.PATH}`, FIXTURE: directory, INSTALL_DIR: install,
      RACKPAD_IMAGE: "ghcr.io/kobii-git/rackpad", RACKPAD_TAG: "latest", RACKPAD_SECRET_KEY: "", ...options.variables },
  });
  return { directory, install, result, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

// Uses the real Compose parser while stubbing all daemon and network mutations.
// CI installs Docker Compose. Missing Docker fails the deployment contract.
for (const [tag, ref] of [["latest", "main"], ["beta", "beta"], ["dev", "dev"], ["1.8.2-beta.5", "v1.8.2-beta.5"]]) {
  test(`fresh ${tag} selects ${ref}, forwards all runtime options, and generates one private key`, () => {
    const f = fixture({ variables: { RACKPAD_TAG: tag } });
    try {
      assert.equal(f.result.status, 0, f.result.stderr);
      assert.match(readFileSync(path.join(f.directory, "url"), "utf8").trim(), new RegExp(`/${ref}/docker-compose.release.yml$`));
      assert.equal(readFileSync(path.join(f.install, "compose.yml"), "utf8"), canonical);
      const env = readFileSync(path.join(f.install, ".env"), "utf8");
      const key = env.match(/^RACKPAD_SECRET_KEY=([a-f0-9]{64})$/m)?.[1];
      assert(key);
      assert(!`${f.result.stdout}${f.result.stderr}`.includes(key));
      assert.equal(statSync(path.join(f.install, ".env")).mode & 0o777, 0o600);
      const settings = YAML.parse(canonical).services.rackpad.environment;
      const synthetic = Object.keys(settings).filter((name) => String(settings[name]).includes("${")).map((name) => `${name}=fixture-${name}`).join("\n");
      writeFileSync(path.join(f.directory, "synthetic.env"), synthetic);
      const render = spawnSync(docker, ["compose", "--env-file", path.join(f.directory, "synthetic.env"), "-f", path.join(f.install, "compose.yml"), "config", "--format", "json"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME } });
      assert.equal(render.status, 0, render.stderr);
      const actual = JSON.parse(render.stdout).services.rackpad.environment;
      for (const name of Object.keys(settings).filter((name) => String(settings[name]).includes("${"))) assert.equal(actual[name], `fixture-${name}`, name);
    } finally { f.cleanup(); }
  });
}

test("legacy upgrade preserves existing values/key, volume identity, and a protected backup", () => {
  const env = "RACKPAD_TAG=beta\nRACKPAD_SECRET_KEY=fixture-existing-key\nOIDC_CLIENT_SECRET=fixture-oidc\nRACKPAD_PORT=4321\n";
  const f = fixture({ compose: legacy, env, variables: { RACKPAD_TAG: "dev" } });
  try {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.equal(readFileSync(path.join(f.install, ".env"), "utf8"), env);
    const backup = readdirSync(f.install).find((name) => name.startsWith("compose.yml.backup."));
    assert.equal(readFileSync(path.join(f.install, backup), "utf8"), legacy);
    assert.equal(statSync(path.join(f.install, backup)).mode & 0o777, 0o600);
    assert.match(readFileSync(path.join(f.directory, "url"), "utf8"), /\/beta\//);
    assert.deepEqual(YAML.parse(canonical).services.rackpad.volumes, YAML.parse(legacy).services.rackpad.volumes);
    assert(!`${f.result.stdout}${f.result.stderr}`.includes("fixture-existing-key"));
  } finally { f.cleanup(); }
});

test("malformed existing environment fails without exposing secrets or replacing configuration", () => {
  const key = "fixture-private-sentinel";
  const env = `RACKPAD_SECRET_KEY='${key}\n`;
  const f = fixture({ compose: legacy, env });
  try {
    assert.notEqual(f.result.status, 0);
    assert.match(f.result.stderr, /Compose failed/);
    assert(!`${f.result.stdout}${f.result.stderr}`.includes(key));
    assert.equal(readFileSync(path.join(f.install, ".env"), "utf8"), env);
    assert.equal(readFileSync(path.join(f.install, "compose.yml"), "utf8"), legacy);
    assert.deepEqual(readdirSync(f.install).sort(), [".env", "compose.yml"]);
    assert(!readdirSync(f.directory).includes("actions"));
  } finally { f.cleanup(); }
});

test("custom Compose is preserved with an adjacent proposal and no start", () => {
  const custom = legacy.replace("3000}:3000", "4444}:3000");
  const f = fixture({ compose: custom, env: "RACKPAD_SECRET_KEY=fixture-key\n" });
  try {
    assert.equal(f.result.status, 2, f.result.stderr);
    assert.equal(readFileSync(path.join(f.install, "compose.yml"), "utf8"), custom);
    assert(readdirSync(f.install).some((name) => name.startsWith("compose.yml.proposed.")));
    assert(!readdirSync(f.directory).includes("actions"));
  } finally { f.cleanup(); }
});

for (const [name, options] of [
  ["download failure", { variables: { FAIL_DOWNLOAD: "yes" } }],
  ["invalid manifest", { invalid: true }],
  ["missing old key", { env: "RACKPAD_TAG=beta\n" }],
  ["inherited key cannot replace missing persisted key", { env: "RACKPAD_TAG=beta\n", variables: { RACKPAD_SECRET_KEY: "fixture-inherited-key" } }],
]) {
  test(`${name} leaves existing files intact and does not start`, () => {
    const env = options.env ?? "RACKPAD_SECRET_KEY=fixture-key\n";
    const f = fixture({ ...options, compose: legacy, env });
    try {
      assert.notEqual(f.result.status, 0);
      assert.equal(readFileSync(path.join(f.install, "compose.yml"), "utf8"), legacy);
      assert.equal(readFileSync(path.join(f.install, ".env"), "utf8"), env);
      assert(!readdirSync(f.directory).includes("actions"));
    } finally { f.cleanup(); }
  });
}

test("an orphan volume prevents fresh key generation", () => {
  const f = fixture({ variables: { HAS_VOLUME: "yes" } });
  try { assert.notEqual(f.result.status, 0); assert.deepEqual(readdirSync(f.install), []); }
  finally { f.cleanup(); }
});

test("custom images use the stable manifest", () => {
  const f = fixture({ variables: { RACKPAD_IMAGE: "registry.example/rackpad", RACKPAD_TAG: "custom" } });
  try {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.match(readFileSync(path.join(f.directory, "url"), "utf8"), /\/main\//);
  } finally { f.cleanup(); }
});

test("a recognized managed manifest can be upgraded without changing quoted environment values", () => {
  const env = "RACKPAD_TAG=beta\nRACKPAD_SECRET_KEY='fixture-persisted-key'\nOIDC_CLIENT_SECRET='fixture-$literal'\n";
  const f = fixture({ compose: canonical, env, managed: true });
  try {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.equal(readFileSync(path.join(f.install, ".env"), "utf8"), env);
    assert.equal(readFileSync(path.join(f.install, "compose.yml"), "utf8"), canonical);
    assert(!f.result.stdout.includes("fixture-persisted-key"));
    assert(!f.result.stderr.includes("fixture-persisted-key"));
  } finally { f.cleanup(); }
});

for (const [label, key] of [
  ["comment delimiter", "fixture-key #suffix"],
  ["leading whitespace", "  fixture-key"],
  ["trailing whitespace", "fixture-key  "],
  ["literal hash", "fixture#key"],
]) {
  test(`supplied key preserves ${label} through real Compose parsing`, () => {
    const f = fixture({ variables: { RACKPAD_SECRET_KEY: key } });
    try {
      assert.equal(f.result.status, 0, f.result.stderr);
      const rendered = spawnSync(docker, ["compose", "--env-file", path.join(f.install, ".env"), "-f", path.join(f.install, "compose.yml"), "config", "--format", "json"], {
        encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME },
      });
      assert.equal(rendered.status, 0, rendered.stderr);
      assert.equal(JSON.parse(rendered.stdout).services.rackpad.environment.RACKPAD_SECRET_KEY, key);
      assert(!`${f.result.stdout}${f.result.stderr}`.includes(key));
      assert.equal(statSync(path.join(f.install, ".env")).mode & 0o777, 0o600);
    } finally { f.cleanup(); }
  });
}

for (const [label, key] of [
  ["newline", "fixture\nkey"],
  ["carriage return", "fixture\rkey"],
  ["single quote", "fixture'key"],
  ["double quote", 'fixture"key'],
  ["dollar", "fixture$key"],
  ["backtick", "fixture`key"],
  ["backslash", "fixture\\key"],
]) {
  test(`unsupported supplied key with ${label} is rejected without writing or starting`, () => {
    const f = fixture({ variables: { RACKPAD_SECRET_KEY: key } });
    try {
      assert.notEqual(f.result.status, 0);
      assert.deepEqual(readdirSync(f.install), []);
      assert(!readdirSync(f.directory).includes("actions"));
      assert(!`${f.result.stdout}${f.result.stderr}`.includes(key));
    } finally { f.cleanup(); }
  });
}

test("a changed final key readback preserves existing configuration and never pulls or starts", () => {
  const env = "RACKPAD_SECRET_KEY='fixture-original #key'\nRACKPAD_TAG=beta\n";
  const f = fixture({ compose: canonical, env, managed: true, variables: { ALTER_KEY_READBACK: "yes" } });
  try {
    assert.notEqual(f.result.status, 0);
    assert.match(f.result.stderr, /persisted encryption key did not match/);
    assert.equal(readFileSync(path.join(f.install, ".env"), "utf8"), env);
    assert.equal(readFileSync(path.join(f.install, "compose.yml"), "utf8"), canonical);
    assert(!readdirSync(f.directory).includes("actions"));
    assert(!`${f.result.stdout}${f.result.stderr}`.includes("fixture-original"));
    assert(!`${f.result.stdout}${f.result.stderr}`.includes("fixture-altered"));
  } finally { f.cleanup(); }
});

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateEnvironmentContract } from "./check-env-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const copiedFiles = [
  ".env.example",
  "docker-compose.yml",
  "docker-compose.release.yml",
  "docker-compose.host-discovery.yml",
  "deploy/proxmox/rackpad.env.example",
];

function createFixture(t) {
  const fixture = mkdtempSync(path.join(tmpdir(), "rackpad-env-contract-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  cpSync(path.join(root, "server"), path.join(fixture, "server"), {
    recursive: true,
  });
  for (const file of copiedFiles) {
    const destination = path.join(fixture, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(root, file), destination);
  }
  return fixture;
}

function updateNativeFixture(fixture, transform) {
  const file = path.join(fixture, "deploy/proxmox/rackpad.env.example");
  writeFileSync(file, transform(readFileSync(file, "utf8")));
}

test("repository environment contracts and approved native defaults are aligned", () => {
  assert.doesNotThrow(() => validateEnvironmentContract(root));
});

test("detects an operator-facing variable missing from the native template", (t) => {
  const fixture = createFixture(t);
  updateNativeFixture(fixture, (source) => source.replace(/^OIDC_LABEL=.*\n/m, ""));

  assert.throws(
    () => validateEnvironmentContract(fixture),
    /OIDC_LABEL is missing from deploy\/proxmox\/rackpad\.env\.example/,
  );
});

test("rejects native default drift outside the two approved safer defaults", (t) => {
  const fixture = createFixture(t);
  updateNativeFixture(fixture, (source) =>
    source.replace(/^OUI_AUTO_UPDATE=1$/m, "OUI_AUTO_UPDATE=0"),
  );

  assert.throws(
    () => validateEnvironmentContract(fixture),
    /OUI_AUTO_UPDATE defaults to "0".*must match the \.env\.example default "1"/,
  );
});

test("rejects drift in native persistent paths", (t) => {
  const fixture = createFixture(t);
  updateNativeFixture(fixture, (source) =>
    source.replace(
      /^DATABASE_PATH=.*$/m,
      "DATABASE_PATH=/opt/rackpad/rackpad.db",
    ),
  );

  assert.throws(
    () => validateEnvironmentContract(fixture),
    /DATABASE_PATH must be "\/opt\/rackpad_data\/rackpad\.db"/,
  );
});

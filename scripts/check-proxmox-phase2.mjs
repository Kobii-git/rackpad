#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relativeFiles = [
  "scripts/install-proxmox-lxc.sh",
  "deploy/proxmox/run.sh",
  "deploy/proxmox/core-ref",
  "deploy/proxmox/ct/rackpad.sh",
  "deploy/proxmox/install/rackpad-install.sh",
  "deploy/proxmox/json/rackpad.json",
  "deploy/proxmox/systemd/rackpad.service",
  "deploy/proxmox/discovery/safe-capabilities.conf",
  "deploy/proxmox/lib/native-common.sh",
  "deploy/proxmox/lib/environment-sync.sh",
  "deploy/proxmox/lib/build-release.sh",
  "deploy/proxmox/lib/install-operational-assets.sh",
  "deploy/proxmox/lib/native-update.sh",
];
const failures = [];

function source(file) {
  return readFileSync(path.join(root, file), "utf8");
}

for (const file of relativeFiles) {
  if (!existsSync(path.join(root, file))) failures.push(`Missing ${file}`);
}

const coreRef = source("deploy/proxmox/core-ref").trim();
if (coreRef !== "7cea42d8a3f7164d1813906f386c6d690eba7fc5") {
  failures.push("Community Scripts core pin does not match the approved revision");
}

const dispatcher = source("scripts/install-proxmox-lxc.sh");
const runner = source("deploy/proxmox/run.sh");
const ct = source("deploy/proxmox/ct/rackpad.sh");
const installer = source("deploy/proxmox/install/rackpad-install.sh");
const builder = source("deploy/proxmox/lib/build-release.sh");
const common = source("deploy/proxmox/lib/native-common.sh");
const updater = source("deploy/proxmox/lib/native-update.sh");
const operations = source("deploy/proxmox/lib/install-operational-assets.sh");
const service = source("deploy/proxmox/systemd/rackpad.service");
const metadata = JSON.parse(source("deploy/proxmox/json/rackpad.json"));

if (!dispatcher.includes("/releases/latest") || !dispatcher.includes("deploy/proxmox/run.sh")) {
  failures.push("Public dispatcher does not resolve the latest stable Release runner");
}
if (!dispatcher.includes("RACKPAD_MAINTAINER_MODE") || !dispatcher.includes("RACKPAD_MAINTAINER_REF")) {
  failures.push("Dispatcher maintainer overrides are not explicitly guarded");
}
if (!dispatcher.includes("A repository override requires RACKPAD_MAINTAINER_MODE=1")) {
  failures.push("Dispatcher repository overrides are not explicitly guarded");
}
if (!runner.includes("/tools/run.sh") || !runner.includes('"ct/rackpad.sh"')) {
  failures.push("Versioned runner is not paired with Community core/tools/run.sh");
}
if (!runner.includes("deploy/proxmox") || !runner.includes("core-ref")) {
  failures.push("Versioned runner does not pin both Rackpad scripts and Community core");
}
if (!runner.includes("Unstable releases require RACKPAD_MAINTAINER_MODE=1") ||
    !runner.includes("script-ref override requires RACKPAD_MAINTAINER_MODE=1")) {
  failures.push("Versioned runner does not guard unstable or script-ref overrides");
}
for (const expected of [
  'var_cpu="${var_cpu:-2}"',
  'var_ram="${var_ram:-4096}"',
  'var_disk="${var_disk:-16}"',
  'var_os="${var_os:-debian}"',
  'var_version="${var_version:-13}"',
  'var_arm64="${var_arm64:-no}"',
  'var_unprivileged="${var_unprivileged:-1}"',
  'var_nesting="${var_nesting:-1}"',
  'check_for_gh_release "rackpad"',
  "fetch_and_deploy_gh_release",
]) {
  if (!ct.includes(expected)) failures.push(`CT helper is missing ${expected}`);
}
if (!ct.includes("RACKPAD_MAINTAINER_RELEASE") ||
    !ct.includes("RACKPAD_ALLOW_PRERELEASE=1") ||
    !ct.includes("requires RACKPAD_MAINTAINER_MODE=1")) {
  failures.push("CT helper does not provide a guarded prerelease-update path for beta testing");
}
if (!common.includes('mv -Tf "$temporary" "$link"')) {
  failures.push("Atomic release switching does not replace the active symlink on GNU/Linux");
}

for (const forbidden of [/\bgit\s+pull\b/i, /\bdocker(?:-compose)?\s+(?:run|pull|up|build)\b/i]) {
  for (const [name, content] of [["CT helper", ct], ["installer", installer]]) {
    if (forbidden.test(content)) failures.push(`${name} contains forbidden deployment command ${forbidden}`);
  }
}

for (const dependency of [
  "build-essential",
  "python3",
  "sqlite3",
  "arp-scan",
  "iproute2",
  "iputils-ping",
  "net-tools",
  "nmap",
]) {
  if (!installer.includes(dependency)) failures.push(`Native installer is missing ${dependency}`);
}
if (!installer.includes('NODE_VERSION="22" setup_nodejs')) {
  failures.push("Native installer does not use Community core to install Node 22");
}
for (const installerControl of [
  "--shell /usr/sbin/nologin",
  "openssl rand -hex 32",
  "unset secret_key",
  "-o rackpad -g rackpad -m 0750",
  "install -m 0640 -o root -g rackpad",
]) {
  if (!installer.includes(installerControl)) {
    failures.push(`Native installer is missing control ${installerControl}`);
  }
}
for (const command of ["npm ci --include=dev", "npm run build", "npm prune --omit=dev"]) {
  if (!builder.includes(command)) failures.push(`Release build is missing ${command}`);
}
for (const asset of [
  "dist/index.html",
  "dist-server/index.js",
  "node_modules",
  "package.json",
  "scripts/collect-proxmox.sh",
  "scripts/collect-hyperv.ps1",
]) {
  if (!builder.includes(asset)) failures.push(`Runtime asset contract is missing ${asset}`);
}

if (metadata.interface_port !== 3000 || metadata.privileged !== false) {
  failures.push("Metadata does not declare port 3000 and unprivileged defaults");
}
if (JSON.stringify(metadata.architectures) !== JSON.stringify(["amd64"])) {
  failures.push("Metadata must claim amd64 support only");
}
const methods = metadata.install_methods ?? [];
if (!methods.some((method) => method.resources?.os === "Debian" && method.resources?.version === "13") ||
    !methods.some((method) => method.resources?.os === "Ubuntu" && method.resources?.version === "24.04")) {
  failures.push("Metadata must include Debian 13 and Ubuntu 24.04 methods");
}
if (metadata.default_credentials?.username !== null || metadata.default_credentials?.password !== null) {
  failures.push("Metadata credentials must remain null");
}
if (!String(metadata.logo).includes("selfhst/icons") || !String(metadata.logo).includes("rackpad.webp")) {
  failures.push("Metadata does not use the Rackpad selfh.st icon");
}

for (const directive of [
  "User=rackpad",
  "Group=rackpad",
  "NoNewPrivileges=true",
  "PrivateTmp=true",
  "ProtectSystem=strict",
  "ProtectHome=true",
  "ProtectKernelTunables=true",
  "UMask=0077",
  "CapabilityBoundingSet=",
  "AmbientCapabilities=",
  "ReadWritePaths=/opt/rackpad_data",
]) {
  if (!service.includes(directive)) failures.push(`Systemd hardening is missing ${directive}`);
}
const writablePaths = service
  .split(/\r?\n/)
  .filter((line) => line.startsWith("ReadWritePaths="));
if (writablePaths.some((line) => line !== "ReadWritePaths=/opt/rackpad_data")) {
  failures.push("Systemd grants writable access outside /opt/rackpad_data");
}

for (const endpoint of [
  "/api/health",
  "/api/auth/status",
  "/api/imports/proxmox-collector",
  "/api/imports/hyperv-collector",
]) {
  if (!updater.includes(endpoint)) failures.push(`Update verification is missing ${endpoint}`);
}
for (const rollbackControl of [
  'chmod 0600 "$snapshot"',
  "PRAGMA integrity_check",
  "operational-library",
  "operational-share",
  "Rollback validation failed. Rackpad remains stopped.",
  "Database snapshot:",
  "Environment backup:",
  "Previous release:",
  '[[ -f "${entry}/active-target" && -f "${entry}/rackpad.db" ]]',
]) {
  if (!updater.includes(rollbackControl)) failures.push(`Rollback contract is missing ${rollbackControl}`);
}
if (!operations.includes("rackpad-update.lock") || !operations.includes("flock -n 9")) {
  failures.push("Generated update entrypoint does not prevent concurrent transactions");
}
for (const pathName of [
  "/opt/rackpad_releases",
  "/opt/rackpad_data",
  "/etc/rackpad/rackpad.env",
  "/etc/rackpad/native-lxc",
  "/usr/bin/update",
]) {
  const combined = `${installer}\n${updater}\n${operations}`;
  if (!combined.includes(pathName)) failures.push(`Native deployment contract is missing ${pathName}`);
}

const nativeEnvironment = source("deploy/proxmox/rackpad.env.example");
if (!/^RACKPAD_SECRET_KEY=$/m.test(nativeEnvironment)) {
  failures.push("A non-empty Rackpad secret appears in a Proxmox asset");
}

if (failures.length > 0) {
  throw new Error(`Proxmox Phase 2 contract failed:\n- ${failures.join("\n- ")}`);
}

console.log(`Proxmox Phase 2 contract valid: ${relativeFiles.length} paired deployment assets checked.`);

#!/usr/bin/env bash
# Dynamic function overrides are intentional dependency injection for isolated
# rollback fixtures; each test runs in its own subshell.
# shellcheck disable=SC1091,SC2030,SC2031,SC2034,SC2317,SC2329
set -Eeuo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tests_run=0

fail() {
  echo "Proxmox fixture failed: $*" >&2
  exit 1
}

new_root() {
  mktemp -d "${TMPDIR:-/tmp}/rackpad-proxmox.XXXXXX"
}

test_environment_sync() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  export RACKPAD_ROOT_PREFIX="$fixture"
  template="${repository_root}/deploy/proxmox/rackpad.env.example"
  environment="${fixture}/rackpad.env"
  cat >"$environment" <<'EOF'
PORT=4321
OIDC_LABEL=Private login
LEGACY_OPTION=kept
EOF

  output="$(bash "${repository_root}/deploy/proxmox/lib/environment-sync.sh" "$template" "$environment")"
  grep -q '^PORT=4321$' "$environment" || fail "operator port was overwritten"
  grep -q '^OIDC_LABEL=Private login$' "$environment" || fail "operator value was overwritten"
  grep -q '^LEGACY_OPTION=kept$' "$environment" || fail "unknown key was removed"
  grep -q '^DATABASE_PATH=/opt/rackpad_data/rackpad.db$' "$environment" || fail "new key was not appended"
  [[ "$(stat -c '%a' "$environment" 2>/dev/null || stat -f '%Lp' "$environment")" == "640" ]] || fail "environment mode is not 0640"
  [[ "$output" == *"LEGACY_OPTION"* ]] || fail "unknown key warning is missing"
  [[ "$output" != *"4321"* && "$output" != *"Private login"* && "$output" != *"kept"* ]] || fail "environment values leaked to output"
)

test_collisions() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  export RACKPAD_ROOT_PREFIX="$fixture"
  # shellcheck source=../lib/native-common.sh
  source "${repository_root}/deploy/proxmox/lib/native-common.sh"
  mkdir -p "${fixture}/opt/rackpad"
  : >"${fixture}/opt/rackpad/compose.yml"
  if rp_refuse_compose_collision >/dev/null 2>&1; then
    fail "Docker Compose collision was accepted"
  fi

  rm -rf "${fixture}/opt/rackpad"
  mkdir -p "${fixture}/opt/rackpad_releases/v1.8.0" "${fixture}/etc/rackpad"
  ln -s "${fixture}/opt/rackpad_releases/v1.8.0" "${fixture}/opt/rackpad"
  if rp_refuse_compose_collision >/dev/null 2>&1; then
    fail "native symlink without marker was accepted"
  fi
  printf '%s\n' "$RACKPAD_NATIVE_MARKER_CONTENT" >"${fixture}/etc/rackpad/native-lxc"
  rp_refuse_compose_collision || fail "valid native installation was rejected"
)

test_operational_assets_are_version_aligned() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  export RACKPAD_ROOT_PREFIX="$fixture"
  release="${fixture}/opt/rackpad_releases/v1.8.1"
  mkdir -p "$release" "${fixture}/etc/rackpad"
  cp -R "${repository_root}/deploy" "$release/deploy"
  cat >"${fixture}/etc/rackpad/rackpad.env" <<'EOF'
PORT=4321
LEGACY_OPTION=kept
EOF
  systemctl_log="${fixture}/systemctl.log"
  # shellcheck source=../lib/install-operational-assets.sh
  source "${repository_root}/deploy/proxmox/lib/install-operational-assets.sh"
  rp_systemctl() { printf '%s\n' "$*" >>"$systemctl_log"; }
  output="$(rp_install_operational_assets \
    "$release" \
    "v1.8.1" \
    "https://raw.githubusercontent.com/Kobii-git/rackpad/v1.8.1/deploy/proxmox" \
    "7cea42d8a3f7164d1813906f386c6d690eba7fc5")"

  [[ "$(<"${fixture}/etc/rackpad/version")" == "v1.8.1" ]] || fail "version marker is not aligned"
  [[ "$(<"${fixture}/etc/rackpad/core-ref")" == "7cea42d8a3f7164d1813906f386c6d690eba7fc5" ]] || fail "core marker is not aligned"
  grep -q 'RACKPAD_RELEASE_TAG="v1.8.1"' "${fixture}/usr/bin/update" || fail "update entrypoint is not tag-pinned"
  grep -q 'community-scripts/core/7cea42d8a3f7164d1813906f386c6d690eba7fc5' "${fixture}/usr/bin/update" || fail "update entrypoint is not core-pinned"
  grep -q 'rackpad-update.lock' "${fixture}/usr/bin/update" || fail "update entrypoint is not transaction-locked"
  grep -q '^PORT=4321$' "${fixture}/etc/rackpad/rackpad.env" || fail "operational refresh overwrote operator config"
  grep -q '^LEGACY_OPTION=kept$' "${fixture}/etc/rackpad/rackpad.env" || fail "operational refresh removed unknown config"
  grep -q '^DISCOVERY_MAC_SCAN_MODE=neighbor$' "${fixture}/etc/rackpad/rackpad.env" || fail "fresh operational assets did not enforce safe discovery"
  cmp -s "${fixture}/etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf" \
    "${fixture}/usr/local/share/rackpad/discovery/safe-capabilities.conf" || fail "fresh operational assets did not install safe capabilities"
  [[ "$(stat -c '%a' "${fixture}/usr/local/sbin/rackpad-discovery-mode" 2>/dev/null || stat -f '%Lp' "${fixture}/usr/local/sbin/rackpad-discovery-mode")" == "700" ]] || fail "discovery mode command is not root-only"
  [[ "$output" != *"4321"* && "$output" != *"kept"* ]] || fail "operational refresh leaked environment values"
  grep -q '^daemon-reload$' "$systemctl_log" || fail "operational refresh did not reload systemd"

  sed -i.bak 's/^DISCOVERY_MAC_SCAN_MODE=.*/DISCOVERY_MAC_SCAN_MODE=auto/' \
    "${fixture}/etc/rackpad/rackpad.env"
  rm -f "${fixture}/etc/rackpad/rackpad.env.bak"
  cp "${fixture}/usr/local/share/rackpad/discovery/advanced-capabilities.conf" \
    "${fixture}/etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf"
  rp_install_operational_assets \
    "$release" \
    "v1.8.1" \
    "https://raw.githubusercontent.com/Kobii-git/rackpad/v1.8.1/deploy/proxmox" \
    "7cea42d8a3f7164d1813906f386c6d690eba7fc5" >/dev/null
  grep -q '^DISCOVERY_MAC_SCAN_MODE=auto$' "${fixture}/etc/rackpad/rackpad.env" || fail "operational refresh did not preserve advanced discovery"
  cmp -s "${fixture}/etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf" \
    "${fixture}/usr/local/share/rackpad/discovery/advanced-capabilities.conf" || fail "operational refresh did not preserve advanced capabilities"
)

make_discovery_fixture() {
  local fixture="$1" mode="${2:-safe}"
  mkdir -p \
    "${fixture}/etc/rackpad" \
    "${fixture}/etc/systemd/system/rackpad.service.d" \
    "${fixture}/usr/local/share/rackpad/discovery"
  printf '%s\n' "rackpad-native-lxc-v1" >"${fixture}/etc/rackpad/native-lxc"
  cp "${repository_root}/deploy/proxmox/discovery/safe-capabilities.conf" \
    "${fixture}/usr/local/share/rackpad/discovery/safe-capabilities.conf"
  cp "${repository_root}/deploy/proxmox/discovery/advanced-capabilities.conf" \
    "${fixture}/usr/local/share/rackpad/discovery/advanced-capabilities.conf"
  if [[ "$mode" == "advanced" ]]; then
    printf '%s\n' "DISCOVERY_MAC_SCAN_MODE=auto" "SNMP_TRAP_ENABLED=0" >"${fixture}/etc/rackpad/rackpad.env"
    cp "${fixture}/usr/local/share/rackpad/discovery/advanced-capabilities.conf" \
      "${fixture}/etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf"
  else
    printf '%s\n' "DISCOVERY_MAC_SCAN_MODE=neighbor" "SNMP_TRAP_ENABLED=0" >"${fixture}/etc/rackpad/rackpad.env"
    cp "${fixture}/usr/local/share/rackpad/discovery/safe-capabilities.conf" \
      "${fixture}/etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf"
  fi
}

test_safe_discovery_mode() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  make_discovery_fixture "$fixture" advanced
  export RACKPAD_ROOT_PREFIX="$fixture"
  systemctl_log="${fixture}/systemctl.log"
  # shellcheck source=../discovery/rackpad-discovery-mode.sh
  source "${repository_root}/deploy/proxmox/discovery/rackpad-discovery-mode.sh"
  rp_systemctl() {
    if [[ "$*" == "is-active --quiet rackpad" ]]; then return 0; fi
    printf '%s\n' "$*" >>"$systemctl_log"
  }
  rp_apply_discovery_mode safe >/dev/null
  grep -q '^DISCOVERY_MAC_SCAN_MODE=neighbor$' "${fixture}/etc/rackpad/rackpad.env" || fail "safe mode did not enforce neighbor discovery"
  grep -q '^SNMP_TRAP_ENABLED=0$' "${fixture}/etc/rackpad/rackpad.env" || fail "safe mode changed SNMP trap state"
  cmp -s "${fixture}/etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf" \
    "${fixture}/usr/local/share/rackpad/discovery/safe-capabilities.conf" || fail "safe mode did not clear capabilities"
  status="$(rp_discovery_status)"
  [[ "$status" == *"Discovery mode: safe"* && "$status" == *"SNMP traps: 0 (managed independently)"* ]] || fail "safe status is inaccurate"
  grep -q '^restart rackpad$' "$systemctl_log" || fail "safe mode did not restart Rackpad"
)

test_advanced_discovery_refusal() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  make_discovery_fixture "$fixture" safe
  export RACKPAD_ROOT_PREFIX="$fixture"
  cp "${fixture}/etc/rackpad/rackpad.env" "${fixture}/before.env"
  cp "${fixture}/etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf" \
    "${fixture}/before-capabilities.conf"
  # shellcheck source=../discovery/rackpad-discovery-mode.sh
  source "${repository_root}/deploy/proxmox/discovery/rackpad-discovery-mode.sh"
  rp_preflight_advanced_discovery() { return 1; }
  rp_systemctl() { fail "refused advanced mode touched systemd"; }
  if rp_apply_discovery_mode advanced >/dev/null 2>&1; then
    fail "advanced mode ignored a failed outer-LXC preflight"
  fi
  cmp -s "${fixture}/before.env" "${fixture}/etc/rackpad/rackpad.env" || fail "advanced refusal changed the environment"
  cmp -s "${fixture}/before-capabilities.conf" \
    "${fixture}/etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf" || fail "advanced refusal changed capabilities"
)

test_advanced_discovery_mode_and_rollback() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  make_discovery_fixture "$fixture" safe
  export RACKPAD_ROOT_PREFIX="$fixture"
  # shellcheck source=../discovery/rackpad-discovery-mode.sh
  source "${repository_root}/deploy/proxmox/discovery/rackpad-discovery-mode.sh"
  rp_preflight_advanced_discovery() { return 0; }
  rp_systemctl() {
    if [[ "$*" == "is-active --quiet rackpad" ]]; then return 0; fi
    return 0
  }
  rp_apply_discovery_mode advanced >/dev/null
  grep -q '^DISCOVERY_MAC_SCAN_MODE=auto$' "${fixture}/etc/rackpad/rackpad.env" || fail "advanced mode did not enable automatic MAC discovery"
  grep -q '^SNMP_TRAP_ENABLED=0$' "${fixture}/etc/rackpad/rackpad.env" || fail "advanced mode changed SNMP trap state"
  cmp -s "${fixture}/etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf" \
    "${fixture}/usr/local/share/rackpad/discovery/advanced-capabilities.conf" || fail "advanced mode did not install raw-network capabilities"
  [[ "$(rp_discovery_status)" == *"Discovery mode: advanced"* ]] || fail "advanced status is inaccurate"

  rp_apply_discovery_mode safe >/dev/null
  restart_count=0
  rp_systemctl() {
    case "$*" in
      "restart rackpad")
        restart_count=$((restart_count + 1))
        ((restart_count > 1))
        ;;
      "is-active --quiet rackpad") return 0 ;;
      *) return 0 ;;
    esac
  }
  if rp_apply_discovery_mode advanced >/dev/null 2>&1; then
    fail "failed advanced activation reported success"
  fi
  grep -q '^DISCOVERY_MAC_SCAN_MODE=neighbor$' "${fixture}/etc/rackpad/rackpad.env" || fail "failed advanced activation did not restore safe environment"
  cmp -s "${fixture}/etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf" \
    "${fixture}/usr/local/share/rackpad/discovery/safe-capabilities.conf" || fail "failed advanced activation did not restore safe capabilities"
)

make_update_fixture() {
  local fixture="$1"
  mkdir -p \
    "${fixture}/opt/rackpad_releases/v1.8.0" \
    "${fixture}/opt/rackpad_releases/v1.8.1/deploy/proxmox" \
    "${fixture}/opt/rackpad_data/update-rollback" \
    "${fixture}/etc/rackpad" \
    "${fixture}/etc/systemd/system/rackpad.service.d" \
    "${fixture}/usr/bin" \
    "${fixture}/usr/local/lib/rackpad" \
    "${fixture}/usr/local/share/rackpad" \
    "${fixture}/usr/local/sbin" \
    "${fixture}/root"
  ln -s "${fixture}/opt/rackpad_releases/v1.8.0" "${fixture}/opt/rackpad"
  printf '%s\n' "rackpad-native-lxc-v1" >"${fixture}/etc/rackpad/native-lxc"
  printf '%s\n' "v1.8.0" >"${fixture}/etc/rackpad/version"
  printf '%s\n' "https://raw.githubusercontent.com/Kobii-git/rackpad/v1.8.0/deploy/proxmox" >"${fixture}/etc/rackpad/script-origin"
  printf '%s\n' "old-core" >"${fixture}/etc/rackpad/core-ref"
  printf '%s\n' "PORT=3000" >"${fixture}/etc/rackpad/rackpad.env"
  printf '%s\n' "old-database" >"${fixture}/opt/rackpad_data/rackpad.db"
  printf '%s\n' "old-service" >"${fixture}/etc/systemd/system/rackpad.service"
  printf '%s\n' "old-dropin" >"${fixture}/etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf"
  printf '%s\n' "old-update" >"${fixture}/usr/bin/update"
  printf '%s\n' "old-library" >"${fixture}/usr/local/lib/rackpad/native-update.sh"
  printf '%s\n' "old-share" >"${fixture}/usr/local/share/rackpad/rackpad.env.example"
  printf '%s\n' "old-discovery-command" >"${fixture}/usr/local/sbin/rackpad-discovery-mode"
  printf '%s\n' "1.8.0" >"${fixture}/root/.rackpad"
  printf '%s\n' "7cea42d8a3f7164d1813906f386c6d690eba7fc5" >"${fixture}/opt/rackpad_releases/v1.8.1/deploy/proxmox/core-ref"
}

test_noop_update() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  make_update_fixture "$fixture"
  export RACKPAD_ROOT_PREFIX="$fixture"
  # shellcheck source=../lib/native-update.sh
  source "${repository_root}/deploy/proxmox/lib/native-update.sh"
  fetch_candidate() { fail "no-op update fetched a release"; }
  rp_systemctl() { fail "no-op update touched systemd"; }
  rackpad_transactional_update "v1.8.0" fetch_candidate >/dev/null
)

test_prerelease_ordering() (
  # shellcheck source=../lib/native-common.sh
  source "${repository_root}/deploy/proxmox/lib/native-common.sh"
  export RACKPAD_ALLOW_PRERELEASE=1
  rp_validate_release "v1.8.1-beta.2" || fail "valid prerelease was rejected"
  rp_release_is_newer "v1.8.1-beta.2" "v1.8.1-beta.1.1" || fail "Beta 2 was not newer than Beta 1.1"
  rp_release_is_newer "v1.8.1" "v1.8.1-beta.2" || fail "stable was not newer than its prerelease"
  if rp_release_is_newer "v1.8.0" "v1.8.1-beta.2"; then
    fail "older stable release was considered newer than Beta 2"
  fi
)

test_update_refuses_downgrade_before_download() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  make_update_fixture "$fixture"
  rm "${fixture}/opt/rackpad"
  mkdir -p "${fixture}/opt/rackpad_releases/v1.8.1-beta.2"
  ln -s "${fixture}/opt/rackpad_releases/v1.8.1-beta.2" "${fixture}/opt/rackpad"
  printf '%s\n' "v1.8.1-beta.2" >"${fixture}/etc/rackpad/version"
  export RACKPAD_ROOT_PREFIX="$fixture"
  unset RACKPAD_ALLOW_PRERELEASE
  # shellcheck source=../lib/native-update.sh
  source "${repository_root}/deploy/proxmox/lib/native-update.sh"
  fetch_candidate() { fail "downgrade attempted to fetch a release"; }
  rp_systemctl() { fail "downgrade touched systemd"; }
  if rackpad_transactional_update "v1.8.0" fetch_candidate >/dev/null 2>&1; then
    fail "downgrade was accepted"
  fi
)

test_build_failure_before_downtime() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  make_update_fixture "$fixture"
  export RACKPAD_ROOT_PREFIX="$fixture"
  systemctl_log="${fixture}/systemctl.log"
  # shellcheck source=../lib/native-update.sh
  source "${repository_root}/deploy/proxmox/lib/native-update.sh"
  rp_prepare_candidate() { return 1; }
  rp_systemctl() { printf '%s\n' "$*" >>"$systemctl_log"; }
  if rackpad_transactional_update "v1.8.1" ignored_fetch >/dev/null 2>&1; then
    fail "candidate preparation failure reported success"
  fi
  [[ ! -e "$systemctl_log" ]] || fail "service changed before candidate was built"
)

test_snapshot_failure_resumes_old_release() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  make_update_fixture "$fixture"
  export RACKPAD_ROOT_PREFIX="$fixture"
  systemctl_log="${fixture}/systemctl.log"
  # shellcheck source=../lib/native-update.sh
  source "${repository_root}/deploy/proxmox/lib/native-update.sh"
  rp_prepare_candidate() { RACKPAD_CANDIDATE_PATH="${fixture}/opt/rackpad_releases/v1.8.1"; }
  rp_snapshot_database() { return 1; }
  rp_systemctl() { printf '%s\n' "$*" >>"$systemctl_log"; }
  rp_verify_active_release() { [[ "$(readlink "${fixture}/opt/rackpad")" == "${fixture}/opt/rackpad_releases/v1.8.0" ]]; }
  if rackpad_transactional_update "v1.8.1" ignored_fetch >/dev/null 2>&1; then
    fail "snapshot failure reported success"
  fi
  grep -q '^stop rackpad$' "$systemctl_log" || fail "service was not stopped for snapshot"
  grep -q '^start rackpad$' "$systemctl_log" || fail "old service was not restarted"
)

test_asset_backup_failure_resumes_old_release() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  make_update_fixture "$fixture"
  rm -rf "${fixture}/usr/local/share/rackpad"
  export RACKPAD_ROOT_PREFIX="$fixture"
  systemctl_log="${fixture}/systemctl.log"
  # shellcheck source=../lib/native-update.sh
  source "${repository_root}/deploy/proxmox/lib/native-update.sh"
  rp_prepare_candidate() { RACKPAD_CANDIDATE_PATH="${fixture}/opt/rackpad_releases/v1.8.1"; }
  rp_snapshot_database() { fail "snapshot ran after an incomplete asset backup"; }
  rp_systemctl() { printf '%s\n' "$*" >>"$systemctl_log"; }
  rp_verify_active_release() { [[ "$(readlink "${fixture}/opt/rackpad")" == "${fixture}/opt/rackpad_releases/v1.8.0" ]]; }
  if rackpad_transactional_update "v1.8.1" ignored_fetch >/dev/null 2>&1; then
    fail "asset backup failure reported success"
  fi
  grep -q '^start rackpad$' "$systemctl_log" || fail "old service was not restarted after asset backup failure"
)

test_failed_candidate_rolls_back_everything() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  make_update_fixture "$fixture"
  export RACKPAD_ROOT_PREFIX="$fixture"
  systemctl_log="${fixture}/systemctl.log"
  # shellcheck source=../lib/native-update.sh
  source "${repository_root}/deploy/proxmox/lib/native-update.sh"
  rp_prepare_candidate() { RACKPAD_CANDIDATE_PATH="${fixture}/opt/rackpad_releases/v1.8.1"; }
  rp_snapshot_database() { cp "$1" "$2"; chmod 0600 "$2"; }
  rp_systemctl() { printf '%s\n' "$*" >>"$systemctl_log"; }
  rp_activate_candidate() {
    rp_atomic_symlink "${fixture}/opt/rackpad_releases/v1.8.1" "${fixture}/opt/rackpad"
    printf '%s\n' "new-database" >"${fixture}/opt/rackpad_data/rackpad.db"
    printf '%s\n' "v1.8.1" >"${fixture}/etc/rackpad/version"
    printf '%s\n' "new-service" >"${fixture}/etc/systemd/system/rackpad.service"
    printf '%s\n' "new-update" >"${fixture}/usr/bin/update"
    printf '%s\n' "new-library" >"${fixture}/usr/local/lib/rackpad/native-update.sh"
    printf '%s\n' "new-share" >"${fixture}/usr/local/share/rackpad/rackpad.env.example"
    printf '%s\n' "new-discovery-command" >"${fixture}/usr/local/sbin/rackpad-discovery-mode"
    return 1
  }
  rp_verify_active_release() {
    [[ "$(readlink "${fixture}/opt/rackpad")" == "${fixture}/opt/rackpad_releases/v1.8.0" ]] &&
      [[ "$(<"${fixture}/opt/rackpad_data/rackpad.db")" == "old-database" ]] &&
      [[ "$(<"${fixture}/etc/rackpad/version")" == "v1.8.0" ]] &&
      [[ "$(<"${fixture}/etc/systemd/system/rackpad.service")" == "old-service" ]] &&
      [[ "$(<"${fixture}/usr/bin/update")" == "old-update" ]] &&
      [[ "$(<"${fixture}/usr/local/lib/rackpad/native-update.sh")" == "old-library" ]] &&
      [[ "$(<"${fixture}/usr/local/share/rackpad/rackpad.env.example")" == "old-share" ]] &&
      [[ "$(<"${fixture}/usr/local/sbin/rackpad-discovery-mode")" == "old-discovery-command" ]]
  }
  if rackpad_transactional_update "v1.8.1" ignored_fetch >/dev/null 2>&1; then
    fail "failed candidate reported success"
  fi
  rp_verify_active_release || fail "paired rollback did not restore all state"
  rollback_count="$(find "${fixture}/opt/rackpad_data/update-rollback" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  [[ "$rollback_count" == "1" ]] || fail "paired rollback point was not retained"
)

test_retention_keeps_current_and_three_pairs() (
  fixture="$(new_root)"
  trap 'rm -rf "$fixture"' EXIT
  export RACKPAD_ROOT_PREFIX="$fixture"
  mkdir -p "${fixture}/opt/rackpad_releases" "${fixture}/opt/rackpad_data/update-rollback"
  for version in 0 1 2 3 4 5; do
    mkdir -p "${fixture}/opt/rackpad_releases/v1.8.${version}"
  done
  ln -s "${fixture}/opt/rackpad_releases/v1.8.5" "${fixture}/opt/rackpad"
  for version in 1 2 3 4; do
    point="${fixture}/opt/rackpad_data/update-rollback/2026080${version}T000000Z-${version}"
    mkdir -p "$point"
    printf '%s\n' "${fixture}/opt/rackpad_releases/v1.8.${version}" >"${point}/active-target"
    printf '%s\n' "snapshot-${version}" >"${point}/rackpad.db"
  done
  incomplete="${fixture}/opt/rackpad_data/update-rollback/20260805T000000Z-incomplete"
  mkdir -p "$incomplete"
  printf '%s\n' "${fixture}/opt/rackpad_releases/v1.8.0" >"${incomplete}/active-target"
  # shellcheck source=../lib/native-update.sh
  source "${repository_root}/deploy/proxmox/lib/native-update.sh"
  rp_cleanup_rollback_points
  rollback_count="$({
    find "${fixture}/opt/rackpad_data/update-rollback" -mindepth 1 -maxdepth 1 -type d -print0 |
      while IFS= read -r -d '' point; do
        if [[ -f "${point}/active-target" && -f "${point}/rackpad.db" ]]; then
          printf '.\n'
        fi
      done
  } | wc -l | tr -d ' ')"
  [[ "$rollback_count" == "3" ]] || fail "retention did not keep three paired rollback points"
  [[ -d "$incomplete" ]] || fail "retention removed an incomplete recovery directory"
  for version in 2 3 4 5; do
    [[ -d "${fixture}/opt/rackpad_releases/v1.8.${version}" ]] || fail "retention removed referenced release v1.8.${version}"
  done
  [[ ! -e "${fixture}/opt/rackpad_releases/v1.8.0" ]] || fail "unreferenced release v1.8.0 was retained"
  [[ ! -e "${fixture}/opt/rackpad_releases/v1.8.1" ]] || fail "expired paired release v1.8.1 was retained"
)

for fixture_test in \
  test_environment_sync \
  test_collisions \
  test_operational_assets_are_version_aligned \
  test_safe_discovery_mode \
  test_advanced_discovery_refusal \
  test_advanced_discovery_mode_and_rollback \
  test_noop_update \
  test_prerelease_ordering \
  test_update_refuses_downgrade_before_download \
  test_build_failure_before_downtime \
  test_snapshot_failure_resumes_old_release \
  test_asset_backup_failure_resumes_old_release \
  test_failed_candidate_rolls_back_everything \
  test_retention_keeps_current_and_three_pairs; do
  "$fixture_test"
  tests_run=$((tests_run + 1))
done

echo "Proxmox fixtures passed: ${tests_run} scenarios."

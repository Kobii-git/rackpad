#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${script_directory}/native-common.sh"

rp_http_get() {
  curl -fsS --connect-timeout 5 --max-time 15 "$@"
}

rp_verify_active_release() {
  local port base temporary trusted_host
  local request_arguments=()
  rp_systemctl is-active --quiet rackpad || return 1
  port="$(rp_read_env PORT)"
  [[ "$port" =~ ^[0-9]+$ ]] || return 1
  base="http://127.0.0.1:${port}"
  trusted_host="$(rp_read_env TRUSTED_HOSTS)"
  trusted_host="${trusted_host%%,*}"
  trusted_host="${trusted_host#"${trusted_host%%[![:space:]]*}"}"
  trusted_host="${trusted_host%"${trusted_host##*[![:space:]]}"}"
  if [[ -n "$trusted_host" ]]; then
    request_arguments=(-H "Host: ${trusted_host}")
  fi
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/rackpad-verify.XXXXXX")" || return

  if ! rp_http_get "${request_arguments[@]}" "${base}/api/health" -o "${temporary}/health" ||
    ! grep -q '"ok"[[:space:]]*:[[:space:]]*true' "${temporary}/health" ||
    ! rp_http_get "${request_arguments[@]}" "${base}/api/auth/status" -o "${temporary}/auth" ||
    ! grep -q '"needsBootstrap"' "${temporary}/auth" ||
    ! rp_http_get "${request_arguments[@]}" "${base}/" -o "${temporary}/index" ||
    ! grep -q 'id="root"' "${temporary}/index" ||
    ! rp_http_get "${request_arguments[@]}" "${base}/api/imports/proxmox-collector" -o "${temporary}/collect-proxmox.sh" ||
    ! grep -q '^#!/usr/bin/env bash' "${temporary}/collect-proxmox.sh" ||
    ! rp_http_get "${request_arguments[@]}" "${base}/api/imports/hyperv-collector" -o "${temporary}/collect-hyperv.ps1" ||
    ! grep -q '^param(' "${temporary}/collect-hyperv.ps1"; then
    rm -rf "$temporary"
    return 1
  fi

  rm -rf "$temporary"
}

rp_snapshot_database() {
  local database="${1:?database required}"
  local snapshot="${2:?snapshot required}"
  local integrity
  [[ -f "$database" && ! -L "$database" ]] || {
    rp_error "The active Rackpad database is missing or invalid."
    return 1
  }
  sqlite3 "$database" ".timeout 10000" ".backup '${snapshot}'" || return 1
  chmod 0600 "$snapshot" || return 1
  integrity="$(sqlite3 "$snapshot" 'PRAGMA integrity_check;')" || return 1
  [[ "$integrity" == "ok" ]] || {
    rp_error "The pre-update SQLite snapshot failed its integrity check."
    return 1
  }
}

rp_copy_required() {
  local source="${1:?source required}"
  local destination="${2:?destination required}"
  [[ -e "$source" || -L "$source" ]] || {
    rp_error "Required rollback input is missing: ${source}."
    return 1
  }
  cp -a "$source" "$destination"
}

rp_backup_update_state() {
  local rollback="${1:?rollback directory required}"
  local active active_target release_root
  active="$(rp_path /opt/rackpad)"
  release_root="$(rp_path /opt/rackpad_releases)"
  [[ -L "$active" ]] || {
    rp_error "The active Rackpad path is not an atomic release symlink."
    return 1
  }
  active_target="$(readlink "$active")"
  [[ "$active_target" == "${release_root}/"v* && -d "$active_target" && ! -L "$active_target" ]] || {
    rp_error "The active Rackpad release target is unavailable."
    return 1
  }

  install -d -m 0700 "$rollback" || return 1
  rp_write_text "${rollback}/active-target" 0600 "$active_target" || return 1
  ln -s "$active_target" "${rollback}/code" || return 1
  rp_copy_required "$(rp_path /etc/rackpad)" "${rollback}/etc-rackpad" || return 1
  rp_copy_required "$(rp_path /etc/systemd/system/rackpad.service)" "${rollback}/rackpad.service" || return 1
  rp_copy_required "$(rp_path /etc/systemd/system/rackpad.service.d)" "${rollback}/rackpad.service.d" || return 1
  rp_copy_required "$(rp_path /usr/bin/update)" "${rollback}/update" || return 1
  rp_copy_required "$(rp_path /root/.rackpad)" "${rollback}/community-version" || return 1
  rp_copy_required "$(rp_path /usr/local/lib/rackpad)" "${rollback}/operational-library" || return 1
  rp_copy_required "$(rp_path /usr/local/share/rackpad)" "${rollback}/operational-share" || return 1
  rp_copy_required "$(rp_path /usr/local/sbin/rackpad-discovery-mode)" "${rollback}/discovery-command" || return 1
}

rp_restore_update_state() {
  local rollback="${1:?rollback directory required}"
  local active_target database etc_rackpad release_root
  database="$(rp_path /opt/rackpad_data/rackpad.db)"
  etc_rackpad="$(rp_path /etc/rackpad)"
  release_root="$(rp_path /opt/rackpad_releases)"
  [[ -f "${rollback}/active-target" &&
    -f "${rollback}/rackpad.db" &&
    -d "${rollback}/etc-rackpad" &&
    -f "${rollback}/rackpad.service" &&
    -d "${rollback}/rackpad.service.d" &&
    -f "${rollback}/update" &&
    -f "${rollback}/community-version" &&
    -d "${rollback}/operational-library" &&
    -d "${rollback}/operational-share" &&
    -f "${rollback}/discovery-command" ]] || {
    rp_error "The paired rollback point is incomplete."
    return 1
  }
  active_target="$(<"${rollback}/active-target")"
  [[ "$active_target" == "${release_root}/"v* && -d "$active_target" && ! -L "$active_target" ]] || {
    rp_error "The rollback release target is invalid."
    return 1
  }

  rp_systemctl stop rackpad >/dev/null 2>&1 || true
  rm -f "${database}" "${database}-wal" "${database}-shm" || return 1
  install -m 0600 "${rollback}/rackpad.db" "$database" || return 1
  rp_set_rackpad_ownership rackpad:rackpad "$database" || return 1

  rm -rf "$etc_rackpad" || return 1
  cp -a "${rollback}/etc-rackpad" "$etc_rackpad" || return 1
  install -m 0644 "${rollback}/rackpad.service" "$(rp_path /etc/systemd/system/rackpad.service)" || return 1
  rm -rf "$(rp_path /etc/systemd/system/rackpad.service.d)" || return 1
  cp -a "${rollback}/rackpad.service.d" "$(rp_path /etc/systemd/system/rackpad.service.d)" || return 1
  install -m 0755 "${rollback}/update" "$(rp_path /usr/bin/update)" || return 1
  install -m 0600 "${rollback}/community-version" "$(rp_path /root/.rackpad)" || return 1
  rm -rf "$(rp_path /usr/local/lib/rackpad)" "$(rp_path /usr/local/share/rackpad)" || return 1
  cp -a "${rollback}/operational-library" "$(rp_path /usr/local/lib/rackpad)" || return 1
  cp -a "${rollback}/operational-share" "$(rp_path /usr/local/share/rackpad)" || return 1
  install -m 0700 "${rollback}/discovery-command" "$(rp_path /usr/local/sbin/rackpad-discovery-mode)" || return 1

  rp_atomic_symlink "$active_target" "$(rp_path /opt/rackpad)" || return 1
  rp_systemctl daemon-reload || return 1
  rp_systemctl start rackpad || return 1
  rp_verify_active_release
}

rp_prepare_candidate() {
  local release="${1:?release required}"
  local fetch_function="${2:?fetch function required}"
  local release_root staging final
  release_root="$(rp_path /opt/rackpad_releases)"
  staging="${release_root}/.staging-${release#v}-$$"
  final="${release_root}/${release}"

  install -d -m 0755 "$release_root" || return 1
  rm -rf "$staging" || return 1
  mkdir -m 0755 "$staging" || return 1

  if ! "$fetch_function" "$release" "$staging"; then
    rm -rf "$staging" || return 1
    rp_error "Release download failed before service downtime."
    return 1
  fi

  # Use the candidate's own build contract so operational assets and build
  # behavior remain aligned with the selected Rackpad tag.
  [[ -f "${staging}/deploy/proxmox/lib/build-release.sh" ]] || {
    rm -rf "$staging" || return 1
    rp_error "Release is missing its native build contract."
    return 1
  }
  # shellcheck source=/dev/null
  source "${staging}/deploy/proxmox/lib/build-release.sh" || {
    rm -rf "$staging"
    return 1
  }
  if ! rp_build_release "$release" "$staging"; then
    rm -rf "$staging"
    rp_error "Release build failed before service downtime."
    return 1
  fi

  if [[ -e "$final" ]]; then
    if ! rp_validate_release_assets "$final" ||
      ! rp_validate_release_identity "$release" "$final"; then
      rm -rf "$staging"
      rp_error "An invalid immutable release already exists at ${final}."
      return 1
    fi
    rm -rf "$staging" || return 1
  else
    mv "$staging" "$final" || return 1
  fi
  RACKPAD_CANDIDATE_PATH="$final"
}

rp_activate_candidate() {
  local release="${1:?release required}"
  local candidate="${2:?candidate required}"
  local script_origin="${3:?script origin required}"
  local core_ref="${4:?core ref required}"

  rp_atomic_symlink "$candidate" "$(rp_path /opt/rackpad)" || return 1
  # shellcheck source=/dev/null
  source "${candidate}/deploy/proxmox/lib/install-operational-assets.sh" || return 1
  rp_install_operational_assets "$candidate" "$release" "$script_origin" "$core_ref" || return 1
  rp_systemctl start rackpad || return 1
  rp_verify_active_release
}

rp_cleanup_rollback_points() {
  local rollback_root release_root active_target list keep entry count target cleanup_failed
  rollback_root="$(rp_path /opt/rackpad_data/update-rollback)"
  release_root="$(rp_path /opt/rackpad_releases)"
  active_target="$(readlink "$(rp_path /opt/rackpad)")"
  list="$(mktemp "${TMPDIR:-/tmp}/rackpad-rollbacks.XXXXXX")" || return
  keep="$(mktemp "${TMPDIR:-/tmp}/rackpad-releases.XXXXXX")" || {
    rm -f "$list"
    return 1
  }
  find "$rollback_root" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null |
    while IFS= read -r entry; do
      if [[ -f "${entry}/active-target" && -f "${entry}/rackpad.db" ]]; then
        printf '%s\n' "$entry"
      fi
    done |
    sort -r >"$list" || {
      rm -f "$list" "$keep"
      return 1
    }
  printf '%s\n' "$active_target" >"$keep" || {
    rm -f "$list" "$keep"
    return 1
  }
  count=0
  cleanup_failed=0
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    count=$((count + 1))
    if ((count <= 3)); then
      if [[ -f "${entry}/active-target" ]]; then
        target="$(<"${entry}/active-target")"
        if ! printf '%s\n' "$target" >>"$keep"; then
          cleanup_failed=1
          break
        fi
      fi
    else
      if ! rm -rf "$entry"; then
        cleanup_failed=1
        break
      fi
    fi
  done <"$list"
  if ((cleanup_failed == 1)); then
    rm -f "$list" "$keep"
    return 1
  fi

  find "$release_root" -mindepth 1 -maxdepth 1 -type d -name 'v*' -print 2>/dev/null |
    while IFS= read -r entry; do
      grep -Fxq "$entry" "$keep" || rm -rf "$entry"
    done || {
      rm -f "$list" "$keep"
      return 1
    }
  rm -f "$list" "$keep" || return 1
}

rackpad_transactional_update() {
  local release="${1:?release required}"
  local fetch_function="${2:?fetch function required}"
  local current candidate rollback_root rollback script_origin core_ref database

  rp_require_root || return 1
  rp_require_native_marker || return 1
  rp_refuse_compose_collision || return 1
  rp_validate_release "$release" || {
    rp_error "Updates require a stable Rackpad Release."
    return 1
  }

  [[ -f "$(rp_path /etc/rackpad/version)" ]] || {
    rp_error "The installed Rackpad version marker is missing."
    return 1
  }
  current="$(<"$(rp_path /etc/rackpad/version)")"
  rp_validate_release_identifier "$current" || {
    rp_error "The installed Rackpad version marker is invalid."
    return 1
  }
  if [[ "$(readlink "$(rp_path /opt/rackpad)")" != "$(rp_path "/opt/rackpad_releases/${current}")" ]]; then
    rp_error "The active Rackpad release and version marker are not aligned."
    return 1
  fi
  if [[ "$current" == "$release" ]]; then
    rp_info "No update available; ${release} is already active."
    return 0
  fi
  if ! rp_release_is_newer "$release" "$current"; then
    rp_error "Refusing non-forward update from ${current} to ${release}."
    return 1
  fi

  if ! rp_prepare_candidate "$release" "$fetch_function"; then
    return 1
  fi
  candidate="$RACKPAD_CANDIDATE_PATH"

  [[ "${RACKPAD_REPOSITORY:-Kobii-git/rackpad}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
    rp_error "Rackpad repository origin is invalid."
    return 1
  }
  script_origin="https://raw.githubusercontent.com/${RACKPAD_REPOSITORY:-Kobii-git/rackpad}/${release}/deploy/proxmox"
  [[ -f "${candidate}/deploy/proxmox/core-ref" ]] || {
    rp_error "Candidate core pin is missing."
    return 1
  }
  core_ref="$(<"${candidate}/deploy/proxmox/core-ref")"
  [[ "$core_ref" =~ ^[0-9a-f]{40}$ ]] || {
    rp_error "Candidate core pin is invalid."
    return 1
  }

  rollback_root="$(rp_path /opt/rackpad_data/update-rollback)"
  rollback="${rollback_root}/$(date -u +%Y%m%dT%H%M%SZ)-${current#v}-to-${release#v}-$$"
  database="$(rp_path /opt/rackpad_data/rackpad.db)"
  install -d -m 0700 "$rollback_root" || return 1

  rp_systemctl stop rackpad || return 1
  if ! rp_backup_update_state "$rollback" ||
    ! rp_snapshot_database "$database" "${rollback}/rackpad.db"; then
    rp_error "Pre-update backup failed; the active release was not changed."
    if rp_systemctl start rackpad && rp_verify_active_release; then
      return 1
    fi
    rp_systemctl stop rackpad >/dev/null 2>&1 || true
    rp_error "The previous release could not be validated. Rackpad remains stopped. Recovery files: ${rollback}"
    return 1
  fi

  if rp_activate_candidate "$release" "$candidate" "$script_origin" "$core_ref"; then
    rp_cleanup_rollback_points ||
      rp_error "The update succeeded, but old rollback-point cleanup needs attention."
    rp_info "Updated successfully to ${release}."
    return 0
  fi

  rp_error "The new release failed validation; restoring the paired rollback point."
  if rp_restore_update_state "$rollback"; then
    rp_cleanup_rollback_points ||
      rp_error "Rollback succeeded, but old rollback-point cleanup needs attention."
    rp_error "Update failed and Rackpad was restored to ${current}."
    return 1
  fi

  rp_systemctl stop rackpad >/dev/null 2>&1 || true
  rp_error "Rollback validation failed. Rackpad remains stopped."
  rp_error "Recovery directory: ${rollback}"
  rp_error "Database snapshot: ${rollback}/rackpad.db"
  rp_error "Environment backup: ${rollback}/etc-rackpad/rackpad.env"
  rp_error "Previous release: $(<"${rollback}/active-target")"
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  rp_error "Run updates through /usr/bin/update."
  exit 2
fi

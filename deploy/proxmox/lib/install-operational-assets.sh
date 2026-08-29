#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${script_directory}/native-common.sh"
# shellcheck source=/dev/null
source "${script_directory}/environment-sync.sh"

rp_write_update_entrypoint() {
  local release="${1:?release required}"
  local script_origin="${2:?script origin required}"
  local core_origin="${3:?core origin required}"
  local destination temporary

  rp_validate_release "$release" || return 1
  [[ "$script_origin" =~ ^https://raw\.githubusercontent\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9._/-]+$ ]] || return 1
  [[ "$core_origin" =~ ^https://raw\.githubusercontent\.com/community-scripts/core/[0-9a-f]{40}$ ]] || return 1

  destination="$(rp_path /usr/bin/update)"
  mkdir -p "$(dirname "$destination")" || return 1
  temporary="$(mktemp "${destination}.tmp.XXXXXX")" || return
  if ! cat >"$temporary" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
exec 9>/run/lock/rackpad-update.lock
if ! flock -n 9; then
  echo "Another Rackpad update is already running." >&2
  exit 1
fi
export RACKPAD_RELEASE_TAG="${release}"
export RACKPAD_SCRIPT_ORIGIN="${script_origin}"
export RACKPAD_CORE_ORIGIN="${core_origin}"
export RACKPAD_CORE_REF="${core_origin##*/}"
export COMMUNITY_SCRIPTS_URL="${script_origin}"
export COMMUNITY_SCRIPTS_CORE_URL="${core_origin}"
curl -fsSL "${core_origin}/tools/run.sh" | bash -s -- "${script_origin}" "ct/rackpad.sh" "${core_origin}"
EOF
  then
    rm -f "$temporary"
    return 1
  fi
  chmod 0755 "$temporary" || {
    rm -f "$temporary"
    return 1
  }
  rp_set_rackpad_ownership root:root "$temporary" || {
    rm -f "$temporary"
    return 1
  }
  mv -f "$temporary" "$destination" || {
    rm -f "$temporary"
    return 1
  }
}

rp_install_operational_assets() {
  local release_directory="${1:?release directory required}"
  local release="${2:?release required}"
  local script_origin="${3:?script origin required}"
  local core_ref="${4:?core ref required}"
  local core_origin="https://raw.githubusercontent.com/community-scripts/core/${core_ref}"
  local library_directory service_directory

  rp_validate_release "$release" || return 1
  [[ "$core_ref" =~ ^[0-9a-f]{40}$ ]] || return 1
  library_directory="$(rp_path /usr/local/lib/rackpad)"
  service_directory="$(rp_path /etc/systemd/system)"

  install -d -m 0755 "$library_directory" \
    "$(rp_path /usr/local/share/rackpad)" \
    "${service_directory}/rackpad.service.d" || return 1
  install -m 0755 "${release_directory}/deploy/proxmox/lib/native-common.sh" "$library_directory/native-common.sh" || return 1
  install -m 0755 "${release_directory}/deploy/proxmox/lib/environment-sync.sh" "$library_directory/environment-sync.sh" || return 1
  install -m 0755 "${release_directory}/deploy/proxmox/lib/build-release.sh" "$library_directory/build-release.sh" || return 1
  install -m 0755 "${release_directory}/deploy/proxmox/lib/install-operational-assets.sh" "$library_directory/install-operational-assets.sh" || return 1
  install -m 0755 "${release_directory}/deploy/proxmox/lib/native-update.sh" "$library_directory/native-update.sh" || return 1
  install -m 0644 "${release_directory}/deploy/proxmox/rackpad.env.example" "$(rp_path /usr/local/share/rackpad/rackpad.env.example)" || return 1
  install -m 0644 "${release_directory}/deploy/proxmox/systemd/rackpad.service" "${service_directory}/rackpad.service" || return 1
  install -m 0644 "${release_directory}/deploy/proxmox/discovery/safe-capabilities.conf" "${service_directory}/rackpad.service.d/10-safe-capabilities.conf" || return 1

  rp_sync_environment \
    "$(rp_path /usr/local/share/rackpad/rackpad.env.example)" \
    "$(rp_path /etc/rackpad/rackpad.env)" || return 1

  rp_write_text "$(rp_path /etc/rackpad/native-lxc)" 0644 "$RACKPAD_NATIVE_MARKER_CONTENT" || return 1
  rp_write_text "$(rp_path /etc/rackpad/version)" 0644 "$release" || return 1
  rp_write_text "$(rp_path /etc/rackpad/script-origin)" 0644 "$script_origin" || return 1
  rp_write_text "$(rp_path /etc/rackpad/core-ref)" 0644 "$core_ref" || return 1
  rp_write_update_entrypoint "$release" "$script_origin" "$core_origin" || return 1
  rp_write_text "$(rp_path /root/.rackpad)" 0600 "${release#v}" || return 1
  rm -f "$(rp_path /root/.rackpad-candidate)" || return 1

  rp_set_rackpad_ownership -R root:root "$library_directory" \
    "$(rp_path /usr/local/share/rackpad)" \
    "${service_directory}/rackpad.service" \
    "${service_directory}/rackpad.service.d/10-safe-capabilities.conf" || return 1
  rp_systemctl daemon-reload || return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  rp_require_root
  rp_install_operational_assets \
    "${1:?usage: install-operational-assets.sh DIRECTORY RELEASE SCRIPT_ORIGIN CORE_REF}" \
    "${2:?release required}" \
    "${3:?script origin required}" \
    "${4:?core ref required}"
fi

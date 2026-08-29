#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${script_directory}/native-common.sh"

rp_run_build_command() {
  if [[ -n "${STD:-}" ]]; then
    # shellcheck disable=SC2086
    $STD "$@"
  else
    "$@"
  fi
}

rp_validate_release_assets() {
  local release_directory="${1:?release directory required}"
  local required
  for required in \
    dist/index.html \
    dist-server/index.js \
    node_modules \
    package.json \
    scripts/collect-proxmox.sh \
    scripts/collect-hyperv.ps1 \
    deploy/proxmox/rackpad.env.example \
    deploy/proxmox/systemd/rackpad.service \
    deploy/proxmox/discovery/safe-capabilities.conf \
    deploy/proxmox/discovery/advanced-capabilities.conf \
    deploy/proxmox/discovery/rackpad-discovery-mode.sh \
    deploy/proxmox/lib/native-update.sh; do
    [[ -e "${release_directory}/${required}" ]] || {
      rp_error "Built release is missing required asset ${required}."
      return 1
    }
  done
}

rp_validate_release_identity() {
  local release="${1:?release required}"
  local release_directory="${2:?release directory required}"
  local package_version
  package_version="$(node -p "require('${release_directory}/package.json').version")" || return 1
  [[ "$package_version" == "${release#v}" ]]
}

rp_build_release() {
  local release="${1:?release required}"
  local release_directory="${2:?release directory required}"

  rp_validate_release "$release" || {
    rp_error "Invalid Rackpad release ${release}."
    return 1
  }
  [[ -d "$release_directory" && ! -L "$release_directory" ]] || {
    rp_error "Release source is not a real directory."
    return 1
  }

  rp_validate_release_identity "$release" "$release_directory" || {
    rp_error "Release tag and package.json version do not match."
    return 1
  }

  rp_info "Installing build dependencies for ${release}."
  (
    cd "$release_directory" &&
      rp_run_build_command npm ci --include=dev &&
      rp_run_build_command npm run build &&
      rp_run_build_command npm prune --omit=dev &&
      rp_run_build_command npm cache clean --force
  ) || return 1

  rp_validate_release_assets "$release_directory" || return 1
  find "$release_directory" -type d -exec chmod 0755 {} + || return 1
  find "$release_directory" -type f -exec chmod 0644 {} + || return 1
  chmod 0755 "$release_directory/scripts/collect-proxmox.sh" || return 1
  rp_set_rackpad_ownership -R root:root "$release_directory" || return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  rp_require_root
  rp_build_release "${1:?usage: build-release.sh RELEASE DIRECTORY}" "${2:?release directory required}"
fi

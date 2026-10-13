#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${script_directory}/native-common.sh"

rp_environment_keys() {
  awk -F= '/^[A-Z][A-Z0-9_]*=/{print $1}' "$1"
}

rp_sync_environment() {
  local template="${1:?template required}"
  local environment="${2:-$(rp_path /etc/rackpad/rackpad.env)}"
  local temporary key duplicate

  [[ -f "$template" && ! -L "$template" ]] || {
    rp_error "Environment template is missing or is not a regular file."
    return 1
  }
  mkdir -p "$(dirname "$environment")" || return 1
  temporary="$(mktemp "${environment}.tmp.XXXXXX")" || return
  trap 'rm -f "${temporary:-}"' RETURN

  duplicate="$(rp_environment_keys "$template" | sort | uniq -d | head -1)"
  if [[ -n "$duplicate" ]]; then
    rp_error "Environment template contains duplicate key ${duplicate}."
    return 1
  fi

  if [[ -f "$environment" ]]; then
    [[ ! -L "$environment" ]] || {
      rp_error "Refusing to update a symlinked environment file."
      return 1
    }
    cp -p "$environment" "$temporary" || return 1
  else
    cp "$template" "$temporary" || return 1
  fi

  while IFS= read -r key; do
    if ! grep -q "^${key}=" "$temporary"; then
      grep "^${key}=" "$template" >>"$temporary" || return 1
      rp_info "Added environment key ${key}."
    fi
  done < <(rp_environment_keys "$template")

  if [[ -f "$environment" ]]; then
    while IFS= read -r key; do
      if ! grep -q "^${key}=" "$template"; then
        rp_info "Preserved unknown or deprecated environment key ${key}."
      fi
    done < <(rp_environment_keys "$environment")
  fi

  chmod 0640 "$temporary" || return 1
  rp_set_rackpad_ownership root:rackpad "$temporary" || return 1
  mv -f "$temporary" "$environment" || return 1
  trap - RETURN
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  rp_require_root
  rp_sync_environment "${1:?usage: environment-sync.sh TEMPLATE [ENVIRONMENT]}" "${2:-$(rp_path /etc/rackpad/rackpad.env)}"
fi

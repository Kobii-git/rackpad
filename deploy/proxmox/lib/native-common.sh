#!/usr/bin/env bash

RACKPAD_NATIVE_MARKER_CONTENT="rackpad-native-lxc-v1"

rp_path() {
  local absolute_path="${1:?absolute path required}"
  [[ "$absolute_path" == /* ]] || return 2
  printf '%s%s' "${RACKPAD_ROOT_PREFIX:-}" "$absolute_path"
}

rp_info() {
  echo "Rackpad native LXC: $*"
}

rp_error() {
  echo "Rackpad native LXC: $*" >&2
}

rp_validate_release() {
  local release="${1:-}"
  if [[ "${RACKPAD_ALLOW_PRERELEASE:-0}" == "1" ]]; then
    [[ "$release" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]]
  else
    [[ "$release" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
  fi
}

rp_require_root() {
  if [[ -z "${RACKPAD_ROOT_PREFIX:-}" && "${EUID:-$(id -u)}" -ne 0 ]]; then
    rp_error "This operation must run as root."
    return 1
  fi
}

rp_require_native_marker() {
  local marker
  marker="$(rp_path /etc/rackpad/native-lxc)"
  if [[ ! -f "$marker" || -L "$marker" ]]; then
    rp_error "The native marker /etc/rackpad/native-lxc is missing or invalid."
    return 1
  fi
  if [[ "$(<"$marker")" != "$RACKPAD_NATIVE_MARKER_CONTENT" ]]; then
    rp_error "The native marker /etc/rackpad/native-lxc has unexpected content."
    return 1
  fi
}

rp_refuse_compose_collision() {
  local active
  active="$(rp_path /opt/rackpad)"
  [[ -e "$active" || -L "$active" ]] || return 0

  if [[ -L "$active" ]]; then
    rp_require_native_marker
    return
  fi

  if [[ -d "$active" ]] && {
    [[ -f "$active/compose.yml" ]] ||
      [[ -f "$active/compose.yaml" ]] ||
      [[ -f "$active/docker-compose.yml" ]] ||
      [[ -f "$active/docker-compose.yaml" ]];
  }; then
    rp_error "Refusing to replace the existing Docker Compose deployment at /opt/rackpad."
  else
    rp_error "Refusing to replace the existing non-native path at /opt/rackpad."
  fi
  return 1
}

rp_read_env() {
  local name="${1:?variable name required}"
  local environment="${2:-$(rp_path /etc/rackpad/rackpad.env)}"
  awk -v key="$name" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' "$environment"
}

rp_systemctl() {
  if [[ -n "${RACKPAD_SYSTEMCTL_COMMAND:-}" ]]; then
    "${RACKPAD_SYSTEMCTL_COMMAND}" "$@"
  else
    systemctl "$@"
  fi
}

rp_write_text() {
  local destination="${1:?destination required}"
  local mode="${2:?mode required}"
  local content="${3-}"
  local temporary
  mkdir -p "$(dirname "$destination")" || return 1
  temporary="$(mktemp "${destination}.tmp.XXXXXX")" || return
  chmod "$mode" "$temporary" || {
    rm -f "$temporary"
    return 1
  }
  printf '%s\n' "$content" >"$temporary" || {
    rm -f "$temporary"
    return 1
  }
  mv -f "$temporary" "$destination" || {
    rm -f "$temporary"
    return 1
  }
}

rp_atomic_symlink() {
  local target="${1:?target required}"
  local link="${2:?link required}"
  local temporary="${link}.new.$$"
  ln -s "$target" "$temporary" || return 1
  if mv --version >/dev/null 2>&1; then
    mv -Tf "$temporary" "$link" || {
      rm -f "$temporary"
      return 1
    }
  else
    mv -f "$temporary" "$link" || {
      rm -f "$temporary"
      return 1
    }
  fi
}

rp_set_rackpad_ownership() {
  [[ -n "${RACKPAD_ROOT_PREFIX:-}" ]] && return 0
  chown "$@"
}

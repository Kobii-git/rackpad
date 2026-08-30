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

rp_validate_release_identifier() {
  local release="${1:-}"
  [[ "$release" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]]
}

rp_validate_release() {
  local release="${1:-}"
  if [[ "${RACKPAD_ALLOW_PRERELEASE:-0}" == "1" ]]; then
    rp_validate_release_identifier "$release"
  else
    [[ "$release" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
  fi
}

rp_release_is_newer() {
  local candidate="${1:?candidate release required}"
  local current="${2:?current release required}"
  command -v node >/dev/null 2>&1 || return 1
  node - "$candidate" "$current" <<'NODE'
const [candidateRaw, currentRaw] = process.argv.slice(2);

function parse(raw) {
  const match = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(raw);
  if (!match) process.exit(2);
  return {
    core: match.slice(1, 4).map(BigInt),
    prerelease: match[4]?.split(".") ?? null,
  };
}

function compareIdentifier(left, right) {
  const leftNumeric = /^[0-9]+$/.test(left);
  const rightNumeric = /^[0-9]+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const leftNumber = BigInt(left);
    const rightNumber = BigInt(right);
    return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compare(left, right) {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] < right.core[index] ? -1 : 1;
    }
  }
  if (left.prerelease === null || right.prerelease === null) {
    if (left.prerelease === right.prerelease) return 0;
    return left.prerelease === null ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const result = compareIdentifier(left.prerelease[index], right.prerelease[index]);
    if (result !== 0) return result;
  }
  return 0;
}

process.exit(compare(parse(candidateRaw), parse(currentRaw)) > 0 ? 0 : 1);
NODE
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

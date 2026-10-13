#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${script_directory}/../lib/native-common.sh" ]]; then
  common_library="${script_directory}/../lib/native-common.sh"
else
  common_library="/usr/local/lib/rackpad/native-common.sh"
fi
if ! declare -F rp_path >/dev/null 2>&1; then
  # shellcheck source=/dev/null
  source "$common_library"
fi

rp_set_environment_value() {
  local name="${1:?variable name required}"
  local value="${2-}"
  local environment temporary
  environment="$(rp_path /etc/rackpad/rackpad.env)"
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || return 1
  [[ -f "$environment" && ! -L "$environment" ]] || {
    rp_error "The native environment file is missing or invalid."
    return 1
  }
  temporary="$(mktemp "${environment}.tmp.XXXXXX")" || return 1
  if ! awk -v key="$name" -v replacement="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 {
      if (!found) print key "=" replacement
      found = 1
      next
    }
    { print }
    END { if (!found) print key "=" replacement }
  ' "$environment" >"$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  chmod 0640 "$temporary" || {
    rm -f "$temporary"
    return 1
  }
  rp_set_rackpad_ownership root:rackpad "$temporary" || {
    rm -f "$temporary"
    return 1
  }
  mv -f "$temporary" "$environment" || {
    rm -f "$temporary"
    return 1
  }
}

rp_install_capability_dropin() {
  local template="${1:?capability template required}"
  local destination temporary
  destination="$(rp_path /etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf)"
  [[ -f "$template" && ! -L "$template" ]] || {
    rp_error "The discovery capability template is missing or invalid."
    return 1
  }
  mkdir -p "$(dirname "$destination")" || return 1
  temporary="$(mktemp "${destination}.tmp.XXXXXX")" || return 1
  install -m 0644 "$template" "$temporary" || {
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

rp_capability_present() {
  local field="${1:?status field required}"
  local bit="${2:?capability bit required}"
  local hexadecimal value mask
  hexadecimal="$(awk -v field="${field}:" '$1 == field { print $2; exit }' /proc/self/status)"
  [[ "$hexadecimal" =~ ^[0-9A-Fa-f]+$ ]] || return 1
  value=$((16#$hexadecimal))
  mask=$((1 << bit))
  ((value & mask))
}

rp_preflight_advanced_discovery() {
  local field
  command -v python3 >/dev/null 2>&1 || {
    rp_error "Advanced discovery requires Python 3 for its raw-socket preflight."
    return 1
  }
  for field in CapBnd CapEff; do
    if ! rp_capability_present "$field" 12 || ! rp_capability_present "$field" 13; then
      rp_error "The outer Proxmox policy does not expose CAP_NET_ADMIN and CAP_NET_RAW to this LXC."
      rp_error "Keep safe mode, or explicitly approve and configure those capabilities on the Proxmox side. Rackpad will not change LXC privilege."
      return 1
    fi
  done
  python3 - <<'PY' || {
import socket

probe = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0003))
probe.close()
PY
    rp_error "The LXC denied a raw network socket. Advanced discovery was not enabled."
    rp_error "Keep safe mode, or explicitly change the Proxmox-side container policy after reviewing the privilege trade-off."
    return 1
  }
}

rp_restore_discovery_state() {
  local backup="${1:?backup directory required}"
  local environment dropin
  environment="$(rp_path /etc/rackpad/rackpad.env)"
  dropin="$(rp_path /etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf)"
  install -m 0640 "${backup}/rackpad.env" "$environment" || return 1
  rp_set_rackpad_ownership root:rackpad "$environment" || return 1
  if [[ -f "${backup}/had-dropin" ]]; then
    install -m 0644 "${backup}/capabilities.conf" "$dropin" || return 1
    rp_set_rackpad_ownership root:root "$dropin" || return 1
  else
    rm -f "$dropin" || return 1
  fi
  rp_systemctl daemon-reload || return 1
  rp_systemctl restart rackpad || return 1
  rp_systemctl is-active --quiet rackpad
}

rp_apply_discovery_mode() {
  local mode="${1:?mode required}"
  local asset_directory environment dropin backup template scan_mode
  rp_require_root || return 1
  rp_require_native_marker || return 1
  asset_directory="${RACKPAD_DISCOVERY_ASSET_DIR:-$(rp_path /usr/local/share/rackpad/discovery)}"
  environment="$(rp_path /etc/rackpad/rackpad.env)"
  dropin="$(rp_path /etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf)"

  case "$mode" in
    safe)
      template="${asset_directory}/safe-capabilities.conf"
      scan_mode="neighbor"
      ;;
    advanced)
      rp_preflight_advanced_discovery || return 1
      template="${asset_directory}/advanced-capabilities.conf"
      scan_mode="auto"
      ;;
    *)
      rp_error "Usage: rackpad-discovery-mode safe|advanced|status"
      return 2
      ;;
  esac

  backup="$(mktemp -d "$(dirname "$environment")/.discovery-mode.XXXXXX")" || return 1
  chmod 0700 "$backup" || {
    rm -rf "$backup"
    return 1
  }
  cp -p "$environment" "${backup}/rackpad.env" || {
    rm -rf "$backup"
    return 1
  }
  if [[ -f "$dropin" ]]; then
    cp -p "$dropin" "${backup}/capabilities.conf" || {
      rm -rf "$backup"
      return 1
    }
    : >"${backup}/had-dropin"
  fi

  if rp_set_environment_value DISCOVERY_MAC_SCAN_MODE "$scan_mode" &&
    rp_install_capability_dropin "$template" &&
    rp_systemctl daemon-reload &&
    rp_systemctl restart rackpad &&
    rp_systemctl is-active --quiet rackpad; then
    rm -rf "$backup"
    rp_info "Discovery mode is now ${mode}."
    return 0
  fi

  rp_error "The ${mode} discovery configuration failed; restoring the previous mode."
  if rp_restore_discovery_state "$backup"; then
    rm -rf "$backup"
    rp_error "The previous discovery mode was restored."
    return 1
  fi
  rp_systemctl stop rackpad >/dev/null 2>&1 || true
  rp_error "Discovery-mode rollback failed. Rackpad remains stopped. Recovery directory: ${backup}"
  return 1
}

rp_discovery_status() {
  local asset_directory environment dropin scan_mode trap_enabled mode service_state
  rp_require_root || return 1
  rp_require_native_marker || return 1
  asset_directory="${RACKPAD_DISCOVERY_ASSET_DIR:-$(rp_path /usr/local/share/rackpad/discovery)}"
  environment="$(rp_path /etc/rackpad/rackpad.env)"
  dropin="$(rp_path /etc/systemd/system/rackpad.service.d/10-discovery-capabilities.conf)"
  scan_mode="$(rp_read_env DISCOVERY_MAC_SCAN_MODE "$environment")"
  trap_enabled="$(rp_read_env SNMP_TRAP_ENABLED "$environment")"
  mode="inconsistent"
  if [[ "$scan_mode" == "neighbor" ]] && cmp -s "$dropin" "${asset_directory}/safe-capabilities.conf"; then
    mode="safe"
  elif [[ "$scan_mode" == "auto" ]] && cmp -s "$dropin" "${asset_directory}/advanced-capabilities.conf"; then
    mode="advanced"
  fi
  if rp_systemctl is-active --quiet rackpad; then
    service_state="active"
  else
    service_state="inactive"
  fi
  printf 'Discovery mode: %s\n' "$mode"
  printf 'MAC scan mode: %s\n' "${scan_mode:-missing}"
  printf 'Rackpad service: %s\n' "$service_state"
  printf 'SNMP traps: %s (managed independently)\n' "${trap_enabled:-missing}"
}

rp_discovery_main() {
  local command="${1:-status}"
  if [[ -z "${RACKPAD_ROOT_PREFIX:-}" ]]; then
    command -v flock >/dev/null 2>&1 || {
      rp_error "flock is required."
      return 1
    }
    exec 9>/run/lock/rackpad-update.lock
    flock -n 9 || {
      rp_error "Another Rackpad update or discovery-mode change is already running."
      return 1
    }
  fi
  case "$command" in
    safe | advanced) rp_apply_discovery_mode "$command" ;;
    status) rp_discovery_status ;;
    *)
      rp_error "Usage: rackpad-discovery-mode safe|advanced|status"
      return 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  rp_discovery_main "$@"
fi

#!/usr/bin/env bash
set -Eeuo pipefail

# This script is also sourced by isolated installer fixtures.
installer_error() { echo "Rackpad installer: $*" >&2; }
run() {
  if (( EUID == 0 )); then "$@"; else sudo "$@"; fi
}

install_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 || {
      installer_error "Install Docker Engine and Compose v2 first."; return 1;
    }
    run apt-get update
    run apt-get install -y ca-certificates curl docker.io
    run systemctl enable --now docker
  fi
  if ! docker compose version >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 || {
      installer_error "Install the Docker Compose v2 plugin first."; return 1;
    }
    run apt-get update
    run apt-get install -y docker-compose-v2 || run apt-get install -y docker-compose-plugin
  fi
  docker compose version >/dev/null
}

manifest_ref() {
  local image="${1:?image required}"
  case "$image" in
    ghcr.io/kobii-git/rackpad:latest) echo main ;;
    ghcr.io/kobii-git/rackpad:beta) echo beta ;;
    ghcr.io/kobii-git/rackpad:dev) echo dev ;;
    ghcr.io/kobii-git/rackpad:*)
      local tag="${image##*:}"
      [[ "$tag" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || {
        installer_error "Official images require latest, beta, dev, or a full version tag."; return 1;
      }
      printf 'v%s\n' "$tag" ;;
    *) echo main ;;
  esac
}

file_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    run sha256sum "$1" | awk '{print $1}'
  else
    run shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Compose parses .env itself. Never source operator configuration as shell code.
# Existing .env values take precedence over inherited shell overrides.
compose() {
  local status=0
  # Parser diagnostics can include the offending .env line, including secrets.
  run env "${unset_environment[@]}" docker compose --project-directory "$INSTALL_DIR" --env-file "$environment_file" "$@" 2>"$temporary/compose-error" || status=$?
  if (( status != 0 )); then installer_error "Compose failed; check configuration privately."; fi
  return "$status"
}

install_rackpad() (
  umask 077
  INSTALL_DIR="${INSTALL_DIR:-/opt/rackpad}"
  [[ "$INSTALL_DIR" == /* && ! -L "$INSTALL_DIR" ]] || {
    installer_error "INSTALL_DIR must be an absolute, non-symlink directory."; return 1;
  }
  install_docker
  if ! command -v curl >/dev/null || { ! command -v sha256sum >/dev/null && ! command -v shasum >/dev/null; }; then
    installer_error "Install curl and sha256sum (or shasum) before continuing."; return 1
  fi
  run docker info >/dev/null
  local temporary environment_file ref image key resolved_key fresh=0 proposed backup hash
  local unset_environment=()
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/rackpad-install.XXXXXX")"
  trap 'rm -rf "$temporary"' EXIT
  environment_file="$temporary/environment"
  : >"$environment_file"
  for file in .env compose.yml compose.yml.installer.sha256; do
    if run test -L "$INSTALL_DIR/$file"; then
      installer_error "Refusing symlink configuration: $file"; return 1
    fi
  done
  if run test -f "$INSTALL_DIR/.env"; then
    unset_environment+=(-u RACKPAD_SECRET_KEY)
    # Existing deployments must persist their key; an inherited value is not recovery.
    # Keep the temporary copy private, including when the source is root-owned.
    run cat "$INSTALL_DIR/.env" >"$environment_file"
    while IFS= read -r name; do unset_environment+=(-u "$name"); done < <(
      sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=.*/\2/p' "$environment_file"
    )
  else
    # An absent .env alone is not evidence of an empty deployment.
    run docker volume ls --format '{{.Name}}' >"$temporary/volumes"
    run docker ps -a --filter 'name=^/rackpad$' -q >"$temporary/containers"
    if { run test -d "$INSTALL_DIR" && [[ -n "$(run ls -A "$INSTALL_DIR")" ]]; } ||
      grep -Eq '(^|_)rackpad_data$' "$temporary/volumes" || [[ -s "$temporary/containers" ]]; then
      installer_error "Existing deployment detected without .env. Restore its configuration and original RACKPAD_SECRET_KEY before retrying. No key was generated."; return 1
    fi
    fresh=1
    key="${RACKPAD_SECRET_KEY:-}"
    # Validate the original input before line-based Compose output can truncate it.
    [[ "$key" != *[$'\n\r\047\042$`\\']* ]] || {
      installer_error "Configure the supplied encryption key directly in .env."; return 1;
    }
    for name in RACKPAD_IMAGE RACKPAD_TAG RACKPAD_PORT MONITOR_INTERVAL_MS TRUST_PROXY TRUSTED_HOSTS TRUSTED_ORIGINS; do
      case "$name" in
        RACKPAD_IMAGE) value="${RACKPAD_IMAGE:-ghcr.io/kobii-git/rackpad}" ;;
        RACKPAD_TAG) value="${RACKPAD_TAG:-latest}" ;;
        RACKPAD_PORT) value="${RACKPAD_PORT:-3000}" ;;
        MONITOR_INTERVAL_MS) value="${MONITOR_INTERVAL_MS:-300000}" ;;
        TRUST_PROXY) value="${TRUST_PROXY:-0}" ;;
        TRUSTED_HOSTS) value="${TRUSTED_HOSTS:-}" ;;
        TRUSTED_ORIGINS) value="${TRUSTED_ORIGINS:-}" ;;
      esac
      [[ "$value" != *[$'\n\r\t\047\042$`\\']* ]] || {
        installer_error "Unsupported characters in $name; configure .env manually."; return 1;
      }
      printf '%s=%s\n' "$name" "$value" >>"$environment_file"
      unset_environment+=(-u "$name")
    done
  fi

  # Selection only: the downloaded canonical manifest is the deployment source.
  cat >"$temporary/selection.yml" <<'EOF'
services:
  rackpad:
    image: ${RACKPAD_IMAGE:-ghcr.io/kobii-git/rackpad}:${RACKPAD_TAG:-latest}
    environment:
      RACKPAD_SECRET_KEY: ${RACKPAD_SECRET_KEY:-}
EOF
  image="$(compose -f "$temporary/selection.yml" config --images)"
  ref="$(manifest_ref "$image")"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 10 --max-time 60 \
    "https://raw.githubusercontent.com/Kobii-git/rackpad/${ref}/docker-compose.release.yml" \
    -o "$temporary/compose.yml"
  # Quiet validation: rendered secrets must never enter console output.
  compose -f "$temporary/compose.yml" config --quiet 2>"$temporary/validation-error" || {
    installer_error "Downloaded manifest is invalid; existing files are unchanged."; return 1;
  }
  [[ "$(compose -f "$temporary/compose.yml" config --services)" == rackpad ]] || {
    installer_error "Downloaded manifest must contain only the rackpad service."; return 1;
  }
  [[ "$(compose -f "$temporary/compose.yml" config --images)" == "$image" ]] || {
    installer_error "Downloaded manifest changed image selection."; return 1;
  }
  run mkdir -p "$INSTALL_DIR"
  if run test -f "$INSTALL_DIR/compose.yml"; then
    hash="$(file_hash "$INSTALL_DIR/compose.yml")"
    if [[ "$hash" != "911e34adc785f293d1ee1c10fa082af63122de0183571d34566eeba15ba622a4" ]] &&
      { ! run test -f "$INSTALL_DIR/compose.yml.installer.sha256" || [[ "$hash" != "$(run cat "$INSTALL_DIR/compose.yml.installer.sha256")" ]]; }; then
      proposed="$(run mktemp "$INSTALL_DIR/compose.yml.proposed.XXXXXX")"
      run install -m 0600 "$temporary/compose.yml" "$proposed"
      installer_error "Custom Compose preserved. Review $proposed and merge its environment mappings while retaining your volume, ports, and service options. Then run Compose manually."
      return 2
    fi
  fi
  if (( fresh == 0 )); then
    key="$(compose -f "$temporary/selection.yml" config --environment 2>"$temporary/validation-error" | sed -n 's/^RACKPAD_SECRET_KEY=//p')"
  fi
  if [[ -z "${key//[[:space:]]/}" ]]; then
    if (( fresh == 0 )); then
      installer_error "Restore the original RACKPAD_SECRET_KEY in .env before upgrading. If none ever existed, back up the old deployment and explicitly configure a key before migration. Lost keys require secret re-entry; never rotate a recoverable key. Files are unchanged."; return 1
    fi
    command -v openssl >/dev/null || { installer_error "Install openssl to generate a fresh encryption key."; return 1; }
    key="$(openssl rand -hex 32)"
    printf 'RACKPAD_SECRET_KEY=%s\n' "$key" >>"$environment_file"
  elif (( fresh == 1 )); then
    # Supplied keys are supported but kept out of logs and the command line.
    [[ "$key" != *[$'\n\r\047\042$`\\']* ]] || {
      installer_error "Configure the supplied encryption key directly in .env."; return 1;
    }
    printf "RACKPAD_SECRET_KEY='%s'\n" "$key" >>"$environment_file"
  fi
  unset_environment+=(-u RACKPAD_SECRET_KEY)
  compose -f "$temporary/compose.yml" config --quiet 2>"$temporary/validation-error" || {
    installer_error "Final configuration is invalid; existing files are unchanged."; return 1;
  }
  resolved_key="$(compose -f "$temporary/selection.yml" config --environment 2>"$temporary/validation-error" | sed -n 's/^RACKPAD_SECRET_KEY=//p')" || {
    installer_error "Could not verify the persisted encryption key; existing files are unchanged."; return 1;
  }
  [[ "$resolved_key" == "$key" ]] || {
    installer_error "The persisted encryption key did not match the supplied value; existing files are unchanged."; return 1;
  }
  # Pull before replacing working configuration. This does not start containers.
  compose -f "$temporary/compose.yml" pull
  if run test -f "$INSTALL_DIR/compose.yml"; then
    backup="$(run mktemp "$INSTALL_DIR/compose.yml.backup.XXXXXX")"
    run install -m 0600 "$INSTALL_DIR/compose.yml" "$backup"
    echo "Previous Compose configuration saved to $backup"
  fi
  proposed="$(run mktemp "$INSTALL_DIR/.compose.XXXXXX")"
  run install -m 0600 "$temporary/compose.yml" "$proposed"
  if (( fresh == 1 )); then run install -m 0600 "$environment_file" "$INSTALL_DIR/.env"; fi
  run mv "$proposed" "$INSTALL_DIR/compose.yml"
  file_hash "$INSTALL_DIR/compose.yml" >"$temporary/hash"
  run install -m 0600 "$temporary/hash" "$INSTALL_DIR/compose.yml.installer.sha256"
  environment_file="$INSTALL_DIR/.env"
  compose -f "$INSTALL_DIR/compose.yml" up -d
  echo "Rackpad is starting. Keep .env and its encryption key with your protected backups."
  echo "Inspect with: cd '$INSTALL_DIR' && docker compose ps"
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  install_rackpad
fi

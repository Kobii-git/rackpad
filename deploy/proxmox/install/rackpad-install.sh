#!/usr/bin/env bash

# Copyright (c) 2026 Rackpad contributors
# License: MIT | https://github.com/Kobii-git/rackpad/raw/main/LICENSE
# Source: https://rackpad.net/ | GitHub: https://github.com/Kobii-git/rackpad

# shellcheck source=/dev/null
source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

if [[ "$(dpkg --print-architecture)" != "amd64" ]]; then
  msg_error "Rackpad native LXC is currently supported only on amd64."
  exit 1
fi

if [[ ! "${RACKPAD_RELEASE_TAG:-}" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]]; then
  msg_error "A versioned Rackpad Release tag was not supplied by the host runner."
  exit 1
fi

if [[ -e /opt/rackpad || -L /opt/rackpad ]]; then
  if [[ -d /opt/rackpad && ! -L /opt/rackpad ]] && {
    [[ -f /opt/rackpad/compose.yml ]] ||
      [[ -f /opt/rackpad/compose.yaml ]] ||
      [[ -f /opt/rackpad/docker-compose.yml ]] ||
      [[ -f /opt/rackpad/docker-compose.yaml ]];
  }; then
    msg_error "Refusing to replace the existing Docker Compose deployment at /opt/rackpad."
  else
    msg_error "Rackpad already exists at /opt/rackpad; use /usr/bin/update for a native installation."
  fi
  exit 1
fi

msg_info "Installing Dependencies"
$STD apt install -y \
  build-essential \
  python3 \
  sqlite3 \
  arp-scan \
  iproute2 \
  iputils-ping \
  net-tools \
  nmap
msg_ok "Installed Dependencies"

NODE_VERSION="22" setup_nodejs

msg_info "Creating Rackpad User and Data Paths"
if ! getent group rackpad >/dev/null; then
  groupadd --system rackpad
fi
if ! id rackpad >/dev/null 2>&1; then
  useradd \
    --system \
    --gid rackpad \
    --home-dir /nonexistent \
    --no-create-home \
    --shell /usr/sbin/nologin \
    rackpad
fi
install -d -o root -g root -m 0755 /opt/rackpad_releases
install -d -o rackpad -g rackpad -m 0750 \
  /opt/rackpad_data \
  /opt/rackpad_data/backups
install -d -o root -g root -m 0700 /opt/rackpad_data/update-rollback
install -d -o root -g rackpad -m 0750 /etc/rackpad
msg_ok "Created Rackpad User and Data Paths"

release_directory="/opt/rackpad_releases/${RACKPAD_RELEASE_TAG}"
fetch_and_deploy_gh_release \
  "rackpad" \
  "${RACKPAD_REPOSITORY:-Kobii-git/rackpad}" \
  "tarball" \
  "$RACKPAD_RELEASE_TAG" \
  "$release_directory"

# Use build and operational code from the selected Rackpad Release itself.
# shellcheck source=/dev/null
source "${release_directory}/deploy/proxmox/lib/build-release.sh"
rp_build_release "$RACKPAD_RELEASE_TAG" "$release_directory"

msg_info "Creating Native Environment"
environment_file=/etc/rackpad/rackpad.env
install -m 0640 -o root -g rackpad \
  "${release_directory}/deploy/proxmox/rackpad.env.example" \
  "$environment_file"
environment_temporary="$(mktemp /etc/rackpad/rackpad.env.tmp.XXXXXX)"
secret_key="$(openssl rand -hex 32)"
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == RACKPAD_SECRET_KEY=* ]]; then
    printf 'RACKPAD_SECRET_KEY=%s\n' "$secret_key" >>"$environment_temporary"
  else
    printf '%s\n' "$line" >>"$environment_temporary"
  fi
done <"$environment_file"
unset secret_key
chmod 0640 "$environment_temporary"
chown root:rackpad "$environment_temporary"
mv -f "$environment_temporary" "$environment_file"
msg_ok "Created Native Environment"

rp_atomic_symlink "$release_directory" /opt/rackpad

# shellcheck source=/dev/null
source "${release_directory}/deploy/proxmox/lib/install-operational-assets.sh"
rp_install_operational_assets \
  "$release_directory" \
  "$RACKPAD_RELEASE_TAG" \
  "${RACKPAD_SCRIPT_ORIGIN:?Rackpad script origin is required}" \
  "${RACKPAD_CORE_REF:-$(<"${release_directory}/deploy/proxmox/core-ref")}"

msg_info "Starting Rackpad"
systemctl enable -q rackpad
systemctl start rackpad
# shellcheck source=/dev/null
source "${release_directory}/deploy/proxmox/lib/native-update.sh"
if ! rp_verify_active_release; then
  systemctl stop rackpad >/dev/null 2>&1 || true
  msg_error "Rackpad did not pass its post-install health checks and remains stopped."
  exit 1
fi
msg_ok "Started Rackpad"

motd_ssh
customize
cleanup_lxc

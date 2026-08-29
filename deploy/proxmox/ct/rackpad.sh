#!/usr/bin/env bash

core_origin="${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/7cea42d8a3f7164d1813906f386c6d690eba7fc5}"
# shellcheck source=/dev/null
source <(curl -fsSL "${core_origin}/core/build.func")

# Copyright (c) 2026 Rackpad contributors
# License: MIT | https://github.com/Kobii-git/rackpad/raw/main/LICENSE
# Source: https://rackpad.net/ | GitHub: https://github.com/Kobii-git/rackpad

APP="Rackpad"
var_tags="${var_tags:-inventory;infrastructure;monitoring}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-4096}"
var_disk="${var_disk:-16}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-no}"
var_unprivileged="${var_unprivileged:-1}"
var_nesting="${var_nesting:-1}"

RACKPAD_REPOSITORY="${RACKPAD_REPOSITORY:-Kobii-git/rackpad}"
RACKPAD_RELEASE_TAG="${RACKPAD_RELEASE_TAG:-}"
RACKPAD_SCRIPT_ORIGIN="${RACKPAD_SCRIPT_ORIGIN:-${COMMUNITY_SCRIPTS_URL}}"
RACKPAD_CORE_REF="${RACKPAD_CORE_REF:-${COMMUNITY_SCRIPTS_CORE_URL##*/}}"
RACKPAD_CORE_ORIGIN="${RACKPAD_CORE_ORIGIN:-${COMMUNITY_SCRIPTS_CORE_URL}}"
export RACKPAD_REPOSITORY RACKPAD_RELEASE_TAG RACKPAD_SCRIPT_ORIGIN
export RACKPAD_CORE_REF RACKPAD_CORE_ORIGIN

header_info "$APP"
variables
color
catch_errors

rackpad_fetch_candidate() {
  local release="$1" target="$2"
  CLEAN_INSTALL=1 fetch_and_deploy_gh_release \
    "rackpad-candidate" \
    "$RACKPAD_REPOSITORY" \
    "tarball" \
    "$release" \
    "$target"
}

function update_script() {
  local update_release
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -f /etc/rackpad/native-lxc ]]; then
    msg_error "No supported Rackpad native-LXC installation was found."
    exit 1
  fi

  if [[ -n "${RACKPAD_MAINTAINER_RELEASE:-}" ]]; then
    [[ "${RACKPAD_MAINTAINER_MODE:-0}" == "1" ]] || {
      msg_error "RACKPAD_MAINTAINER_RELEASE requires RACKPAD_MAINTAINER_MODE=1."
      exit 1
    }
    [[ "$RACKPAD_MAINTAINER_RELEASE" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]] || {
      msg_error "The maintainer update target must be a v-prefixed SemVer tag."
      exit 1
    }
    export RACKPAD_ALLOW_PRERELEASE=1
    update_release="$RACKPAD_MAINTAINER_RELEASE"
  elif check_for_gh_release "rackpad" "$RACKPAD_REPOSITORY"; then
    update_release="$CHECK_UPDATE_RELEASE"
  else
    exit
  fi

  NODE_VERSION="22" setup_nodejs
  # shellcheck source=/dev/null
  source /usr/local/lib/rackpad/native-update.sh
  rackpad_transactional_update "$update_release" rackpad_fetch_candidate
  exit
}

start
build_container
description

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}Access it using the following URL:${CL}"
echo -e "${GATEWAY}${BGN}http://${IP}:3000${CL}"

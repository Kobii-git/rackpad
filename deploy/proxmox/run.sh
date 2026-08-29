#!/usr/bin/env bash
set -Eeuo pipefail

RACKPAD_REPOSITORY="${RACKPAD_REPOSITORY:-Kobii-git/rackpad}"
RACKPAD_RELEASE_TAG="${RACKPAD_RELEASE_TAG:-}"
RACKPAD_SCRIPT_REF="${RACKPAD_SCRIPT_REF:-${RACKPAD_RELEASE_TAG}}"
RACKPAD_MAINTAINER_MODE="${RACKPAD_MAINTAINER_MODE:-0}"
RACKPAD_ALLOW_UNSTABLE="${RACKPAD_ALLOW_UNSTABLE:-0}"
RACKPAD_SCRIPT_BASE_OVERRIDE="${RACKPAD_SCRIPT_BASE_OVERRIDE:-}"
RACKPAD_CORE_REF_OVERRIDE="${RACKPAD_CORE_REF_OVERRIDE:-}"

fail() {
  echo "Rackpad Proxmox runner: $*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required."
[[ "$RACKPAD_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] ||
  fail "Invalid Rackpad repository."
[[ -n "$RACKPAD_RELEASE_TAG" ]] || fail "RACKPAD_RELEASE_TAG is required."

if [[ "$RACKPAD_ALLOW_UNSTABLE" == "1" ]]; then
  [[ "$RACKPAD_MAINTAINER_MODE" == "1" ]] ||
    fail "Unstable releases require RACKPAD_MAINTAINER_MODE=1."
else
  [[ "$RACKPAD_RELEASE_TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] ||
    fail "Production installs require a stable SemVer Rackpad tag."
fi
[[ "$RACKPAD_SCRIPT_REF" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "Invalid Rackpad script ref."
if [[ "$RACKPAD_SCRIPT_REF" != "$RACKPAD_RELEASE_TAG" && "$RACKPAD_MAINTAINER_MODE" != "1" ]]; then
  fail "A Rackpad script-ref override requires RACKPAD_MAINTAINER_MODE=1."
fi

rackpad_root="https://raw.githubusercontent.com/${RACKPAD_REPOSITORY}/${RACKPAD_SCRIPT_REF}"
rackpad_scripts="${rackpad_root}/deploy/proxmox"

if [[ -n "$RACKPAD_SCRIPT_BASE_OVERRIDE" || -n "$RACKPAD_CORE_REF_OVERRIDE" ]]; then
  [[ "$RACKPAD_MAINTAINER_MODE" == "1" ]] ||
    fail "Origin overrides require RACKPAD_MAINTAINER_MODE=1."
fi

if [[ -n "$RACKPAD_SCRIPT_BASE_OVERRIDE" ]]; then
  [[ "$RACKPAD_SCRIPT_BASE_OVERRIDE" =~ ^https://raw\.githubusercontent\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9._/-]+$ ]] ||
    fail "Invalid maintainer script origin."
  rackpad_scripts="${RACKPAD_SCRIPT_BASE_OVERRIDE%/}"
fi

core_ref="${RACKPAD_CORE_REF_OVERRIDE:-$(curl -fsSL "${rackpad_scripts}/core-ref")}" ||
  fail "Unable to read the pinned Community Scripts core revision."
[[ "$core_ref" =~ ^[0-9a-f]{40}$ ]] || fail "The Community Scripts core pin is invalid."
core_origin="https://raw.githubusercontent.com/community-scripts/core/${core_ref}"

export RACKPAD_RELEASE_TAG
export RACKPAD_REPOSITORY
export RACKPAD_SCRIPT_ORIGIN="$rackpad_scripts"
export RACKPAD_CORE_REF="$core_ref"
export RACKPAD_CORE_ORIGIN="$core_origin"
export COMMUNITY_SCRIPTS_URL="$rackpad_scripts"
export COMMUNITY_SCRIPTS_CORE_URL="$core_origin"

curl -fsSL "${core_origin}/tools/run.sh" |
  bash -s -- "$rackpad_scripts" "ct/rackpad.sh" "$core_origin"

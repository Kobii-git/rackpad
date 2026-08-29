#!/usr/bin/env bash
set -Eeuo pipefail

RACKPAD_REPOSITORY="${RACKPAD_REPOSITORY:-Kobii-git/rackpad}"
RACKPAD_MAINTAINER_MODE="${RACKPAD_MAINTAINER_MODE:-0}"
RACKPAD_MAINTAINER_REF="${RACKPAD_MAINTAINER_REF:-}"
RACKPAD_MAINTAINER_RELEASE="${RACKPAD_MAINTAINER_RELEASE:-}"
official_repository="Kobii-git/rackpad"

fail() {
  echo "Rackpad Proxmox dispatcher: $*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v jq >/dev/null 2>&1 || fail "jq is required."

if [[ ! "$RACKPAD_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  fail "RACKPAD_REPOSITORY must be an owner/repository pair."
fi
if [[ "$RACKPAD_REPOSITORY" != "$official_repository" && "$RACKPAD_MAINTAINER_MODE" != "1" ]]; then
  fail "A repository override requires RACKPAD_MAINTAINER_MODE=1."
fi

if [[ -n "$RACKPAD_MAINTAINER_REF" ]]; then
  [[ "$RACKPAD_MAINTAINER_MODE" == "1" ]] ||
    fail "RACKPAD_MAINTAINER_REF requires RACKPAD_MAINTAINER_MODE=1."
  [[ "$RACKPAD_MAINTAINER_REF" =~ ^[A-Za-z0-9._/-]+$ ]] ||
    fail "RACKPAD_MAINTAINER_REF contains unsupported characters."
  rackpad_script_ref="$RACKPAD_MAINTAINER_REF"
  if [[ -n "$RACKPAD_MAINTAINER_RELEASE" ]]; then
    rackpad_release="$RACKPAD_MAINTAINER_RELEASE"
  else
    rackpad_release="v$(
      curl -fsSL \
        "https://raw.githubusercontent.com/${RACKPAD_REPOSITORY}/${rackpad_script_ref}/package.json" |
        jq -er '.version'
    )" || fail "Unable to resolve the Rackpad version for the maintainer ref."
  fi
  [[ "$rackpad_release" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]] ||
    fail "The maintainer release must be a v-prefixed SemVer tag."
  export RACKPAD_ALLOW_UNSTABLE=1
else
  rackpad_release="$(
    curl -fsSL \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/${RACKPAD_REPOSITORY}/releases/latest" |
      jq -er '.tag_name'
  )" || fail "Unable to resolve the latest stable Rackpad Release."
  [[ "$rackpad_release" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] ||
    fail "The latest GitHub Release is not a stable SemVer tag."
  rackpad_script_ref="$rackpad_release"
fi

export RACKPAD_RELEASE_TAG="$rackpad_release"
export RACKPAD_SCRIPT_REF="$rackpad_script_ref"
export RACKPAD_REPOSITORY RACKPAD_MAINTAINER_MODE
rackpad_root="https://raw.githubusercontent.com/${RACKPAD_REPOSITORY}/${rackpad_script_ref}"

curl -fsSL "${rackpad_root}/deploy/proxmox/run.sh" | bash

#!/usr/bin/env bash
set -Eeuo pipefail

RACKPAD_IMAGE="${RACKPAD_IMAGE:-ghcr.io/kobii-git/rackpad}"
RACKPAD_TAG="${RACKPAD_TAG:-1.3.0}"
RACKPAD_PORT="${RACKPAD_PORT:-3000}"
INSTALL_DIR="${INSTALL_DIR:-/opt/rackpad}"
MONITOR_INTERVAL_MS="${MONITOR_INTERVAL_MS:-300000}"
TRUST_PROXY="${TRUST_PROXY:-0}"
TRUSTED_HOSTS="${TRUSTED_HOSTS:-}"
TRUSTED_ORIGINS="${TRUSTED_ORIGINS:-}"

if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  SUDO=""
else
  if ! command -v sudo >/dev/null 2>&1; then
    echo "This installer needs root privileges or sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

run() {
  if [ -n "$SUDO" ]; then
    sudo "$@"
  else
    "$@"
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    return
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Docker is not installed. Install Docker Engine and Compose, then re-run this script." >&2
    exit 1
  fi

  echo "Installing Docker from the OS package repository..."
  run apt-get update
  run apt-get install -y ca-certificates curl docker.io

  if ! docker compose version >/dev/null 2>&1; then
    run apt-get install -y docker-compose-plugin || \
      run apt-get install -y docker-compose-v2 || \
      run apt-get install -y docker-compose
  fi

  run systemctl enable --now docker >/dev/null 2>&1 || true
}

install_compose() {
  if docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1; then
    return
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Docker Compose is not installed. Install the Docker Compose plugin, then re-run this script." >&2
    exit 1
  fi

  echo "Installing Docker Compose..."
  run apt-get update
  run apt-get install -y docker-compose-plugin || \
    run apt-get install -y docker-compose-v2 || \
    run apt-get install -y docker-compose
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return
  fi
  echo "Docker Compose is not available after Docker installation." >&2
  exit 1
}

install_docker
install_compose
COMPOSE="$(compose_cmd)"

run mkdir -p "$INSTALL_DIR"

if [ ! -f "$INSTALL_DIR/.env" ]; then
  run tee "$INSTALL_DIR/.env" >/dev/null <<EOF
RACKPAD_IMAGE=$RACKPAD_IMAGE
RACKPAD_TAG=$RACKPAD_TAG
RACKPAD_PORT=$RACKPAD_PORT
MONITOR_INTERVAL_MS=$MONITOR_INTERVAL_MS
TRUST_PROXY=$TRUST_PROXY
TRUSTED_HOSTS=$TRUSTED_HOSTS
TRUSTED_ORIGINS=$TRUSTED_ORIGINS
EOF
else
  echo "Keeping existing $INSTALL_DIR/.env"
fi

run tee "$INSTALL_DIR/compose.yml" >/dev/null <<'EOF'
services:
  rackpad:
    image: ${RACKPAD_IMAGE:-ghcr.io/kobii-git/rackpad}:${RACKPAD_TAG:-1.3.0}
    container_name: rackpad
    init: true
    restart: unless-stopped
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 3000
      DATABASE_PATH: /data/rackpad.db
      MONITOR_INTERVAL_MS: ${MONITOR_INTERVAL_MS:-300000}
      TRUST_PROXY: ${TRUST_PROXY:-0}
      TRUSTED_HOSTS: ${TRUSTED_HOSTS:-}
      TRUSTED_ORIGINS: ${TRUSTED_ORIGINS:-}
    ports:
      - "${RACKPAD_PORT:-3000}:3000"
    volumes:
      - rackpad_data:/data
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3000/api/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  rackpad_data:
EOF

cd "$INSTALL_DIR"

echo "Pulling $RACKPAD_IMAGE:$RACKPAD_TAG..."
run $COMPOSE --env-file .env -f compose.yml pull
run $COMPOSE --env-file .env -f compose.yml up -d

echo
echo "Rackpad is starting."
echo "Open: http://SERVER_IP:$RACKPAD_PORT"
echo
echo "Useful commands:"
echo "  cd $INSTALL_DIR && docker compose ps"
echo "  cd $INSTALL_DIR && docker compose logs -f"
echo "  cd $INSTALL_DIR && docker compose pull && docker compose up -d"

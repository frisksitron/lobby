#!/usr/bin/env bash

set -euo pipefail

INSTALL_DIR="/opt/lobby"
ENV_FILE="${INSTALL_DIR}/.env"
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.prod.yml"
CADDY_FILE="${INSTALL_DIR}/Caddyfile"
ASSET_BASE_URL="https://raw.githubusercontent.com/frisksitron/lobby/main/src-server/deploy"
DEFAULT_LOBBY_IMAGE_TAG="latest"

APT_UPDATED=false

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

warn() {
  printf 'WARN: %s\n' "$1" >&2
}

fatal() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

apt_install() {
  if [ "$APT_UPDATED" = false ]; then
    apt-get update -y >/dev/null
    APT_UPDATED=true
  fi
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" >/dev/null
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fatal "Run as root (or with sudo)."
}

require_interactive_terminal() {
  [ -t 0 ] || fatal "This installer requires an interactive terminal. Download the script first, then run it with sudo."
}

require_ubuntu_2404() {
  [ -f /etc/os-release ] || fatal "Cannot detect operating system. /etc/os-release is missing."

  # shellcheck disable=SC1091
  . /etc/os-release

  if [ "${ID:-}" != "ubuntu" ] || [ "${VERSION_ID:-}" != "24.04" ]; then
    fatal "This installer only supports Ubuntu 24.04 LTS."
  fi
}

require_architecture() {
  case "$(uname -m)" in
    x86_64|amd64) ;;
    *) fatal "Unsupported architecture. Supported: x86_64/amd64." ;;
  esac
}

ensure_not_installed() {
  if [ -f "$ENV_FILE" ]; then
    fatal "Lobby already appears installed in ${INSTALL_DIR} (${ENV_FILE} exists). This installer is one-time only. Upgrade with: docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} pull && docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} up -d"
  fi
}

ensure_tools() {
  local missing=()

  command -v curl >/dev/null 2>&1 || missing+=(curl)
  command -v openssl >/dev/null 2>&1 || missing+=(openssl)

  if [ "${#missing[@]}" -gt 0 ]; then
    log "Installing required packages: ${missing[*]}"
    apt_install "${missing[@]}"
  fi

  if ! dpkg -s ca-certificates >/dev/null 2>&1; then
    apt_install ca-certificates
  fi
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker"
    curl -fsSL https://get.docker.com | sh >/dev/null
  fi

  command -v docker >/dev/null 2>&1 || fatal "Docker installation failed."

  if ! docker compose version >/dev/null 2>&1; then
    log "Installing Docker Compose plugin"
    apt_install docker-compose-plugin
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
}

ask() {
  local var_name="$1"
  local prompt_text="$2"
  local default_value="${3:-}"
  local required="${4:-false}"
  local secret="${5:-false}"
  local value=""

  if [ "$secret" = "true" ]; then
    if [ -n "$default_value" ]; then
      read -r -s -p "${prompt_text} [hidden default]: " value
    else
      read -r -s -p "${prompt_text}: " value
    fi
    printf '\n'
  else
    if [ -n "$default_value" ]; then
      read -r -p "${prompt_text} [${default_value}]: " value
    else
      read -r -p "${prompt_text}: " value
    fi
  fi

  if [ -z "$value" ]; then
    value="$default_value"
  fi

  if [ "$required" = "true" ] && [ -z "$value" ]; then
    fatal "${var_name} is required."
  fi

  printf -v "$var_name" '%s' "$value"
}

collect_config() {
  ask LOBBY_DOMAIN "Domain name (for example: lobby.example.com)" "" true
  ask LOBBY_SERVER_NAME "Server display name" "Lobby Server"
  ask LOBBY_IMAGE_TAG "Lobby server image tag" "$DEFAULT_LOBBY_IMAGE_TAG"
  ask LOBBY_SMTP_HOST "SMTP host" "" true
  ask LOBBY_SMTP_PORT "SMTP port" "587" true
  ask LOBBY_SMTP_FROM "SMTP from address" "" true
  ask LOBBY_SMTP_USERNAME "SMTP username (optional)"
  ask LOBBY_SMTP_PASSWORD "SMTP password (optional)" "" false true
  ask LOBBY_SFU_PUBLIC_IP "Server public IPv4" "" true

  LOBBY_SERVER_BASE_URL="https://${LOBBY_DOMAIN}"
  LOBBY_TURN_ADDR="${LOBBY_DOMAIN}:3478"
  LOBBY_JWT_SECRET="$(openssl rand -hex 32)"
  LOBBY_TURN_SECRET="$(openssl rand -hex 32)"
}

validate_config() {
  printf '%s' "$LOBBY_IMAGE_TAG" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$' || fatal "LOBBY_IMAGE_TAG is invalid."
  printf '%s' "$LOBBY_DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+$' || fatal "LOBBY_DOMAIN is invalid."
  printf '%s' "$LOBBY_DOMAIN" | grep -q '\.' || fatal "LOBBY_DOMAIN must include a dot."

  printf '%s' "$LOBBY_SMTP_PORT" | grep -Eq '^[0-9]+$' || fatal "LOBBY_SMTP_PORT must be numeric."
  if [ "$LOBBY_SMTP_PORT" -lt 1 ] || [ "$LOBBY_SMTP_PORT" -gt 65535 ]; then
    fatal "LOBBY_SMTP_PORT must be between 1 and 65535."
  fi

  if [ "${#LOBBY_JWT_SECRET}" -lt 32 ]; then
    fatal "LOBBY_JWT_SECRET must be at least 32 characters."
  fi
}

download_assets() {
  log "Downloading deployment files"
  curl -fsSL -o "$COMPOSE_FILE" "${ASSET_BASE_URL}/docker-compose.prod.yml"
  curl -fsSL -o "$CADDY_FILE" "${ASSET_BASE_URL}/Caddyfile"
}

write_env_file() {
  umask 077
  cat > "$ENV_FILE" <<EOF
LOBBY_IMAGE_TAG=${LOBBY_IMAGE_TAG}
LOBBY_DOMAIN=${LOBBY_DOMAIN}
LOBBY_SFU_PUBLIC_IP=${LOBBY_SFU_PUBLIC_IP}
LOBBY_SERVER_NAME=${LOBBY_SERVER_NAME}
LOBBY_SERVER_BASE_URL=${LOBBY_SERVER_BASE_URL}
LOBBY_JWT_SECRET=${LOBBY_JWT_SECRET}
LOBBY_SMTP_HOST=${LOBBY_SMTP_HOST}
LOBBY_SMTP_PORT=${LOBBY_SMTP_PORT}
LOBBY_SMTP_FROM=${LOBBY_SMTP_FROM}
LOBBY_SMTP_USERNAME=${LOBBY_SMTP_USERNAME}
LOBBY_SMTP_PASSWORD=${LOBBY_SMTP_PASSWORD}
LOBBY_TURN_SECRET=${LOBBY_TURN_SECRET}
LOBBY_TURN_ADDR=${LOBBY_TURN_ADDR}
EOF
  chmod 600 "$ENV_FILE"
}

start_stack() {
  log "Pulling images"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull

  log "Starting containers"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
}

wait_for_lobby_health() {
  local container_id
  local status
  local i

  for i in $(seq 1 60); do
    container_id="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -q lobby || true)"
    if [ -n "$container_id" ]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
      if [ "$status" = "healthy" ]; then
        return 0
      fi
    fi
    sleep 2
  done

  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=50 lobby || true
  fatal "Lobby container did not become healthy in time."
}

check_public_health() {
  if curl -fsS --max-time 10 "https://${LOBBY_DOMAIN}/health" >/dev/null 2>&1; then
    log "Public health check passed"
  else
    warn "Public health check failed: https://${LOBBY_DOMAIN}/health"
  fi
}

print_summary() {
  cat <<EOF

Lobby is installed.

This installer is one-time only for a fresh host.

- Install directory: ${INSTALL_DIR}
- Image: ghcr.io/frisksitron/lobby/server:${LOBBY_IMAGE_TAG}
- Health endpoint: https://${LOBBY_DOMAIN}/health

Upgrade command:
- docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} pull
- docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} up -d

Required open ports:
- 22/tcp
- 80/tcp
- 443/tcp
- 443/udp
- 3478/tcp
- 3478/udp
- 49152-49252/udp
- 50000-50100/udp

EOF
}

main() {
  log "Starting Lobby installer"

  require_root
  require_interactive_terminal
  require_ubuntu_2404
  require_architecture
  ensure_tools
  ensure_docker
  ensure_not_installed

  mkdir -p "$INSTALL_DIR"

  collect_config
  validate_config
  download_assets
  write_env_file
  start_stack
  wait_for_lobby_health
  check_public_health
  print_summary
}

main "$@"

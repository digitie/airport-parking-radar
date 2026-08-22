#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/apps/parking-radar}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.odroid.yml}"
ENV_FILE="${ENV_FILE:-.env.odroid}"

if [[ " $(hostname -I 2>/dev/null || true) " == *" 192.168.1.13 "* ]]; then
  echo "Refusing Docker deployment on 192.168.1.13. Docker/PostgreSQL run only on 192.168.1.14." >&2
  exit 2
fi

if [[ ! -f "${APP_DIR}/${ENV_FILE}" ]]; then
  echo "Missing env file: ${APP_DIR}/${ENV_FILE}" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "${APP_DIR}/${ENV_FILE}"
set +a

ln -sfn "${ENV_FILE}" "${APP_DIR}/.env"

docker_compose() {
  if [[ -n "${SUDO_PASSWORD:-}" ]] && command -v sudo >/dev/null 2>&1; then
    if printf '%s\n' "${SUDO_PASSWORD}" | sudo -S -p '' docker compose version >/dev/null 2>&1; then
      printf '%s\n' "${SUDO_PASSWORD}" | sudo -S -p '' docker compose -f "${COMPOSE_FILE}" "$@"
      return
    fi

    if command -v docker-compose >/dev/null 2>&1 && printf '%s\n' "${SUDO_PASSWORD}" | sudo -S -p '' docker-compose version >/dev/null 2>&1; then
      printf '%s\n' "${SUDO_PASSWORD}" | sudo -S -p '' docker-compose -f "${COMPOSE_FILE}" "$@"
      return
    fi
  fi

  if docker compose version >/dev/null 2>&1; then
    docker compose -f "${COMPOSE_FILE}" "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    docker-compose -f "${COMPOSE_FILE}" "$@"
    return
  fi

  echo "Docker Compose is unavailable. Install Docker first or run as a user with docker access." >&2
  exit 64
}

wait_for_url() {
  local url="$1"
  local timeout_seconds="${2:-180}"
  local waited=0

  until curl -fsS "${url}" >/dev/null 2>&1; do
    sleep 5
    waited=$((waited + 5))
    if (( waited >= timeout_seconds )); then
      echo "Timed out waiting for ${url}" >&2
      return 1
    fi
  done
}

cd "${APP_DIR}"

docker_compose build
docker_compose down --remove-orphans || true
docker_compose up -d backend
wait_for_url "http://127.0.0.1:${PUBLIC_API_PORT:-8000}/health" 180
docker_compose up -d frontend
docker_compose ps

curl -fsS "http://127.0.0.1:${PUBLIC_API_PORT:-8000}/health" >/dev/null
curl -fsS "http://127.0.0.1:${PUBLIC_WEB_PORT:-3000}" >/dev/null

echo "ODROID deployment completed."

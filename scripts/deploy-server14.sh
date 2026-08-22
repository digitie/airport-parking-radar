#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-192.168.1.14}"
REMOTE_USER="${REMOTE_USER:-digitie}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/home/digitie/apps/parking-radar}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-.env.server14}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-parking-radar}"
ARCHIVE_PATH="$(mktemp -p /tmp parking-radar-server14.XXXXXX.tgz)"
REMOTE_ARCHIVE="/tmp/$(basename "${ARCHIVE_PATH}")"

cleanup() {
  rm -f "${ARCHIVE_PATH}"
}
trap cleanup EXIT

tar \
  --exclude=.git \
  --exclude=.env \
  --exclude=.env.* \
  --exclude=.next \
  --exclude=node_modules \
  --exclude=coverage \
  --exclude=dist \
  --exclude=.pytest_cache \
  --exclude=__pycache__ \
  --exclude=backend/.venv \
  --exclude=data \
  -czf "${ARCHIVE_PATH}" .

ssh "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p '${REMOTE_APP_DIR}'"
scp "${ARCHIVE_PATH}" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_ARCHIVE}"
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "REMOTE_APP_DIR='${REMOTE_APP_DIR}' REMOTE_ARCHIVE='${REMOTE_ARCHIVE}' REMOTE_ENV_FILE='${REMOTE_ENV_FILE}' COMPOSE_PROJECT_NAME='${COMPOSE_PROJECT_NAME}' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail
if [[ ! -f "${REMOTE_APP_DIR}/${REMOTE_ENV_FILE}" ]]; then
  echo "Missing ${REMOTE_APP_DIR}/${REMOTE_ENV_FILE}; copy .env.server14.example and add the existing operations values." >&2
  exit 2
fi
tar -xzf "${REMOTE_ARCHIVE}" -C "${REMOTE_APP_DIR}"
cd "${REMOTE_APP_DIR}"
set -a
source "${REMOTE_ENV_FILE}"
set +a
docker compose --project-name "${COMPOSE_PROJECT_NAME}" --env-file "${REMOTE_ENV_FILE}" -f docker-compose.yml up -d --build
docker compose --project-name "${COMPOSE_PROJECT_NAME}" --env-file "${REMOTE_ENV_FILE}" -f docker-compose.yml ps
curl -fsS "http://127.0.0.1:${PUBLIC_API_PORT:-14000}/health" >/dev/null
curl -fsS "http://127.0.0.1:${PUBLIC_WEB_PORT:-14001}/" >/dev/null
rm -f "${REMOTE_ARCHIVE}"
REMOTE_SCRIPT

echo "192.168.1.14 deployment completed; existing compose projects were not stopped."

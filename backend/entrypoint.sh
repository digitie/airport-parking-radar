#!/bin/sh
set -eu

case "${1:-}" in
  pytest|python|sh|bash)
    exec "$@"
    ;;
esac

if [ "${RUN_DB_MIGRATIONS:-true}" = "true" ]; then
  alembic upgrade head
fi

exec "$@"

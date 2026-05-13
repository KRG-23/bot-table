#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  npm run prisma:deploy
fi

exec "$@"

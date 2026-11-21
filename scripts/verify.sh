#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
set -a; [ ! -f .env ] || . ./.env; set +a
BASE="http://127.0.0.1:${BACKLOG_PORT:-3000}"
echo "Santé :"; curl -fsS "$BASE/api/health"; echo
echo "État :"; curl -fsS "$BASE/api/status"; echo
echo "Premiers jeux :"; curl -fsS "$BASE/api/games?limit=3"; echo
echo "Vérification terminée."

#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "ERREUR: copiez .env.example vers .env et renseignez DATA_PATH." >&2; exit 1; }
set -a; . ./.env; set +a
[ -n "${DATA_PATH:-}" ] || { echo "ERREUR: DATA_PATH est vide." >&2; exit 1; }
[ -d "$DATA_PATH" ] || { echo "ERREUR: le dossier $DATA_PATH n'existe pas." >&2; exit 1; }
[ -f "$DATA_PATH/backlog.sqlite" ] || { echo "ERREUR: $DATA_PATH/backlog.sqlite est introuvable. Core refuse d'inventer un inventaire." >&2; exit 1; }
command -v docker >/dev/null || { echo "ERREUR: Docker est introuvable." >&2; exit 1; }
docker compose version >/dev/null || { echo "ERREUR: Docker Compose v2 est requis." >&2; exit 1; }
echo "Prévol réussi."
echo "Base historique : $DATA_PATH/backlog.sqlite"
echo "Nouvelle base : $DATA_PATH/backlog-core.sqlite"
echo "Port : ${BACKLOG_PORT:-3000}"

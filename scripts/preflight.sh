#!/bin/sh
set -eu
[ -f .env ] || { echo "ERREUR: copiez .env.example vers .env puis définissez DATA_PATH." >&2; exit 1; }
set -a; . ./.env; set +a
[ -n "${DATA_PATH:-}" ] || { echo "ERREUR: DATA_PATH est vide." >&2; exit 1; }
[ -d "$DATA_PATH" ] || { echo "ERREUR: $DATA_PATH n'existe pas." >&2; exit 1; }
[ -w "$DATA_PATH" ] || { echo "ERREUR: $DATA_PATH n'est pas inscriptible." >&2; exit 1; }
if [ -f "$DATA_PATH/backlog-core.sqlite" ]; then
  echo "Base existante détectée. La migration créera une sauvegarde SQLite cohérente avant conversion."
fi
docker compose config >/dev/null
echo "Prévol réussi: configuration Compose valide et volume accessible."

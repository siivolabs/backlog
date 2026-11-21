#!/usr/bin/env sh
set -eu

if [ ! -f .env ]; then echo "Fichier .env absent" >&2; exit 1; fi
set -a; . ./.env; set +a
: "${DATA_PATH:?DATA_PATH doit être défini}"
STAMP=$(date +%Y%m%d-%H%M%S)
DEST="$DATA_PATH/backups/$STAMP"
mkdir -p "$DEST"
for file in backlog.sqlite backlog-core.sqlite; do
  if [ -f "$DATA_PATH/$file" ]; then cp -p "$DATA_PATH/$file" "$DEST/$file"; fi
done
printf 'Sauvegarde créée: %s\n' "$DEST"

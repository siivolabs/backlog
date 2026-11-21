#!/bin/sh
set -eu
[ -f .env ] && { set -a; . ./.env; set +a; }
: "${DATA_PATH:?DATA_PATH doit être défini}"
echo "IMPORTANT : utilisez ce script uniquement lorsque le conteneur Backlog est arrêté." >&2
SOURCE="$DATA_PATH/backlog-core.sqlite"
[ -f "$SOURCE" ] || { echo "Base absente: $SOURCE" >&2; exit 1; }
TARGET="$DATA_PATH/backlog-core.manual-$(date +%Y%m%d-%H%M%S).sqlite"
cp -p "$SOURCE" "$TARGET"
echo "$TARGET"

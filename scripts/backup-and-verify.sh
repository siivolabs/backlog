#!/bin/sh
set -eu

DATA_DIR="${1:-/srv/docker/backlog/data}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${2:-${DATA_DIR%/}-backup-${STAMP}}"

if [ ! -d "$DATA_DIR" ]; then
  echo "Dossier introuvable: $DATA_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp -a "$DATA_DIR"/. "$BACKUP_DIR"/

echo "Sauvegarde créée: $BACKUP_DIR"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \) -print

echo "Important: exécuter cette sauvegarde conteneur Backlog arrêté pour garantir la cohérence des fichiers WAL/SHM."

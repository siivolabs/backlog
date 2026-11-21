#!/usr/bin/env sh
set -eu

if [ ! -f .env ]; then
  echo "ERREUR: copiez .env.example vers .env et adaptez-le." >&2
  exit 1
fi

set -a
. ./.env
set +a

: "${DATA_PATH:?DATA_PATH doit être défini dans .env}"
: "${BACKLOG_IMAGE:?BACKLOG_IMAGE doit être défini dans .env}"

if [ ! -d "$DATA_PATH" ]; then
  echo "ERREUR: le dossier DATA_PATH n'existe pas: $DATA_PATH" >&2
  exit 1
fi
if [ ! -f "$DATA_PATH/backlog.sqlite" ]; then
  echo "ERREUR: backlog.sqlite est absent de $DATA_PATH" >&2
  exit 1
fi
if [ ! -w "$DATA_PATH" ]; then
  echo "ERREUR: le dossier DATA_PATH n'est pas accessible en écriture." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "ERREUR: Docker est introuvable." >&2
  exit 1
fi

echo "Prévol réussi. Aucun conteneur n'a été créé ou modifié."
echo "Image: $BACKLOG_IMAGE"
echo "Données: $DATA_PATH"

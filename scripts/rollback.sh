#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
[ -f deployment-state.env ] || { echo "ERREUR: deployment-state.env introuvable." >&2; exit 1; }
. ./deployment-state.env
[ -n "${LEGACY_CONTAINER:-}" ] || { echo "ERREUR: aucun conteneur précédent n'a été enregistré." >&2; exit 1; }
docker container inspect "$LEGACY_CONTAINER" >/dev/null 2>&1 || { echo "ERREUR: le conteneur $LEGACY_CONTAINER n'existe plus." >&2; exit 1; }
docker compose down
if [ -n "${DATA_PATH:-}" ] && [ -f "$DATA_PATH/backlog-core.sqlite" ]; then mv "$DATA_PATH/backlog-core.sqlite" "$DATA_PATH/backlog-core-rollback-$(date +%Y%m%d-%H%M%S).sqlite"; fi
docker rename "$LEGACY_CONTAINER" backlog-test
docker start backlog-test
echo "Ancienne installation restaurée. La base historique n'a pas été modifiée."

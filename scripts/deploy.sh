#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
./scripts/preflight.sh
set -a; . ./.env; set +a
STAMP=$(date +%Y%m%d-%H%M%S)
LEGACY_NAME=""
STATE_FILE="deployment-state.env"
rollback_on_error() {
  echo "Échec du déploiement; restauration du conteneur précédent..." >&2
  docker compose down >/dev/null 2>&1 || true
  if [ -n "$LEGACY_NAME" ] && docker container inspect "$LEGACY_NAME" >/dev/null 2>&1; then
    docker rename "$LEGACY_NAME" backlog-test || true
    docker start backlog-test || true
  fi
}
trap rollback_on_error INT TERM HUP

if docker container inspect backlog-test >/dev/null 2>&1; then
  echo "Sauvegarde cohérente de la base historique..."
  docker exec backlog-test node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/backlog.sqlite');d.exec(\"VACUUM INTO '/data/backlog-before-core-$STAMP.sqlite'\");d.close()"
  docker inspect backlog-test > "deployment-backup-container-$STAMP.json"
  LEGACY_NAME="backlog-legacy-$STAMP"
  docker stop backlog-test
  docker rename backlog-test "$LEGACY_NAME"
fi
cat > "$STATE_FILE" <<STATE
LEGACY_CONTAINER=$LEGACY_NAME
DEPLOYED_AT=$STAMP
HISTORICAL_BACKUP=$DATA_PATH/backlog-before-core-$STAMP.sqlite
DATA_PATH=$DATA_PATH
STATE

echo "Construction et démarrage de Backlog Core..."
if ! docker compose up -d --build --force-recreate; then rollback_on_error; exit 1; fi
PORT=${BACKLOG_PORT:-3000}
OK=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
if [ "$OK" -ne 1 ]; then rollback_on_error; exit 1; fi
trap - INT TERM HUP
echo "Backlog Core est prêt sur http://127.0.0.1:$PORT"
echo "Le conteneur précédent est conservé sous : ${LEGACY_NAME:-aucun}"
echo "Ne le supprimez qu'après validation de la bibliothèque réelle."

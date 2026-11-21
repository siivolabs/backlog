#!/bin/sh
set -eu
docker compose run --rm --no-deps backlog node scripts/backup.mjs

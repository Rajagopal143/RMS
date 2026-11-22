#!/usr/bin/env bash
# Dumps the database to $APP_DIR/backups/rms-YYYY-MM-DD.sql.gz and keeps the last two weeks.
# deploy.sh schedules this every night. To restore a backup:
#   gunzip -c backups/rms-2026-10-09.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U rms rms
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/rms}"
OUT="$APP_DIR/backups"
DAY="$(date +%F)"
mkdir -p "$OUT"
cd "$APP_DIR"
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U rms rms | gzip > "$OUT/rms-$DAY.sql.gz.tmp"
mv "$OUT/rms-$DAY.sql.gz.tmp" "$OUT/rms-$DAY.sql.gz"
find "$OUT" -name 'rms-*.sql.gz' -mtime +14 -delete

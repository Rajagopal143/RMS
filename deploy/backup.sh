#!/usr/bin/env bash
# Dumps the database to $APP_DIR/backups/rms-YYYY-MM-DD.sql.gz and keeps the last two weeks.
# deploy.sh schedules this every night (as root). To restore a backup:
#   gunzip -c backups/rms-2026-10-09.sql.gz | sudo -u postgres psql rms
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/rms}"
OUT="$APP_DIR/backups"
DAY="$(date +%F)"
mkdir -p "$OUT"
cd /
sudo -u postgres pg_dump rms | gzip > "$OUT/rms-$DAY.sql.gz.tmp"
mv "$OUT/rms-$DAY.sql.gz.tmp" "$OUT/rms-$DAY.sql.gz"
find "$OUT" -name 'rms-*.sql.gz' -mtime +14 -delete

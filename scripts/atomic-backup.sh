#!/usr/bin/env bash
# Nightly backups for the atomic-payments box. Installed at /usr/local/bin/atomic-backup.sh
# and run by /etc/cron.d/atomic-backup at 03:15 daily. Root-only; kept here for version control.
#
# Backs up (gzip'd, 14-day retention, to /var/backups/atomic):
#   1. atomic SQLite (consistent .backup snapshot — NOT a racy file copy)
#   2. opensigner Postgres (authservice + hotstorage) via pg_dumpall
#   3. opensigner MySQL (shield) via mysqldump (root pw read from container env)
#
# NOTE: these are ON-BOX backups (they don't survive loss of the box itself).
# Off-box replication (pull to a second host / object storage) is the next step.
# Also note: the passkey (email) wallet's funds do NOT depend on this DB — the key
# is re-derived on-device from the user's passkey. These backups protect
# operational data (swap history, bug reports, the passkey directory), not funds.
set -uo pipefail
TS=$(date +%Y%m%d-%H%M%S)
DEST=/var/backups/atomic
mkdir -p "$DEST"; chmod 700 "$DEST"
LOG=/var/log/atomic-backup.log
echo "[$(date -Is)] backup start $TS" >> "$LOG"

sqlite3 /var/www/atomic-pay/prisma/dev.db ".backup '$DEST/atomic-$TS.db'" \
  && gzip -f "$DEST/atomic-$TS.db" \
  && echo "[$(date -Is)] sqlite ok" >> "$LOG" || echo "[$(date -Is)] SQLITE FAIL" >> "$LOG"

docker exec ofpostgres pg_dumpall -U postgres 2>>"$LOG" | gzip > "$DEST/opensigner-pg-$TS.sql.gz" \
  && echo "[$(date -Is)] postgres ok" >> "$LOG" || echo "[$(date -Is)] PG FAIL" >> "$LOG"

docker exec ofmysql sh -c 'exec mysqldump --all-databases -uroot -p"$MYSQL_ROOT_PASSWORD" 2>/dev/null' | gzip > "$DEST/opensigner-mysql-$TS.sql.gz" \
  && echo "[$(date -Is)] mysql ok" >> "$LOG" || echo "[$(date -Is)] MYSQL FAIL" >> "$LOG"

find "$DEST" -name "*.gz" -mtime +14 -delete
echo "[$(date -Is)] backup done" >> "$LOG"

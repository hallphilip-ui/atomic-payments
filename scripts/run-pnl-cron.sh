#!/bin/sh
# Daily P&L cron wrapper: load the app env, then generate + email the report.
# Scheduled via crontab with CRON_TZ=America/New_York so 7:00 stays 7:00 ET
# across daylight-saving changes.
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
set -a
[ -f ./.env ] && . ./.env
set +a
exec node scripts/pnl-report.js

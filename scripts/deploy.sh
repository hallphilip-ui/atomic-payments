#!/usr/bin/env bash
# Deploy atomic-payments to the production box.
#
# WHY THIS SCRIPT EXISTS (do not go back to a bare `rsync -az`):
#   `rsync -a` implies -o/-g, and when the receiving side runs as root it
#   PRESERVES THE SOURCE'S uid/gid. Deploying from a Mac (uid 502) therefore
#   re-owned /var/www/atomic-pay/prisma to a uid that doesn't exist on the box,
#   leaving it unwritable by the `atomic` service user. SQLite then fails every
#   write with "attempt to write a readonly database" — quotes, bug reports and
#   wallet sessions all silently break, while reads keep working so the site
#   looks fine. Forcing --chown (and a belt-and-braces chown -R) prevents that.
#
# Usage: scripts/deploy.sh [ssh-host]   (default host: opensigner)
set -euo pipefail

HOST="${1:-opensigner}"
APP=/var/www/atomic-pay
SERVICE_USER=atomic

echo "==> syncing to ${HOST}:${APP}"
# -rlptz, NOT -a: -a implies -o/-g which, when the receiver runs as root,
# stamps this machine's uid/gid onto the files (the bug this script exists to
# prevent). Without -o/-g, files land owned by the ssh user; the chown -R below
# then hands them to the service user. (Also avoids --chown, unsupported by the
# ancient rsync macOS ships.)
rsync -rlptz \
  --exclude=node_modules --exclude=.git --exclude=.env \
  --exclude=dist --exclude='*.db' --exclude=.DS_Store \
  ./ "${HOST}:${APP}/"

echo "==> fixing ownership, building, restarting"
ssh "${HOST}" "set -e
  chown -R ${SERVICE_USER}:${SERVICE_USER} ${APP}
  chmod 600 ${APP}/.env
  # SQLite needs the *directory* writable (for -wal/-journal), not just the file.
  sudo -u ${SERVICE_USER} test -w ${APP}/prisma || { echo 'prisma dir not writable by ${SERVICE_USER}'; exit 1; }
  sudo -u ${SERVICE_USER} HOME=/home/${SERVICE_USER} bash -c 'cd ${APP} && npm run build >/tmp/deploy-build.log 2>&1' \
    || { echo 'BUILD FAILED'; tail -15 /tmp/deploy-build.log; exit 1; }
  sudo -u ${SERVICE_USER} HOME=/home/${SERVICE_USER} bash -c 'cd ${APP} && set -a; . ./.env; set +a; pm2 restart atomic-backend >/dev/null 2>&1'
  echo '  built + restarted'"

echo "==> post-deploy smoke (reads AND a write — a readonly DB must fail loudly)"
sleep 3
health=$(curl -s -o /dev/null -w '%{http_code}' -m15 https://atomicpay.cloud/v1/health)
# Write canary: upsert a fixed sentinel passkey row. Idempotent (one row, never
# accumulates) and not user-facing — unlike a bug report, it won't pollute anything.
write=$(curl -s -m20 -XPOST https://atomicpay.cloud/v1/passkey/register -H 'Content-Type: application/json' \
        -d '{"email":"deploy-smoke@atomic.internal","credentialId":"ZGVwbG95","address":"0x00000000000000000000000000000000dEadBeef"}' \
        | grep -c '"ok"')
echo "  health: ${health}  |  db-write ok: ${write} (want 1)"
[ "${health}" = "200" ] && [ "${write}" = "1" ] && echo "==> DEPLOY OK" || { echo "==> DEPLOY VERIFY FAILED"; exit 1; }

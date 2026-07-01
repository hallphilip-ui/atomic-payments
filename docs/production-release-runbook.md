# Atomic Payments Production Release Runbook

## Release Goal

This runbook defines the minimum production gate for Atomic Payments before a hosted release. The current Docker path is strong enough for local repeatability and smoke testing, but production still needs managed persistence, real secrets, live provider verification, and operational monitoring.

## Preflight Gates

Run these checks before every release candidate:

```bash
cd /Users/philiphall/atomic-payments
npm run build
npm run test:providers
npm run smoke:core:isolated
npm run check:deploy
```

Run the strict production gate with production-shaped environment values:

```bash
cd /Users/philiphall/atomic-payments
ATOMIC_DEPLOY_ENV=production npm run check:deploy
```

The strict gate must report zero failures before launch.

## Production Requirements

- Use a managed database instead of local SQLite.
- Move the Prisma datasource provider and migration process to the selected managed database target.
- Store `DATABASE_URL`, `ATOMIC_WEBHOOK_SECRET`, provider keys, and compliance vendor keys in a deployment secret store.
- Use `live_with_fallback` only during pre-production verification; use `live` after provider contract tests pass.
- Connect the compliance provider boundary to a real KYT/sanctions vendor before handling production value.
- Keep `/v1/health` wired to the platform health check.
- Ship structured request logs to the platform log store.
- Add release rollback instructions for the hosting target.

## Release Decision

Do not promote to production if any of these are true:

- `npm run check:deploy` fails in strict production mode.
- Prisma is still configured for SQLite.
- Swap or compliance provider mode is still `simulation`.
- Webhook secret is unset, short, or placeholder-like.
- Docker smoke or isolated core smoke fails.
- No rollback plan exists for the release target.

## Current Status

Atomic Payments is ready for local Docker smoke and internal demo workflows. It is not yet production-ready for real funds until the managed database, live provider, compliance vendor, and rollback paths are completed.

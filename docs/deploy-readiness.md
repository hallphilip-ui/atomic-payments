# Atomic Payments Deploy Readiness

## Purpose

This check is a lightweight gate before production-style deploys. It does not replace security review, vendor onboarding, or infrastructure runbooks, but it prevents the easiest mistakes: missing database config, placeholder webhook secrets, and accidental simulation-only provider modes.

## Commands

Local/staging review:

```bash
cd /Users/philiphall/atomic-payments
npm run check:deploy
```

Strict production gate:

```bash
cd /Users/philiphall/atomic-payments
ATOMIC_DEPLOY_ENV=production npm run check:deploy
```

## Current Rules

- `DATABASE_URL` must exist.
- Production mode fails if `DATABASE_URL` is SQLite.
- Production mode fails if the Prisma datasource provider is still `sqlite`.
- `ATOMIC_WEBHOOK_SECRET` must be set to a non-placeholder secret before production.
- `ATOMIC_OPERATOR_API_KEY` must be set to a non-placeholder secret before production.
- Production mode fails if swap provider mode is still `simulation`.
- Production mode fails if compliance provider mode is still `simulation`.
- `PORT` must be a valid integer.

## Production Follow-Up

- Move persistence to a managed database.
- Change the Prisma datasource provider and migration workflow for the managed database target.
- Store all secrets, including operator/admin keys used for internal metrics and progress endpoints, in the deployment secret store.
- Run live provider contract tests against the exact Rango/THORChain payloads.
- Connect KYT/sanctions credentials and record provider request IDs.
- Add log shipping, dashboards, alerting, and rollback runbooks.

# Atomic Payments Deploy Readiness

## Purpose

This check is a lightweight gate before production-style deploys. It does not replace security review, vendor onboarding, or infrastructure runbooks, but it prevents the easiest mistakes: missing database config, placeholder webhook secrets, and accidental simulation-only provider modes.

## Commands

Local/staging review:

```bash
cd /Users/philiphall/atomic-payments
npm run check:deploy
npm run check:prisma
```

Strict production gate:

```bash
cd /Users/philiphall/atomic-payments
ATOMIC_DEPLOY_ENV=production npm run check:deploy
```

Strict production gate with public-domain reachability:

```bash
cd /Users/philiphall/atomic-payments
ATOMIC_DEPLOY_ENV=production ATOMIC_PUBLIC_BASE_URL=https://atomicpay.cloud npm run check:deploy
```

Strict production gate using the Postgres schema variant:

```bash
cd /Users/philiphall/atomic-payments
ATOMIC_DEPLOY_ENV=production ATOMIC_PRISMA_SCHEMA_PATH=prisma/schema.postgres.prisma ATOMIC_PUBLIC_BASE_URL=https://atomicpay.cloud npm run check:deploy
```

## Current Rules

- `DATABASE_URL` must exist.
- Production mode fails if `DATABASE_URL` is SQLite.
- Production mode fails if the Prisma datasource provider is still `sqlite`.
- `ATOMIC_WEBHOOK_SECRET` must be set to a non-placeholder secret before production.
- `ATOMIC_OPERATOR_API_KEY` must be set to a non-placeholder secret before production.
- `ATOMIC_OPERATOR_READONLY_API_KEY` must be set to a separate non-placeholder secret before production for inspection-only workflows.
- Production mode fails if swap provider mode is still `simulation`.
- Production mode fails if compliance provider mode is still `simulation`.
- `PORT` must be a valid integer.
- Required contract test scripts must be present for observability, operator auth, providers, platform connectors, and transfer compliance.
- Production mode requires `ATOMIC_PUBLIC_BASE_URL` to be a valid HTTPS URL.
- When `ATOMIC_PUBLIC_BASE_URL` is set, the checker probes public HTTPS reachability unless `ATOMIC_SKIP_PUBLIC_URL_CHECK=1` is set.
- `ATOMIC_PRISMA_SCHEMA_PATH` can point the gate at `prisma/schema.postgres.prisma` for production database readiness checks.

## Production Follow-Up

- Move persistence to a managed database.
- Use `prisma/schema.postgres.prisma` with the managed Postgres `DATABASE_URL`, then promote it to the primary schema once migrations and hosted smoke tests are complete.
- Store all secrets, including operator/admin keys used for internal metrics and progress endpoints, in the deployment secret store.
- Use the read-only operator key for dashboards and previews; reserve the full operator key for decisions, withdrawals, settlement accepts, and other write actions.
- Run live provider contract tests against the exact Rango/THORChain payloads.
- Connect KYT/sanctions credentials and record provider request IDs.
- Keep platform connector and transfer compliance contract tests in CI before enabling live transfer credentials.
- Verify operator audit-log retention/export requirements before live operations; local audit exports include a SHA-256 digest, but production still needs external immutable archive storage.
- Add log shipping, dashboards, alerting, and rollback runbooks.

## Cloudflare Domain Check

- `atomicpay.cloud` is delegated to Cloudflare nameservers.
- The apex and `www` hostnames resolve to Cloudflare proxy IPs.
- Public HTTP reaches Cloudflare.
- Public HTTPS currently returns Cloudflare `525`, which means Cloudflare cannot complete an SSL handshake with the origin. Fix the origin certificate/HTTPS listener or adjust Cloudflare SSL mode before treating the domain as production-ready.
- Browser pages should use same-origin API paths so Cloudflare-served pages call `atomicpay.cloud` instead of a local development host.
- `npm run check:deploy` now includes a `PUBLIC_HTTPS_REACHABILITY` check when `ATOMIC_PUBLIC_BASE_URL=https://atomicpay.cloud` is provided.

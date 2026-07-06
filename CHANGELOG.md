# Changelog

## Unreleased

- Added a public, read-only transfers/conversions explorer (`/transfers` page + `GET /v1/transfers`) with status-group filtering (all/pending/complete/failed), pagination, per-tab counts, and live refresh.
- Added a daily P&L report (`GET /v1/admin/pnl` + `scripts/pnl-report.js`): platform-fee revenue on completed conversions bucketed into today / week (Mon) / month / calendar-YTD, timezone-aware, delivered by email over SMTP via a 7:00 AM ET cron.
- Hardened live swap routing to fail closed: `getProviderAssetId` + `buildProviderPayload(..., live)` reject any asset lacking a certified provider ID, so live mode never sends an internal asset ID to THORChain/Rango. Simulation is unchanged.

## 1.1.0 - 2026-07-03

- Added runtime build metadata through `/v1/build`, `/v1/health`, and `/v1/project/progress`.
- Added deterministic local test accounts and seed verification.
- Added guarded wallet broadcast adapters for EVM and Solana simulation/live/live-with-fallback modes.
- Added swap broadcast route with transaction proof capture and raw transaction redaction.
- Added production observability readiness contract for log drain, dashboard, alert policy, and incident runbook links.
- Added a protected launch-evidence bundle for bug-test handoff, local verification proof, production observability state, release decision, and remaining external signoffs.
- Added operator audit evidence exports with SHA-256 digests.
- Added settlement reconciliation evidence exports with SHA-256 digests.
- Added production readiness gates for evidence archive configuration and build identity.
- Expanded operator-protected smoke coverage for read-only inspection and privileged operations.

## 1.0.0 - 2026-06-29

- Initial Atomic Payments local MVP foundation.

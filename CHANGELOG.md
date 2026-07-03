# Changelog

## 1.1.0 - 2026-07-03

- Added runtime build metadata through `/v1/build`, `/v1/health`, and `/v1/project/progress`.
- Added deterministic local test accounts and seed verification.
- Added guarded wallet broadcast adapters for EVM and Solana simulation/live/live-with-fallback modes.
- Added swap broadcast route with transaction proof capture and raw transaction redaction.
- Added operator audit evidence exports with SHA-256 digests.
- Added settlement reconciliation evidence exports with SHA-256 digests.
- Added production readiness gates for evidence archive configuration and build identity.
- Expanded operator-protected smoke coverage for read-only inspection and privileged operations.

## 1.0.0 - 2026-06-29

- Initial Atomic Payments local MVP foundation.

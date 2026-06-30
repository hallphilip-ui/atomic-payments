# Atomic Payments Project Progress

Last updated: June 30, 2026

## Overall Build Completion

Estimated total completion: 62-65%

Atomic Payments now has a working local foundation for merchant payments, off-exchange settlement, DeFi swap quoting, AML review, brand presentation, internationalized console UI, and core smoke coverage. The remaining work is mostly production hardening: real provider verification, real wallet signing, production-grade AML/KYT vendors, security controls, CI/CD, observability, and operational runbooks.

## Completed Slices

### Core App And API

Completion: 65-70%

- Express API running on port 3005.
- Prisma-backed local SQLite data model.
- Merchant payment intent endpoints and admin fee configuration.
- CORS, JSON handling, and local static console routes.
- Build passes with `npm run build`.

### Off-Exchange Settlement And Market Making

Completion: 50-55%

- Top-20 launch basket for liquid fiat and stablecoin rails.
- FX quote engine with spreads, route fees, TTLs, and risk checks.
- Settlement instruction creation and treasury ledger entries.
- Treasury position summaries and settlement API endpoints.

Production gaps:

- Real bank/PSP rails.
- Liquidity provider connectivity.
- Treasury controls, reconciliation, limits, and approvals.
- Production settlement accounting.

### DeFi Atomic Swap Core

Completion: 55-60%

- Target top-25 crypto asset registry.
- Quote path with platform fee guardrails.
- Rango/THORChain adapter boundary with simulation default.
- Provider diagnostics surfaced in API and UI.
- Swap lifecycle states, authorization, advance flow, event log, and SSE stream.

Production gaps:

- Verify live Rango and THORChain request/response formats against current official docs.
- Real provider execution, not just quote simulation.
- Real wallet signatures and transaction submission.
- Chain-specific gas, slippage, failure, and refund handling.

### AML And Compliance

Completion: 50-55%

- Compliance scoring engine for wallet format, watchlist keywords, enhanced chain review, amount thresholds, and price-impact risk.
- Auto-clear, manual-review, blocked, approved, and rejected states.
- Admin compliance API for listing reviews and recording decisions.
- Operator review desk at `/admin-compliance`.
- Compliance review response includes linked swap context.

Production gaps:

- Real KYT/sanctions provider integration.
- Case management, audit export, user/KYC identity links, Travel Rule vendor flow.
- Role-based access control and immutable audit logs.

### Console UX And Brand

Completion: 55-60%

- DeFi swap console at `/defi-swap`.
- Compliance review console at `/admin-compliance`.
- Transparent Atomic mark asset served from `/assets/atomic-mark.png`.
- Logo integrated into the top bar without a pasted background box.
- Provider diagnostics, quote state, action hints, compliance status, and event logs visible.
- Internationalization layer with 15 languages and RTL support for Arabic and Urdu.

Production gaps:

- Move from standalone HTML to the final product frontend architecture if needed.
- More polished mobile QA across small devices.
- Accessibility pass for keyboard navigation and screen-reader details.

### Smoke Coverage

Completion: 35-40%

- Core smoke script at `scripts/smoke-core.js`.
- `npm run smoke:core` checks:
  - asset/config endpoints
  - i18n asset serving
  - quote creation
  - authorization
  - event log
  - manual AML review
  - compliance approval
- Smoke-created quotes are cleaned up by default after each run.

Production gaps:

- Add CI execution.
- Add dedicated test database isolation for CI and parallel runs.
- Add provider-adapter contract tests.
- Add browser-level UI regression tests.

## Current Run Commands

Start the local app:

```bash
cd /Users/philiphall/atomic-payments
npm start
```

Run the TypeScript build:

```bash
cd /Users/philiphall/atomic-payments
npm run build
```

Run the core smoke test while the app is running:

```bash
cd /Users/philiphall/atomic-payments
npm run smoke:core
```

Open the main local consoles:

- Swap console: `http://127.0.0.1:3005/defi-swap`
- Compliance desk: `http://127.0.0.1:3005/admin-compliance`

## Next Recommended Build Slices

1. Real wallet connection boundary

Add wallet adapter contracts for EVM and Solana, capture wallet address from injected providers, and separate simulated authorization from real signature capture.

2. Provider adapter verification

Use official Rango and THORChain documentation to confirm live quote payloads, response parsing, affiliate fee fields, error handling, and live-with-fallback behavior.

3. Test hardening

Add isolated test database setup and teardown for CI and parallel runs. Local smoke-created quote records are already cleaned up by the script.

4. Compliance production bridge

Add vendor abstraction for KYT/sanctions screening, case decisions, and audit export.

5. Docker and CI finish

Make Docker a repeatable path for app, database migration, smoke checks, and future deploy readiness.

## Current Risk Register

- Live provider integration is scaffolded but not production-verified.
- AML is deterministic simulation logic, not a production compliance vendor.
- Wallet signing is simulated.
- Local SQLite is useful for development but not production persistence.
- i18n copy is operational and broad, but should get native-speaker review before customer launch.
- Smoke tests clean up their own quote records, but should still use an isolated database before CI.

## Near-Term Completion Target

The project can reach roughly 75% completion by finishing:

- real wallet adapter boundary
- provider live-doc verification
- test database isolation
- Docker/CI smoke execution
- first compliance vendor abstraction

The remaining 25% after that is launch-grade production work: regulated operations, vendor contracts, security review, observability, incident runbooks, reconciliation, and real liquidity/settlement operations.

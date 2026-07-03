# Atomic Payments Project Progress

Last updated: July 3, 2026

## Overall Build Completion

Estimated total completion: 84-86%

Atomic Payments now has a working local foundation for merchant payments, off-exchange settlement, DeFi swap quoting, AML review, brand presentation, internationalized console UI, Cloudflare readiness checks, a Postgres schema path, cross-platform checkout UI, a real local payment-intent checkout contract, tethered-asset checkout rails for USDC, USDT, and PYUSD, transfer-only platform connector boundaries, simulated withdrawal compliance gates, and CI-backed contract coverage. The remaining work is mostly production hardening: real provider verification, real wallet signing, production-grade AML/KYT vendors, hosted database migration, role controls, reconciliation, observability, and operational runbooks.

## Completed Slices

### Core App And API

Completion: 82-84%

- Express API running on port 3005.
- Prisma-backed local SQLite data model.
- Merchant payment intent endpoints and admin fee configuration.
- Merchant-authenticated payment intent creation with `x-atomic-key`.
- Public payment intent lookup returns checkout-safe fields without merchant secrets.
- Payment intent responses include checkout path and deployment-aware checkout URL for merchant redirects.
- Rail selection persists selected chain, quoted crypto amount, live rate, and deposit address for checkout refresh.
- Stablecoin conversion registry supports checkout settlement into USDC, USDT, and PYUSD at USD parity.
- Public `/v1/payment_rails` catalog exposes checkout rail metadata for product UI and future widgets.
- Payment intent rail selection rejects unsupported rail IDs and returns the supported catalog identifiers.
- CORS, JSON handling, and local static console routes.
- Build passes with `npm run build`.
- Docker image and Compose service for repeatable local app startup.
- Dedicated `/v1/health` readiness endpoint reports service, database, provider, and compliance mode.
- Structured request logging emits request ID, method, redacted path, status, duration, user agent, and remote address.
- `/v1/metrics` exposes in-memory request counts, error counts, average/max latency, and per-route summaries.
- Deploy readiness check validates database config, Prisma datasource provider, webhook secret posture, operator API key posture, provider modes, and port settings.
- Postgres Prisma schema variant and `npm run check:prisma` validate the managed database path without forcing local development off SQLite.
- Public-domain readiness checks validate HTTPS reachability for Cloudflare-served URLs.
- Production release runbook documents the hosted-release preflight gates and blockers.
- Observability contract test verifies sensitive query parameters are redacted before logging or metrics aggregation.
- Operator API key middleware protects admin, metrics, internal project progress, settlement quote list, settlement instruction, and treasury routes when `ATOMIC_OPERATOR_API_KEY` is configured.
- Optional read-only operator key allows inspection and withdrawal previews while write actions require the full operator key.

### Off-Exchange Settlement And Market Making

Completion: 61-65%

- Top-20 launch basket for liquid fiat and stablecoin rails.
- FX quote engine with spreads, route fees, TTLs, and risk checks.
- Settlement instruction creation and treasury ledger entries.
- Treasury position summaries and settlement API endpoints.
- Platform transfer connector registry covers 15 broker/exchange/infrastructure APIs for deposits, withdrawals, account status, and balances only.
- `/v1/settlement/platform-connectors` exposes transfer-only connector candidates with trading disabled.
- Simulated platform transfer adapter factory defines the safe future-live connector boundary without order/trade methods.
- Outgoing platform withdrawal simulation now passes through a compliance release gate before transfer creation.
- Admin funding connector panel previews clean and blocked withdrawal release-gate decisions without creating transfers.
- Operator-protected simulated connector endpoints cover account status, balances, deposit instructions/status, withdrawal request/status, and transfer events.
- `npm run test:platform-connectors` enforces transfer-only connector scope and rejects trading capability drift.

Production gaps:

- Real bank/PSP rails.
- Liquidity provider connectivity.
- Official platform API verification and transfer-only credential onboarding.
- Treasury controls, reconciliation, limits, and approvals.
- Production settlement accounting.

### DeFi Atomic Swap Core

Completion: 66-69%

- Target top-25 crypto asset registry.
- Quote path with platform fee guardrails.
- Rango/THORChain adapter boundary with simulation default.
- Provider diagnostics surfaced in API and UI.
- Provider adapter contract coverage for simulation, live-with-fallback behavior, mocked live Rango response parsing, and mocked live THORChain response parsing.
- Swap lifecycle states, authorization, advance flow, event log, and SSE stream.
- Browser wallet boundary for EVM and Solana detection, connection, destination fill, and signature capture with simulation fallback.
- Wallet authorization audit trail records wallet type, wallet address, signature kind, signature hash, signed message hash, chain intent, and timestamp.

Production gaps:

- Verify live Rango and THORChain request/response formats against current official docs and sandbox/live responses.
- Real provider execution, not just quote simulation.
- Production wallet transaction submission and chain-specific broadcast flows.
- Chain-specific gas, slippage, failure, and refund handling.

### AML And Compliance

Completion: 64-68%

- Compliance scoring engine for wallet format, watchlist keywords, enhanced chain review, amount thresholds, and price-impact risk.
- Auto-clear, manual-review, blocked, approved, and rejected states.
- Admin compliance API for listing reviews and recording decisions.
- Compliance evidence export endpoint returns review context, linked quote context, generated timestamp, and SHA-256 evidence hash.
- Operator review desk at `/admin-compliance`.
- Compliance review response includes linked swap context.
- Compliance provider boundary records simulated KYT vendor mode, provider, reference ID, decision, latency, and metadata.
- Transfer compliance contract test covers clean, invalid, sanctioned, high-value, and enhanced-network withdrawal release outcomes.

Production gaps:

- Real KYT/sanctions provider credentials and live request/response mapping.
- Case management, audit export, user/KYC identity links, Travel Rule vendor flow.
- Immutable audit logs and broader multi-user role management beyond API-key scoped operator access.

### Console UX And Brand

Completion: 75-78%

- DeFi swap console at `/defi-swap`.
- Checkout gateway at `/checkout` now uses a self-contained responsive Atomic UI with no Tailwind CDN dependency.
- Checkout gateway has safe-area support, mobile/desktop responsive layout, reduced-motion handling, and large touch targets.
- Checkout gateway supports light, dark, and system theme modes.
- Checkout gateway loads real payment intents from `?intentId=...`, `?intent=...`, or pasted intent IDs.
- Checkout gateway displays the real amount, currency, status, selected rail instructions, and payment URI QR.
- Checkout gateway exposes tethered-asset payment rails for USDC on Solana/Ethereum, USDT on Ethereum/Tron, and PYUSD on Ethereum.
- Checkout gateway renders payment rail options from the backend catalog with a local fallback catalog.
- Compliance review console at `/admin-compliance`.
- Product-facing project tracker UI has been removed from the swap console and app routes.
- `/v1/project/progress` exposes build progress as structured data for internal reporting and future non-product surfaces.
- Transparent Atomic mark asset served from `/assets/atomic-mark.png`.
- Logo integrated into the top bar without a pasted background box.
- Provider diagnostics, quote state, action hints, compliance status, and event logs visible.
- Internationalization layer with 15 languages and RTL support for Arabic and Urdu.
- Connect Wallet control in the swap console with EVM/Solana detection.

Production gaps:

- Move from standalone HTML to the final product frontend architecture if needed.
- Accessibility pass for keyboard navigation and screen-reader details.

### Smoke Coverage

Completion: 79-82%

- Core smoke script at `scripts/smoke-core.js`.
- `npm run smoke:core` checks:
  - asset/config endpoints
  - i18n asset serving
  - quote creation
  - authorization
  - wallet authorization audit metadata
  - event log
  - manual AML review
  - compliance approval
  - simulated KYT vendor metadata
  - payment intent create/fetch/select-rail checkout contract
  - checkout path and forwarded-domain checkout URL generation
  - USDC, USDT, and PYUSD tethered checkout rail conversion
  - public payment rail catalog metadata
  - unsupported payment rail rejection
- Smoke-created quotes are cleaned up by default after each run.
- Smoke-created payment intents and merchants are cleaned up by default after each run.
- GitHub Actions CI runs install, Prisma database prep, build, local API startup, and core smoke checks on push/PR.
- GitHub Actions CI runs platform connector and transfer compliance contract tests before smoke.
- Isolated smoke command creates a temporary SQLite database and API port for clean local/CI runs.
- Provider adapter contract test runs in CI without network or database dependencies.
- Docker smoke command builds the container, starts the service, waits for readiness, runs the core smoke, and tears the stack down.
- Smoke coverage verifies `/v1/health`; Docker healthcheck uses the dedicated readiness endpoint.
- Smoke coverage verifies request ID propagation through the health endpoint.
- Smoke coverage verifies `/v1/metrics` request and route tracking.
- Deploy readiness check reports whether required local contract test scripts are present.
- Smoke coverage verifies read-only operator access can inspect connector state and preview withdrawals but cannot create withdrawals.

Production gaps:

- Add broader test isolation for future browser suites.
- Expand provider-adapter contract tests again after official live Rango/THORChain schemas are verified.
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

Run provider adapter contract checks:

```bash
cd /Users/philiphall/atomic-payments
npm run test:providers
```

Run observability contract checks:

```bash
cd /Users/philiphall/atomic-payments
npm run test:observability
```

Run operator auth contract checks:

```bash
cd /Users/philiphall/atomic-payments
npm run test:operator-auth
```

Fetch structured project progress:

```bash
cd /Users/philiphall/atomic-payments
curl http://127.0.0.1:3005/v1/project/progress
```

When `ATOMIC_OPERATOR_API_KEY` is configured, include `x-atomic-operator-key` on that progress request.

Run deployment readiness checks:

```bash
cd /Users/philiphall/atomic-payments
npm run check:deploy
```

Review the production release runbook:

```bash
cd /Users/philiphall/atomic-payments
open docs/production-release-runbook.md
```

Run the Docker smoke path:

```bash
cd /Users/philiphall/atomic-payments
npm run smoke:docker
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

1. Real wallet production signing

Turn the wallet authorization audit trail into chain-specific transaction submission for the supported chains, with payload validation, broadcast results, error handling, and refund/failure states.

2. Provider adapter verification

Use official Rango and THORChain documentation to confirm live quote payloads, response parsing, affiliate fee fields, error handling, and live-with-fallback behavior.

3. Test hardening

Extend the isolated smoke pattern into browser and provider-contract test suites as those suites are added.

4. Compliance production bridge

Connect the compliance provider boundary to a production KYT/sanctions vendor, add sensitive-field filtering, and exportable case evidence.

5. Docker and deploy finish

Extend the Docker path into production deploy configuration, environment secrets, hosted database migrations, image publishing, and release rollback steps.

## Current Risk Register

- Live provider integration is scaffolded but not production-verified.
- AML now has a provider boundary with simulated KYT metadata, but not a production compliance vendor.
- Wallet signing now records auditable authorization metadata, but production transaction broadcast is still simulated.
- Local SQLite is useful for development but not production persistence.
- A Postgres Prisma schema variant now exists for managed-database readiness checks, but production migrations and hosted smoke tests are still required.
- i18n copy is operational and broad, but should get native-speaker review before customer launch.
- Core smoke tests now use an isolated database in CI; provider adapter contracts now run without network or database dependencies; future browser suites should follow the same pattern.
- CI now runs isolated smoke both without an operator key and with a test operator key, covering open local mode plus protected-route rejection behavior.
- Docker is now repeatable locally, but production deploy still needs managed persistence, secrets, image publishing, and rollback controls.
- Deploy readiness checks now block SQLite schema posture in strict production mode, but production still needs managed secrets, image publishing, and hosted database migration workflows.
- Operator auth now gates sensitive API and internal progress routes when configured, but production still needs full identity, roles, session management, and immutable audit logs.
- Health/readiness, structured request logs, and local request metrics exist, but production observability still needs traces, log shipping, dashboards, and alerting.

## Near-Term Completion Target

The project can reach roughly 75% completion by finishing:

- production wallet signing/submission
- provider live-doc verification
- browser test isolation
- Docker deploy hardening
- first live compliance vendor integration

The remaining 25% after that is launch-grade production work: regulated operations, vendor contracts, security review, observability, incident runbooks, reconciliation, and real liquidity/settlement operations.

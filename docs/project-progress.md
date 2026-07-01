# Atomic Payments Project Progress

Last updated: July 1, 2026

## Overall Build Completion

Estimated total completion: 73-75%

Atomic Payments now has a working local foundation for merchant payments, off-exchange settlement, DeFi swap quoting, AML review, brand presentation, internationalized console UI, and core smoke coverage. The remaining work is mostly production hardening: real provider verification, real wallet signing, production-grade AML/KYT vendors, security controls, CI/CD, observability, and operational runbooks.

## Completed Slices

### Core App And API

Completion: 68-72%

- Express API running on port 3005.
- Prisma-backed local SQLite data model.
- Merchant payment intent endpoints and admin fee configuration.
- CORS, JSON handling, and local static console routes.
- Build passes with `npm run build`.
- Docker image and Compose service for repeatable local app startup.
- Dedicated `/v1/health` readiness endpoint reports service, database, provider, and compliance mode.
- Structured request logging emits request ID, method, path, status, duration, user agent, and remote address.
- `/v1/metrics` exposes in-memory request counts, error counts, average/max latency, and per-route summaries.

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

Completion: 63-66%

- Target top-25 crypto asset registry.
- Quote path with platform fee guardrails.
- Rango/THORChain adapter boundary with simulation default.
- Provider diagnostics surfaced in API and UI.
- Provider adapter contract coverage for simulation and live-with-fallback behavior.
- Swap lifecycle states, authorization, advance flow, event log, and SSE stream.
- Browser wallet boundary for EVM and Solana detection, connection, destination fill, and signature capture with simulation fallback.
- Wallet authorization audit trail records wallet type, wallet address, signature kind, signature hash, signed message hash, chain intent, and timestamp.

Production gaps:

- Verify live Rango and THORChain request/response formats against current official docs.
- Real provider execution, not just quote simulation.
- Production wallet transaction submission and chain-specific broadcast flows.
- Chain-specific gas, slippage, failure, and refund handling.

### AML And Compliance

Completion: 55-58%

- Compliance scoring engine for wallet format, watchlist keywords, enhanced chain review, amount thresholds, and price-impact risk.
- Auto-clear, manual-review, blocked, approved, and rejected states.
- Admin compliance API for listing reviews and recording decisions.
- Operator review desk at `/admin-compliance`.
- Compliance review response includes linked swap context.
- Compliance provider boundary records simulated KYT vendor mode, provider, reference ID, decision, latency, and metadata.

Production gaps:

- Real KYT/sanctions provider credentials and live request/response mapping.
- Case management, audit export, user/KYC identity links, Travel Rule vendor flow.
- Role-based access control and immutable audit logs.

### Console UX And Brand

Completion: 58-62%

- DeFi swap console at `/defi-swap`.
- Compliance review console at `/admin-compliance`.
- Project plan widget at `/project-plan` visualizes overall completion, workstream progress, near-term milestones, risks, and recently finished slices.
- Transparent Atomic mark asset served from `/assets/atomic-mark.png`.
- Logo integrated into the top bar without a pasted background box.
- Provider diagnostics, quote state, action hints, compliance status, and event logs visible.
- Internationalization layer with 15 languages and RTL support for Arabic and Urdu.
- Connect Wallet control in the swap console with EVM/Solana detection.

Production gaps:

- Move from standalone HTML to the final product frontend architecture if needed.
- More polished mobile QA across small devices.
- Accessibility pass for keyboard navigation and screen-reader details.

### Smoke Coverage

Completion: 58-61%

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
- Smoke-created quotes are cleaned up by default after each run.
- GitHub Actions CI runs install, Prisma database prep, build, local API startup, and core smoke checks on push/PR.
- Isolated smoke command creates a temporary SQLite database and API port for clean local/CI runs.
- Provider adapter contract test runs in CI without network or database dependencies.
- Docker smoke command builds the container, starts the service, waits for readiness, runs the core smoke, and tears the stack down.
- Smoke coverage verifies `/v1/health`; Docker healthcheck uses the dedicated readiness endpoint.
- Smoke coverage verifies request ID propagation through the health endpoint.
- Smoke coverage verifies `/v1/metrics` request and route tracking.

Production gaps:

- Add broader test isolation for future browser suites.
- Expand provider-adapter contract tests after live Rango/THORChain schemas are verified.
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
- Project plan widget: `http://127.0.0.1:3005/project-plan`

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
- i18n copy is operational and broad, but should get native-speaker review before customer launch.
- Core smoke tests now use an isolated database in CI; provider adapter contracts now run without network or database dependencies; future browser suites should follow the same pattern.
- Docker is now repeatable locally, but production deploy still needs managed persistence, secrets, image publishing, and rollback controls.
- Health/readiness, structured request logs, and local request metrics exist, but production observability still needs traces, log shipping, dashboards, and alerting.

## Near-Term Completion Target

The project can reach roughly 75% completion by finishing:

- production wallet signing/submission
- provider live-doc verification
- browser test isolation
- Docker deploy hardening
- first live compliance vendor integration

The remaining 25% after that is launch-grade production work: regulated operations, vendor contracts, security review, observability, incident runbooks, reconciliation, and real liquidity/settlement operations.

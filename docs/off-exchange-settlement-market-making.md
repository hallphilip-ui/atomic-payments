# Atomic Payments Off-Exchange Settlement and Market Making

## Product Position

Atomic Payments should settle client payments outside of centralized exchanges. Exchanges may be used as reference markets, hedging venues, or emergency liquidity sources, but they should not be the core settlement dependency.

The platform market makes between a controlled basket of highly liquid and stable currencies. The launch basket is intentionally operational rather than permanent: currencies can move in or out based on liquidity, volatility, regulatory access, rail coverage, banking/custody availability, and real corridor demand.

## Launch Architecture

The first working system is simulation-safe and has four core layers:

1. Currency basket policy: defines eligible currencies, settlement rails, liquidity score, stability score, priority, and max quote size.
2. Route registry: defines available off-exchange routes across bank, stablecoin, custodian, and OTC rails.
3. Quote engine: produces executable RFQ responses with reference rate, spread, route fee, TTL, settlement estimate, and risk checks.
4. Treasury controls: exposes inventory bands, rebalance triggers, and release gates before money movement becomes live.

## Quote Lifecycle

1. Client submits source currency, target currency, and notional.
2. Atomic checks currency eligibility and route availability.
3. Quote engine calculates reference rate, spread, route fee, all-in rate, target amount, and expiry.
4. Client accepts the quote before expiry.
5. Atomic reserves inventory pending compliance checks.
6. Settlement instruction is released after sanctions, client limit, route health, and instruction-match checks pass.
7. Treasury reconciles settlement and rebalances inventory if a band is breached.

## Spread Model

The first model is deterministic and transparent:

- Reference mid rate comes from a managed table in the simulation build.
- Spread increases when liquidity or stability scores are lower.
- Route fee is added from the selected settlement rail.
- Longer settlement windows add route risk.
- Stablecoin-to-stablecoin routes receive tighter pricing when eligible.

Live pricing should replace the static reference table with a provider-aggregated rate feed and signed quote snapshots.

## Risk Controls Required Before Live Funds

- Per-currency and per-corridor max quote sizes.
- Per-client daily and rolling limits.
- Quote TTL and replay prevention.
- Inventory min/mid/max bands by currency.
- Compliance hold before reserve release.
- Route health checks before settlement instruction release.
- Manual treasury override for quotes above currency limits.
- Reconciliation state machine for pending, reserved, released, settled, failed, and reversed states.

## Current Reconciliation Slice

Accepted RFQs now create settlement instructions and double-entry treasury ledger records in the database. The operator-protected reconciliation report checks recent settlement instructions for source reserve debits, target obligation credits, required release gates, and ledger amount matches. The reconciliation export endpoint wraps that report with a schema version, generated timestamp, and SHA-256 digest for audit evidence. This remains simulation-safe, but it establishes the control surface needed before live provider reconciliation.

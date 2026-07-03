# Atomic Payments AML and Compliance Build Plan

## Compliance Position

Atomic Payments has two product lanes:

1. Off-exchange settlement and market making between liquid/stable currencies.
2. DeFi any-to-any crypto swaps routed through provider infrastructure such as Rango and THORChain.

Both lanes need compliance controls before live funds move. The DeFi lane especially needs wallet screening, destination address validation, quote holds, and an auditable operator review trail.

## Current Build Slice

The first compliance slice is simulation-safe:

- Destination wallet format checks by chain family.
- Keyword watchlist screening for blocked/sanctioned address patterns.
- Risk scoring by chain, amount size, price impact, and address validity.
- Vendor-screening boundary with simulated KYT provider metadata, reference IDs, decisions, and latency.
- Auto-clear for low-risk quotes.
- Manual review for medium/high risk quotes.
- Block for critical-risk quotes.
- Persisted compliance reviews tied to swap quotes.
- Admin review list and approve/reject decision endpoint.
- Simulated outgoing transfer release gate blocks connector withdrawals that fail destination or sanctions-keyword screening.

## Required Before Production

- Integrate a real sanctions/wallet-screening provider behind the compliance provider boundary.
- Store provider request IDs and raw decision metadata with sensitive-field filtering.
- Add client identity/KYB/KYC objects.
- Add travel rule threshold policy by jurisdiction.
- Add jurisdiction and IP/device checks.
- Add suspicious activity report workflow.
- Add immutable audit export.
- Replace simulated off-exchange transfer release gates with a live KYT/sanctions provider.
- Carry provider mode, provider quote ID, latency, and fallback diagnostics into compliance reviews for live swap investigations.

## Target Operator Workflow

1. Quote request arrives.
2. Compliance engine screens destination wallet, amount, route, and counterparty context.
3. Low-risk quotes auto-clear.
4. Medium/high-risk quotes require manual review before authorization.
5. Critical-risk quotes are blocked.
6. Every decision writes an event to the quote history.
7. Settlement or swap execution cannot proceed unless compliance status allows it.

# Atomic Payments Provider Adapter Plan

## Purpose

The DeFi swap lane needs a stable boundary between Atomic's product workflow and external routing providers. The UI, quote persistence, compliance review, and event tracker should not care whether a quote came from simulation, Rango, or THORChain.

## Current Slice

The first adapter layer supports:

- Simulation mode by default.
- Optional live mode with `ATOMIC_SWAP_PROVIDER_MODE=live`.
- Optional live-with-fallback mode with `ATOMIC_SWAP_PROVIDER_MODE=live_with_fallback`.
- Rango-style payload generation with Atomic's 0.5% referrer fee.
- THORChain-style payload generation with Atomic's 50 bps affiliate fee.
- Provider quote ID, mode, latency, and diagnostics persisted on every swap quote.
- Conservative fallback if a live provider is unreachable or returns an unexpected shape.

## Production Requirements

- Verify exact Rango and THORChain response schemas against provider docs before enabling live mode.
- Add provider API keys and rate-limit controls where required.
- Add quote response signature/hash capture.
- Add provider request/response audit storage with sensitive-field filtering.
- Add retry budgets and circuit breakers.
- Add per-provider health endpoints for ops.
- Add reconciliation between provider final execution events and Atomic's persisted event timeline.

## Operator Modes

- `simulation`: no external provider calls; deterministic local quote.
- `live_with_fallback`: attempts live quote, falls back to simulation on provider/network failure.
- `live`: provider failure fails the quote request.

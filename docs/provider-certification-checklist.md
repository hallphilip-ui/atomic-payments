# Live Swap Provider Certification Checklist

Goal: turn the swap router from `simulation` into a live, affiliate-earning
router (THORChain + Rango) with **no pooled liquidity and no inventory** — the
platform only earns a spread when a real trade routes through. This is the
capital-light "settle only when there's a trade" model.

## Status

- [x] Adapter mechanics corrected against verified official specs
      (`src/cryptoCore/providerAdapters.ts`).
  - Rango endpoint fixed to `https://api.rango.exchange/basic/quote`.
  - Rango `apiKey` now injected at request time only (never stored/returned).
  - Rango referrer monetization uses `referrerFee` (+ optional `referrerCode`);
    the non-existent `referrerAddress` param was removed.
  - Rango `resultType` (`OK|HIGH_IMPACT|INPUT_LIMIT_ISSUE|NO_ROUTE`) handled.
  - THORChain endpoint + `x-client-id` header are env-configurable.
- [x] Endpoints/credentials are environment-driven (`swapConfig.ts`,
      `.env.example`) — nothing hardcoded, no secrets in the repo.
- [x] Provider contract test green in all four modes (`npm run test:providers`).

## Remaining — needs external accounts + live verification (NOT codeable blind)

### 1. Register affiliate accounts (this is the revenue, zero capital)
- [ ] **THORChain**: register a THORName to receive affiliate fees, set
      `THOR_AFFILIATE_NAME` (currently `ATOMIC_MOBILE_PROD` placeholder) to it,
      and set `ATOMIC_THOR_CLIENT_ID`.
- [ ] **Rango**: create an account, get an `ATOMIC_RANGO_API_KEY`, and set
      `ATOMIC_RANGO_REFERRER_CODE`. Confirm the `referrerFee` percent is honored.

### 2. Certify the per-asset identifier map (the real blocker)
The token registry (`src/cryptoCore/tokens.ts`) uses **internal** asset IDs
(e.g. `BITCOIN.BTC`, `ETH.USDC`) that are **not** valid live-provider IDs:
- THORChain expects `BTC.BTC`, `ETH.ETH`, `ETH.USDC-0X<CONTRACT>` (single dash,
  uppercase).
- Rango expects `BLOCKCHAIN.SYMBOL--<CONTRACT>` (double dash) with real
  contract addresses.

Action: add a `thorAsset` / `rangoAsset` mapping per registry entry, populated
from each provider's official asset list, then translate in `buildProviderPayload`.
Until an asset is mapped, live mode must fail closed for that asset (no
malformed live request). Do this against live provider responses, not memory —
these are financial routing identifiers.

### 3. Live quote verification
- [ ] With `ATOMIC_SWAP_PROVIDER_MODE=live_with_fallback`, confirm a real quote
      for at least one THORChain pair (e.g. BTC→ETH) and one Rango pair
      (e.g. ETH.USDC→BASE.USDC) parses correctly end to end.
- [ ] Confirm the affiliate fee actually appears in the provider's route.
- [ ] Extend `provider-adapter-contract.js` with the real (recorded) response
      payloads once verified.

### 4. Execution (beyond quoting)
Quoting ≠ executing. Real settlement still needs the wallet-broadcast path
(`walletBroadcastAdapters.ts`) wired to live EVM/Solana RPC + chain receipts,
plus gas/slippage/refund handling. That is a separate slice from quote
certification and is tracked in the launch-readiness blockers.

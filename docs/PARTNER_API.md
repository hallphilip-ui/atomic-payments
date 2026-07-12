# Atomic Partner Swap API

Embed Atomic's cross-chain swaps in your product. **Non-custodial**: we return a
quote plus a signable transaction; *your* user signs and broadcasts it. Atomic's
integrator fee is embedded in the route (you can also be assigned a partner fee).

Base URL: `https://atomicpay.cloud`

## Authentication

Send your API key as a Bearer token on every request:

```
Authorization: Bearer ak_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

(or the header `x-atomic-api-key: ak_live_...`)

Keys are issued by Atomic. The plaintext key is shown **once** at creation and
cannot be retrieved again — store it securely. We keep only its hash.

Rate limit: **120 requests/minute** per key.

## Endpoints

### `GET /v1/partner/assets`
Assets certified for live routing (what you can quote/swap).

```json
{ "assets": [{ "assetId": "BASE.USDC", "symbol": "USDC", "name": "USD Coin on Base",
  "chain": "BASE", "chainFamily": "evm", "decimals": 6 }], "count": 15 }
```

### `POST /v1/partner/quote`
Create a swap quote.

```json
{
  "fromAsset": "BASE.USDC",   // asset id from /assets
  "toAsset":   "ETH.USDC",
  "amount":    "5000000",     // ATOMIC integer string (5 USDC @ 6 decimals = 5000000)
  "userAddress": "0x…",       // destination — where the swapped funds land
  "fromAddress": "0x…"        // source — the wallet that will sign (optional for same-chain)
}
```

Response `201` (status `QUOTED`):

```json
{
  "quote": {
    "id": "47af7d0d-…",
    "status": "QUOTED",
    "fromAsset": { "assetId": "BASE.USDC", "symbol": "USDC", "decimals": 6, … },
    "toAsset":   { "assetId": "ETH.USDC", … },
    "amount": "5000000",
    "estimatedOutputAmount": "4862500",
    "platformFeeBps": 250,
    "expiresAt": "2026-07-10T…Z",
    "quoteTtlSeconds": 90,
    "execution": {
      "transactionRequest": { "to": "0x1231DEB6…", "data": "0x…", "value": "0x0",
                              "chainId": 8453, "gasLimit": "0x12762c" },
      "approvalAddress": "0x1231DEB6…",   // ERC20 sources: approve this spender first
      "fromTokenAddress": "0x833589fC…"
    }
  },
  "partner": { "name": "Acme Wallet", "feeBps": 30 },
  "nextStep": "Have your user sign & broadcast quote.execution.transactionRequest before expiresAt."
}
```

Status codes: `201` QUOTED · `403` compliance BLOCKED (sanctioned address/jurisdiction) · `409` price-impact HALTED · `400` bad request.

### `GET /v1/partner/quote/:id`
Current status of one of your quotes (scoped to your key).

## Integration flow

1. `GET /v1/partner/assets` → choose `fromAsset` / `toAsset`.
2. `POST /v1/partner/quote` → receive `quote.execution.transactionRequest`.
3. **ERC20 source only:** if allowance to `execution.approvalAddress` is insufficient,
   have the user send an `approve(spender, amount)` first, and wait for it to confirm.
4. Have the user **sign & broadcast** `execution.transactionRequest`.
5. Poll `GET /v1/partner/quote/:id` for status (or use webhooks — coming soon).

## Notes

- **Non-custodial** — Atomic never holds funds; the user's wallet signs and broadcasts.
- **Compliance** — destination/source addresses are screened against OFAC + the
  on-chain sanctions oracle; sanctioned parties get a `403`.
- **Amounts** are always atomic integer strings (respect each asset's `decimals`).
- **Quotes expire** at `expiresAt` (default 90s) — re-quote if it lapses.

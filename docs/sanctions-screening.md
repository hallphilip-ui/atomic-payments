# Sanctions Screening

Baseline sanctions controls for the swap flow. Every `/v1/swaps/quote` is screened
before a quote can be signed; a hit returns **HTTP 403** with the quote `status: BLOCKED`,
and the decision is recorded as a `complianceReview` (visible in operator exports).

## What runs today

| Layer | Source | Always on? |
|---|---|---|
| **Wallet-address screening** | Local OFAC SDN list (`src/compliance/ofacSanctionedAddresses.ts`) — offline, deterministic | ✅ Yes |
| **Wallet-address screening (live)** | Chainalysis sanctions oracle | Only if `ATOMIC_CHAINALYSIS_API_KEY` set |
| **Jurisdiction block** | Cloudflare `CF-IPCountry` header vs blocked-country set | ✅ Yes (needs Cloudflare in front) |

Both the **destination** (`userAddress`) and **source** (`fromAddress`) addresses are screened.
The local OFAC list always runs, so known-sanctioned addresses are blocked even if
Chainalysis is unreachable (the oracle is best-effort / fail-open on network error).

## Configuration

- **`ATOMIC_CHAINALYSIS_API_KEY`** — enables the live Chainalysis oracle. Get a free
  key at Chainalysis (sanctions screening is free). Put it in the VPS `.env`, then
  restart. Without it, only the offline OFAC list runs.
- **`ATOMIC_BLOCKED_COUNTRIES`** — comma-separated ISO country codes to override the
  default embargo set (`CU,IR,KP,SY`). Example: `ATOMIC_BLOCKED_COUNTRIES=CU,IR,KP,SY,RU`.

## Cloudflare jurisdiction block

`CF-IPCountry` is added automatically by Cloudflare — no config needed for country-level
screening at the app. For a hard edge block (recommended), also add a Cloudflare WAF rule
to deny the embargoed countries before requests reach the origin.

> **Note:** country codes can't distinguish sub-national sanctioned regions (Crimea,
> Donetsk, Luhansk). Those need a WAF rule or a KYT vendor with region resolution.

## Refreshing the OFAC list

```
node scripts/update-ofac-addresses.js   # fetches official OFAC SDN, regenerates the list
npm run build                            # then redeploy + restart
```

## Tested by

`npm run test:sanctions` (in CI) — verifies address hits, jurisdiction blocks, the
override, and end-to-end `screenSwapCompliance` blocking.

## Not covered (needs a paid KYT vendor)

Risk scoring, exposure to mixers/darknet/high-risk counterparties, and transaction-graph
analysis. The free Chainalysis oracle only covers **OFAC-sanctioned** addresses. Upgrade
to Chainalysis/TRM/Elliptic KYT when volume justifies it. **Scope of required screening is
a legal/compliance decision — confirm with counsel.**

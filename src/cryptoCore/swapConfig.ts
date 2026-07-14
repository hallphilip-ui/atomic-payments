export const PLATFORM_SPREAD_PERCENT = '2.5';
export const PLATFORM_SPREAD_BPS = 250;
// Partner Swap API economics (model B + capped markup):
//   * The partner earns a fixed 50 bps SHARE out of our 250 bps base (revenue
//     share — does NOT increase customer cost; we net 200 bps).
//   * The partner may ALSO stack up to 50 bps of markup, which IS added on top
//     (customer pays 250 + markup). That markup accrues entirely to the partner.
//   * So partner earns (50 + markup) bps; we always net 200 bps; customer pays
//     (250 + markup) bps, capped at 300.
export const PARTNER_REVENUE_SHARE_BPS = 50;
export const PARTNER_MAX_MARKUP_BPS = 50;
// Hard ceiling on a single automated payout run (USD). A larger balance owed is
// held for manual operator review rather than swept in one transfer — a circuit
// breaker against a mis-attribution or verification bug ever draining the treasury.
export const PARTNER_MAX_PAYOUT_USD = Number(process.env.ATOMIC_PARTNER_MAX_PAYOUT_USD) || 25000;
// Platform maximum swap size in USD. A swap whose USD notional exceeds this is
// refused with a clear, user-facing reason (never silently) — a guardrail against
// oversized / fat-finger swaps and large-exposure risk. Applies when the swap's
// USD value is known (the live provider path); fails open when it can't be
// determined. Set ATOMIC_SWAP_MAX_USD=0 to disable. Default $1,000,000.
export const SWAP_MAX_USD = (() => {
  const raw = process.env.ATOMIC_SWAP_MAX_USD;
  if (raw == null || raw === '') return 1000000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1000000;   // 0 disables the cap
})();
// Informational only — surfaced as metadata on a swap quote, never a fund
// destination (swap fees are collected by LI.FI to wallets configured in the LI.FI
// portal). Env-driven; when unset we publish nothing rather than a placeholder.
export const PLATFORM_TREASURY_ADDRESS = (process.env.ATOMIC_PLATFORM_TREASURY_ADDRESS || '').trim();
export const THOR_AFFILIATE_NAME = 'ATOMIC_MOBILE_PROD';
// Quote lifetime. 30s was too tight for a hand-driven test (re-quote churn, B9);
// default 90s and allow tuning via env without a redeploy. LI.FI's own tx carries
// its slippage/deadline, so a slightly longer UI window doesn't loosen execution.
export const QUOTE_TTL_SECONDS = (() => {
  const n = Number(process.env.ATOMIC_QUOTE_TTL_SECONDS);
  return Number.isFinite(n) && n >= 15 && n <= 600 ? Math.floor(n) : 90;
})();
export const PRICE_IMPACT_LIMIT_PCT = 1.5;

// Live provider endpoints and credentials are environment-configurable so the
// affiliate accounts and hosted node URLs are supplied at deploy time, never
// hardcoded. Defaults preserve the documented public endpoints for simulation
// and contract tests.
export const RANGO_QUOTE_ENDPOINT =
  process.env.ATOMIC_RANGO_QUOTE_ENDPOINT ?? 'https://api.rango.exchange/basic/quote';
// Rango Basic API requires an apiKey query parameter. Kept out of the stored/
// returned request payload so it never leaks through the quote API.
export const RANGO_API_KEY = process.env.ATOMIC_RANGO_API_KEY ?? '';
// Optional Rango affiliate/referrer code that pairs with referrerFee.
export const RANGO_REFERRER_CODE = process.env.ATOMIC_RANGO_REFERRER_CODE ?? '';
export const THOR_QUOTE_ENDPOINT =
  process.env.ATOMIC_THOR_QUOTE_ENDPOINT ?? 'https://thornode.ninerealms.com/thorchain/quote/swap';
// Nine Realms and most hosted THORNodes expect an x-client-id header for
// identification/rate-limiting. Sent as a header, not a query param.
export const THOR_CLIENT_ID = process.env.ATOMIC_THOR_CLIENT_ID ?? '';

// LI.FI aggregator (cross-chain incl. native BTC, Solana, EVM). Gatekeeper-free:
// no token/on-chain name required — revenue comes from an integrator fee that
// LI.FI collects to a fee wallet configured in the LI.FI portal. The API key is
// sent as an x-lifi-api-key header, injected at request time so it never enters
// the stored/returned payload.
export const LIFI_QUOTE_ENDPOINT =
  process.env.ATOMIC_LIFI_QUOTE_ENDPOINT ?? 'https://li.quest/v1/quote';
export const LIFI_API_KEY = process.env.ATOMIC_LIFI_API_KEY ?? '';
// Must match the integrator registered in portal.li.fi (the one with a fee
// wallet configured), otherwise LI.FI rejects fee collection.
export const LIFI_INTEGRATOR = process.env.ATOMIC_LIFI_INTEGRATOR ?? 'atomic';
// Verified against live LI.FI quotes (2026-07-06): LI.FI's ~25 bps fixed fee is
// ADDED ON TOP of our integrator fee, not deducted from it. So we pass exactly
// our PLATFORM_SPREAD_BPS margin and receive it in full (customer's all-in cost
// is our fee + LI.FI's 25 bps + gas). Recorded platform revenue == what we net.
export const LIFI_PROTOCOL_FEE_BPS = 25; // LI.FI's additive fixed fee (informational)
export const LIFI_FEE_DECIMAL = (PLATFORM_SPREAD_BPS / 10000).toString();

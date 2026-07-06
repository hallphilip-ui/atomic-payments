export const PLATFORM_SPREAD_PERCENT = '2.5';
export const PLATFORM_SPREAD_BPS = 250;
export const PLATFORM_TREASURY_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
export const THOR_AFFILIATE_NAME = 'ATOMIC_MOBILE_PROD';
export const QUOTE_TTL_SECONDS = 30;
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
// LI.FI takes a ~25 bps share of the integrator fee we collect (not an additive
// charge). To net our PLATFORM_SPREAD_BPS margin after their cut, we pass an
// integrator fee of (our margin + LI.FI's 25 bps). We still record our own
// revenue as PLATFORM_SPREAD_BPS (see the LIFI branch in providerAdapters).
export const LIFI_PROTOCOL_FEE_BPS = 25;
export const LIFI_FEE_DECIMAL = ((PLATFORM_SPREAD_BPS + LIFI_PROTOCOL_FEE_BPS) / 10000).toString();

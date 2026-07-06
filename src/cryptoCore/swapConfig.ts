export const PLATFORM_SPREAD_PERCENT = '0.5';
export const PLATFORM_SPREAD_BPS = 50;
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

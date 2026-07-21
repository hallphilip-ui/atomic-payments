// Sell-quote engine — "if you sell X crypto right now, how much fiat do you get, and
// where is best?" READ-ONLY. It quotes; it never sells. No order is placed, no key is
// used, no fund moves. Execution (placing the sale, paying out fiat) is deliberately not
// here — that is the money-movement / custodial line, and it is the operator's to cross
// with their own credentials and licensing.
//
// Two venue classes, quoted side by side:
//   * CEX  — public Kraken + Coinbase tickers (keyless). Net = spot × amount × (1 − taker
//            fee). These are what a sale WOULD net on-exchange; actually executing needs a
//            funded, authenticated account we do not wire here.
//   * DeFi — the existing swap engine (LI.FI/Rango/THORChain) quoting the asset → USDC.
//            This is a swap to a STABLECOIN, not fiat: on DeFi there is no fiat. The fiat
//            leg still needs a licensed off-ramp partner (see offramp.ts). Only attempted
//            when a wallet address is supplied and the asset is swap-enabled.
//
// Every number is INDICATIVE and time-boxed. Spot moves; fees vary by tier. The response
// says so, per venue.
import { getEnforcedPlatformQuote } from './routing';
import { krakenTakerBps } from './krakenFees';

// Taker fees are tier-dependent and change; these are conservative low-tier defaults,
// env-overridable, and surfaced in every quote so the assumption is never hidden.
const KRAKEN_TAKER_BPS = Number(process.env.SELLQUOTE_KRAKEN_TAKER_BPS || '40');   // ~0.40%
const COINBASE_TAKER_BPS = Number(process.env.SELLQUOTE_COINBASE_TAKER_BPS || '60'); // ~0.60%

// Majors we can quote. kraken/coinbase are the public-ticker identifiers; defiFrom is the
// swap-registry asset id used to route asset → USDC on DeFi (EVM majors only for now).
type AssetMap = { kraken?: string; coinbase?: string; defiFrom?: string; decimals: number };
const ASSETS: Record<string, AssetMap> = {
  BTC:  { kraken: 'XXBTZUSD', coinbase: 'BTC-USD', decimals: 8 },
  ETH:  { kraken: 'XETHZUSD', coinbase: 'ETH-USD', defiFrom: 'ETH.ETH', decimals: 18 },
  SOL:  { kraken: 'SOLUSD',   coinbase: 'SOL-USD', decimals: 9 },
  USDT: { kraken: 'USDTZUSD', coinbase: 'USDT-USD', defiFrom: 'ETH.USDT', decimals: 6 },
  USDC: { kraken: 'USDCUSD',  coinbase: 'USDC-USD', defiFrom: 'ETH.USDC', decimals: 6 },
  LINK: { kraken: 'LINKUSD',  coinbase: 'LINK-USD', decimals: 18 },
  AAVE: { kraken: 'AAVEUSD',  coinbase: 'AAVE-USD', decimals: 18 },
  MATIC:{ kraken: 'MATICUSD', coinbase: 'MATIC-USD', decimals: 18 },
  AVAX: { kraken: 'AVAXUSD',  coinbase: 'AVAX-USD', decimals: 18 },
  DOT:  { kraken: 'DOTUSD',   coinbase: 'DOT-USD', decimals: 10 },
  ADA:  { kraken: 'ADAUSD',   coinbase: 'ADA-USD', decimals: 6 },
  XRP:  { kraken: 'XXRPZUSD', coinbase: 'XRP-USD', decimals: 6 },
};

export type VenueQuote = {
  venue: string;               // 'Kraken' | 'Coinbase' | 'DeFi (→USDC)'
  kind: 'cex' | 'defi';
  available: boolean;
  spot_usd: number | null;     // reference unit price used
  gross_usd: number | null;    // spot × amount, before fees
  fee_bps: number | null;      // the fee applied
  fee_source?: 'kraken-live' | 'assumed';  // was fee_bps the account's real tier, or a default?
  net_usd: number | null;      // what the seller nets
  to_fiat: boolean;            // true = fiat out; false = stablecoin, needs an off-ramp
  note?: string;
};

export type SellQuote = {
  asset: string;
  amount: number;
  fiat: string;
  reference_spot_usd: number | null;   // median of available CEX spots
  venues: VenueQuote[];
  best: { venue: string; net_usd: number } | null;
  as_of: string;
  read_only: true;
  disclaimer: string;
};

async function j(url: string, opts?: RequestInit): Promise<any | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000), ...(opts || {}) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function krakenSpot(pair: string): Promise<number | null> {
  const d = await j(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
  const res = d?.result;
  if (!res) return null;
  // Kraken keys the result by its own canonical pair name, not always what we asked.
  const first: any = Object.values(res)[0];
  const px = Number(first?.c?.[0]); // c = last trade [price, lotVolume]
  return Number.isFinite(px) ? px : null;
}

async function coinbaseSpot(product: string): Promise<number | null> {
  const d = await j(`https://api.exchange.coinbase.com/products/${product}/ticker`,
    { headers: { 'User-Agent': 'atomic-sellquote' } });
  const px = Number(d?.price);
  return Number.isFinite(px) ? px : null;
}

function cexVenue(name: string, spot: number | null, amount: number, feeBps: number, feeSource: 'kraken-live' | 'assumed'): VenueQuote {
  const gross = spot != null ? spot * amount : null;
  const net = gross != null ? gross * (1 - feeBps / 1e4) : null;
  const feeNote = feeSource === 'kraken-live'
    ? "net of this account's real Kraken taker tier"
    : 'net of an ASSUMED taker fee (no live tier available)';
  return {
    venue: name, kind: 'cex', available: spot != null,
    spot_usd: spot, gross_usd: gross, fee_bps: feeBps, fee_source: feeSource, net_usd: net, to_fiat: true,
    note: spot == null ? 'ticker unavailable' : `${feeNote}; a real sale needs a funded, authenticated account (not wired)`,
  };
}

/**
 * Quote selling `amount` of `asset`. READ-ONLY. `userAddress` (optional) enables a live
 * DeFi route quote to USDC; without it the DeFi venue is omitted rather than guessed.
 */
export async function getSellQuote(asset: string, amount: number, fiat = 'USD', userAddress?: string): Promise<SellQuote> {
  const sym = asset.toUpperCase();
  const map = ASSETS[sym];
  const disclaimer =
    'Indicative, read-only quote. No order is placed and no funds move. CEX figures are ' +
    'public spot net of an assumed taker fee; DeFi is a swap to USDC (a stablecoin, not ' +
    'fiat — the fiat leg needs a licensed off-ramp). Actually selling requires a funded, ' +
    'authenticated venue account, which is operated by you, not by this endpoint.';

  if (!map) {
    return { asset: sym, amount, fiat, reference_spot_usd: null, venues: [], best: null,
      as_of: new Date().toISOString(), read_only: true,
      disclaimer: `${sym} is not in the sell-quote asset list.` };
  }
  if (fiat.toUpperCase() !== 'USD') {
    // CEX pairs here are USD-quoted; a non-USD fiat needs an FX leg we don't model yet.
    return { asset: sym, amount, fiat, reference_spot_usd: null, venues: [], best: null,
      as_of: new Date().toISOString(), read_only: true,
      disclaimer: `Only USD quotes are supported for now; ${fiat} needs an FX conversion step (not yet modelled).` };
  }

  // Kraken's REAL taker tier for this account (read-only key) when available; the assumed
  // default is the fallback. Fetched in parallel with the spots. Coinbase has no public
  // per-account fee read here, so it stays on the documented assumption.
  const [kSpot, cSpot, kRealBps] = await Promise.all([
    map.kraken ? krakenSpot(map.kraken) : Promise.resolve(null),
    map.coinbase ? coinbaseSpot(map.coinbase) : Promise.resolve(null),
    map.kraken ? krakenTakerBps(map.kraken).catch(() => null) : Promise.resolve(null),
  ]);

  const venues: VenueQuote[] = [];
  if (map.kraken) {
    const bps = kRealBps ?? KRAKEN_TAKER_BPS;
    venues.push(cexVenue('Kraken', kSpot, amount, bps, kRealBps != null ? 'kraken-live' : 'assumed'));
  }
  if (map.coinbase) venues.push(cexVenue('Coinbase', cSpot, amount, COINBASE_TAKER_BPS, 'assumed'));

  // Reference spot = median of the CEX spots we actually got (robust to one bad feed).
  const spots = [kSpot, cSpot].filter((x): x is number => x != null).sort((a, b) => a - b);
  const refSpot = spots.length ? (spots.length % 2 ? spots[spots.length >> 1] : (spots[spots.length / 2 - 1] + spots[spots.length / 2]) / 2) : null;

  // DeFi venue: a real route quote to USDC, only when we have a wallet address AND the
  // asset is swap-enabled. Fails soft — a DeFi outage must not sink the whole quote.
  if (map.defiFrom && userAddress) {
    try {
      const atomicAmount = BigInt(Math.round(amount * 10 ** map.decimals)).toString();
      const q = await getEnforcedPlatformQuote({
        fromAsset: map.defiFrom, toAsset: 'ETH.USDC', amount: atomicAmount, userAddress,
      });
      const outUsdc = Number(q.estimatedOutputAmount) / 1e6; // USDC 6dp
      venues.push({
        venue: 'DeFi (→USDC)', kind: 'defi', available: Number.isFinite(outUsdc),
        spot_usd: refSpot, gross_usd: refSpot != null ? refSpot * amount : null,
        fee_bps: q.platformFeeBps, net_usd: Number.isFinite(outUsdc) ? outUsdc : null,
        to_fiat: false,
        note: 'output is USDC, not fiat — route it through a licensed off-ramp for cash. Includes price impact + platform fee.',
      });
    } catch (e) {
      venues.push({ venue: 'DeFi (→USDC)', kind: 'defi', available: false,
        spot_usd: refSpot, gross_usd: null, fee_bps: null, net_usd: null, to_fiat: false,
        note: `route unavailable: ${e instanceof Error ? e.message : String(e)}` });
    }
  } else if (map.defiFrom) {
    venues.push({ venue: 'DeFi (→USDC)', kind: 'defi', available: false,
      spot_usd: refSpot, gross_usd: null, fee_bps: null, net_usd: null, to_fiat: false,
      note: 'supply a wallet address to get a live DeFi route quote' });
  }

  // Best = highest net among venues that produced a number. Note this compares fiat-out
  // (CEX) against stablecoin-out (DeFi) at face value; the caller must remember DeFi still
  // owes a fiat leg. Surfaced via to_fiat so the UI can caveat it.
  const priced = venues.filter((v) => v.net_usd != null) as Array<VenueQuote & { net_usd: number }>;
  priced.sort((a, b) => b.net_usd - a.net_usd);
  const best = priced.length ? { venue: priced[0].venue, net_usd: priced[0].net_usd } : null;

  return {
    asset: sym, amount, fiat: 'USD', reference_spot_usd: refSpot, venues, best,
    as_of: new Date().toISOString(), read_only: true, disclaimer,
  };
}

export function sellQuoteAssets(): string[] { return Object.keys(ASSETS); }

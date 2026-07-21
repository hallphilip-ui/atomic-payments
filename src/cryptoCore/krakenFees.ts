// Kraken real fee tier — replaces the sell-quote's ASSUMED taker fee with this account's
// actual, volume-based tier. Read-only: it calls only the private TradeVolume endpoint,
// which returns fee schedule + 30-day volume and cannot place a trade or move funds.
//
// WHY IT MATTERS: the assumption (40bps) was HALF this account's real fee. A zero-volume
// account sits on Kraken's top tier — 0.80% taker — so quoting at 40bps overstated
// proceeds by ~$530 on a 1.5 BTC sale. An assumed fee is a quiet lie the moment the
// account's real tier differs; this makes the number true for THIS account.
//
// FAILS OPEN: no key, a bad signature, or an API error → returns null, and the caller
// falls back to the assumed bps. A read-only enrichment must never break the quote.
// KEY STAYS SERVER-SIDE: read from env, used only to sign, never logged or returned.
import crypto from 'crypto';

const KEY = (process.env.KRAKEN_QUERY_KEY || '').trim();
const SECRET = (process.env.KRAKEN_QUERY_SECRET || '').trim();
const API = 'https://api.kraken.com';

// Fee tier moves only as 30-day volume crosses thresholds — hours of staleness is fine.
const TTL_MS = 60 * 60 * 1000;
type Entry = { at: number; bps: number };
const cache = new Map<string, Entry>();

export function krakenFeeConfigured(): boolean { return !!(KEY && SECRET); }

/**
 * This account's live TAKER fee in bps for a Kraken pair (e.g. "XXBTZUSD"), or null if
 * unconfigured/unavailable. Cached per pair. Read-only.
 */
export async function krakenTakerBps(pair: string): Promise<number | null> {
  if (!KEY || !SECRET || !pair) return null;
  const hit = cache.get(pair);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.bps;

  const path = '/0/private/TradeVolume';
  const nonce = Date.now().toString();
  const post = new URLSearchParams({ nonce, pair, 'fee-info': 'true' }).toString();
  let sign: string;
  try {
    const sha256 = crypto.createHash('sha256').update(nonce + post).digest();
    const msg = Buffer.concat([Buffer.from(path, 'utf8'), sha256]);
    sign = crypto.createHmac('sha512', Buffer.from(SECRET, 'base64')).update(msg).digest('base64');
  } catch { return null; } // secret not valid base64 → fail open
  try {
    const r = await fetch(API + path, {
      method: 'POST',
      headers: { 'API-Key': KEY, 'API-Sign': sign, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'atomic-sellquote' },
      body: post,
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    if (j?.error?.length) return null;
    const fees = j?.result?.fees || {};
    // Kraken may key the result by its canonical pair name; take the requested pair if
    // present, else the only entry returned.
    const entry: any = fees[pair] || Object.values(fees)[0];
    const pct = Number(entry?.fee);
    if (!Number.isFinite(pct)) return null;
    const bps = Math.round(pct * 100); // 0.80% -> 80 bps
    cache.set(pair, { at: Date.now(), bps });
    return bps;
  } catch { return null; } // network/timeout → fail open
}

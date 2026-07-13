import { Router, Request, Response } from 'express';

// Public, cached market-data endpoint for the Atomic Exchange dashboard.
// CoinGecko rate-limits Cloudflare Worker egress IPs (429), so the exchange's edge
// proxy can't fetch it directly — but this box's dedicated IP can. We fetch at most
// once per FRESH_MS and keep a last-known-good copy, so the dashboard never blanks.
// Same passthrough shape as CoinGecko /coins/markets. Not operator-gated (public,
// read-only); the global CORS middleware already allows cross-origin GET.
const router = Router();

const UPSTREAM = 'https://api.coingecko.com/api/v3/coins/markets'
  + '?vs_currency=usd'
  + '&ids=bitcoin,ethereum,solana,ripple,litecoin,dogecoin,cardano,chainlink'
  + '&order=market_cap_desc&sparkline=true&price_change_percentage=24h,7d';

const FRESH_MS = 60_000;
let fresh: { at: number; body: string } | null = null;
let stale: string | null = null; // last known good, for outage protection

router.get('/v1/markets', async (_req: Request, res: Response) => {
  res.header('Cache-Control', 'public, max-age=60');
  res.header('Content-Type', 'application/json; charset=utf-8');
  if (fresh && Date.now() - fresh.at < FRESH_MS) {
    return res.send(fresh.body);
  }
  try {
    const r = await fetch(UPSTREAM, {
      headers: { accept: 'application/json', 'user-agent': 'atomic-pay/1.0 (+https://atomicpay.cloud)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('upstream HTTP ' + r.status);
    const body = await r.text();
    if (!Array.isArray(JSON.parse(body))) throw new Error('unexpected upstream shape');
    fresh = { at: Date.now(), body };
    stale = body;
    return res.send(body);
  } catch (err) {
    if (stale) {
      res.header('x-stale', '1');
      return res.send(stale);
    }
    return res.status(503).json({
      error: 'market data temporarily unavailable',
      detail: err instanceof Error ? err.message : String(err)
    });
  }
});

export default router;

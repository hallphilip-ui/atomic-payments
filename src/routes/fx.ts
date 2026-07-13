import { Router, Request, Response } from 'express';

// Public, cached USD→fiat exchange rates for showing local-currency equivalents of
// amounts (the swap cap, prices, invoice totals). Fetched at most once per FRESH_MS
// from a free, no-key source, with a last-known-good copy so a source outage never
// blanks the UI. Rates are indicative (display only) — never used for settlement.
// Not operator-gated (public, read-only); global CORS already allows cross-origin GET.
const router = Router();

const UPSTREAM = 'https://open.er-api.com/v6/latest/USD';
const FRESH_MS = 60 * 60 * 1000;               // rates move slowly; refresh hourly
let fresh: { at: number; body: string } | null = null;
let stale: string | null = null;               // last known good, for outage protection

router.get('/v1/fx/rates', async (_req: Request, res: Response) => {
  res.header('Cache-Control', 'public, max-age=3600');
  res.header('Content-Type', 'application/json; charset=utf-8');
  if (fresh && Date.now() - fresh.at < FRESH_MS) return res.send(fresh.body);
  try {
    const r = await fetch(UPSTREAM, {
      headers: { accept: 'application/json', 'user-agent': 'atomic-pay/1.0 (+https://atomicpay.cloud)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('upstream HTTP ' + r.status);
    const j = await r.json() as { result?: string; rates?: Record<string, number> };
    if (j.result !== 'success' || !j.rates || typeof j.rates.EUR !== 'number') throw new Error('unexpected fx shape');
    const body = JSON.stringify({ base: 'USD', rates: j.rates, updatedAt: new Date().toISOString() });
    fresh = { at: Date.now(), body };
    stale = body;
    return res.send(body);
  } catch (err) {
    if (stale) { res.header('x-stale', '1'); return res.send(stale); }
    return res.status(503).json({ error: 'fx rates temporarily unavailable', detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;

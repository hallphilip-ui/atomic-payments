// Sell-quote route — READ-ONLY price discovery for "sell crypto → fiat".
//
// It returns indicative net proceeds across CEX (public tickers) and DeFi (→USDC) so the
// platform can show "you'll receive ~$X and where's best". It places NO order and moves
// NO funds — execution is out of scope by design (the money-movement / custodial line).
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getSellQuote, sellQuoteAssets } from '../cryptoCore/sellQuote';

const router = Router();

// Public quote endpoint — keyed per client IP (forwarded from the edge, same pattern as
// wallet-intel) so one caller can't exhaust the upstream tickers for everyone.
const limiter = rateLimit({
  windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => {
    const fwd = req.headers['x-client-ip'];
    const ip = Array.isArray(fwd) ? fwd[0] : fwd;
    return (ip && String(ip).trim()) || req.ip || 'unknown';
  },
});

router.get('/v1/sell-quote/assets', (_req: Request, res: Response) => {
  res.json({ assets: sellQuoteAssets() });
});

router.get('/v1/sell-quote', limiter, async (req: Request, res: Response) => {
  const asset = String(req.query.asset || '').trim();
  const amount = Number(req.query.amount);
  const fiat = String(req.query.fiat || 'USD').trim();
  const userAddress = req.query.address ? String(req.query.address).trim() : undefined;

  if (!asset) return res.status(400).json({ error: 'asset is required (e.g. BTC, ETH, USDT)' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });

  try {
    const quote = await getSellQuote(asset, amount, fiat, userAddress);
    res.header('Cache-Control', 'no-store'); // prices are live; never cache a quote
    return res.json(quote);
  } catch (err) {
    return res.status(502).json({ error: 'quote failed', detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;

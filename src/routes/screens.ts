// Crypto signal screens — READ-ONLY. Serves the cross-sectional relative-strength screen.
// No order, no wallet, no execution — a research/signal surface only.
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getCryptoMomentumScreen } from '../screens/cryptoMomentum';

const router = Router();

const limiter = rateLimit({
  windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => {
    const fwd = req.headers['x-client-ip'];
    const ip = Array.isArray(fwd) ? fwd[0] : fwd;
    return (ip && String(ip).trim()) || req.ip || 'unknown';
  },
});

router.get('/v1/screens/crypto-momentum', limiter, async (req: Request, res: Response) => {
  const topN = Math.min(30, Math.max(5, Number(req.query.top) || 15));
  try {
    const screen = await getCryptoMomentumScreen(topN);
    // The engine caches 15m; let the edge cache briefly too, but the data is a signal not
    // a price, so a short cache is fine (unlike sell-quote which must be no-store).
    res.header('Cache-Control', 'public, max-age=300');
    return res.json(screen);
  } catch (err) {
    return res.status(502).json({ error: 'screen unavailable', detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;

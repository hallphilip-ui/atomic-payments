import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const router = Router();

// Server-side JSON-RPC proxy (L1). The browser wallet talks ONLY to our own
// origin for RPC; we forward to a trusted upstream. Benefits:
//   * a trusted/paid provider (Alchemy) is used when ATOMIC_ALCHEMY_KEY is set,
//     and the key stays server-side (never shipped to the client),
//   * no third-party RPC host appears in the page (tightens the CSP, M3),
//   * one place to rate-limit and to swap providers.
// Falls back to public endpoints when no key is configured, so it works today
// and upgrades to "trusted" the moment the key is added to .env.
const ALCHEMY = (process.env.ATOMIC_ALCHEMY_KEY || '').trim();
const alchemy = (net: string) => (ALCHEMY ? `https://${net}.g.alchemy.com/v2/${ALCHEMY}` : null);

// Fallbacks use publicnode.com (Allnodes) — free and markedly more reliable than
// llamarpc/chain-default endpoints. Still: set ATOMIC_ALCHEMY_KEY for production
// (a paid provider is the real "trusted RPC" — public nodes rate-limit and drop).
const UPSTREAM: Record<number, string> = {
  1:     alchemy('eth-mainnet')     ?? 'https://ethereum-rpc.publicnode.com',
  8453:  alchemy('base-mainnet')    ?? 'https://base-rpc.publicnode.com',
  42161: alchemy('arb-mainnet')     ?? 'https://arbitrum-one-rpc.publicnode.com',
  10:    alchemy('opt-mainnet')     ?? 'https://optimism-rpc.publicnode.com',
  137:   alchemy('polygon-mainnet') ?? 'https://polygon-bor-rpc.publicnode.com',
  56:    'https://bsc-rpc.publicnode.com', // Alchemy has no BNB Chain — public
  43114: alchemy('avax-mainnet')    ?? 'https://avalanche-c-chain-rpc.publicnode.com',
  84532: alchemy('base-sepolia')    ?? 'https://base-sepolia-rpc.publicnode.com'
};

// Read-heavy but cheap; generous per-IP cap keeps a single client fast while
// preventing the proxy from being abused as an open relay against our quota.
const rpcLimiter = rateLimit({
  windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => { const cf = req.headers['cf-connecting-ip']; return typeof cf === 'string' && cf.length ? cf : req.ip || 'unknown'; }
});

// Only relay standard node methods, so the proxy can't be repurposed.
const ALLOWED = /^(eth_|net_|web3_)/;
const methodsAllowed = (body: any): boolean => {
  const calls = Array.isArray(body) ? body : [body];
  return calls.length > 0 && calls.every((c) => c && typeof c.method === 'string' && ALLOWED.test(c.method));
};

router.post('/v1/rpc/:chainId', rpcLimiter, async (req, res) => {
  const upstream = UPSTREAM[Number(req.params.chainId)];
  if (!upstream) return res.status(400).json({ error: 'Unsupported chain.' });
  if (!methodsAllowed(req.body)) return res.status(400).json({ error: 'Method not permitted.' });
  try {
    const r = await fetch(upstream, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body), signal: AbortSignal.timeout(15000)
    });
    const text = await r.text();
    return res.status(r.status).header('Content-Type', 'application/json').send(text);
  } catch {
    return res.status(502).json({ error: 'Upstream RPC error.' });
  }
});

// Lets the client discover the active chains without hardcoding (and confirms proxy is up).
router.get('/v1/rpc', (_req, res) => res.json({ chains: Object.keys(UPSTREAM).map(Number), trusted: !!ALCHEMY }));

export default router;

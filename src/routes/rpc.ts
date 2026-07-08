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

// Reliable public fallbacks (publicnode.com / Allnodes).
const PUBLIC: Record<number, string> = {
  1:     'https://ethereum-rpc.publicnode.com',
  8453:  'https://base-rpc.publicnode.com',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
  10:    'https://optimism-rpc.publicnode.com',
  137:   'https://polygon-bor-rpc.publicnode.com',
  56:    'https://bsc-rpc.publicnode.com',
  43114: 'https://avalanche-c-chain-rpc.publicnode.com',
  84532: 'https://base-sepolia-rpc.publicnode.com'
};
// Alchemy endpoint per chain (null where Alchemy has no coverage, e.g. BNB).
const ALCHEMY_NET: Record<number, string | null> = {
  1: alchemy('eth-mainnet'), 8453: alchemy('base-mainnet'), 42161: alchemy('arb-mainnet'),
  10: alchemy('opt-mainnet'), 137: alchemy('polygon-mainnet'), 56: null,
  43114: alchemy('avax-mainnet'), 84532: alchemy('base-sepolia')
};
// Try Alchemy first (trusted), then the public node. So a chain the user hasn't
// enabled on their Alchemy app — or a transient Alchemy hiccup — transparently
// falls back and keeps working, and upgrades to Alchemy once enabled.
const upstreamsFor = (chainId: number): string[] =>
  [ALCHEMY_NET[chainId], PUBLIC[chainId]].filter((u): u is string => !!u);

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
  const upstreams = upstreamsFor(Number(req.params.chainId));
  if (!upstreams.length) return res.status(400).json({ error: 'Unsupported chain.' });
  if (!methodsAllowed(req.body)) return res.status(400).json({ error: 'Method not permitted.' });

  const body = JSON.stringify(req.body);
  for (let i = 0; i < upstreams.length; i++) {
    const isLast = i === upstreams.length - 1;
    try {
      const r = await fetch(upstreams[i], {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body, signal: AbortSignal.timeout(15000)
      });
      const text = await r.text();
      // Fall back on a provider-level failure: non-2xx, or Alchemy reporting the
      // network isn't enabled for this app. A valid JSON-RPC error (e.g. a revert)
      // is HTTP 200 without that marker, so it passes straight through.
      if (!isLast && (!r.ok || /is not enabled for this app/i.test(text))) continue;
      return res.status(r.status).header('Content-Type', 'application/json').send(text);
    } catch {
      if (isLast) return res.status(502).json({ error: 'Upstream RPC error.' });
    }
  }
  return res.status(502).json({ error: 'Upstream RPC error.' });
});

// Lets the client discover the active chains without hardcoding (and confirms proxy is up).
router.get('/v1/rpc', (_req, res) => res.json({ chains: Object.keys(UPSTREAM).map(Number), trusted: !!ALCHEMY }));

export default router;

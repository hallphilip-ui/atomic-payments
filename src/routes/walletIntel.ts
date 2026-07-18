import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { rpcCall } from './rpc';
import { screenAddressLocal, screenAddressOracleChecked, screenAddresses } from '../compliance/sanctions';

// Wallet Intelligence — LOG-ONLY, READ-ONLY diligence on a pasted EVM address.
// Public (no funds, no keys, only public on-chain data + our OFAC screen). Reuses
// the Alchemy-backed rpcCall and the sanctions screener. Ethereum mainnet for now.
// NOT financial or legal advice; every behavioural label is an explicit heuristic.
const router = Router();

const EVM = /^0x[a-fA-F0-9]{40}$/;
const CHAIN_ID = 1;

// Per-CLIENT limit. Requests arrive via the exchange's Cloudflare Pages proxy, which
// does a server-side fetch — so the origin sees Cloudflare's egress IP, not the user,
// and req.ip would collapse everyone into ONE global bucket (a trivial self-DoS). The
// proxy forwards the real client IP as X-Client-IP (set from cf-connecting-ip, never
// from client input); fall back to req.ip for direct callers. Keyed per client, so
// this can be generous.
const limiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const fwd = req.headers['x-client-ip'];
    const ip = Array.isArray(fwd) ? fwd[0] : fwd;
    return (ip && String(ip).trim()) || req.ip || 'unknown';
  },
});

// A small, high-signal known-address map (lowercased). Not exhaustive — labels the
// obvious infrastructure so a pasted router/token reads correctly rather than as a
// mystery "contract". Sanctioned addresses are caught by the OFAC screen, not here.
const KNOWN: Record<string, string> = {
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'Uniswap V2 Router',
  '0xe592427a0aece92de3edee1f18e0157c05861564': 'Uniswap V3 Router',
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': 'Uniswap Universal Router',
  '0x1111111254eeb25477b68fb85ed929f73a960582': '1inch v5 Router',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH (token)',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC (token)',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT (token)',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI (token)',
  '0x00000000006c3852cbef3e08e8df289169ede581': 'Seaport (OpenSea)',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'UNI (token)',
};

// Native ETH price, cached — best-effort USD context; null on failure (never blocks).
let ethPx: { at: number; usd: number } | null = null;
async function ethUsd(): Promise<number | null> {
  if (ethPx && Date.now() - ethPx.at < 120_000) return ethPx.usd;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    const usd = ((await r.json()) as any)?.ethereum?.usd;
    if (typeof usd === 'number') { ethPx = { at: Date.now(), usd }; return usd; }
  } catch { /* best-effort */ }
  return ethPx?.usd ?? null;
}

const hexToNum = (h: any): number => { try { return Number(BigInt(h)); } catch { return 0; } };

router.get('/v1/wallet-intel/:address', limiter, async (req: Request, res: Response) => {
  const raw = String(req.params.address || '').trim();
  if (!EVM.test(raw)) {
    return res.status(400).json({
      error: 'Enter a valid Ethereum address (0x… 40 hex). Only Ethereum mainnet is supported today.',
    });
  }
  const addr = raw.toLowerCase();
  const reasons: string[] = [];
  const labels: string[] = [];

  try {
    // --- core reads + live sanctions oracle, in parallel ---
    const [balHex, code, nonceHex, px, oracleRes] = await Promise.all([
      rpcCall(CHAIN_ID, 'eth_getBalance', [addr, 'latest']).catch(() => null),
      rpcCall(CHAIN_ID, 'eth_getCode', [addr, 'latest']).catch(() => '0x'),
      rpcCall(CHAIN_ID, 'eth_getTransactionCount', [addr, 'latest']).catch(() => '0x0'),
      ethUsd(),
      screenAddressOracleChecked(addr).catch(() => ({ hit: null, ran: false })),
    ]);
    // Local OFAC snapshot (sync, authoritative) + the live oracle above. Track whether
    // the live layer actually ran so we never assert "clean" on a failed check.
    const localHit = screenAddressLocal(addr);
    const selfHit = localHit || oracleRes.hit;
    const liveOracleRan = oracleRes.ran;

    // Post-Pectra (EIP-7702) an EOA can carry a `0xef0100…` delegation, so non-empty
    // code no longer means "contract". Treat a 7702 delegation as the EOA it still is.
    const codeStr = (code || '0x').toLowerCase();
    const delegated = codeStr.startsWith('0xef0100');
    const isContract = codeStr !== '0x' && !delegated;
    const ethBalance = balHex ? hexToNum(balHex) / 1e18 : 0;
    const outboundTx = hexToNum(nonceHex);
    const known = KNOWN[addr];

    if (known) labels.push(`known: ${known}`);
    labels.push(isContract ? 'contract' : (delegated ? 'EIP-7702 delegated EOA' : 'EOA (externally-owned account)'));

    // --- token holdings (Alchemy) ---
    let tokens: Array<{ symbol: string; name: string; amount: number; contract: string }> = [];
    try {
      const tb = await rpcCall(CHAIN_ID, 'alchemy_getTokenBalances', [addr, 'erc20']);
      const nonzero = (tb?.tokenBalances || [])
        .filter((t: any) => { try { return BigInt(t.tokenBalance) > 0n; } catch { return false; } })
        .slice(0, 12);
      tokens = (await Promise.all(nonzero.map(async (t: any) => {
        try {
          const m = await rpcCall(CHAIN_ID, 'alchemy_getTokenMetadata', [t.contractAddress]);
          const dec = Number.isFinite(m?.decimals) ? m.decimals : 18;
          const amount = hexToNum(t.tokenBalance) / 10 ** dec;
          if (!(amount > 0) || !m?.symbol) return null;
          return { symbol: m.symbol, name: m.name || '', amount, contract: t.contractAddress };
        } catch { return null; }
      }))).filter(Boolean) as any;
      tokens.sort((a, b) => b.amount - a.amount);
    } catch { /* holdings best-effort */ }

    const stableHeld = tokens.some((t) => ['USDC', 'USDT', 'DAI', 'USDE', 'FRAX'].includes(t.symbol.toUpperCase()));
    if (stableHeld) labels.push('holds stablecoins');
    if (tokens.length >= 8) labels.push('diversified token holdings');

    // --- activity window + out-counterparties (Alchemy getAssetTransfers) ---
    // last_seen must reflect BOTH directions — a receive-only wallet has no outbound
    // transfer, so outbound alone would wrongly report it as never-active. Out query
    // is capped at 15 (also the counterparty set screened below — bounds RPC fan-out).
    let firstSeen: string | null = null, lastOut: string | null = null, lastIn: string | null = null;
    const counterparties = new Set<string>();
    try {
      const out = await rpcCall(CHAIN_ID, 'alchemy_getAssetTransfers', [{
        fromBlock: '0x0', toBlock: 'latest', fromAddress: addr,
        category: ['external', 'erc20'], order: 'desc', maxCount: '0x0f', withMetadata: true,
      }]);
      const outs = out?.transfers || [];
      if (outs.length) lastOut = outs[0]?.metadata?.blockTimestamp || null;
      for (const t of outs) if (t?.to && EVM.test(t.to)) counterparties.add(String(t.to).toLowerCase());
    } catch { /* best-effort */ }
    try {
      const inLast = await rpcCall(CHAIN_ID, 'alchemy_getAssetTransfers', [{
        fromBlock: '0x0', toBlock: 'latest', toAddress: addr,
        category: ['external', 'erc20'], order: 'desc', maxCount: '0x1', withMetadata: true,
      }]);
      lastIn = inLast?.transfers?.[0]?.metadata?.blockTimestamp || null;
    } catch { /* best-effort */ }
    try {
      const inFirst = await rpcCall(CHAIN_ID, 'alchemy_getAssetTransfers', [{
        fromBlock: '0x0', toBlock: 'latest', toAddress: addr,
        category: ['external', 'erc20'], order: 'asc', maxCount: '0x1', withMetadata: true,
      }]);
      firstSeen = inFirst?.transfers?.[0]?.metadata?.blockTimestamp || null;
    } catch { /* best-effort */ }

    // ISO-8601 timestamps sort chronologically; take the most recent of either direction.
    const lastSeen = [lastOut, lastIn].filter(Boolean).sort().slice(-1)[0] || null;
    const now = Date.now();
    const lastMs = lastSeen ? Date.parse(lastSeen) : NaN;
    const dormant = Number.isFinite(lastMs) && (now - lastMs) > 180 * 86_400_000;
    const daysActive = firstSeen && Number.isFinite(Date.parse(firstSeen))
      ? Math.round((now - Date.parse(firstSeen)) / 86_400_000) : null;
    const fresh = daysActive != null && daysActive <= 14;

    if (outboundTx > 5000) labels.push('very high activity (likely a bot or hot wallet)');
    else if (outboundTx > 500) labels.push('high activity');
    if (outboundTx === 0 && ethBalance > 0) labels.push('receive-only (no outbound tx — cold-storage pattern)');
    if (dormant) labels.push('dormant (no activity in 180+ days)');
    if (fresh) labels.push(`newly active (~${daysActive}d old)`);
    if (ethBalance >= 100) labels.push('whale (native ETH)');

    // --- counterparty taint screen (reuses the batch OFAC/oracle screener) ---
    let taintedCounterparty: string | null = null;
    if (counterparties.size) {
      const hit = await screenAddresses([...counterparties]).catch(() => null);
      if (hit) taintedCounterparty = hit.matchedAddress || 'a screened address';
    }

    // --- risk verdict ---
    let level: 'clean' | 'caution' | 'high' | 'critical' = 'clean';
    if (selfHit) {
      level = 'critical';
      reasons.push(`This address is on a sanctions list (${selfHit.source}). Do not transact.`);
      labels.push('SANCTIONED');
    } else if (taintedCounterparty) {
      level = 'high';
      reasons.push(`Sent funds to a sanctioned/flagged address (${taintedCounterparty.slice(0, 10)}…). Possible taint.`);
    } else if (fresh && (ethBalance > 5 || stableHeld)) {
      level = 'caution';
      reasons.push('Newly created and already holding meaningful value — verify provenance before trusting.');
    }
    // Honest about which sanctions layers actually ran — never assert "clean" when
    // the live oracle was unreachable; the daily OFAC snapshot alone is provisional.
    const sanctionsScreen = {
      ofac_snapshot: localHit ? 'hit' : 'clear',
      live_oracle: oracleRes.hit ? 'hit' : (liveOracleRan ? 'clear' : 'unavailable'),
    };
    if (level === 'clean') {
      reasons.push(liveOracleRan
        ? 'No match on the OFAC list (refreshed daily) or the live on-chain sanctions oracle; recent counterparties also clear.'
        : 'Clear on the daily OFAC snapshot, but the live on-chain sanctions oracle was unreachable this check — treat as provisional and re-run shortly.');
    }

    const summary = isContract
      ? `Smart contract${known ? ` — ${known}` : ''}. ${outboundTx.toLocaleString()} outbound tx. Risk: ${level}.`
      : `EOA${known ? ` (${known})` : ''} holding ${ethBalance.toFixed(4)} ETH${px ? ` (~$${Math.round(ethBalance * px).toLocaleString()})` : ''} and ${tokens.length} token(s), ${outboundTx.toLocaleString()} outbound tx${daysActive != null ? `, ~${daysActive}d old` : ''}. Risk: ${level}.`;

    return res.json({
      address: raw,
      chain: 'ethereum',
      valid: true,
      type: isContract ? 'contract' : 'EOA',
      known_label: known || null,
      risk: { level, sanctioned: !!selfHit, screen: sanctionsScreen, tainted_counterparty: taintedCounterparty, reasons },
      native: { symbol: 'ETH', balance: ethBalance, usd: px ? ethBalance * px : null },
      activity: {
        outbound_tx: outboundTx,
        first_seen: firstSeen, last_seen: lastSeen,
        days_active: daysActive, dormant,
      },
      tokens,
      labels,
      summary,
      disclaimer: 'Heuristic diligence on public on-chain data (Ethereum mainnet). Not investment or legal advice; labels are indicative, not definitive.',
      data_sources: ['Ethereum RPC (Alchemy)', 'OFAC SDN list + on-chain sanctions oracle', 'CoinGecko (ETH price)'],
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[wallet-intel] lookup failed:', err instanceof Error ? err.message : String(err));
    return res.status(502).json({ error: 'Wallet lookup failed. Please try again.' });
  }
});

export default router;

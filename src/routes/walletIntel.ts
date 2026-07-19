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
const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const BTC = /^(bc1[a-z0-9]{25,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
// Solana is the fallback base58 shape — checked only AFTER EVM/Tron/BTC, since a
// Tron 'T…' and a legacy BTC '1…'/'3…' also fit the base58 alphabet.
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CHAIN_ID = 1;

// Curated top TRC-20 tokens (Tron): contract → symbol, decimals, CoinGecko id for
// pricing. USDT dominates real value on Tron, so this small map covers most wallets;
// anything not here is counted as "unpriced/other" rather than shown as noise.
const TRON_TOKENS: Record<string, { sym: string; dec: number; cg: string }> = {
  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: { sym: 'USDT', dec: 6, cg: 'tether' },
  TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: { sym: 'USDC', dec: 6, cg: 'usd-coin' },
  TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn: { sym: 'USDD', dec: 18, cg: 'usdd' },
  TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9: { sym: 'JST', dec: 18, cg: 'just' },
  TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4: { sym: 'BTT', dec: 18, cg: 'bittorrent' },
  TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7: { sym: 'WIN', dec: 6, cg: 'wink' },
  TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S: { sym: 'SUN', dec: 18, cg: 'sun-token' },
  TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9: { sym: 'WBTC', dec: 8, cg: 'wrapped-bitcoin' },
};

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

// USD prices for ERC-20 contracts (CoinGecko, by contract address). A real token
// has a price feed; airdrop-spam almost never does — so an ABSENT price is the spam
// signal we filter on. `ok` distinguishes "service answered, this token has no price"
// (spam → hide) from "price service was down" (→ don't hide real holdings).
async function tokenPrices(network: string, contracts: string[]): Promise<{ prices: Record<string, number>; ok: boolean }> {
  const prices: Record<string, number> = {};
  const uniq = [...new Set(contracts.filter((c) => EVM.test(c)).map((c) => c.toLowerCase()))];
  if (!uniq.length) return { prices, ok: true };
  // Alchemy Prices API (by contract). Reliable + batched + already on our key —
  // CoinGecko's contract endpoint silently fails on large batches. A token with no
  // price comes back with an empty `prices` array → absent here → treated as spam.
  const key = (process.env.ATOMIC_ALCHEMY_KEY || '').trim();
  if (!key) return { prices, ok: false };
  let ok = false;
  for (let i = 0; i < uniq.length; i += 25) {
    const chunk = uniq.slice(i, i + 25);
    try {
      const r = await fetch(`https://api.g.alchemy.com/prices/v1/${key}/tokens/by-address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: chunk.map((a) => ({ network, address: a })) }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      ok = true;
      const j = (await r.json()) as { data?: Array<{ address?: string; prices?: Array<{ currency?: string; value?: string }> }> };
      for (const row of j.data || []) {
        const p = (row.prices || []).find((x) => x.currency === 'usd');
        const v = p ? Number(p.value) : NaN;
        if (row.address && Number.isFinite(v)) prices[String(row.address).toLowerCase()] = v;
      }
    } catch { /* best-effort per chunk */ }
  }
  return { prices, ok };
}

const hexToNum = (h: any): number => { try { return Number(BigInt(h)); } catch { return 0; } };

// The same 0x address exists on every EVM chain, so one paste is scanned across all
// of them. `net` is the Alchemy network slug (RPC + Prices API); `cg` prices the
// native coin. Ethereum stays the "primary" chain — activity, counterparties and the
// sanctions screen run there only, to bound RPC fan-out.
const EVM_CHAINS = [
  { id: 1, key: 'ethereum', name: 'Ethereum', sym: 'ETH', net: 'eth-mainnet', cg: 'ethereum' },
  { id: 8453, key: 'base', name: 'Base', sym: 'ETH', net: 'base-mainnet', cg: 'ethereum' },
  { id: 42161, key: 'arbitrum', name: 'Arbitrum', sym: 'ETH', net: 'arb-mainnet', cg: 'ethereum' },
  { id: 10, key: 'optimism', name: 'Optimism', sym: 'ETH', net: 'opt-mainnet', cg: 'ethereum' },
  { id: 137, key: 'polygon', name: 'Polygon', sym: 'POL', net: 'polygon-mainnet', cg: 'polygon-ecosystem-token' },
  { id: 43114, key: 'avalanche', name: 'Avalanche', sym: 'AVAX', net: 'avax-mainnet', cg: 'avalanche-2' },
];

type ChainHoldings = {
  key: string; name: string;
  native: { symbol: string; balance: number; usd: number | null };
  tokens: Array<{ symbol: string; name: string; amount: number; contract: string; price: number | null; usd: number | null }>;
  tokens_hidden: number; total_usd: number;
};

// Native + value-ranked token holdings for one EVM chain. Price FIRST (one batched
// call), then pay for metadata only on tokens that have a price — an absent price is
// the spam signal, and a spam-flooded wallet would otherwise bury its real tokens.
async function chainHoldings(
  chain: typeof EVM_CHAINS[number], addr: string, nativeUsd: number | null,
): Promise<ChainHoldings> {
  const out: ChainHoldings = {
    key: chain.key, name: chain.name,
    native: { symbol: chain.sym, balance: 0, usd: null },
    tokens: [], tokens_hidden: 0, total_usd: 0,
  };
  const balHex = await rpcCall(chain.id, 'eth_getBalance', [addr, 'latest']).catch(() => null);
  out.native.balance = balHex ? hexToNum(balHex) / 1e18 : 0;
  out.native.usd = nativeUsd != null ? out.native.balance * nativeUsd : null;

  try {
    const tb = await rpcCall(chain.id, 'alchemy_getTokenBalances', [addr, 'erc20']);
    const held: Array<{ contract: string; raw: string }> = (tb?.tokenBalances || [])
      .filter((t: any) => { try { return BigInt(t.tokenBalance) > 0n; } catch { return false; } })
      .map((t: any) => ({ contract: String(t.contractAddress).toLowerCase(), raw: String(t.tokenBalance) }))
      .slice(0, 120);
    const totalHeld = held.length;
    if (totalHeld) {
      const { prices, ok } = await tokenPrices(chain.net, held.map((t) => t.contract));
      const candidates = ok ? held.filter((t) => prices[t.contract] != null) : held.slice(0, 8);
      const valued = (await Promise.all(candidates.slice(0, 12).map(async (t) => {
        try {
          const m = await rpcCall(chain.id, 'alchemy_getTokenMetadata', [t.contract]);
          const dec = Number.isFinite(m?.decimals) ? m.decimals : 18;
          const amount = hexToNum(t.raw) / 10 ** dec;
          if (!(amount > 0) || !m?.symbol) return null;
          const price = ok ? (prices[t.contract] ?? null) : null;
          return { symbol: String(m.symbol), name: m.name || '', amount, contract: t.contract, price, usd: price != null ? amount * price : null };
        } catch { return null; }
      }))).filter(Boolean) as ChainHoldings['tokens'];
      out.tokens = (ok ? valued.filter((t) => t.usd != null && t.usd >= 1) : valued)
        .sort((a, b) => (b.usd || 0) - (a.usd || 0)).slice(0, 12);
      out.tokens_hidden = Math.max(0, totalHeld - out.tokens.length);
    }
  } catch { /* holdings best-effort per chain */ }

  out.total_usd = (out.native.usd || 0) + out.tokens.reduce((s, t) => s + (t.usd || 0), 0);
  return out;
}

// ENS primary (reverse) name. Public resolver service; 404 = no ENS set. Identity
// signal only — never a trust signal on its own.
async function ensName(addr: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.ensdata.net/${addr}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    return j?.ens_primary || j?.ens || null;
  } catch { return null; }
}

// CoinGecko USD prices by coin id (for native TRX + curated TRC-20s). Best-effort.
async function cgPricesByIds(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=' + uniq.join(','),
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) return out;
    const j = (await r.json()) as Record<string, { usd?: number }>;
    for (const [k, v] of Object.entries(j)) if (typeof v?.usd === 'number') out[k] = v.usd;
  } catch { /* best-effort */ }
  return out;
}

// Tron diligence — same report shape as EVM. Sanctions via the local OFAC snapshot
// (267 Tron addresses; the on-chain oracle is EVM-only). Account/holdings from the
// keyless TronGrid API; curated TRC-20 map priced via CoinGecko, value-ranked.
async function tronReport(raw: string): Promise<any> {
  const reasons: string[] = [];
  const labels: string[] = ['Tron account (TRC-20)'];

  // Local OFAC screen — addresses are stored lowercased, matched case-insensitively.
  const localHit = screenAddressLocal(raw);

  let balTrx = 0, createTime: number | null = null, lastOp: number | null = null;
  let holdings: Array<{ contract: string; raw: string }> = [];
  try {
    const r = await fetch(`https://api.trongrid.io/v1/accounts/${raw}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    const j = (await r.json()) as any;
    const a = (j?.data || [])[0];
    if (a) {
      balTrx = (a.balance || 0) / 1e6;
      createTime = a.create_time || null;
      lastOp = a.latest_opration_time || a.latest_operation_time || null;
      holdings = (a.trc20 || [])
        .map((m: any) => { const e = Object.entries(m || {})[0]; return e ? { contract: String(e[0]), raw: String(e[1]) } : null; })
        .filter(Boolean);
    }
  } catch { /* account read best-effort */ }

  const known = holdings.filter((h) => TRON_TOKENS[h.contract]);
  const px = await cgPricesByIds(['tron', ...known.map((h) => TRON_TOKENS[h.contract].cg)]);
  const trxUsd = px['tron'] ?? null;

  let tokens = known.map((h) => {
    const meta = TRON_TOKENS[h.contract];
    let amount = 0;
    try { amount = Number(BigInt(h.raw)) / 10 ** meta.dec; } catch { /* keep 0 */ }
    const price = px[meta.cg] ?? null;
    return { symbol: meta.sym, name: '', amount, contract: h.contract, price, usd: price != null ? amount * price : null };
  }).filter((t) => t.usd == null || t.usd >= 1).sort((a, b) => (b.usd || 0) - (a.usd || 0));
  const tokensHidden = holdings.length - tokens.length;

  const now = Date.now();
  const firstSeen = createTime ? new Date(createTime).toISOString() : null;
  const lastSeen = lastOp ? new Date(lastOp).toISOString() : null;
  const daysActive = createTime ? Math.round((now - createTime) / 86_400_000) : null;
  const dormant = !!lastOp && (now - lastOp) > 180 * 86_400_000;

  const stableHeld = tokens.some((t) => ['USDT', 'USDC', 'USDD', 'TUSD'].includes(t.symbol));
  if (stableHeld) labels.push('holds stablecoins');
  if (balTrx >= 1_000_000) labels.push('whale (native TRX)');
  if (dormant) labels.push('dormant (no activity in 180+ days)');
  if (daysActive != null && daysActive <= 14) labels.push(`newly active (~${daysActive}d old)`);

  let level: 'clean' | 'caution' | 'high' | 'critical' = 'clean';
  if (localHit) {
    level = 'critical';
    reasons.push('This address is on the OFAC SDN sanctions list. Do not transact.');
    labels.push('SANCTIONED');
  }
  const sanctionsScreen = { ofac_snapshot: localHit ? 'hit' : 'clear', live_oracle: 'n/a (Tron)' };
  if (level === 'clean') {
    reasons.push('No match on the OFAC SDN list (daily snapshot, includes Tron). The live on-chain oracle covers EVM chains only.');
  }

  const summary = `Tron account holding ${balTrx.toLocaleString(undefined, { maximumFractionDigits: 2 })} TRX${trxUsd ? ` (~$${Math.round(balTrx * trxUsd).toLocaleString()})` : ''} and ${tokens.length} priced token(s)${daysActive != null ? `, ~${daysActive}d old` : ''}. Risk: ${level}.`;

  return {
    address: raw,
    chain: 'tron',
    valid: true,
    type: 'account',
    known_label: null,
    risk: { level, sanctioned: !!localHit, screen: sanctionsScreen, tainted_counterparty: null, reasons },
    native: { symbol: 'TRX', balance: balTrx, usd: trxUsd ? balTrx * trxUsd : null },
    activity: { outbound_tx: null, first_seen: firstSeen, last_seen: lastSeen, days_active: daysActive, dormant },
    tokens,
    tokens_hidden: tokensHidden,
    labels,
    summary,
    disclaimer: 'Heuristic diligence on public on-chain data (Tron mainnet). Not investment or legal advice; labels are indicative, not definitive.',
    data_sources: ['TronGrid (account + TRC-20)', 'OFAC SDN list (Tron addresses)', 'CoinGecko (prices)'],
    generated_at: new Date().toISOString(),
  };
}

// Bitcoin diligence — OFAC snapshot (526 BTC addresses) + balance/tx from the
// keyless mempool.space API. No native tokens on Bitcoin.
async function btcReport(raw: string): Promise<any> {
  const reasons: string[] = [];
  const labels: string[] = ['Bitcoin address'];
  const localHit = screenAddressLocal(raw);

  let balBtc = 0, txCount = 0;
  let lastSeen: string | null = null;
  try {
    const r = await fetch(`https://mempool.space/api/address/${raw}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    const j = (await r.json()) as any;
    const cs = j?.chain_stats || {};
    balBtc = ((cs.funded_txo_sum || 0) - (cs.spent_txo_sum || 0)) / 1e8;
    txCount = cs.tx_count || 0;
  } catch { /* best-effort */ }
  try {
    const r = await fetch(`https://mempool.space/api/address/${raw}/txs`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    const txs = (await r.json()) as any[];
    const bt = Array.isArray(txs) && txs[0]?.status?.block_time;
    if (bt) lastSeen = new Date(bt * 1000).toISOString();
  } catch { /* best-effort */ }

  const btcUsd = (await cgPricesByIds(['bitcoin']))['bitcoin'] ?? null;
  const dormant = !!lastSeen && (Date.now() - Date.parse(lastSeen)) > 180 * 86_400_000;
  if (balBtc >= 50) labels.push('whale (native BTC)');
  if (dormant) labels.push('dormant (no activity in 180+ days)');

  let level: 'clean' | 'caution' | 'high' | 'critical' = 'clean';
  if (localHit) { level = 'critical'; reasons.push('This address is on the OFAC SDN sanctions list. Do not transact.'); labels.push('SANCTIONED'); }
  else reasons.push('No match on the OFAC SDN list (daily snapshot, includes Bitcoin). No live oracle exists for Bitcoin.');
  const sanctionsScreen = { ofac_snapshot: localHit ? 'hit' : 'clear', live_oracle: 'n/a (Bitcoin)' };

  return {
    address: raw, chain: 'bitcoin', valid: true, type: 'account', known_label: null,
    risk: { level, sanctioned: !!localHit, screen: sanctionsScreen, tainted_counterparty: null, reasons },
    native: { symbol: 'BTC', balance: balBtc, usd: btcUsd ? balBtc * btcUsd : null },
    activity: { outbound_tx: txCount, first_seen: null, last_seen: lastSeen, days_active: null, dormant },
    tokens: [], tokens_hidden: 0, labels,
    summary: `Bitcoin address holding ${balBtc.toLocaleString(undefined, { maximumFractionDigits: 8 })} BTC${btcUsd ? ` (~$${Math.round(balBtc * btcUsd).toLocaleString()})` : ''} across ${txCount.toLocaleString()} transaction(s). Risk: ${level}.`,
    disclaimer: 'Heuristic diligence on public on-chain data (Bitcoin). Not investment or legal advice.',
    data_sources: ['mempool.space (balance + tx)', 'OFAC SDN list (Bitcoin addresses)', 'CoinGecko (price)'],
    generated_at: new Date().toISOString(),
  };
}

async function solRpc(method: string, params: any[]): Promise<any> {
  const r = await fetch('https://api.mainnet-beta.solana.com', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(9000),
  });
  return ((await r.json()) as any)?.result;
}

// Solana diligence — OFAC snapshot + SOL balance, SPL-token-account count, and last
// activity from the public Solana RPC.
async function solReport(raw: string): Promise<any> {
  const reasons: string[] = [];
  const labels: string[] = ['Solana account'];
  const localHit = screenAddressLocal(raw);

  const [balRes, tokRes, sigRes] = await Promise.all([
    solRpc('getBalance', [raw]).catch(() => null),
    solRpc('getTokenAccountsByOwner', [raw, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]).catch(() => null),
    solRpc('getSignaturesForAddress', [raw, { limit: 1 }]).catch(() => null),
  ]);
  const balSol = (balRes?.value || 0) / 1e9;
  const splCount = (tokRes?.value || []).length;
  const sig = Array.isArray(sigRes) ? sigRes[0] : null;
  const lastSeen = sig?.blockTime ? new Date(sig.blockTime * 1000).toISOString() : null;

  const solUsd = (await cgPricesByIds(['solana']))['solana'] ?? null;
  const dormant = !!lastSeen && (Date.now() - Date.parse(lastSeen)) > 180 * 86_400_000;
  if (splCount) labels.push(`${splCount} SPL token account(s)`);
  if (balSol >= 10000) labels.push('whale (native SOL)');
  if (dormant) labels.push('dormant (no activity in 180+ days)');

  let level: 'clean' | 'caution' | 'high' | 'critical' = 'clean';
  if (localHit) { level = 'critical'; reasons.push('This address is on the OFAC SDN sanctions list. Do not transact.'); labels.push('SANCTIONED'); }
  else reasons.push('No match on the OFAC SDN list (daily snapshot). No live on-chain oracle exists for Solana.');
  const sanctionsScreen = { ofac_snapshot: localHit ? 'hit' : 'clear', live_oracle: 'n/a (Solana)' };

  return {
    address: raw, chain: 'solana', valid: true, type: 'account', known_label: null,
    risk: { level, sanctioned: !!localHit, screen: sanctionsScreen, tainted_counterparty: null, reasons },
    native: { symbol: 'SOL', balance: balSol, usd: solUsd ? balSol * solUsd : null },
    activity: { outbound_tx: null, first_seen: null, last_seen: lastSeen, days_active: null, dormant },
    tokens: [], tokens_hidden: 0, labels,
    summary: `Solana account holding ${balSol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL${solUsd ? ` (~$${Math.round(balSol * solUsd).toLocaleString()})` : ''} and ${splCount} SPL token account(s). Risk: ${level}.`,
    disclaimer: 'Heuristic diligence on public on-chain data (Solana). Not investment or legal advice.',
    data_sources: ['Solana RPC (balance + tokens + activity)', 'OFAC SDN list', 'CoinGecko (price)'],
    generated_at: new Date().toISOString(),
  };
}

router.get('/v1/wallet-intel/:address', limiter, async (req: Request, res: Response) => {
  const raw = String(req.params.address || '').trim();
  // Non-EVM paths (different data sources, same report shape). Order matters: Tron
  // and legacy-BTC also fit the base58 alphabet, so Solana is checked last.
  const nonEvm: Record<string, (a: string) => Promise<any>> =
    TRON.test(raw) ? { tron: tronReport } :
    BTC.test(raw) ? { bitcoin: btcReport } :
    (!EVM.test(raw) && SOL.test(raw)) ? { solana: solReport } : {};
  const [chainName, fn] = Object.entries(nonEvm)[0] || [];
  if (fn) {
    try {
      return res.json(await fn(raw));
    } catch (err) {
      console.error(`[wallet-intel ${chainName}] lookup failed:`, err instanceof Error ? err.message : String(err));
      return res.status(502).json({ error: 'Wallet lookup failed. Please try again.' });
    }
  }
  if (!EVM.test(raw)) {
    return res.status(400).json({
      error: 'Enter a valid Ethereum (0x…), Tron (T…), Bitcoin, or Solana address.',
    });
  }
  const addr = raw.toLowerCase();
  const reasons: string[] = [];
  const labels: string[] = [];

  try {
    // --- core reads + live sanctions oracle + ENS + native prices, in parallel ---
    const [code, nonceHex, px, oracleRes, ens, nativePx] = await Promise.all([
      rpcCall(CHAIN_ID, 'eth_getCode', [addr, 'latest']).catch(() => '0x'),
      rpcCall(CHAIN_ID, 'eth_getTransactionCount', [addr, 'latest']).catch(() => '0x0'),
      ethUsd(),
      screenAddressOracleChecked(addr).catch(() => ({ hit: null, ran: false })),
      ensName(addr).catch(() => null),
      cgPricesByIds([...new Set(EVM_CHAINS.map((c) => c.cg))]).catch(() => ({} as Record<string, number>)),
    ]);
    // Multi-chain holdings — every EVM chain, in parallel.
    const chains = (await Promise.all(
      EVM_CHAINS.map((c) => chainHoldings(c, addr, nativePx[c.cg] ?? null).catch(() => null)),
    )).filter(Boolean) as ChainHoldings[];
    const eth = chains.find((c) => c.key === 'ethereum');
    const balHex = null; // native ETH now comes from the Ethereum chain entry below
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
    const ethBalance = eth?.native.balance || 0;
    const portfolioUsd = chains.reduce((s, c) => s + (c.total_usd || 0), 0);
    const outboundTx = hexToNum(nonceHex);
    const known = KNOWN[addr];

    if (known) labels.push(`known: ${known}`);
    labels.push(isContract ? 'contract' : (delegated ? 'EIP-7702 delegated EOA' : 'EOA (externally-owned account)'));

    // --- token holdings (Alchemy), value-ranked + spam-filtered ---
    // Order matters: PRICE first (one cheap batched call), then fetch metadata only
    // for tokens that HAVE a price. A spam-flooded wallet can bury its few real tokens
    // beyond any fixed metadata cap, so we scan a wide balance set but only pay for
    // metadata on the real ones. An absent price is the spam signal.
    // Ethereum holdings come from the multi-chain scan above (kept as the primary
    // chain's `tokens` for the report's headline table).
    const tokens = eth?.tokens || [];
    const tokensHidden = eth?.tokens_hidden || 0;

    const stableHeld = tokens.some((t) => ['USDC', 'USDT', 'DAI', 'USDE', 'FRAX'].includes(t.symbol.toUpperCase()));
    if (stableHeld) labels.push('holds stablecoins');
    if (tokens.length >= 8) labels.push('diversified token holdings');

    // --- activity window + out-counterparties (Alchemy getAssetTransfers) ---
    // last_seen must reflect BOTH directions — a receive-only wallet has no outbound
    // transfer, so outbound alone would wrongly report it as never-active. Out query
    // is capped at 15 (also the counterparty set screened below — bounds RPC fan-out).
    let firstSeen: string | null = null;
    const counterparties = new Set<string>();
    const cpCount: Record<string, { count: number; out: number; in: number }> = {};
    let transactions: Array<{ ts: string; direction: 'in' | 'out'; asset: string; amount: number | null; counterparty: string | null; counterparty_label: string | null }> = [];

    const xfer = (params: any) => rpcCall(CHAIN_ID, 'alchemy_getAssetTransfers', [params]).catch(() => null);
    const [outT, inT, inFirst] = await Promise.all([
      xfer({ fromBlock: '0x0', toBlock: 'latest', fromAddress: addr, category: ['external', 'erc20'], order: 'desc', maxCount: '0x14', withMetadata: true }),
      xfer({ fromBlock: '0x0', toBlock: 'latest', toAddress: addr, category: ['external', 'erc20'], order: 'desc', maxCount: '0x14', withMetadata: true }),
      xfer({ fromBlock: '0x0', toBlock: 'latest', toAddress: addr, category: ['external', 'erc20'], order: 'asc', maxCount: '0x1', withMetadata: true }),
    ]);
    firstSeen = inFirst?.transfers?.[0]?.metadata?.blockTimestamp || null;

    const rows = [
      ...((outT?.transfers || []).map((t: any) => ({ t, direction: 'out' as const, cp: t?.to }))),
      ...((inT?.transfers || []).map((t: any) => ({ t, direction: 'in' as const, cp: t?.from }))),
    ].filter((r) => r.t?.metadata?.blockTimestamp)
      .sort((a, b) => Date.parse(b.t.metadata.blockTimestamp) - Date.parse(a.t.metadata.blockTimestamp));

    for (const r of rows) {
      const cp = r.cp && EVM.test(String(r.cp)) ? String(r.cp).toLowerCase() : null;
      if (!cp) continue;
      counterparties.add(cp);
      const e = (cpCount[cp] ||= { count: 0, out: 0, in: 0 });
      e.count++; r.direction === 'out' ? e.out++ : e.in++;
    }

    transactions = rows.slice(0, 15).map((r) => {
      const cp = r.cp && EVM.test(String(r.cp)) ? String(r.cp).toLowerCase() : null;
      const v = Number(r.t.value);
      const asset = r.t.asset || 'ETH';
      // Address-poisoning / spoof detection: scam tokens impersonate real ones with
      // non-ASCII homoglyphs (e.g. "ĖTḨ" for ETH) and dust an address to get their
      // lookalike into its history. Flag them so real activity isn't buried.
      const spoofed = /[^\x20-\x7E]/.test(asset);
      return {
        ts: r.t.metadata.blockTimestamp,
        direction: r.direction,
        asset,
        amount: Number.isFinite(v) ? v : null,
        counterparty: cp,
        counterparty_label: cp ? (KNOWN[cp] || null) : null,
        suspected_spam: spoofed,
      };
    });

    const topCounterparties = Object.entries(cpCount)
      .sort((a, b) => b[1].count - a[1].count).slice(0, 8)
      .map(([address, s]) => ({ address, count: s.count, sent_to: s.out, received_from: s.in, label: KNOWN[address] || null }));

    // Most recent activity in either direction (a receive-only wallet has no outbound).
    const lastSeen = rows[0]?.t?.metadata?.blockTimestamp || null;
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

    const activeChains = chains.filter((c) => c.total_usd > 0 || c.native.balance > 0);
    const who = ens ? `${ens} — ` : '';
    const portfolioStr = portfolioUsd > 0 ? ` Portfolio ≈ $${Math.round(portfolioUsd).toLocaleString()} across ${activeChains.length} chain(s).` : '';
    const summary = isContract
      ? `${who}Smart contract${known ? ` — ${known}` : ''}. ${outboundTx.toLocaleString()} outbound tx.${portfolioStr} Risk: ${level}.`
      : `${who}EOA${known ? ` (${known})` : ''} holding ${ethBalance.toFixed(4)} ETH${px ? ` (~$${Math.round(ethBalance * px).toLocaleString()})` : ''} on Ethereum, ${outboundTx.toLocaleString()} outbound tx${daysActive != null ? `, ~${daysActive}d old` : ''}.${portfolioStr} Risk: ${level}.`;

    return res.json({
      address: raw,
      ens,
      chain: 'ethereum',
      valid: true,
      type: isContract ? 'contract' : 'EOA',
      known_label: known || null,
      risk: { level, sanctioned: !!selfHit, screen: sanctionsScreen, tainted_counterparty: taintedCounterparty, reasons },
      native: { symbol: 'ETH', balance: ethBalance, usd: px ? ethBalance * px : null },
      portfolio_total_usd: portfolioUsd,
      // Per-chain breakdown — only chains where the address actually holds something.
      chains: chains.filter((c) => c.total_usd > 0 || c.native.balance > 0),
      activity: {
        outbound_tx: outboundTx,
        first_seen: firstSeen, last_seen: lastSeen,
        days_active: daysActive, dormant,
      },
      tokens,
      tokens_hidden: tokensHidden,
      transactions,
      counterparties: topCounterparties,
      labels,
      summary,
      disclaimer: 'Heuristic diligence on public on-chain data (EVM chains). Not investment or legal advice; labels are indicative, not definitive.',
      data_sources: ['Alchemy RPC + Prices (Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche)', 'OFAC SDN list + on-chain sanctions oracle', 'ENS (ensdata)', 'CoinGecko (native prices)'],
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[wallet-intel] lookup failed:', err instanceof Error ? err.message : String(err));
    return res.status(502).json({ error: 'Wallet lookup failed. Please try again.' });
  }
});

export default router;

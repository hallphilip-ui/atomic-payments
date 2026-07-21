import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { rpcCall } from './rpc';
import { screenAddressLocal, screenAddressOracleChecked, screenAddresses } from '../compliance/sanctions';
import { lookupLabel } from '../compliance/addressLabels';
import { arkhamLabel, arkhamConfigured } from '../compliance/arkhamLabels';

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

// Does a TRC-20 have a real price feed? The curated map above is only the majors, so
// absence from it means nothing — USDV is a legitimate stablecoin and was being libelled
// as spam. CoinGecko's tron contract endpoint is the actual authority. Free tier caps at
// ONE contract per call, hence the cache + the caller only asking about displayed rows.
// Returns null (= unknown, do NOT flag) when the lookup itself fails.
const tronPriceCache = new Map<string, boolean>();
async function tronTokenPriced(contract: string): Promise<boolean | null> {
  if (TRON_TOKENS[contract]) return true;
  if (tronPriceCache.has(contract)) return tronPriceCache.get(contract)!;
  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/tron?contract_addresses=${encodeURIComponent(contract)}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return null; // rate-limited or down → unknown, not spam
    const j: any = await r.json();
    if (j?.error_code) return null;
    const has = Object.keys(j || {}).length > 0;
    tronPriceCache.set(contract, has);
    return has;
  } catch { return null; }
}

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

// Well-known approval spenders. `allowance(owner,spender)` returns CURRENT state, so
// checking these covers ALL history for them — the gap is only unknown spenders,
// which the recent-window log scan below partially closes.
const SPENDERS: Record<string, string> = {
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'Uniswap V2 Router',
  '0xe592427a0aece92de3edee1f18e0157c05861564': 'Uniswap V3 Router',
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': 'Uniswap Universal Router',
  '0x000000000022d473030f116ddee9f6b43ac78ba3': 'Permit2',
  '0x1111111254eeb25477b68fb85ed929f73a960582': '1inch v5 Router',
  '0x111111125421ca6dc452d289314280a0f8842a65': '1inch v6 Router',
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': '0x Exchange Proxy',
  '0x00000000006c3852cbef3e08e8df289169ede581': 'Seaport (OpenSea)',
  '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110': 'CoW Protocol',
};
// Known funding sources — labelling the FIRST inbound sender is a strong provenance
// signal (funded from a regulated exchange reads very differently from a mixer).
// Best-effort labels; the raw address is always shown so it can be verified.
const FUNDERS: Record<string, string> = {
  '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance (hot wallet)',
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance (hot wallet)',
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': 'Binance (hot wallet)',
  '0x9696f59e4d72e237be84ffd425dcad154bf96976': 'Binance (hot wallet)',
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': 'Coinbase (hot wallet)',
  '0x503828976d22510aad0201ac7ec88293211d23da': 'Coinbase (hot wallet)',
  '0xddb108893104de4e1c6d0e47c42237db4e617acc': 'Coinbase (hot wallet)',
  '0x2910543af39aba0cd09dbb2d50200b3e800a63d2': 'Kraken (hot wallet)',
  '0xe853c56864a2ebe4576a807d26fdc4a0ada51919': 'Kraken (hot wallet)',
  '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': 'OKX (hot wallet)',
  '0x876eabf441b2ee5b5b0554fd502a8e0600950cfa': 'Bitfinex (hot wallet)',
};
// Curated maps first (highest confidence, hand-verified), then the ~33k refreshed
// corpus. Returns the display name; use labelInfo() when the tags/risk matter.
const labelFor = (a?: string | null): string | null => {
  if (!a) return null;
  const k = a.toLowerCase();
  return KNOWN[k] || SPENDERS[k] || FUNDERS[k] || lookupLabel(k)?.name || null;
};
const labelInfo = (a?: string | null): { name: string | null; tags: string[]; scam: boolean } => {
  if (!a) return { name: null, tags: [], scam: false };
  const k = a.toLowerCase();
  const curated = KNOWN[k] || SPENDERS[k] || FUNDERS[k] || null;
  const corpus = lookupLabel(k);
  return {
    name: curated || corpus?.name || null,
    tags: corpus?.tags || [],
    scam: corpus?.risk === 'scam',
  };
};

const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

// Outstanding ERC-20 approvals — a real, under-appreciated risk surface: an unlimited
// allowance lets that contract move the token at any time, indefinitely.
//
// SCOPE, and why it is what it is: discovering approvals to ARBITRARY spenders needs
// an Approval-event log scan, and eth_getLogs is unavailable on our RPC access (the
// paid upstream rejects it; the public fallback refuses archive queries). What DOES
// work is `allowance(owner, spender)`, which returns CURRENT state — so for every
// spender we can name, coverage is complete and all-time. The unavoidable gap is
// approvals to contracts outside that list. The response states this plainly rather
// than implying a clean bill of health we can't actually give.
async function tokenApprovals(addr: string, tokens: Array<{ contract: string; symbol: string }>) {
  const owner32 = addr.slice(2).toLowerCase().padStart(64, '0');
  const top = tokens.slice(0, 8);
  const spenderList = Object.keys(SPENDERS);
  const baseScope = `Checked ${spenderList.length} well-known spenders against the top ${top.length} held token(s) on Ethereum. Coverage for those spenders is complete (current on-chain allowance, any age). Approvals to contracts outside this list are NOT detected — this is not an exhaustive approval audit.`;
  if (!top.length) {
    return { approvals: [], unlimited_count: 0, checked_spenders: spenderList.length, scope: 'No priced tokens held on Ethereum, so there was nothing to check.' };
  }

  const approvals: Array<{ token: string; token_contract: string; spender: string; spender_label: string | null; unlimited: boolean }> = [];
  await Promise.all(top.map(async (t) =>
    Promise.all(spenderList.map(async (sp) => {
      try {
        const data = '0xdd62ed3e' + owner32 + sp.slice(2).toLowerCase().padStart(64, '0');
        const res = await rpcCall(CHAIN_ID, 'eth_call', [{ to: t.contract, data }, 'latest']);
        if (!res || res === '0x') return;
        const v = BigInt(res);
        if (v === 0n) return;
        approvals.push({
          token: t.symbol, token_contract: t.contract, spender: sp,
          spender_label: SPENDERS[sp] || null, unlimited: v >= 2n ** 255n,
        });
      } catch { /* per-pair best-effort */ }
    })),
  ));

  approvals.sort((a, b) => Number(b.unlimited) - Number(a.unlimited));
  return {
    approvals: approvals.slice(0, 20),
    unlimited_count: approvals.filter((a) => a.unlimited).length,
    checked_spenders: spenderList.length,
    scope: baseScope,
  };
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

  // --- TRC-20 transfer history, counterparties and net flow -------------------
  // Tron previously reported holdings but no activity, so a treasury wallet and an
  // exchange hot wallet looked identical. Transfer count + flow direction is what
  // actually distinguishes them (an exchange churns constantly; a treasury receives
  // lumpy deposits and barely spends).
  let trTransfers: any[] = [];
  try {
    const r = await fetch(`https://api.trongrid.io/v1/accounts/${raw}/transactions/trc20?limit=200`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    trTransfers = ((await r.json()) as any)?.data || [];
  } catch { /* history best-effort */ }

  const trRows = trTransfers
    .filter((t: any) => t?.block_timestamp && (t.from || t.to))
    .sort((a: any, b: any) => b.block_timestamp - a.block_timestamp);

  const trCp: Record<string, { count: number; out: number; in: number }> = {};
  for (const t of trRows) {
    const out = t.from === raw;
    const cp = out ? t.to : t.from;
    if (!cp || !TRON.test(String(cp))) continue;
    const e = (trCp[cp] ||= { count: 0, out: 0, in: 0 });
    e.count++; out ? e.out++ : e.in++;
  }

  const trShown = trRows.slice(0, 15);

  // Price-feed lookup for the distinct non-major contracts on show. Sequential because
  // the free tier is one-contract-per-call; in practice this is 1-4 requests.
  const trPriced = new Map<string, boolean | null>();
  for (const c of [...new Set(trShown.map((t: any) => String(t?.token_info?.address || '')).filter(Boolean))] as string[]) {
    trPriced.set(c, await tronTokenPriced(c));
  }

  const trTransactions = trShown.map((t: any) => {
    const info = t.token_info || {};
    const dec = Number.isFinite(Number(info.decimals)) ? Number(info.decimals) : 6;
    let amount: number | null = null;
    try { amount = Number(BigInt(t.value)) / 10 ** dec; } catch { /* keep null */ }
    const sym = String(info.symbol || '?');
    // Spam detection, most→least certain. Symbol-pattern bait is high confidence. The
    // price-feed check is weaker but real: `false` means CoinGecko has no market for the
    // contract. `null` = lookup failed → left unflagged rather than guessed at.
    const contract = String(info.address || '');
    const spamReason =
      /[^\x20-\x7E]/.test(sym) ? 'non-ASCII symbol impersonating a real ticker'
      : /\.[a-z]{2,}$/i.test(sym) ? 'domain-name symbol (bait to visit a site)'
      : (trPriced.get(contract) === false) ? 'unrecognised token — no price feed'
      : null;
    const spoofed = !!spamReason;
    return {
      ts: new Date(Number(t.block_timestamp)).toISOString(),
      chain: 'Tron',
      direction: (t.from === raw ? 'out' : 'in') as 'in' | 'out',
      asset: sym,
      amount,
      counterparty: t.from === raw ? (t.to || null) : (t.from || null),
      counterparty_label: null, // the label corpus is EVM-only; Tron is unlabelled
      suspected_spam: spoofed,
      spam_reason: spamReason,
    };
  });

  const trCounterparties = Object.entries(trCp)
    .sort((a, b) => b[1].count - a[1].count).slice(0, 8)
    .map(([address, s]) => ({ address, count: s.count, sent_to: s.out, received_from: s.in, label: null, tags: [], scam: false }));

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

  // Net flow for the DOMINANT held token (top by USD, so it's the money that matters).
  // Doubles as an integrity check: in − out should reconcile to the reported balance.
  // Accumulation with near-zero spend = treasury/custody; heavy churn = exchange.
  let flow: { asset: string; in: number; out: number; net: number; transfers: number; reconciles: boolean } | null = null;
  const dom = tokens[0];
  if (dom && TRON_TOKENS[dom.contract]) {
    const meta = TRON_TOKENS[dom.contract];
    let fin = 0, fout = 0, n = 0;
    for (const t of trRows) {
      if (String((t.token_info || {}).address) !== dom.contract) continue;
      let v = 0;
      try { v = Number(BigInt(t.value)) / 10 ** meta.dec; } catch { continue; }
      n++; t.from === raw ? (fout += v) : (fin += v);
    }
    if (n) {
      const net = fin - fout;
      flow = {
        asset: meta.sym, in: fin, out: fout, net, transfers: n,
        // Within 0.01 of the on-chain balance => the visible history explains the
        // whole balance (no funds arrived outside the window we can see).
        reconciles: Math.abs(net - dom.amount) < 0.01,
      };
    }
  }

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

  // Behavioural read from the flow: lumpy inflow with almost no spend is a
  // treasury/custody pattern; constant two-way churn is an exchange/operational one.
  if (flow) {
    labels.push(`${flow.transfers} ${flow.asset} transfer(s)`);
    if (flow.in > 0 && flow.out / Math.max(flow.in, 1) < 0.1) {
      labels.push('accumulation pattern (inflow ≫ outflow)');
    }
    if (flow.transfers < 50 && (dom?.usd || 0) > 1_000_000) {
      labels.push('low transaction count for size — treasury/custody profile, not an exchange hot wallet');
    }
  }

  const flowStr = flow
    ? ` ${flow.asset} flow: ${Math.round(flow.in).toLocaleString()} in / ${Math.round(flow.out).toLocaleString()} out across ${flow.transfers} transfer(s)${flow.reconciles ? ' (reconciles to balance)' : ''}.`
    : '';
  const summary = `Tron account holding ${balTrx.toLocaleString(undefined, { maximumFractionDigits: 2 })} TRX${trxUsd ? ` (~$${Math.round(balTrx * trxUsd).toLocaleString()})` : ''} and ${tokens.length} priced token(s)${daysActive != null ? `, ~${daysActive}d old` : ''}.${flowStr} Risk: ${level}.`;

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
    transactions: trTransactions,
    counterparties: trCounterparties,
    flow,
    labels_note: 'Tron counterparties are unlabelled — the address-label corpus covers EVM chains only. An unnamed Tron address means "no label available", not "unknown/suspicious".',
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
    const selfLabel = labelInfo(addr);
    // Arkham attribution, layered above the free corpus. Fails open: null → corpus name.
    // Arkham wins when present because it resolves live entities (which exchange, hot vs
    // deposit wallet, named individual) the corpus can't — exactly the deposit-address gap.
    const selfArkham = await arkhamLabel(addr).catch(() => null);
    const known = selfArkham?.display || selfLabel.name;

    if (known) labels.push(`known: ${known}${selfArkham ? ' (Arkham)' : ''}`);
    if (selfArkham?.entity_type) labels.push(selfArkham.entity_type);
    for (const t of selfLabel.tags.slice(0, 3)) labels.push(t);
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

    // Activity is gathered across EVERY EVM chain, not just Ethereum — a wallet that
    // lives on Base would otherwise look inactive. Categories include `internal`
    // (contract-mediated ETH moves) and NFTs, so contract-driven wallets aren't
    // invisible; `internal` isn't supported on every chain, hence the fallback.
    const catsFor = (id: number) => id === 1
      ? ['external', 'internal', 'erc20', 'erc721', 'erc1155']
      : ['external', 'erc20', 'erc721', 'erc1155'];

    async function xferOn(chainId: number, params: any) {
      try {
        return await rpcCall(chainId, 'alchemy_getAssetTransfers', [{ ...params, category: catsFor(chainId) }]);
      } catch {
        // Retry with the narrowest category set a chain is guaranteed to support.
        try {
          return await rpcCall(chainId, 'alchemy_getAssetTransfers', [{ ...params, category: ['external', 'erc20'] }]);
        } catch { return null; }
      }
    }

    const perChain = await Promise.all(EVM_CHAINS.map(async (c) => {
      const base = { fromBlock: '0x0', toBlock: 'latest', withMetadata: true };
      const [o, i, f] = await Promise.all([
        xferOn(c.id, { ...base, fromAddress: addr, order: 'desc', maxCount: '0x0a' }),
        xferOn(c.id, { ...base, toAddress: addr, order: 'desc', maxCount: '0x0a' }),
        xferOn(c.id, { ...base, toAddress: addr, order: 'asc', maxCount: '0x1' }),
      ]);
      return { chain: c, outs: o?.transfers || [], ins: i?.transfers || [], first: f?.transfers?.[0] || null };
    }));

    // Earliest inbound across ALL chains = true wallet birth + funding provenance.
    const firstCandidates = perChain
      .map((p) => ({ chain: p.chain, t: p.first }))
      .filter((x) => x.t?.metadata?.blockTimestamp)
      .sort((a, b) => Date.parse(a.t.metadata.blockTimestamp) - Date.parse(b.t.metadata.blockTimestamp));
    const earliest = firstCandidates[0] || null;
    firstSeen = earliest?.t?.metadata?.blockTimestamp || null;

    // Funding provenance — who sent that first inbound transfer, and on which chain.
    const funder0 = earliest?.t;
    const funderAddr = funder0?.from && EVM.test(String(funder0.from)) ? String(funder0.from).toLowerCase() : null;
    // Funder attribution: Arkham first (names the exchange/deposit wallet — the whole
    // point of adding it), corpus as fallback. `label_source` says which answered.
    const funderArkham = funderAddr ? await arkhamLabel(funderAddr).catch(() => null) : null;
    const fundedBy = funderAddr ? {
      address: funderAddr,
      label: funderArkham?.display || labelFor(funderAddr),
      label_source: funderArkham ? 'arkham' : (labelFor(funderAddr) ? 'corpus' : null),
      entity_type: funderArkham?.entity_type || null,
      asset: funder0?.asset || earliest?.chain.sym || 'ETH',
      amount: Number.isFinite(Number(funder0?.value)) ? Number(funder0.value) : null,
      at: firstSeen,
      chain: earliest?.chain.name || null,
    } : null;

    const rows = perChain.flatMap((p) => [
      ...p.outs.map((t: any) => ({ t, direction: 'out' as const, cp: t?.to, chain: p.chain })),
      ...p.ins.map((t: any) => ({ t, direction: 'in' as const, cp: t?.from, chain: p.chain })),
    ]).filter((r) => r.t?.metadata?.blockTimestamp)
      .sort((a, b) => Date.parse(b.t.metadata.blockTimestamp) - Date.parse(a.t.metadata.blockTimestamp));

    for (const r of rows) {
      const cp = r.cp && EVM.test(String(r.cp)) ? String(r.cp).toLowerCase() : null;
      if (!cp) continue;
      counterparties.add(cp);
      const e = (cpCount[cp] ||= { count: 0, out: 0, in: 0 });
      e.count++; r.direction === 'out' ? e.out++ : e.in++;
    }

    const shown = rows.slice(0, 15);

    // Symbol patterns only catch bait that *looks* fake. Plain-ASCII scam tokens
    // ("DDYS") need a second signal: no price feed anywhere = worthless airdrop.
    // Priced per chain over the displayed rows only, and a chain whose price call
    // FAILED is left unchecked — a dead lookup must not manufacture spam flags.
    const priced = new Set<string>();
    const checked = new Set<string>();
    await Promise.all(EVM_CHAINS.map(async (c) => {
      const cs = shown.filter((r) => r.chain.id === c.id)
        .map((r) => String(r.t?.rawContract?.address || ''))
        .filter((a) => EVM.test(a)).map((a) => a.toLowerCase());
      if (!cs.length) return;
      const { prices, ok } = await tokenPrices(c.net, cs);
      if (!ok) return;
      cs.forEach((a) => checked.add(`${c.id}:${a}`));
      Object.keys(prices).forEach((a) => priced.add(`${c.id}:${a.toLowerCase()}`));
    }));

    transactions = shown.map((r) => {
      const cp = r.cp && EVM.test(String(r.cp)) ? String(r.cp).toLowerCase() : null;
      const v = Number(r.t.value);
      const asset = r.t.asset || 'ETH';
      // Address-poisoning / spoof detection: scam tokens impersonate real ones with
      // non-ASCII homoglyphs (e.g. "ĖTḨ" for ETH) or advertise a site in the symbol,
      // then dust an address to get into its history. Flag so real flow isn't buried.
      const contract = String(r.t?.rawContract?.address || '').toLowerCase();
      const ck = `${r.chain.id}:${contract}`;
      const spamReason =
        /[^\x20-\x7E]/.test(asset) ? 'non-ASCII symbol impersonating a real ticker'
        : /\.[a-z]{2,}$/i.test(asset) ? 'domain-name symbol (bait to visit a site)'
        : (checked.has(ck) && !priced.has(ck)) ? 'unrecognised token — no price feed'
        : null;
      const spoofed = !!spamReason;
      return {
        ts: r.t.metadata.blockTimestamp,
        chain: r.chain.name,
        direction: r.direction,
        asset,
        amount: Number.isFinite(v) ? v : null,
        counterparty: cp,
        counterparty_label: labelFor(cp),
        suspected_spam: spoofed,
        spam_reason: spamReason,
      };
    });

    const topCounterparties = Object.entries(cpCount)
      .sort((a, b) => b[1].count - a[1].count).slice(0, 8)
      .map(([address, s]) => {
        const li = labelInfo(address);
        return { address, count: s.count, sent_to: s.out, received_from: s.in, label: li.name, tags: li.tags, scam: li.scam };
      });

    // Scam/drainer counterparties — the highest-value signal the label corpus adds.
    // Screened across EVERY counterparty seen, not just the top 8 shown.
    const scamCounterparties = [...counterparties]
      .map((a) => ({ address: a, info: labelInfo(a) }))
      .filter((x) => x.info.scam)
      .slice(0, 10)
      .map((x) => ({ address: x.address, label: x.info.name }));

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

    // --- outstanding token approvals (risk surface) ---
    const approvalsRes = await tokenApprovals(addr, tokens)
      .catch(() => ({ approvals: [] as any[], unlimited_count: 0, checked_spenders: 0, scope: 'Approval check unavailable this run.' }));
    // Informational, not a risk verdict: an unlimited approval to a mainstream router
    // is normal DeFi hygiene-debt, not evidence of compromise. And since we cannot see
    // approvals to unlisted contracts, absence here is NOT proof of none.
    if (approvalsRes.unlimited_count) {
      labels.push(`${approvalsRes.unlimited_count} unlimited approval(s) to known spenders`);
    }

    // --- counterparty taint screen (reuses the batch OFAC/oracle screener) ---
    let taintedCounterparty: string | null = null;
    if (counterparties.size) {
      const hit = await screenAddresses([...counterparties]).catch(() => null);
      if (hit) taintedCounterparty = hit.matchedAddress || 'a screened address';
    }

    // --- risk verdict: composite, not first-match-wins ---
    //
    // The previous logic was an escalating if/else: the first matching condition set the
    // level and the rest were never evaluated. So a sanctioned address never reported
    // that it ALSO had scam counterparties or unlimited approvals — real signals were
    // masked by a higher one. This accumulates EVERY triggered factor independently and
    // derives the headline level from the most severe, so the full picture is shown.
    // Each factor carries its own severity, so the UI can render the breakdown, not just
    // a single word. Deliberately NOT a 0-100 score — that would imply precision we do
    // not have. A transparent factor list is more honest than a fabricated number.
    type Sev = 'critical' | 'high' | 'caution' | 'info';
    const factors: Array<{ signal: string; severity: Sev; detail: string }> = [];
    const addFactor = (severity: Sev, signal: string, detail: string) => factors.push({ severity, signal, detail });

    if (selfHit) {
      addFactor('critical', 'sanctioned', `On a sanctions list (${selfHit.source}). Do not transact.`);
      labels.push('SANCTIONED');
    }
    if (selfLabel.scam) {
      addFactor('critical', 'reported-scam', `On a public scam/phishing blacklist${selfLabel.name ? ` — "${selfLabel.name}"` : ''}. Do not send funds to it.`);
      labels.push('REPORTED SCAM ADDRESS');
    }
    if (taintedCounterparty) {
      addFactor('high', 'tainted-counterparty', `Sent funds to a sanctioned/flagged address (${taintedCounterparty.slice(0, 10)}…). Possible taint.`);
    }
    if (scamCounterparties.length) {
      addFactor('high', 'scam-counterparties', `Interacted with ${scamCounterparties.length} address(es) on a public scam/phishing blacklist (e.g. ${scamCounterparties[0].address.slice(0, 10)}…) — possible drainer exposure or a compromised wallet.`);
    }
    // Funding provenance — a mixer/scam-funded wallet is a distinct signal the old
    // verdict ignored entirely.
    const funderInfo = fundedBy ? labelInfo(fundedBy.address) : { name: null as string | null, tags: [] as string[], scam: false };
    const funderMixer = funderInfo.tags.some((t) => /mixer|tornado|sanction/i.test(t));
    if (fundedBy && (funderInfo.scam || funderMixer)) {
      addFactor('high', 'tainted-funding', `First funded by ${funderInfo.name || fundedBy.address.slice(0, 10) + '…'}${funderMixer ? ' (mixer/sanctioned source)' : ' (blacklisted source)'} — provenance is tainted at origin.`);
    }
    // Unlimited approvals: a real surface, but ONLY to UNLABELLED spenders. Approvals to
    // a known mainstream router are DeFi hygiene-debt, not evidence of compromise — the
    // report already says so, and inflating the verdict for them would cry wolf.
    const unlabelledUnlimited = (approvalsRes.approvals || []).filter((a: any) => a.unlimited && !a.spender_label).length;
    if (unlabelledUnlimited) {
      addFactor('caution', 'unlimited-approvals', `${unlabelledUnlimited} unlimited approval(s) to UNLABELLED contracts — each can move that token without further consent. Consider revoking.`);
    }
    if (fresh && (ethBalance > 5 || stableHeld)) {
      addFactor('caution', 'fresh-funded', 'Newly created and already holding meaningful value — verify provenance before trusting.');
    }

    const sevRank: Record<Sev, number> = { info: 0, caution: 1, high: 2, critical: 3 };
    const worst = factors.reduce((m, f) => Math.max(m, sevRank[f.severity]), 0);
    let level: 'clean' | 'caution' | 'high' | 'critical' =
      worst === 3 ? 'critical' : worst === 2 ? 'high' : worst === 1 ? 'caution' : 'clean';
    // Keep `reasons` populated from the factors so existing consumers keep working.
    factors.filter((f) => f.severity !== 'info').forEach((f) => reasons.push(f.detail));
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
      known_source: selfArkham ? 'arkham' : (selfLabel.name ? 'corpus' : null),
      attribution_provider: arkhamConfigured() ? 'arkham+corpus' : 'corpus',
      risk: { level, sanctioned: !!selfHit, screen: sanctionsScreen, tainted_counterparty: taintedCounterparty, reasons, factors },
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
      scam_counterparties: scamCounterparties,
      labels_note: 'Address labels come from public corpora (Etherscan nametags, ScamSniffer, MEW darklist). They cover exchange HOT wallets, not the per-user DEPOSIT addresses exchanges generate — so an unlabelled counterparty is "not in the corpus", not "not an exchange".',
      funded_by: fundedBy,
      approvals: approvalsRes.approvals,
      approvals_unlimited: approvalsRes.unlimited_count,
      approvals_checked_spenders: approvalsRes.checked_spenders,
      approvals_scope: approvalsRes.scope,
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

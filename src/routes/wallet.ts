import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getLifiAsset, getSwapAsset, listSwapAssets } from '../cryptoCore/tokens';
import { rpcCall } from './rpc';

const router = Router();

// Wallet balances + USD prices.
//
// Token contract addresses are NOT hard-coded here. They're resolved from LI.FI's
// token API — the same source that routes the swap — so the address we read a
// balance from is always the address the swap will actually spend. LI.FI also
// returns priceUSD, which powers the fiat/crypto amount toggle. If an asset isn't
// certified for live routing, we fail closed (supported:false) rather than guess.

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; data: LifiToken | null }>();
type LifiToken = { chainId: number; address: string; symbol: string; decimals: number; priceUSD: number | null; logoURI: string | null };

const clip = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NATIVE_ADDRESS = /^0x0{40}$/i; // LI.FI reports native assets as the zero address

const limiter = rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => { const cf = req.headers['cf-connecting-ip']; return typeof cf === 'string' && cf.length ? cf : req.ip || 'unknown'; }
});

async function lifiToken(assetId: string): Promise<LifiToken | null> {
  const mapped = getLifiAsset(assetId);
  if (!mapped) return null;
  const key = assetId.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  let data: LifiToken | null = null;
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    const apiKey = process.env.ATOMIC_LIFI_API_KEY;
    if (apiKey) headers['x-lifi-api-key'] = apiKey;
    const r = await fetch(
      `https://li.quest/v1/token?chain=${encodeURIComponent(mapped.chain)}&token=${encodeURIComponent(mapped.token)}`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (r.ok) {
      const d: any = await r.json();
      const price = Number(d.priceUSD);
      data = {
        chainId: Number(d.chainId), address: String(d.address || ''), symbol: String(d.symbol || mapped.token),
        decimals: Number(d.decimals), priceUSD: Number.isFinite(price) && price > 0 ? price : null,
        logoURI: d.logoURI ? String(d.logoURI) : null
      };
    }
  } catch { /* fall through to null */ }
  cache.set(key, { at: Date.now(), data });
  return data;
}

// BigInt -> fixed decimal string, no float rounding.
function formatUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const s = (neg ? -raw : raw).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, '') : '';
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

// USD price for an asset (drives the fiat <-> crypto amount toggle).
router.get('/v1/wallet/price', limiter, async (req, res) => {
  const assetId = clip(req.query.assetId, 64);
  const asset = getSwapAsset(assetId);
  if (!asset) return res.status(400).json({ error: 'Unknown asset.' });
  const t = await lifiToken(assetId);
  if (!t) return res.json({ symbol: asset.symbol, priceUSD: null, reason: 'Asset not certified for live routing.' });
  return res.json({ symbol: t.symbol, priceUSD: t.priceUSD, decimals: t.decimals });
});

// Core EVM balance read for one asset. Returns null if unreadable/unsupported.
async function readEvmBalance(assetId: string, address: string) {
  const asset = getSwapAsset(assetId);
  if (!asset || asset.chainFamily !== 'evm') return null;
  const t = await lifiToken(assetId);
  if (!t || !t.address) return null;
  let raw: string;
  if (NATIVE_ADDRESS.test(t.address)) {
    raw = await rpcCall(t.chainId, 'eth_getBalance', [address, 'latest']);
  } else {
    const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0'); // balanceOf(address)
    raw = await rpcCall(t.chainId, 'eth_call', [{ to: t.address, data }, 'latest']);
  }
  const value = BigInt(raw && raw !== '0x' ? raw : '0x0');
  const formatted = formatUnits(value, t.decimals);
  const usdValue = t.priceUSD !== null ? Number(formatted) * t.priceUSD : null;
  return { assetId, symbol: t.symbol, chain: asset.chain, chainId: t.chainId, raw: value.toString(), formatted, decimals: t.decimals, priceUSD: t.priceUSD, usdValue, logoURI: t.logoURI };
}

// On-chain balance of `address` for one `assetId`. EVM only.
router.get('/v1/wallet/balance', limiter, async (req, res) => {
  const assetId = clip(req.query.assetId, 64);
  const address = clip(req.query.address, 64);
  const asset = getSwapAsset(assetId);
  if (!asset) return res.status(400).json({ error: 'Unknown asset.' });
  if (!EVM_ADDRESS.test(address)) return res.status(400).json({ error: 'Valid EVM address required.' });
  if (asset.chainFamily !== 'evm') return res.json({ supported: false, reason: `Balance display isn't available for ${asset.symbol} yet.` });
  try {
    const b = await readEvmBalance(assetId, address);
    if (!b) return res.json({ supported: false, reason: 'Asset not certified for live routing.' });
    return res.json({ supported: true, ...b });
  } catch {
    return res.status(502).json({ error: 'Could not read balance from the network.' });
  }
});

// Bitcoin balance for a BTC address (native Bitcoin wallets: Unisat/Xverse/Leather).
// EVM wallets can't expose a BTC address, so this only applies when a BTC wallet
// is connected. Uses public block explorers (no key); mempool.space then blockstream.
const BTC_ADDRESS = /^(bc1[a-z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{25,62})$/;
async function btcSats(address: string): Promise<bigint> {
  const sources = [`https://mempool.space/api/address/${address}`, `https://blockstream.info/api/address/${address}`];
  for (const url of sources) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const d: any = await r.json();
      const cs = d.chain_stats || {};
      return BigInt(cs.funded_txo_sum || 0) - BigInt(cs.spent_txo_sum || 0);
    } catch { /* try next source */ }
  }
  throw new Error('No BTC explorer available');
}

router.get('/v1/wallet/btc-balance', limiter, async (req, res) => {
  const address = clip(req.query.address, 128);
  if (!BTC_ADDRESS.test(address)) return res.status(400).json({ error: 'Valid Bitcoin address required.' });
  try {
    const sats = await btcSats(address);
    const formatted = formatUnits(sats, 8);
    const t = await lifiToken('BITCOIN.BTC');
    const priceUSD = t?.priceUSD ?? null;
    const usdValue = priceUSD !== null ? Number(formatted) * priceUSD : null;
    return res.json({ supported: true, assetId: 'BITCOIN.BTC', symbol: 'BTC', chain: 'BITCOIN', raw: sats.toString(), formatted, decimals: 8, priceUSD, usdValue, logoURI: t?.logoURI ?? null });
  } catch {
    return res.status(502).json({ error: 'Could not read BTC balance.' });
  }
});

// Portfolio: scan the wallet across every supported EVM asset/chain and return
// what it actually holds (non-zero), sorted by USD value. Wallet-first UX — the
// user connects and sees their real holdings instead of guessing an asset.
router.get('/v1/wallet/portfolio', limiter, async (req, res) => {
  const address = clip(req.query.address, 64);
  if (!EVM_ADDRESS.test(address)) return res.status(400).json({ error: 'Valid EVM address required.' });
  const evmAssets = listSwapAssets().filter((a) => a.chainFamily === 'evm' && getLifiAsset(a.assetId));
  const results = await Promise.all(evmAssets.map(async (a) => {
    try { return await readEvmBalance(a.assetId, address); } catch { return null; }
  }));
  const holdings = results
    .filter((b): b is NonNullable<typeof b> => !!b && b.raw !== '0')
    .sort((x, y) => (y.usdValue ?? 0) - (x.usdValue ?? 0));
  const totalUsd = holdings.reduce((s, h) => s + (h.usdValue ?? 0), 0);
  return res.json({ address, holdings, totalUsd, scanned: evmAssets.length });
});

export default router;

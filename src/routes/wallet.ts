import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getLifiAsset, getSwapAsset } from '../cryptoCore/tokens';
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
type LifiToken = { chainId: number; address: string; symbol: string; decimals: number; priceUSD: number | null };

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
        decimals: Number(d.decimals), priceUSD: Number.isFinite(price) && price > 0 ? price : null
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

// On-chain balance of `address` for `assetId`. EVM only (that's what our
// browser wallets can actually spend today).
router.get('/v1/wallet/balance', limiter, async (req, res) => {
  const assetId = clip(req.query.assetId, 64);
  const address = clip(req.query.address, 64);
  const asset = getSwapAsset(assetId);
  if (!asset) return res.status(400).json({ error: 'Unknown asset.' });
  if (!EVM_ADDRESS.test(address)) return res.status(400).json({ error: 'Valid EVM address required.' });
  if (asset.chainFamily !== 'evm') {
    return res.json({ supported: false, reason: `Balance display isn't available for ${asset.symbol} yet.` });
  }
  const t = await lifiToken(assetId);
  if (!t || !t.address) return res.json({ supported: false, reason: 'Asset not certified for live routing.' });

  try {
    let raw: string;
    if (NATIVE_ADDRESS.test(t.address)) {
      raw = await rpcCall(t.chainId, 'eth_getBalance', [address, 'latest']);
    } else {
      // ERC-20 balanceOf(address) — selector 0x70a08231 + 32-byte padded address
      const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
      raw = await rpcCall(t.chainId, 'eth_call', [{ to: t.address, data }, 'latest']);
    }
    const value = BigInt(raw && raw !== '0x' ? raw : '0x0');
    const formatted = formatUnits(value, t.decimals);
    const usdValue = t.priceUSD !== null ? Number(formatted) * t.priceUSD : null;
    return res.json({
      supported: true, raw: value.toString(), formatted, symbol: t.symbol,
      decimals: t.decimals, priceUSD: t.priceUSD, usdValue, chainId: t.chainId
    });
  } catch {
    return res.status(502).json({ error: 'Could not read balance from the network.' });
  }
});

export default router;

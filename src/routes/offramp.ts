// Fiat off-ramp partner integration. The merchant sells USDC-on-Base to a licensed
// partner that runs KYC, custodies only during conversion, and pays fiat to their
// bank/card — Atomic never touches funds. Partner API keys live ONLY here (env);
// publishable keys go into the redirect URL (they're public by design), but SECRETS
// (MoonPay, Mercuryo) never leave the server — they only sign the URL server-side.
//
// To go live, set the env vars below with your partner credentials and redeploy.
// Until a provider's key is set, its button hands off to the provider's public page.
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

const router = Router();

const EVM = /^0x[0-9a-fA-F]{40}$/;
const FIAT = /^[A-Z]{3}$/;

// -------- Partner credentials (env). Publishable key = safe in the URL; *_SECRET
// is used only to sign server-side and is never returned to the client. --------
function cfg() {
  return {
    moonpay:  { key: process.env.ATOMIC_OFFRAMP_MOONPAY_KEY || '',   secret: process.env.ATOMIC_OFFRAMP_MOONPAY_SECRET || '' },
    transak:  { key: process.env.ATOMIC_OFFRAMP_TRANSAK_KEY || '' },
    ramp:     { key: process.env.ATOMIC_OFFRAMP_RAMP_KEY || '' },
    banxa:    { subdomain: process.env.ATOMIC_OFFRAMP_BANXA_SUBDOMAIN || '' },
    mercuryo: { widget: process.env.ATOMIC_OFFRAMP_MERCURYO_WIDGET_ID || '', secret: process.env.ATOMIC_OFFRAMP_MERCURYO_SECRET || '' },
    kado:     { key: process.env.ATOMIC_OFFRAMP_KADO_KEY || '' },
    unlimit:  { key: process.env.ATOMIC_OFFRAMP_UNLIMIT_KEY || '' }
  };
}

const HOMES: Record<string, string> = {
  moonpay: 'https://www.moonpay.com/sell', transak: 'https://transak.com/', ramp: 'https://ramp.network/',
  banxa: 'https://banxa.com/', mercuryo: 'https://mercuryo.io/', kado: 'https://www.kado.money/',
  unlimit: 'https://www.unlimit.com/crypto/', coinbase: 'https://www.coinbase.com/'
};

// ---- Sandbox toggle -------------------------------------------------------
// ATOMIC_OFFRAMP_ENV=sandbox points every provider at its STAGING host, so you can
// validate the whole cash-out flow with test keys before any KYB completes. Providers
// do move these hosts, so any base can be pinned with ATOMIC_OFFRAMP_<ID>_BASE
// (e.g. ATOMIC_OFFRAMP_TRANSAK_BASE=https://global-stg.transak.com).
// A provider with NO known sandbox host stays offline in sandbox rather than sending
// test keys at production — a silent prod hit with a test key fails confusingly.
export const OFFRAMP_ENV: 'production' | 'sandbox' =
  (process.env.ATOMIC_OFFRAMP_ENV || 'production').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production';

const BASES: Record<string, { production: string; sandbox: string | null }> = {
  moonpay:  { production: 'https://sell.moonpay.com',     sandbox: 'https://sell-sandbox.moonpay.com' },
  transak:  { production: 'https://global.transak.com',   sandbox: 'https://global-stg.transak.com' },
  ramp:     { production: 'https://app.ramp.network',     sandbox: 'https://app.demo.ramp.network' },
  mercuryo: { production: 'https://exchange.mercuryo.io', sandbox: 'https://sandbox-exchange.mrcr.io' },
  kado:     { production: 'https://app.kado.money',       sandbox: null },
  unlimit:  { production: 'https://crypto.unlimit.com',   sandbox: null }
};

// Resolve a provider's base URL for the active env (env override wins). null = the
// provider can't be used in this env.
function baseUrl(id: string): string | null {
  const override = process.env['ATOMIC_OFFRAMP_' + id.toUpperCase() + '_BASE'];
  if (override) return override.replace(/\/+$/, '');
  if (id === 'banxa') {
    const sub = cfg().banxa.subdomain;
    if (!sub) return null;
    return 'https://' + sub + (OFFRAMP_ENV === 'sandbox' ? '.banxa-sandbox.com' : '.banxa.com');
  }
  const b = BASES[id];
  if (!b) return null;
  return OFFRAMP_ENV === 'sandbox' ? b.sandbox : b.production;
}

// A provider is "live" only when it has BOTH a credential and a usable host for the
// active env. Coinbase needs a session token exchanged server-side (separate
// integration), so it's never auto-"live" here.
function configuredMap() {
  const c = cfg();
  const hasKey: Record<string, boolean> = {
    moonpay: !!c.moonpay.key, transak: !!c.transak.key, ramp: !!c.ramp.key,
    banxa: !!c.banxa.subdomain, mercuryo: !!c.mercuryo.widget, kado: !!c.kado.key,
    unlimit: !!c.unlimit.key, coinbase: false
  };
  const out: Record<string, boolean> = {};
  Object.keys(hasKey).forEach((id) => { out[id] = hasKey[id] && !!baseUrl(id); });
  return out;
}

type Ctx = { address: string; amount: string; fiat: string };

// Build the prefilled, sell/off-ramp deep link for a provider (USDC on Base ->
// the merchant's chosen fiat). Returns null when the provider isn't configured.
function build(provider: string, ctx: Ctx): string | null {
  const c = cfg();
  const amt = /^[0-9]+(\.[0-9]+)?$/.test(ctx.amount) ? ctx.amount : '';
  const host = baseUrl(provider);
  if (!host) return null;   // no usable host for this env (e.g. no sandbox equivalent)
  switch (provider) {
    case 'moonpay': {
      if (!c.moonpay.key) return null;
      const p = new URLSearchParams({ apiKey: c.moonpay.key, baseCurrencyCode: 'usdc', quoteCurrencyCode: ctx.fiat.toLowerCase(), refundWalletAddress: ctx.address });
      if (amt) p.set('baseCurrencyAmount', amt);
      let search = '?' + p.toString();
      // MoonPay requires the URL to be signed: signature = base64(HMAC-SHA256(secret, url.search)).
      if (c.moonpay.secret) {
        const sig = crypto.createHmac('sha256', c.moonpay.secret).update(search).digest('base64');
        search += '&signature=' + encodeURIComponent(sig);
      }
      return host + search;
    }
    case 'transak': {
      if (!c.transak.key) return null;
      const p = new URLSearchParams({ apiKey: c.transak.key, productsAvailed: 'SELL', cryptoCurrencyCode: 'USDC', network: 'base', walletAddress: ctx.address, fiatCurrency: ctx.fiat });
      if (amt) p.set('cryptoAmount', amt);
      return host + '?' + p.toString();
    }
    case 'ramp': {
      if (!c.ramp.key) return null;
      const p = new URLSearchParams({ hostApiKey: c.ramp.key, enabledFlows: 'OFFRAMP', defaultFlow: 'OFFRAMP', offrampAsset: 'BASE_USDC', userAddress: ctx.address, fiatCurrency: ctx.fiat });
      if (amt) p.set('swapAmount', amt);
      return host + '/?' + p.toString();
    }
    case 'banxa': {
      if (!c.banxa.subdomain) return null;
      const p = new URLSearchParams({ sellMode: 'true', coinType: 'USDC', blockchain: 'BASE', fiatType: ctx.fiat, walletAddress: ctx.address });
      if (amt) p.set('coinAmount', amt);
      return host + '/?' + p.toString();
    }
    case 'mercuryo': {
      if (!c.mercuryo.widget) return null;
      const p = new URLSearchParams({ type: 'sell', currency: 'USDC', network: 'BASE', fiat_currency: ctx.fiat, address: ctx.address, widget_id: c.mercuryo.widget });
      if (amt) p.set('amount', amt);
      // Mercuryo signs the destination: signature = SHA-256(address + secret).
      if (c.mercuryo.secret) p.set('signature', crypto.createHash('sha256').update(ctx.address + c.mercuryo.secret).digest('hex'));
      return host + '/?' + p.toString();
    }
    case 'kado': {
      if (!c.kado.key) return null;
      const p = new URLSearchParams({ mode: 'sell', onPayCurrency: ctx.fiat, onRevCurrency: 'USDC', network: 'BASE', onToAddress: ctx.address, apiKey: c.kado.key });
      if (amt) p.set('onRevAmount', amt);
      return host + '/?' + p.toString();
    }
    case 'unlimit': {
      if (!c.unlimit.key) return null;
      const p = new URLSearchParams({ type: 'sell', crypto: 'USDC', fiat: ctx.fiat, address: ctx.address, key: c.unlimit.key });
      if (amt) p.set('amount', amt);
      return host + '/?' + p.toString();
    }
    default: return null;
  }
}

// Which off-ramps are live (have credentials). Public, cache-lite.
router.get('/v1/offramp/providers', (_req: Request, res: Response) => {
  res.header('Cache-Control', 'no-store');
  return res.json({ env: OFFRAMP_ENV, configured: configuredMap() });
});

const linkLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });

// Build a prefilled off-ramp link (signed where the partner requires it). We only
// return a URL for the client to open — we never fetch it, so no SSRF surface.
router.post('/v1/offramp/link', linkLimiter, (req: Request, res: Response) => {
  const provider = String(req.body?.provider || '');
  const address = String(req.body?.address || '').trim();
  const fiat = String(req.body?.fiat || 'USD').trim().toUpperCase();
  const amount = req.body?.amount != null ? String(req.body.amount).trim() : '';
  if (!(provider in HOMES)) return res.status(400).json({ error: 'Unknown provider.' });
  if (!EVM.test(address)) return res.status(400).json({ error: 'A valid receiving wallet (0x…) is required to cash out.' });
  if (!FIAT.test(fiat)) return res.status(400).json({ error: 'Invalid payout currency.' });
  const url = build(provider, { address, amount, fiat });
  // Not configured (or no host for this env) → hand off to the provider's public page.
  return res.json({ url: url || HOMES[provider], configured: !!url, env: OFFRAMP_ENV });
});

export default router;

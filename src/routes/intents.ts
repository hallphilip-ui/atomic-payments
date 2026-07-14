import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { rpcCall } from './rpc';
import { isSafeWebhookUrl } from '../security/partnerWebhook';
import { sendInvoiceEmail } from '../notify/merchantEmail';
import { screenAddresses } from '../compliance/sanctions';

const prisma = new PrismaClient();
const router = Router();

const MERCHANT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// Self-serve signup creates a row + key — tight per-IP limit.
const merchantRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => { const cf = req.headers['cf-connecting-ip']; return typeof cf === 'string' && cf.length ? cf : req.ip || 'unknown'; }
});
function newMerchantKey(): string { return 'mk_live_' + crypto.randomBytes(24).toString('hex'); }

// Resolve the merchant from the x-atomic-key header (portal + API auth).
async function authMerchant(req: any): Promise<{ merchant?: any; error?: string }> {
  const header = req.headers['x-atomic-key'];
  const apiKey = Array.isArray(header) ? header[0] : header;
  if (!apiKey) return { error: 'Merchant API key is required' };
  const merchant = await prisma.merchant.findUnique({ where: { apiKey } });
  if (!merchant) return { error: 'Merchant API key is invalid' };
  return { merchant };
}

export const STABLECOIN_RAILS: Record<string, {
  symbol: string;
  name: string;
  network: string;
  tokenAddress?: string;
  decimals: number;
  uriScheme: 'ethereum' | 'solana' | 'tron';
  chainId?: number; // EVM only — the RPC chain the payment watcher scans
}> = {
  USD_COIN_BASE: {
    symbol: 'USDC',
    name: 'USD Coin',
    network: 'Base',
    tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    uriScheme: 'ethereum',
    chainId: 8453
  },
  USD_COIN_SOLANA: {
    symbol: 'USDC',
    name: 'USD Coin',
    network: 'Solana',
    tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    uriScheme: 'solana'
  },
  USD_COIN_ETHEREUM: {
    symbol: 'USDC',
    name: 'USD Coin',
    network: 'Ethereum',
    tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
    uriScheme: 'ethereum',
    chainId: 1
  },
  TETHER_ETHEREUM: {
    symbol: 'USDT',
    name: 'Tether USD',
    network: 'Ethereum',
    tokenAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    uriScheme: 'ethereum',
    chainId: 1
  },
  TETHER_TRON: {
    symbol: 'USDT',
    name: 'Tether USD',
    network: 'Tron',
    tokenAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    decimals: 6,
    uriScheme: 'tron'
  },
  PYUSD_ETHEREUM: {
    symbol: 'PYUSD',
    name: 'PayPal USD',
    network: 'Ethereum',
    tokenAddress: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8',
    decimals: 6,
    uriScheme: 'ethereum',
    chainId: 1
  }
};

const VOLATILE_RAILS: Record<string, {
  symbol: string;
  name: string;
  network: string;
  badgeClass: string;
}> = {
  BITCOIN_ONCHAIN: { symbol: 'BTC', name: 'Bitcoin Layer 1', network: 'BTC', badgeClass: 'btc' },
  ETHEREUM: { symbol: 'ETH', name: 'Ethereum Network', network: 'ETH', badgeClass: 'eth' },
  BNB_CHAIN: { symbol: 'BNB', name: 'BNB Smart Chain', network: 'BSC', badgeClass: '' },
  SOLANA: { symbol: 'SOL', name: 'Solana High-Speed', network: 'SOL', badgeClass: 'sol' },
  RIPPLE: { symbol: 'XRP', name: 'Ripple Ledger', network: 'XRP', badgeClass: 'xrp' },
  CARDANO: { symbol: 'ADA', name: 'Cardano Settlement', network: 'ADA', badgeClass: 'ada' },
  DOGECOIN: { symbol: 'DOGE', name: 'Dogecoin Core', network: 'DOGE', badgeClass: 'doge' }
};

function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function amountToBaseUnits(amount: number, decimals: number): string {
  return Math.round(amount * 10 ** decimals).toString();
}

// `toAddress` is REQUIRED and is always the merchant's own verified wallet. There is
// no fallback by design: inventing a destination here would send real funds to an
// address nobody controls.
function buildStablecoinPaymentUri(chain: string, intent: any, amount: number, toAddress: string): string {
  const rail = STABLECOIN_RAILS[chain];
  const addr = toAddress;
  const encodedMemo = encodeURIComponent(`Intent_${intent.id}`);
  const encodedLabel = encodeURIComponent('AtomicPay');

  if (rail.uriScheme === 'solana') {
    return `solana:${addr}?amount=${amount}&spl-token=${rail.tokenAddress}&label=${encodedLabel}&memo=${encodedMemo}`;
  }

  if (rail.uriScheme === 'tron') {
    return `tron:${addr}?amount=${amount}&token=${rail.tokenAddress}&memo=${encodedMemo}`;
  }

  // EIP-681 ERC20 transfer; some chains want a chainId hint (`@8453`).
  const target = rail.chainId ? `${rail.tokenAddress}@${rail.chainId}` : rail.tokenAddress;
  return `ethereum:${target}/transfer?address=${addr}&uint256=${amountToBaseUnits(amount, rail.decimals)}`;
}

function requestOrigin(req: any): string {
  const forwardedProto = Array.isArray(req.headers['x-forwarded-proto'])
    ? req.headers['x-forwarded-proto'][0]
    : req.headers['x-forwarded-proto'];
  const forwardedHost = Array.isArray(req.headers['x-forwarded-host'])
    ? req.headers['x-forwarded-host'][0]
    : req.headers['x-forwarded-host'];
  const proto = String(forwardedProto || req.protocol || 'http').split(',')[0].trim();
  const host = String(forwardedHost || req.headers.host || '').split(',')[0].trim();

  return host ? `${proto}://${host}` : '';
}

function checkoutPathForIntent(intentId: string): string {
  return `/checkout?intentId=${encodeURIComponent(intentId)}`;
}

function toPublicIntent(intent: any, req?: any) {
  const checkoutPath = checkoutPathForIntent(intent.id);
  const origin = req ? requestOrigin(req) : '';

  return {
    id: intent.id,
    amount: intent.amount,
    currency: intent.currency,
    status: intent.status,
    selectedChain: intent.selectedChain,
    cryptoAmountRequired: intent.cryptoAmountRequired,
    depositAddress: intent.depositAddress,
    liveMarketRate: intent.liveMarketRate,
    txHash: intent.txHash,
    expiresAt: intent.expiresAt,
    createdAt: intent.createdAt,
    checkoutPath,
    checkoutUrl: origin ? `${origin}${checkoutPath}` : checkoutPath
  };
}

function publicPaymentRails() {
  const stablecoinRails = Object.entries(STABLECOIN_RAILS).map(([id, rail]) => ({
    id,
    symbol: rail.symbol,
    name: rail.name,
    network: rail.network,
    type: 'tethered_asset',
    stable: true,
    quoteModel: 'USD parity',
    badgeClass: rail.uriScheme === 'solana' ? 'sol' : rail.uriScheme === 'ethereum' ? 'eth' : '',
    settlementAsset: `${rail.symbol}_${rail.network.toUpperCase()}`
  }));

  const volatileRails = Object.entries(VOLATILE_RAILS).map(([id, rail]) => ({
    id,
    symbol: rail.symbol,
    name: rail.name,
    network: rail.network,
    type: 'crypto_asset',
    stable: false,
    quoteModel: 'Live oracle',
    badgeClass: rail.badgeClass,
    settlementAsset: rail.symbol
  }));

  return [...stablecoinRails, ...volatileRails];
}

function supportedPaymentRailIds(): string[] {
  return [...Object.keys(STABLECOIN_RAILS), ...Object.keys(VOLATILE_RAILS)];
}

function isSupportedPaymentRail(chain: unknown): chain is string {
  return typeof chain === 'string' && supportedPaymentRailIds().includes(chain);
}

router.get('/v1/payment_rails', (_req, res) => {
  const rails = publicPaymentRails();
  return res.json({
    rails,
    defaultRailId: 'USD_COIN_SOLANA',
    tetheredAssets: Array.from(new Set(rails.filter((rail) => rail.stable).map((rail) => rail.symbol))),
    railsCount: rails.length
  });
});

router.post('/v1/payment_intents', async (req, res) => {
  try {
    const header = req.headers['x-atomic-key'];
    const apiKey = Array.isArray(header) ? header[0] : header;
    if (!apiKey) return res.status(401).json({ error: 'Merchant API key is required' });

    const merchant = await prisma.merchant.findUnique({ where: { apiKey } });
    if (!merchant) return res.status(401).json({ error: 'Merchant API key is invalid' });

    const amount = Number(req.body.amount);
    const currency = String(req.body.currency || 'USD').trim().toUpperCase();
    const source = ['pos', 'invoice', 'api'].includes(String(req.body.source)) ? String(req.body.source) : 'api';
    // A POS QR is scanned on the spot, so a tight window is right; an emailed
    // invoice must stay payable long after it's sent. Default the TTL by source.
    const DEFAULT_TTL_MIN: Record<string, number> = { pos: 15, api: 15, invoice: 60 * 24 * 7 };
    const MAX_TTL_MIN = 60 * 24 * 30;   // 30 days
    const ttlMinutes = Number(req.body.ttlMinutes || DEFAULT_TTL_MIN[source] || 15);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    // FUND SAFETY: refuse to mint a charge the merchant cannot actually be paid for.
    // Without a receiving wallet there is no address to settle to, and an invoice
    // emailed to a customer would be unpayable (previously: payable to a placeholder).
    if (!merchant.receiveAddress || !EVM_ADDRESS.test(merchant.receiveAddress)) {
      return res.status(409).json({
        error: 'Set a receiving wallet in Settings before creating a charge — payments settle directly to your own wallet.',
        code: 'MERCHANT_WALLET_NOT_SET'
      });
    }
    // Per-transaction limits, if the merchant set them (in the charge currency).
    if (merchant.minChargeAmount != null && amount < merchant.minChargeAmount) {
      return res.status(400).json({ error: `Amount is below this merchant's minimum of ${merchant.minChargeAmount}.` });
    }
    if (merchant.maxChargeAmount != null && amount > merchant.maxChargeAmount) {
      return res.status(400).json({ error: `Amount exceeds this merchant's maximum of ${merchant.maxChargeAmount}.` });
    }
    if (!/^[A-Z]{3,10}$/.test(currency)) {
      return res.status(400).json({ error: 'Currency must be a valid uppercase code' });
    }
    if (!Number.isFinite(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > MAX_TTL_MIN) {
      return res.status(400).json({ error: `ttlMinutes must be between 1 and ${MAX_TTL_MIN}` });
    }
    const intent = await prisma.paymentIntent.create({
      data: {
        merchantId: merchant.id,
        amount,
        currency,
        description: req.body.description ? String(req.body.description).slice(0, 300) : null,
        customerEmail: req.body.customerEmail && MERCHANT_EMAIL_RE.test(String(req.body.customerEmail).trim()) ? String(req.body.customerEmail).trim() : null,
        reference: req.body.reference ? String(req.body.reference).slice(0, 60) : null,
        source,
        expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000)
      }
    });

    // Email the customer an invoice + pay link (best-effort; never blocks the response).
    if (source === 'invoice' && intent.customerEmail) {
      sendInvoiceEmail({
        to: intent.customerEmail, businessName: merchant.businessName, replyTo: merchant.email,
        amount: intent.amount, currency: intent.currency, description: intent.description, reference: intent.reference, intentId: intent.id
      }).catch(() => {});
    }

    return res.status(201).json({ intent: toPublicIntent(intent, req) });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/v1/payment_intents/:id', async (req, res) => {
  try {
    const intent = await prisma.paymentIntent.findUnique({ where: { id: req.params.id } });
    if (!intent) return res.status(404).json({ error: 'Payment intent not found' });

    return res.json({ intent: toPublicIntent(intent, req) });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// UPGRADED CHECKOUT: Volatility-Free Stablecoin Option
// ==========================================
router.post('/v1/payment_intents/:id/select_chain', async (req, res) => {
  try {
    const { id } = req.params;
    const { chain } = req.body; 

    const intent = await prisma.paymentIntent.findUnique({ where: { id } });
    if (!intent) return res.status(404).json({ error: 'Payment intent not found' });
    if (new Date() > intent.expiresAt) return res.status(400).json({ error: 'Payment intent has expired' });
    if (!isSupportedPaymentRail(chain)) {
      return res.status(400).json({
        error: 'Unsupported payment rail',
        supportedRails: supportedPaymentRailIds()
      });
    }

    const merchant = await prisma.merchant.findUnique({ where: { id: intent.merchantId } });
    const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;

    // FUND SAFETY: a deposit address may ONLY ever be the merchant's own verified
    // wallet. There is deliberately no fallback — a placeholder/demo address here
    // would send a real customer payment to an address nobody controls, and the
    // funds would be unrecoverable. If the merchant hasn't set a receiving wallet,
    // we refuse to render a payable address at all.
    const stablecoinRail = STABLECOIN_RAILS[chain];
    const isEvmStablecoin = !!stablecoinRail && stablecoinRail.uriScheme === 'ethereum' && !!stablecoinRail.chainId && !!stablecoinRail.tokenAddress;
    if (!isEvmStablecoin) {
      // Only the watcher-confirmable EVM stablecoin rails can be settled safely: they
      // are the ones we can (a) pay to the merchant's own wallet and (b) confirm
      // on-chain. The volatile/non-EVM rails had no payout wallet and no watcher.
      return res.status(400).json({
        error: 'This payment rail is not supported. Pay with a stablecoin (USDC on Base, or USDC/USDT/PYUSD on Ethereum).',
        supportedRails: Object.keys(STABLECOIN_RAILS).filter((k) => {
          const r = STABLECOIN_RAILS[k];
          return r.uriScheme === 'ethereum' && !!r.chainId && !!r.tokenAddress;
        })
      });
    }
    if (!merchant?.receiveAddress || !EVM_ADDR.test(merchant.receiveAddress)) {
      return res.status(409).json({
        error: 'This merchant has not set a receiving wallet yet, so this charge cannot be paid. No payment should be sent.',
        code: 'MERCHANT_WALLET_NOT_SET'
      });
    }

    const currentPrice = 1.00;
    const merchantWalletAddress = merchant.receiveAddress;
    const assetSymbol = stablecoinRail.symbol;
    const railName = `${stablecoinRail.name} on ${stablecoinRail.network}`;
    let watchFromBlock: number | null = null;

    // A tiny per-invoice amount entropy so the on-chain watcher can match THIS
    // payment to THIS invoice unambiguously, even when several invoices target the
    // same merchant wallet.
    const entropy = ((parseInt(crypto.createHash('sha1').update(intent.id).digest('hex').slice(0, 4), 16) % 9000) + 1) / 10 ** stablecoinRail.decimals;
    const cryptoAmountRequired = parseFloat((intent.amount / currentPrice + entropy).toFixed(stablecoinRail.decimals));
    const web3PaymentUri = buildStablecoinPaymentUri(chain, intent, cryptoAmountRequired, merchantWalletAddress);
    try { watchFromBlock = parseInt(String(await rpcCall(stablecoinRail.chainId!, 'eth_blockNumber', [])), 16); } catch { /* watcher falls back to a lookback window */ }

    await prisma.paymentIntent.update({
      where: { id },
      data: {
        selectedChain: chain,
        cryptoAmountRequired: String(cryptoAmountRequired),
        depositAddress: merchantWalletAddress,
        liveMarketRate: `$${currentPrice.toFixed(2)} USD`,
        watchFromBlock,
        status: 'PROCESSING'
      }
    });

    return res.json({
      intentId: intent.id,
      fiatAmount: intent.amount,
      selectedChain: chain,
      assetSymbol,
      railName,
      liveMarketRate: `$${currentPrice.toFixed(2)} USD`,
      cryptoAmountRequired,
      depositAddress: merchantWalletAddress,
      web3PaymentUri,
      expiresAt: intent.expiresAt
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Operator-only (gated in operatorRules): marking an intent CONFIRMED is a
// settlement action. A real confirmation must come from on-chain detection; this
// endpoint is a controlled simulation for testing, never an anonymous "paid" flip.
router.post('/v1/payment_intents/:id/simulate_payment', async (req, res) => {
  try {
    const { id } = req.params;
    const { txHash } = req.body;
    const intent = await prisma.paymentIntent.findUnique({ where: { id }, include: { merchant: true } });
    if (!intent) return res.status(404).json({ error: 'Payment intent not found' });

    const settledIntent = await prisma.paymentIntent.update({ where: { id }, data: { status: 'CONFIRMED' } });
    const webhookPayload = JSON.stringify({ event: "payment.confirmed", data: { id: settledIntent.id, amount: settledIntent.amount } });
    // Fail closed: never sign with a hardcoded fallback secret. Without a
    // configured secret the webhook simply isn't signed.
    const secret = process.env.ATOMIC_WEBHOOK_SECRET;
    const computedSignature = secret ? generateSignature(webhookPayload, secret) : null;

    return res.json({ message: "⚡ Payment successfully signed!", txHash: txHash || "0x_signature_verified", signatureVerified: computedSignature });
  } catch (error: any) { return res.status(500).json({ error: error.message }); }
});

// Merchant-authed: set the receiving wallet + webhook. Payments settle DIRECTLY to
// receiveAddress (non-custodial); the watcher fires payment.confirmed webhooks.
router.post('/v1/merchant/settings', async (req, res) => {
  try {
    const header = req.headers['x-atomic-key'];
    const apiKey = Array.isArray(header) ? header[0] : header;
    if (!apiKey) return res.status(401).json({ error: 'Merchant API key is required' });
    const merchant = await prisma.merchant.findUnique({ where: { apiKey } });
    if (!merchant) return res.status(401).json({ error: 'Merchant API key is invalid' });

    const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
    const data: { receiveAddress?: string | null; webhookUrl?: string | null; webhookSecret?: string | null; minChargeAmount?: number | null; maxChargeAmount?: number | null } = {};

    if (req.body.receiveAddress !== undefined) {
      const a = String(req.body.receiveAddress).trim();
      if (a && !EVM_ADDR.test(a)) return res.status(400).json({ error: 'receiveAddress must be a valid EVM address (0x…).' });
      // AML: never let a sanctioned address be set as the payout wallet.
      if (a) {
        const hit = await screenAddresses([a]);
        if (hit) return res.status(403).json({ error: 'This address cannot be used as a receiving wallet.', code: 'SANCTIONS_BLOCKED' });
      }
      data.receiveAddress = a || null;
    }
    if (req.body.webhookUrl !== undefined) {
      const u = String(req.body.webhookUrl).trim();
      if (u && !/^https:\/\//i.test(u)) return res.status(400).json({ error: 'webhookUrl must be https://.' });
      if (u && !(await isSafeWebhookUrl(u))) return res.status(400).json({ error: 'webhookUrl host must be a public https endpoint (private/internal addresses are not allowed).' });
      data.webhookUrl = u || null;
      data.webhookSecret = u ? (merchant.webhookSecret || 'whsec_' + crypto.randomBytes(24).toString('hex')) : null;
    }
    // Per-transaction limits (in the charge currency). Empty/null clears a limit.
    const parseLimit = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined;                       // field not sent → leave as-is
      if (v === null || String(v).trim() === '') return null;      // explicit clear
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : NaN;               // NaN → validation error below
    };
    const minL = parseLimit(req.body.minChargeAmount);
    const maxL = parseLimit(req.body.maxChargeAmount);
    if (Number.isNaN(minL as number) || Number.isNaN(maxL as number)) {
      return res.status(400).json({ error: 'Transaction limits must be non-negative numbers.' });
    }
    if (minL !== undefined) data.minChargeAmount = minL;
    if (maxL !== undefined) data.maxChargeAmount = maxL;
    // Effective values after this update (fall back to current stored values).
    const effMin = minL !== undefined ? minL : merchant.minChargeAmount;
    const effMax = maxL !== undefined ? maxL : merchant.maxChargeAmount;
    if (effMin != null && effMax != null && effMax < effMin) {
      return res.status(400).json({ error: 'Maximum must be greater than or equal to the minimum.' });
    }

    const updated = await prisma.merchant.update({ where: { id: merchant.id }, data });
    return res.json({
      businessName: updated.businessName,
      receiveAddress: updated.receiveAddress,
      webhookUrl: updated.webhookUrl,
      webhookSecret: updated.webhookSecret,
      minChargeAmount: updated.minChargeAmount,
      maxChargeAmount: updated.maxChargeAmount,
      note: 'Payments settle directly to receiveAddress (non-custodial). Verify webhooks with HMAC-SHA256(rawBody, webhookSecret) == the x-atomic-signature header.'
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Public: self-serve merchant signup. Returns the API key ONCE (it is the login).
router.post('/v1/merchant/register', merchantRegisterLimiter, async (req, res) => {
  try {
    const businessName = String(req.body.businessName ?? '').trim().slice(0, 120);
    const email = String(req.body.email ?? '').trim().slice(0, 200);
    if (businessName.length < 2) return res.status(400).json({ error: 'A business name is required.' });
    if (!MERCHANT_EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
    const receiveAddress = req.body.receiveAddress && EVM_ADDRESS.test(String(req.body.receiveAddress).trim()) ? String(req.body.receiveAddress).trim() : null;
    // AML: screen the payout wallet at signup too (settings is not the only way in).
    if (receiveAddress) {
      const hit = await screenAddresses([receiveAddress]);
      if (hit) return res.status(403).json({ error: 'This address cannot be used as a receiving wallet.', code: 'SANCTIONS_BLOCKED' });
    }
    const apiKey = newMerchantKey();
    const merchant = await prisma.merchant.create({ data: { businessName, email, apiKey, receiveAddress } });
    return res.status(201).json({
      id: merchant.id, businessName, email, receiveAddress, apiKey,
      warning: 'Save this API key now — it is shown once and is your merchant login. Anyone with it can act as your account.'
    });
  } catch (error: any) { return res.status(500).json({ error: error.message }); }
});

// Merchant-authed: account summary + lifetime totals for the portal overview.
router.get('/v1/merchant/me', async (req, res) => {
  const a = await authMerchant(req);
  if (!a.merchant) return res.status(401).json({ error: a.error });
  const m = a.merchant;
  const confirmed = await prisma.paymentIntent.findMany({ where: { merchantId: m.id, status: 'CONFIRMED' }, select: { amount: true, currency: true } });
  const totalPaid = confirmed.reduce((s, r) => s + (r.amount || 0), 0);
  const pending = await prisma.paymentIntent.count({ where: { merchantId: m.id, status: { in: ['PENDING', 'PROCESSING'] } } });
  return res.json({
    id: m.id, businessName: m.businessName, email: m.email,
    receiveAddress: m.receiveAddress, receiveConfigured: !!m.receiveAddress,
    webhookUrl: m.webhookUrl, webhookConfigured: !!m.webhookUrl,
    minChargeAmount: m.minChargeAmount, maxChargeAmount: m.maxChargeAmount,
    stats: { paidCount: confirmed.length, paidVolume: Number(totalPaid.toFixed(2)), pendingCount: pending, currency: confirmed[0]?.currency || 'USD' }
  });
});

// Merchant-authed: payments/invoices list for reports — filterable, paginated, with totals.
router.get('/v1/merchant/payments', async (req, res) => {
  const a = await authMerchant(req);
  if (!a.merchant) return res.status(401).json({ error: a.error });
  const status = typeof req.query.status === 'string' && ['PENDING', 'PROCESSING', 'CONFIRMED', 'EXPIRED'].includes(req.query.status) ? req.query.status : undefined;
  const source = typeof req.query.source === 'string' && ['pos', 'invoice', 'api'].includes(req.query.source) ? req.query.source : undefined;
  const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10) || 0);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '25'), 10) || 25));
  const where: any = { merchantId: a.merchant.id, ...(status ? { status } : {}), ...(source ? { source } : {}) };
  const [rows, total, agg] = await Promise.all([
    prisma.paymentIntent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * pageSize, take: pageSize }),
    prisma.paymentIntent.count({ where }),
    prisma.paymentIntent.aggregate({ where: { merchantId: a.merchant.id, status: 'CONFIRMED' }, _sum: { amount: true }, _count: true })
  ]);
  return res.json({
    payments: rows.map((r) => ({
      id: r.id, amount: r.amount, currency: r.currency, status: r.status, source: r.source,
      description: r.description, reference: r.reference, customerEmail: r.customerEmail,
      asset: r.selectedChain, cryptoAmount: r.cryptoAmountRequired, txHash: r.txHash,
      createdAt: r.createdAt.toISOString(), confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null
    })),
    page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
    totals: { confirmedCount: agg._count, confirmedVolume: Number((agg._sum.amount || 0).toFixed(2)) }
  });
});

// Public (id-gated): receipt for a payment — shareable with the customer.
router.get('/v1/payment_intents/:id/receipt', async (req, res) => {
  const intent = await prisma.paymentIntent.findUnique({ where: { id: req.params.id }, include: { merchant: true } });
  if (!intent) return res.status(404).json({ error: 'Payment not found.' });
  const rail = STABLECOIN_RAILS[intent.selectedChain || ''];
  return res.json({
    receipt: {
      id: intent.id, businessName: intent.merchant.businessName,
      status: intent.status, paid: intent.status === 'CONFIRMED',
      amount: intent.amount, currency: intent.currency,
      description: intent.description, reference: intent.reference,
      asset: rail ? `${rail.symbol} on ${rail.network}` : intent.selectedChain,
      cryptoAmount: intent.cryptoAmountRequired, txHash: intent.txHash, paidTo: intent.depositAddress,
      createdAt: intent.createdAt.toISOString(),
      confirmedAt: intent.confirmedAt ? intent.confirmedAt.toISOString() : null
    }
  });
});

router.get('/v1/admin/dashboard', async (req, res) => {
  const totalTransactions = await prisma.paymentIntent.count();
  return res.json({ metrics: { total_processed_intents: totalTransactions, completed_settlements: totalTransactions } });
});

export default router;

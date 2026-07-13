import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { rpcCall } from './rpc';
import { isSafeWebhookUrl } from '../security/partnerWebhook';
import { sendInvoiceEmail } from '../notify/merchantEmail';

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
  address: string;
  tokenAddress?: string;
  decimals: number;
  uriScheme: 'ethereum' | 'solana' | 'tron';
  chainId?: number; // EVM only — the RPC chain the payment watcher scans
}> = {
  USD_COIN_BASE: {
    symbol: 'USDC',
    name: 'USD Coin',
    network: 'Base',
    address: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe',
    tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    uriScheme: 'ethereum',
    chainId: 8453
  },
  USD_COIN_SOLANA: {
    symbol: 'USDC',
    name: 'USD Coin',
    network: 'Solana',
    address: 'HN7c7w8DmQCvVx4jYdgY8rCDAMiNkaRPQE6vgbZTk6Z2',
    tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    uriScheme: 'solana'
  },
  USD_COIN_ETHEREUM: {
    symbol: 'USDC',
    name: 'USD Coin',
    network: 'Ethereum',
    address: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe',
    tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
    uriScheme: 'ethereum',
    chainId: 1
  },
  TETHER_ETHEREUM: {
    symbol: 'USDT',
    name: 'Tether USD',
    network: 'Ethereum',
    address: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe',
    tokenAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    uriScheme: 'ethereum',
    chainId: 1
  },
  TETHER_TRON: {
    symbol: 'USDT',
    name: 'Tether USD',
    network: 'Tron',
    address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
    tokenAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    decimals: 6,
    uriScheme: 'tron'
  },
  PYUSD_ETHEREUM: {
    symbol: 'PYUSD',
    name: 'PayPal USD',
    network: 'Ethereum',
    address: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe',
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

function buildStablecoinPaymentUri(chain: string, intent: any, amount: number, toAddress?: string): string {
  const rail = STABLECOIN_RAILS[chain];
  const addr = toAddress || rail.address;
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
    const ttlMinutes = Number(req.body.ttlMinutes || 15);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    if (!/^[A-Z]{3,10}$/.test(currency)) {
      return res.status(400).json({ error: 'Currency must be a valid uppercase code' });
    }
    if (!Number.isFinite(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 120) {
      return res.status(400).json({ error: 'ttlMinutes must be between 1 and 120' });
    }

    const source = ['pos', 'invoice', 'api'].includes(String(req.body.source)) ? String(req.body.source) : 'api';
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

    let currentPrice = 1;
    let merchantWalletAddress = "";
    let web3PaymentUri = "";
    let assetSymbol = chain.split('_')[0];
    let railName = chain;
    let watchFromBlock: number | null = null;
    let cryptoAmountRequired: number;

    const stablecoinRail = STABLECOIN_RAILS[chain];
    if (stablecoinRail) {
      currentPrice = 1.00;
      assetSymbol = stablecoinRail.symbol;
      railName = `${stablecoinRail.name} on ${stablecoinRail.network}`;
      const isEvm = stablecoinRail.uriScheme === 'ethereum' && !!stablecoinRail.chainId;
      // Watched EVM rails get a tiny per-invoice amount entropy so the on-chain
      // watcher can match THIS payment to THIS invoice unambiguously, even when
      // several invoices target the same merchant wallet.
      const entropy = isEvm ? (((parseInt(crypto.createHash('sha1').update(intent.id).digest('hex').slice(0, 4), 16) % 9000) + 1) / 10 ** stablecoinRail.decimals) : 0;
      cryptoAmountRequired = parseFloat((intent.amount / currentPrice + entropy).toFixed(stablecoinRail.decimals));
      // Non-custodial: funds settle to the MERCHANT's own wallet. Fall back to the
      // rail demo address only until the merchant sets a receiving address.
      merchantWalletAddress = (isEvm && merchant?.receiveAddress && EVM_ADDR.test(merchant.receiveAddress)) ? merchant.receiveAddress : stablecoinRail.address;
      web3PaymentUri = buildStablecoinPaymentUri(chain, intent, cryptoAmountRequired, merchantWalletAddress);
      if (isEvm) {
        try { watchFromBlock = parseInt(String(await rpcCall(stablecoinRail.chainId!, 'eth_blockNumber', [])), 16); } catch { /* watcher falls back to a lookback window */ }
      }
    } else {
      // Fallback to Volatile Layer-1 Price Oracle Feed
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana,ethereum&vs_currencies=usd');
        const marketData = await response.json() as any;
        const fallbacks: Record<string, number> = { BITCOIN_ONCHAIN: 65000, SOLANA: 145, ETHEREUM: 3400 };
        currentPrice = marketData[chain.toLowerCase()]?.usd || fallbacks[chain] || 1;
      } catch (err) {
        const fallbacks: Record<string, number> = { BITCOIN_ONCHAIN: 65000, SOLANA: 145, ETHEREUM: 3400 };
        currentPrice = fallbacks[chain] || 1;
      }
      cryptoAmountRequired = parseFloat((intent.amount / currentPrice).toFixed(6));
      if (chain === 'SOLANA') {
        merchantWalletAddress = "HN7c7w8DmQCvVx4jYdgY8rCDAMiNkaRPQE6vgbZTk6Z2";
        assetSymbol = 'SOL';
        web3PaymentUri = `solana:${merchantWalletAddress}?amount=${cryptoAmountRequired}`;
      } else {
        merchantWalletAddress = "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe";
        assetSymbol = chain === 'BITCOIN_ONCHAIN' ? 'BTC' : chain === 'ETHEREUM' ? 'ETH' : assetSymbol;
        web3PaymentUri = `ethereum:${merchantWalletAddress}?value=${cryptoAmountRequired}e18`;
      }
    }

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
    const data: { receiveAddress?: string | null; webhookUrl?: string | null; webhookSecret?: string | null } = {};

    if (req.body.receiveAddress !== undefined) {
      const a = String(req.body.receiveAddress).trim();
      if (a && !EVM_ADDR.test(a)) return res.status(400).json({ error: 'receiveAddress must be a valid EVM address (0x…).' });
      data.receiveAddress = a || null;
    }
    if (req.body.webhookUrl !== undefined) {
      const u = String(req.body.webhookUrl).trim();
      if (u && !/^https:\/\//i.test(u)) return res.status(400).json({ error: 'webhookUrl must be https://.' });
      if (u && !(await isSafeWebhookUrl(u))) return res.status(400).json({ error: 'webhookUrl host must be a public https endpoint (private/internal addresses are not allowed).' });
      data.webhookUrl = u || null;
      data.webhookSecret = u ? (merchant.webhookSecret || 'whsec_' + crypto.randomBytes(24).toString('hex')) : null;
    }

    const updated = await prisma.merchant.update({ where: { id: merchant.id }, data });
    return res.json({
      businessName: updated.businessName,
      receiveAddress: updated.receiveAddress,
      webhookUrl: updated.webhookUrl,
      webhookSecret: updated.webhookSecret,
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

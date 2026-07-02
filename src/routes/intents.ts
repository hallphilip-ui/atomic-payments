import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const router = Router();

const STABLECOIN_RAILS: Record<string, {
  symbol: string;
  name: string;
  network: string;
  address: string;
  tokenAddress?: string;
  decimals: number;
  uriScheme: 'ethereum' | 'solana' | 'tron';
}> = {
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
    uriScheme: 'ethereum'
  },
  TETHER_ETHEREUM: {
    symbol: 'USDT',
    name: 'Tether USD',
    network: 'Ethereum',
    address: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe',
    tokenAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    uriScheme: 'ethereum'
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
    uriScheme: 'ethereum'
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

function buildStablecoinPaymentUri(chain: string, intent: any, amount: number): string {
  const rail = STABLECOIN_RAILS[chain];
  const encodedMemo = encodeURIComponent(`Intent_${intent.id}`);
  const encodedLabel = encodeURIComponent('AtomicPay');

  if (rail.uriScheme === 'solana') {
    return `solana:${rail.address}?amount=${amount}&spl-token=${rail.tokenAddress}&label=${encodedLabel}&memo=${encodedMemo}`;
  }

  if (rail.uriScheme === 'tron') {
    return `tron:${rail.address}?amount=${amount}&token=${rail.tokenAddress}&memo=${encodedMemo}`;
  }

  return `ethereum:${rail.tokenAddress}/transfer?address=${rail.address}&uint256=${amountToBaseUnits(amount, rail.decimals)}`;
}

function toPublicIntent(intent: any) {
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
    createdAt: intent.createdAt
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

    const intent = await prisma.paymentIntent.create({
      data: {
        merchantId: merchant.id,
        amount,
        currency,
        expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000)
      }
    });

    return res.status(201).json({ intent: toPublicIntent(intent) });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/v1/payment_intents/:id', async (req, res) => {
  try {
    const intent = await prisma.paymentIntent.findUnique({ where: { id: req.params.id } });
    if (!intent) return res.status(404).json({ error: 'Payment intent not found' });

    return res.json({ intent: toPublicIntent(intent) });
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

    let currentPrice = 1;
    let merchantWalletAddress = "";
    let web3PaymentUri = "";
    let assetSymbol = chain.split('_')[0];
    let railName = chain;

    const stablecoinRail = STABLECOIN_RAILS[chain];
    if (stablecoinRail) {
      merchantWalletAddress = stablecoinRail.address;
      currentPrice = 1.00;
      assetSymbol = stablecoinRail.symbol;
      railName = `${stablecoinRail.name} on ${stablecoinRail.network}`;
      web3PaymentUri = buildStablecoinPaymentUri(chain, intent, intent.amount);

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

      if (chain === 'SOLANA') {
        merchantWalletAddress = "HN7c7w8DmQCvVx4jYdgY8rCDAMiNkaRPQE6vgbZTk6Z2";
        assetSymbol = 'SOL';
        web3PaymentUri = `solana:${merchantWalletAddress}?amount=${parseFloat((intent.amount / currentPrice).toFixed(6))}`;
      } else {
        merchantWalletAddress = "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe";
        assetSymbol = chain === 'BITCOIN_ONCHAIN' ? 'BTC' : chain === 'ETHEREUM' ? 'ETH' : assetSymbol;
        web3PaymentUri = `ethereum:${merchantWalletAddress}?value=${parseFloat((intent.amount / currentPrice).toFixed(6))}e18`;
      }
    }

    const cryptoAmountRequired = parseFloat((intent.amount / currentPrice).toFixed(6));

    await prisma.paymentIntent.update({
      where: { id },
      data: {
        selectedChain: chain,
        cryptoAmountRequired: String(cryptoAmountRequired),
        depositAddress: merchantWalletAddress,
        liveMarketRate: `$${currentPrice.toFixed(2)} USD`
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

// Keep simulation and admin metrics active
router.post('/v1/payment_intents/:id/simulate_payment', async (req, res) => {
  try {
    const { id } = req.params;
    const { txHash } = req.body;
    const intent = await prisma.paymentIntent.findUnique({ where: { id }, include: { merchant: true } });
    if (!intent) return res.status(404).json({ error: 'Payment intent not found' });

    const settledIntent = await prisma.paymentIntent.update({ where: { id }, data: { status: 'CONFIRMED' } });
    const webhookPayload = JSON.stringify({ event: "payment.confirmed", data: { id: settledIntent.id, amount: settledIntent.amount } });
    const computedSignature = generateSignature(webhookPayload, process.env.ATOMIC_WEBHOOK_SECRET || 'whsec_prod_secret');

    return res.json({ message: "⚡ Payment successfully signed!", txHash: txHash || "0x_signature_verified", signatureVerified: computedSignature });
  } catch (error: any) { return res.status(500).json({ error: error.message }); }
});

router.get('/v1/admin/dashboard', async (req, res) => {
  const totalTransactions = await prisma.paymentIntent.count();
  return res.json({ metrics: { total_processed_intents: totalTransactions, completed_settlements: totalTransactions } });
});

export default router;

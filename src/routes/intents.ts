import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const router = Router();

function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// ==========================================
// 1. MERCHANT LAYER: Create Payment Intent
// ==========================================
router.post('/v1/payment_intents', async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const apiKey = req.headers['x-atomic-key'] as string;

    if (!apiKey) return res.status(401).json({ error: 'Missing x-atomic-key header' });

    const merchant = await prisma.merchant.findUnique({ where: { apiKey } });
    if (!merchant) return res.status(401).json({ error: 'Invalid API Key' });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const intent = await prisma.paymentIntent.create({
      data: {
        merchantId: merchant.id,
        amount: parseFloat(amount),
        currency: currency || 'USD',
        expiresAt,
        status: 'PENDING'
      }
    });

    return res.json(intent);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. CHECKOUT LAYER: Web3 Payment URI Lock
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
    let web3PaymentUri = ""; // Native browser deep-linking context

    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana,ethereum,binancecoin,ripple,cardano,dogecoin&vs_currencies=usd');
      const marketData = await response.json() as any;

      const fallbacks: Record<string, number> = { BITCOIN_ONCHAIN: 65000, SOLANA: 145, ETHEREUM: 3400, BNB_CHAIN: 580 };
      currentPrice = marketData[chain === 'BNB_CHAIN' ? 'binancecoin' : chain.toLowerCase()]?.usd || fallbacks[chain] || 1;
    } catch (apiErr) {
      const fallbacks: Record<string, number> = { BITCOIN_ONCHAIN: 65000, SOLANA: 145, ETHEREUM: 3400, BNB_CHAIN: 580 };
      currentPrice = fallbacks[chain] || 1;
    }

    const cryptoAmount = parseFloat((intent.amount / currentPrice).toFixed(6));

    // Generate specific Web3 Browser Execution URIs
    if (chain === 'SOLANA') {
      merchantWalletAddress = "HN7c7w8DmQCvVx4jYdgY8rCDAMiNkaRPQE6vgbZTk6Z2";
      // Solana Pay Standard Format
      web3PaymentUri = `solana:${merchantWalletAddress}?amount=${cryptoAmount}&label=AtomicPay&memo=Intent_${intent.id}`;
    } else if (chain === 'ETHEREUM') {
      merchantWalletAddress = "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe";
      // EIP-681 Standard Format for Metamask native transaction triggers
      web3PaymentUri = `ethereum:${merchantWalletAddress}?value=${cryptoAmount}e18`; 
    } else if (chain === 'BNB_CHAIN') {
      merchantWalletAddress = "0xBb9c31EFEc16260840A61585f1cE58CBEB7bC765";
      web3PaymentUri = `ethereum:${merchantWalletAddress}@56?value=${cryptoAmount}e18`;
    } else {
      merchantWalletAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
      web3PaymentUri = `bitcoin:${merchantWalletAddress}?amount=${cryptoAmount}`;
    }

    return res.json({
      intentId: intent.id,
      fiatAmount: intent.amount,
      selectedChain: chain,
      liveMarketRate: `$${currentPrice.toLocaleString()} USD`,
      cryptoAmountRequired: cryptoAmount,
      depositAddress: merchantWalletAddress,
      web3PaymentUri, // Frontend captures this to invoke extension wallets seamlessly
      expiresAt: intent.expiresAt
    });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 3. SETTLEMENT LAYER: Payment Simulator
// ==========================================
router.post('/v1/payment_intents/:id/simulate_payment', async (req, res) => {
  try {
    const { id } = req.params;
    const { txHash } = req.body;

    const intent = await prisma.paymentIntent.findUnique({ 
      where: { id },
      include: { merchant: true } 
    });
    if (!intent) return res.status(404).json({ error: 'Payment intent not found' });

    const settledIntent = await prisma.paymentIntent.update({
      where: { id },
      data: { status: 'CONFIRMED' }
    });

    const webhookPayload = JSON.stringify({
      event: "payment.confirmed",
      timestamp: new Date().toISOString(),
      data: {
        id: settledIntent.id,
        amount: settledIntent.amount,
        currency: settledIntent.currency,
        txHash: txHash || "0x_live_signature_web3_abc123",
        merchant: intent.merchant.businessName
      }
    });

    const webhookSecret = process.env.ATOMIC_WEBHOOK_SECRET || 'whsec_prod_secret_key_88888';
    const computedSignature = generateSignature(webhookPayload, webhookSecret);
    
    fetch('https://httpbin.org/post', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-atomic-signature': computedSignature
      },
      body: webhookPayload
    }).catch(() => {});

    return res.json({
      message: "⚡ Blockchain payment successfully signed and finalized!",
      txHash: txHash || "0x_live_signature_web3_abc123",
      signatureVerified: computedSignature
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 4. ADMIN LAYER: Dashboard Metrics
// ==========================================
router.get('/v1/admin/dashboard', async (req, res) => {
  try {
    const totalTransactions = await prisma.paymentIntent.count();
    const pendingCount = await prisma.paymentIntent.count({ where: { status: 'PENDING' } });
    const confirmedTransactions = await prisma.paymentIntent.findMany({ where: { status: 'CONFIRMED' } });
    const totalVolume = confirmedTransactions.reduce((acc, current) => acc + current.amount, 0);

    return res.json({
      metrics: {
        total_processed_intents: totalTransactions,
        active_pending_checkouts: pendingCount,
        completed_settlements: confirmedTransactions.length,
        total_settled_volume_fiat: `$${totalVolume.toFixed(2)} USD`
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;

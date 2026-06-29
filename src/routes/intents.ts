import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

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
        amountFiat: parseFloat(amount),
        currencyFiat: currency || 'USD',
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
// 2. CHECKOUT LAYER: Select Crypto Rail & Lock Rate
// ==========================================
router.post('/v1/payment_intents/:id/select_chain', async (req, res) => {
  try {
    const { id } = req.params;
    const { chain } = req.body; 

    const intent = await prisma.paymentIntent.findUnique({ where: { id } });
    if (!intent) return res.status(404).json({ error: 'Payment intent not found' });
    if (new Date() > intent.expiresAt) return res.status(400).json({ error: 'Payment intent has expired' });

    let mockRate = 1; 
    let mockAddress = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"; 

    if (chain === 'BITCOIN_ONCHAIN') {
      mockRate = 65000; 
      mockAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
    } else if (chain === 'SOLANA') {
      mockRate = 145; 
      mockAddress = "HN7c7w8DmQCvVx4jYdgY8rCDAMiNkaRPQE6vgbZTk6Z2";
    }

    const cryptoAmount = parseFloat((intent.amountFiat / mockRate).toFixed(6));

    return res.json({
      intentId: intent.id,
      fiatAmount: intent.amountFiat,
      selectedChain: chain,
      cryptoAmountRequired: cryptoAmount,
      depositAddress: mockAddress,
      expiresAt: intent.expiresAt,
      instructions: `Please send exactly ${cryptoAmount} ${chain.split('_')[0]} to ${mockAddress}`
    });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 3. SETTLEMENT & WEBHOOK LAYER: Simulate Blockchain Confirmation
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

    // Mark as confirmed in local DB
    const settledIntent = await prisma.paymentIntent.update({
      where: { id },
      data: { status: 'CONFIRMED' }
    });

    // ⚡ DISPATCH WEBHOOK EVENT (Firing asynchronously to a test hook target)
    const webhookPayload = {
      event: "payment.confirmed",
      timestamp: new Date().toISOString(),
      data: {
        id: settledIntent.id,
        amount: settledIntent.amountFiat,
        currency: settledIntent.currencyFiat,
        txHash: txHash || "0x_mock_signature_999",
        merchant: intent.merchant.businessName
      }
    };

    console.log(`\n📣 [Webhook Dispatcher] Firing event 'payment.confirmed' for Intent ${id}...`);
    
    // Using a public webhook tester endpoint (webhook.site style mock)
    fetch('https://httpbin.org/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload)
    })
    .then(() => console.log(`✅ [Webhook] Successfully delivered transaction callback data to Merchant system.\n`))
    .catch((err) => console.error(`❌ [Webhook] Network delivery failed: ${err.message}\n`));

    return res.json({
      message: "⚡ Blockchain confirmation detected and webhook dispatched!",
      txHash: txHash || "0x_mock_solana_signature_555aaabbb",
      updatedIntent: settledIntent
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
    
    const totalVolume = confirmedTransactions.reduce((acc, current) => acc + current.amountFiat, 0);

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

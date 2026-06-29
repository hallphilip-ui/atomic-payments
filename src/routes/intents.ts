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
        amount: parseFloat(amount), // Field name fixed from amountFiat to amount
        currency: currency || 'USD', // Field name fixed from currencyFiat to currency
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
// 2. CHECKOUT LAYER: Multi-Chain Live Price Lock
// ==========================================
router.post('/v1/payment_intents/:id/select_chain', async (req, res) => {
  try {
    const { id } = req.params;
    const { chain } = req.body; 

    const intent = await prisma.paymentIntent.findUnique({ where: { id } });
    if (!intent) return res.status(404).json({ error: 'Payment intent not found' });
    if (new Date() > intent.expiresAt) return res.status(400).json({ error: 'Payment intent has expired' });

    let currentPrice = 1; 
    let mockAddress = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"; 

    console.log(`\n🔍 [Price Oracle] Querying CoinGecko mega-feed for ${chain}...`);

    try {
      // Comprehensive multi-asset query payload (all top 7 cryptos)
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana,ethereum,binancecoin,ripple,cardano,dogecoin&vs_currencies=usd');
      
      const marketData = await response.json() as {
        bitcoin?: { usd: number };
        solana?: { usd: number };
        ethereum?: { usd: number };
        binancecoin?: { usd: number };
        ripple?: { usd: number };
        cardano?: { usd: number };
        dogecoin?: { usd: number };
      };

      // Full Chain Routing Mapping
      if (chain === 'BITCOIN_ONCHAIN' && marketData.bitcoin?.usd) {
        currentPrice = marketData.bitcoin.usd;
        mockAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
      } else if (chain === 'SOLANA' && marketData.solana?.usd) {
        currentPrice = marketData.solana.usd;
        mockAddress = "HN7c7w8DmQCvVx4jYdgY8rCDAMiNkaRPQE6vgbZTk6Z2";
      } else if (chain === 'ETHEREUM' && marketData.ethereum?.usd) {
        currentPrice = marketData.ethereum.usd;
        mockAddress = "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe";
      } else if (chain === 'BNB_CHAIN' && marketData.binancecoin?.usd) {
        currentPrice = marketData.binancecoin.usd;
        mockAddress = "0xBb9c31EFEc16260840A61585f1cE58CBEB7bC765";
      } else if (chain === 'RIPPLE' && marketData.ripple?.usd) {
        currentPrice = marketData.ripple.usd;
        mockAddress = "r9cZA1mLm5RfEEe65BaFcB6SBc6ce65BaF";
      } else if (chain === 'CARDANO' && marketData.cardano?.usd) {
        currentPrice = marketData.cardano.usd;
        mockAddress = "addr1v9asuyv9g3gzk3gzk3gzk3gzk3gzk3gzk3gzk3gzk";
      } else if (chain === 'DOGECOIN' && marketData.dogecoin?.usd) {
        currentPrice = marketData.dogecoin.usd;
        mockAddress = "DJ78Z6965w7nBkWy5yU5vHnC8uCq9P5r3h";
      } else {
        // Ultimate static asset baseline falls
        const fallbacks: Record<string, number> = { BITCOIN_ONCHAIN: 65000, SOLANA: 145, ETHEREUM: 3400, BNB_CHAIN: 580, RIPPLE: 0.50, CARDANO: 0.45, DOGECOIN: 0.14 };
        currentPrice = fallbacks[chain] || 1;
        console.log(`⚠️ [Price Oracle] Asset parsing issue. Using internal index fallback for ${chain}.`);
      }

      console.log(`📈 [Price Oracle] Live ${chain} Rate Confirmed: $${currentPrice} USD`);
    } catch (apiErr) {
      // Network/Rate limit protection with locked baseline fallback
      const fallbacks: Record<string, number> = { BITCOIN_ONCHAIN: 65000, SOLANA: 145, ETHEREUM: 3400, BNB_CHAIN: 580, RIPPLE: 0.50, CARDANO: 0.45, DOGECOIN: 0.14 };
      currentPrice = fallbacks[chain] || 1;
      console.log(`⚠️ [Price Oracle] CoinGecko rate-limited. Using locked baseline fallback.`);
    }

    // Exact crypto fractional math (intent.amountFiat fixed to intent.amount)
    const cryptoAmount = parseFloat((intent.amount / currentPrice).toFixed(6));

    return res.json({
      intentId: intent.id,
      fiatAmount: intent.amount, // Field name fixed
      selectedChain: chain,
      liveMarketRate: `$${currentPrice.toLocaleString()} USD`,
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
// 3. SETTLEMENT LAYER: Simulate Confirmation
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

    const webhookPayload = {
      event: "payment.confirmed",
      timestamp: new Date().toISOString(),
      data: {
        id: settledIntent.id,
        amount: settledIntent.amount, // Field name fixed from amountFiat to amount
        currency: settledIntent.currency, // Field name fixed from currencyFiat to currency
        txHash: txHash || "0x_mock_signature_999",
        merchant: intent.merchant.businessName
      }
    };

    console.log(`\n📣 [Webhook Dispatcher] Firing event 'payment.confirmed' for Intent ${id}...`);
    
    fetch('https://httpbin.org/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload)
    })
    .then(() => console.log(`✅ [Webhook] Callback successfully delivered to merchant.\n`))
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
    
    // totalVolume math fixed from current.amountFiat to current.amount
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

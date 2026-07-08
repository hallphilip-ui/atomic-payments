import { Router } from 'express';
import {
  PLATFORM_SPREAD_BPS,
  PLATFORM_SPREAD_PERCENT,
  PLATFORM_TREASURY_ADDRESS,
  PRICE_IMPACT_LIMIT_PCT,
  QUOTE_TTL_SECONDS,
  THOR_AFFILIATE_NAME,
} from '../cryptoCore/routing';
import { getProviderModeLabel } from '../cryptoCore/providerAdapters';
import { getWalletBroadcastModeLabel } from '../cryptoCore/walletBroadcastAdapters';
import {
  advanceStoredSwapQuote,
  authorizeStoredSwapQuote,
  broadcastStoredSwapQuote,
  createStoredSwapQuote,
  getStoredSwapQuote,
  listStoredSwapQuotes,
  listSwapExecutionEvents
} from '../cryptoCore/swapStore';
import { listSwapAssets, getLifiAsset } from '../cryptoCore/tokens';

const router = Router();

router.get('/v1/swaps/assets', (_req, res) => {
  return res.json({
    policy: {
      model: 'target_top_25_crypto_assets',
      note: 'Launch registry is operational and should be refreshed against market-cap/liquidity data before production.',
      supportedRouting: ['RANGO', 'THORCHAIN']
    },
    // liveSupported = certified for live LI.FI routing/pricing. The client shows
    // only these in the swap dropdowns so every selectable asset actually works.
    assets: listSwapAssets().map((a) => ({ ...a, liveSupported: !!getLifiAsset(a.assetId) }))
  });
});

router.get('/v1/swaps/config', (_req, res) => {
  return res.json({
    platformSpreadPercent: PLATFORM_SPREAD_PERCENT,
    platformSpreadBps: PLATFORM_SPREAD_BPS,
    platformTreasuryAddress: PLATFORM_TREASURY_ADDRESS,
    thorAffiliateName: THOR_AFFILIATE_NAME,
    quoteTtlSeconds: QUOTE_TTL_SECONDS,
    priceImpactLimitPct: PRICE_IMPACT_LIMIT_PCT,
    providerMode: getProviderModeLabel(),
    walletBroadcastMode: getWalletBroadcastModeLabel(),
    mode: 'provider_adapters_with_simulation_default'
  });
});

router.post('/v1/swaps/quote', async (req, res) => {
  try {
    // Cloudflare sets CF-IPCountry to the visitor's ISO country for jurisdiction screening.
    const cfCountry = req.headers['cf-ipcountry'];
    const countryCode = typeof cfCountry === 'string' ? cfCountry : undefined;
    const result = await createStoredSwapQuote(req.body, { countryCode });
    const quote = result.quote;
    const statusCode = quote.status === 'HALTED' ? 409 : quote.status === 'BLOCKED' ? 403 : 201;

    return res.status(statusCode).json({
      quote,
      complianceReview: result.complianceReview,
      nextStep: quote.status === 'QUOTED'
        ? 'Client signs provider payload before expiresAt.'
        : quote.status === 'BLOCKED'
          ? 'Compliance review blocked this quote.'
        : 'Refresh with a smaller amount or lower-impact route.'
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/v1/swaps/quotes', async (_req, res) => {
  return res.json({ quotes: await listStoredSwapQuotes() });
});

router.get('/v1/swaps/quotes/:id', async (req, res) => {
  try {
    return res.json({ quote: await getStoredSwapQuote(req.params.id) });
  } catch (error: any) {
    return res.status(404).json({ error: error.message });
  }
});

router.get('/v1/swaps/quotes/:id/events', async (req, res) => {
  return res.json({ events: await listSwapExecutionEvents(req.params.id) });
});

router.get('/v1/swaps/quotes/:id/stream', async (req, res) => {
  res.header('Content-Type', 'text/event-stream');
  res.header('Cache-Control', 'no-cache');
  res.header('Connection', 'keep-alive');

  let lastPayload = '';

  const writeEvents = async () => {
    try {
      const events = await listSwapExecutionEvents(req.params.id);
      const payload = JSON.stringify({ events });
      if (payload !== lastPayload) {
        res.write(`event: swap-events\n`);
        res.write(`data: ${payload}\n\n`);
        lastPayload = payload;
      }
    } catch (error: any) {
      res.write(`event: swap-error\n`);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
  };

  await writeEvents();
  const interval = setInterval(writeEvents, 2000);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

router.post('/v1/swaps/quotes/:id/authorize', async (req, res) => {
  try {
    const quote = await authorizeStoredSwapQuote(req.params.id, {
      signature: String(req.body.signature ?? ''),
      walletType: req.body.walletType ? String(req.body.walletType) : undefined,
      walletAddress: req.body.walletAddress ? String(req.body.walletAddress) : undefined,
      signatureKind: req.body.signatureKind ? String(req.body.signatureKind) : undefined,
      signedMessage: req.body.signedMessage ? String(req.body.signedMessage) : undefined,
      chainIntent: req.body.chainIntent ? String(req.body.chainIntent) : undefined
    });
    return res.json({
      quote,
      nextStep: 'Background tracker advances routing states as provider confirmations arrive.'
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/v1/swaps/quotes/:id/advance', async (req, res) => {
  try {
    const quote = await advanceStoredSwapQuote(req.params.id);
    return res.json({ quote });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/v1/swaps/quotes/:id/broadcast', async (req, res) => {
  try {
    const result = await broadcastStoredSwapQuote(req.params.id, {
      chain: String(req.body.chain ?? ''),
      signedTransaction: String(req.body.signedTransaction ?? ''),
      walletAddress: req.body.walletAddress ? String(req.body.walletAddress) : undefined
    });
    return res.json({
      ...result,
      nextStep: 'Broadcast proof recorded; routing tracker can advance provider and treasury states.'
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

export default router;

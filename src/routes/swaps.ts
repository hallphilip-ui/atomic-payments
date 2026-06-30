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
import {
  advanceStoredSwapQuote,
  authorizeStoredSwapQuote,
  createStoredSwapQuote,
  getStoredSwapQuote,
  listStoredSwapQuotes,
  listSwapExecutionEvents
} from '../cryptoCore/swapStore';
import { listSwapAssets } from '../cryptoCore/tokens';

const router = Router();

router.get('/v1/swaps/assets', (_req, res) => {
  return res.json({
    policy: {
      model: 'target_top_25_crypto_assets',
      note: 'Launch registry is operational and should be refreshed against market-cap/liquidity data before production.',
      supportedRouting: ['RANGO', 'THORCHAIN']
    },
    assets: listSwapAssets()
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
    mode: 'provider_adapters_with_simulation_default'
  });
});

router.post('/v1/swaps/quote', async (req, res) => {
  try {
    const result = await createStoredSwapQuote(req.body);
    const quote = result.quote;
    const statusCode = quote.status === 'HALTED' ? 409 : 201;

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

router.post('/v1/swaps/quotes/:id/authorize', async (req, res) => {
  try {
    const quote = await authorizeStoredSwapQuote(req.params.id, String(req.body.signature ?? ''));
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

export default router;

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  PLATFORM_SPREAD_BPS,
  PLATFORM_SPREAD_PERCENT,
  PLATFORM_TREASURY_ADDRESS,
  PRICE_IMPACT_LIMIT_PCT,
  QUOTE_TTL_SECONDS,
  THOR_AFFILIATE_NAME,
} from '../cryptoCore/routing';
import { getProviderModeLabel, probeRouteMinimum } from '../cryptoCore/providerAdapters';
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
import { listSwapAssets, getLifiAsset, getSwapAsset } from '../cryptoCore/tokens';
import { resolveJurisdiction } from '../security/edgeTrust';

const router = Router();

// Route-minimum probing fires up to 3 live LI.FI quotes per call — meter it.
const clip = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const routeMinLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => { const cf = req.headers['cf-connecting-ip']; return typeof cf === 'string' && cf.length ? cf : req.ip || 'unknown'; }
});

// Smallest amount that actually quotes for a pair (there's no LI.FI "minimum"
// field — see probeRouteMinimum). Feeds the "Min" button.
router.get('/v1/swaps/route-min', routeMinLimiter, async (req, res) => {
  const fromAsset = clip(req.query.fromAsset, 64);
  const toAsset = clip(req.query.toAsset, 64);
  const userAddress = clip(req.query.userAddress, 128);
  const fromAddress = clip(req.query.fromAddress, 128) || undefined;
  if (!getSwapAsset(fromAsset) || !getSwapAsset(toAsset)) return res.status(400).json({ supported: false, reason: 'Unknown asset.' });
  if (fromAsset === toAsset) return res.status(400).json({ supported: false, reason: 'Pick two different assets.' });
  if (userAddress.length < 8) return res.status(400).json({ supported: false, reason: 'A destination address is required.' });
  try {
    const result = await probeRouteMinimum({ fromAsset, toAsset, amount: '0', userAddress, fromAddress });
    return res.json(result);
  } catch {
    return res.status(502).json({ supported: false, reason: 'Could not reach the routing provider.' });
  }
});

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
    ...(PLATFORM_TREASURY_ADDRESS ? { platformTreasuryAddress: PLATFORM_TREASURY_ADDRESS } : {}),
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
    // Cloudflare sets CF-IPCountry to the visitor's ISO country for jurisdiction
    // screening. resolveJurisdiction also reports whether the request actually came
    // through our edge (see edgeTrust) so a forged header from a direct-origin
    // request can be failed safe rather than trusted.
    const { countryCode, trusted: jurisdictionTrusted } = resolveJurisdiction(req);
    // Build the request from an ALLOW-LIST of client fields. feeBps is deliberately
    // NOT read from the consumer body — the platform fee is server-controlled and
    // defaults to PLATFORM_SPREAD_BPS; only the authenticated partner API may set it.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const request = {
      fromAsset: String(body.fromAsset ?? ''),
      toAsset: String(body.toAsset ?? ''),
      amount: String(body.amount ?? ''),
      userAddress: String(body.userAddress ?? ''),
      fromAddress: body.fromAddress != null ? String(body.fromAddress) : undefined
    };
    const result = await createStoredSwapQuote(request, { countryCode, jurisdictionTrusted });
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
    // Surface a size-cap refusal with its own status + code so the client can
    // explain to the user exactly why the swap was declined (not a generic 400).
    return res.status(error?.status || 400).json({ error: error.message, code: error?.code, maxUsd: error?.maxUsd, amountUsd: error?.amountUsd });
  }
});

router.get('/v1/swaps/quotes', async (_req, res) => {
  return res.json({ quotes: await listStoredSwapQuotes() });
});

// Public (UUID-gated) single-quote read. Truncate addresses — the owner already
// knows their own address, and this endpoint shouldn't hand full addresses to
// anyone who has (or guesses) a quote id.
function truncateAddr(a: string | null | undefined): string | null {
  const s = (a ?? '').trim();
  if (!s) return s || null;
  return s.length <= 14 ? s : `${s.slice(0, 8)}…${s.slice(-6)}`;
}
router.get('/v1/swaps/quotes/:id', async (req, res) => {
  try {
    const quote = await getStoredSwapQuote(req.params.id);
    const redacted = {
      ...quote,
      userAddress: truncateAddr(quote.userAddress),
      walletAuthorization: {
        ...quote.walletAuthorization,
        walletAddress: truncateAddr(quote.walletAuthorization.walletAddress)
      }
    };
    return res.json({ quote: redacted });
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

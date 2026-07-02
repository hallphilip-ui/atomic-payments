const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

const BASE_URL = process.env.ATOMIC_BASE_URL || 'http://127.0.0.1:3005';
const KEEP_SMOKE_DATA = process.env.ATOMIC_SMOKE_KEEP_DATA === '1';
const OPERATOR_API_KEY = process.env.ATOMIC_OPERATOR_API_KEY || '';
const prisma = new PrismaClient();
const createdQuoteIds = new Set();
const createdIntentIds = new Set();
const createdMerchantIds = new Set();

async function request(path, options = {}) {
  const requestId = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-atomic-request-id': requestId,
      ...(OPERATOR_API_KEY ? { 'x-atomic-operator-key': OPERATOR_API_KEY } : {}),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof body === 'string' ? body : body.error || JSON.stringify(body);
    throw new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${message}`);
  }

  return body;
}

async function assertContains(path, text) {
  const body = await request(path);
  assert.equal(typeof body, 'string');
  assert.ok(body.includes(text), `${path} should include ${text}`);
}

async function assertStatus(path, expectedStatus) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'x-atomic-request-id': `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ...(OPERATOR_API_KEY ? { 'x-atomic-operator-key': OPERATOR_API_KEY } : {})
    }
  });
  assert.equal(response.status, expectedStatus, `${path} should return ${expectedStatus}`);
}

async function assertStatusWithoutOperatorKey(path, expectedStatus) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'x-atomic-request-id': `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`
    }
  });
  assert.equal(response.status, expectedStatus, `${path} should return ${expectedStatus} without operator key`);
}

async function assertJsonStatus(path, expectedStatus, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-atomic-request-id': `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ...(OPERATOR_API_KEY ? { 'x-atomic-operator-key': OPERATOR_API_KEY } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  assert.equal(response.status, expectedStatus, `${options.method || 'GET'} ${path} should return ${expectedStatus}`);
  return body;
}

function trackQuote(result) {
  if (result?.quote?.id) createdQuoteIds.add(result.quote.id);
  return result;
}

function trackIntent(result) {
  if (result?.intent?.id) createdIntentIds.add(result.intent.id);
  return result;
}

async function cleanupSmokeData() {
  if (KEEP_SMOKE_DATA) return;

  const quoteIds = Array.from(createdQuoteIds);
  const intentIds = Array.from(createdIntentIds);
  const merchantIds = Array.from(createdMerchantIds);

  if (quoteIds.length > 0) {
    await prisma.swapQuote.deleteMany({
      where: { id: { in: quoteIds } }
    });
  }

  if (intentIds.length > 0) {
    await prisma.paymentIntent.deleteMany({
      where: { id: { in: intentIds } }
    });
  }

  if (merchantIds.length > 0) {
    await prisma.merchant.deleteMany({
      where: { id: { in: merchantIds } }
    });
  }

  if (quoteIds.length > 0 || intentIds.length > 0 || merchantIds.length > 0) {
    console.log(`OK smoke cleanup removed ${quoteIds.length} quotes, ${intentIds.length} intents, ${merchantIds.length} merchants`);
  }
}

async function main() {
  console.log(`Smoke target: ${BASE_URL}`);

  const [health, assets, config] = await Promise.all([
    request('/v1/health'),
    request('/v1/swaps/assets'),
    request('/v1/swaps/config')
  ]);

  assert.equal(health.status, 'ok', 'health endpoint reports ok');
  assert.equal(health.database, 'ready', 'health endpoint reports database readiness');
  assert.equal(health.service, 'atomic-payments', 'health endpoint reports service name');
  assert.ok(String(health.requestId || '').startsWith('smoke-'), 'health endpoint echoes request id');
  console.log(`OK health: ${health.database}, ${health.providerMode} provider mode`);

  assert.ok(Array.isArray(assets.assets), 'assets response includes assets array');
  assert.ok(assets.assets.length >= 20, 'asset registry has at least 20 enabled assets');
  assert.equal(config.platformSpreadBps, 50, 'platform spread is 50 bps');
  assert.equal(config.priceImpactLimitPct, 1.5, 'price-impact guardrail is 1.5%');
  console.log(`OK assets/config: ${assets.assets.length} assets, ${config.providerMode} provider mode`);

  const paymentRails = await request('/v1/payment_rails');
  assert.equal(paymentRails.railsCount, 12, 'payment rail catalog exposes all checkout rails');
  assert.deepEqual(paymentRails.tetheredAssets, ['USDC', 'USDT', 'PYUSD'], 'payment rail catalog exposes tethered assets');
  assert.ok(paymentRails.rails.some((rail) => rail.id === 'TETHER_TRON' && rail.stable), 'payment rail catalog includes USDT Tron rail');
  assert.ok(paymentRails.rails.some((rail) => rail.id === 'USD_COIN_SOLANA' && rail.stable), 'payment rail catalog includes USDC Solana rail');
  console.log(`OK payment rails: ${paymentRails.railsCount} rails, ${paymentRails.tetheredAssets.join('/')}`);

  await Promise.all([
    assertContains('/defi-swap', 'data-atomic-language-select'),
    assertContains('/checkout', 'data-theme-option'),
    assertContains('/admin-compliance', 'data-atomic-language-select'),
    assertStatus('/project-plan', 404),
    assertContains('/assets/widget.js', 'new URL'),
    assertContains('/assets/widget.js', 'data-intent-id'),
    assertStatus('/favicon.ico', 200),
    assertContains('/assets/i18n.js', "'ja'"),
    assertContains('/assets/i18n.js', "'ar'")
  ]);
  console.log('OK consoles/i18n assets are served');

  const merchant = await prisma.merchant.create({
    data: {
      businessName: `Smoke Merchant ${Date.now()}`,
      apiKey: `smoke_key_${Date.now()}_${Math.random().toString(16).slice(2)}`
    }
  });
  createdMerchantIds.add(merchant.id);

  const intentCreated = trackIntent(await request('/v1/payment_intents', {
    method: 'POST',
    headers: { 'x-atomic-key': merchant.apiKey },
    body: JSON.stringify({
      amount: 120.5,
      currency: 'USD',
      ttlMinutes: 20
    })
  }));
  assert.equal(intentCreated.intent.amount, 120.5, 'created payment intent preserves amount');
  assert.equal(intentCreated.intent.currency, 'USD', 'created payment intent preserves currency');
  assert.equal(intentCreated.intent.status, 'PENDING', 'created payment intent starts pending');
  assert.equal(intentCreated.intent.checkoutPath, `/checkout?intentId=${intentCreated.intent.id}`, 'created payment intent includes checkout path');
  assert.equal(intentCreated.intent.checkoutUrl, `${BASE_URL}/checkout?intentId=${intentCreated.intent.id}`, 'created payment intent includes checkout URL');

  const intentFetched = await request(`/v1/payment_intents/${intentCreated.intent.id}`, {
    headers: {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'atomicpay.cloud'
    }
  });
  assert.equal(intentFetched.intent.id, intentCreated.intent.id, 'checkout can fetch public payment intent');
  assert.equal(intentFetched.intent.amount, 120.5, 'fetched payment intent includes amount');
  assert.equal(intentFetched.intent.checkoutPath, `/checkout?intentId=${intentCreated.intent.id}`, 'fetched payment intent includes checkout path');
  assert.equal(intentFetched.intent.checkoutUrl, `https://atomicpay.cloud/checkout?intentId=${intentCreated.intent.id}`, 'fetched payment intent respects forwarded checkout URL');

  const unsupportedRail = await assertJsonStatus(`/v1/payment_intents/${intentCreated.intent.id}/select_chain`, 400, {
    method: 'POST',
    body: JSON.stringify({ chain: 'UNSUPPORTED_RAIL' })
  });
  assert.equal(unsupportedRail.error, 'Unsupported payment rail', 'unknown payment rail is rejected');
  assert.ok(unsupportedRail.supportedRails.includes('TETHER_TRON'), 'unsupported rail response includes supported rails');

  const tetheredRails = [
    { chain: 'USD_COIN_SOLANA', symbol: 'USDC', uriPrefix: 'solana:' },
    { chain: 'USD_COIN_ETHEREUM', symbol: 'USDC', uriPrefix: 'ethereum:' },
    { chain: 'TETHER_ETHEREUM', symbol: 'USDT', uriPrefix: 'ethereum:' },
    { chain: 'TETHER_TRON', symbol: 'USDT', uriPrefix: 'tron:' },
    { chain: 'PYUSD_ETHEREUM', symbol: 'PYUSD', uriPrefix: 'ethereum:' }
  ];

  let railSelected;
  for (const rail of tetheredRails) {
    railSelected = await request(`/v1/payment_intents/${intentCreated.intent.id}/select_chain`, {
      method: 'POST',
      body: JSON.stringify({ chain: rail.chain })
    });
    assert.equal(railSelected.selectedChain, rail.chain, `${rail.symbol} tethered rail can be selected`);
    assert.equal(railSelected.assetSymbol, rail.symbol, `${rail.symbol} tethered rail returns asset symbol`);
    assert.equal(railSelected.cryptoAmountRequired, 120.5, `${rail.symbol} tethered rail preserves USD parity`);
    assert.ok(railSelected.web3PaymentUri.includes(rail.uriPrefix), `${rail.symbol} tethered rail returns wallet payment URI`);
  }

  const intentAfterRail = await request(`/v1/payment_intents/${intentCreated.intent.id}`);
  assert.equal(intentAfterRail.intent.selectedChain, 'PYUSD_ETHEREUM', 'selected tethered rail is persisted for checkout refresh');
  assert.equal(intentAfterRail.intent.depositAddress, railSelected.depositAddress, 'tethered deposit address persists for checkout refresh');
  console.log(`OK payment intent checkout contract: ${intentCreated.intent.id}`);

  const quotePayload = {
    fromAsset: 'BITCOIN.BTC',
    toAsset: 'ETH.USDC',
    amount: '100000000',
    userAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
  };
  const quoted = trackQuote(await request('/v1/swaps/quote', {
    method: 'POST',
    body: JSON.stringify(quotePayload)
  }));

  assert.equal(quoted.quote.status, 'QUOTED', 'valid quote is quoted');
  assert.equal(quoted.quote.platformFeeBps, 50, 'quote embeds platform fee');
  assert.ok(quoted.quote.providerQuoteId, 'quote includes provider quote id');
  assert.ok(['AUTO_CLEARED', 'APPROVED'].includes(quoted.complianceReview.status), 'valid quote is compliance-cleared');
  assert.equal(quoted.complianceReview.vendorMode, 'simulation', 'compliance review includes vendor mode');
  assert.equal(quoted.complianceReview.vendorProvider, 'atomic-simulated-kyt', 'compliance review includes vendor provider');
  assert.ok(quoted.complianceReview.vendorReferenceId, 'compliance review includes vendor reference id');
  console.log(`OK quote created: ${quoted.quote.id}`);

  const authorized = await request(`/v1/swaps/quotes/${quoted.quote.id}/authorize`, {
    method: 'POST',
    body: JSON.stringify({
      signature: `smoke_signature_${Date.now()}`,
      walletType: 'smoke',
      walletAddress: quotePayload.userAddress,
      signatureKind: 'smoke_message_signature',
      signedMessage: `Smoke authorization for ${quoted.quote.id}`,
      chainIntent: 'quote_authorization'
    })
  });
  assert.equal(authorized.quote.status, 'AUTHORIZED', 'cleared quote authorizes');
  assert.equal(authorized.quote.walletAuthorization.walletType, 'smoke', 'authorization records wallet type');
  assert.equal(authorized.quote.walletAuthorization.signatureKind, 'smoke_message_signature', 'authorization records signature kind');
  assert.ok(authorized.quote.walletAuthorization.signatureHash, 'authorization records signature hash');
  assert.ok(authorized.quote.walletAuthorization.signedMessageHash, 'authorization records signed message hash');
  assert.equal(authorized.quote.walletAuthorization.metadata.rawSignatureStored, false, 'authorization avoids raw signature storage');

  const advanced = await request(`/v1/swaps/quotes/${quoted.quote.id}/advance`, { method: 'POST' });
  assert.ok(['ROUTING', 'COMPLETE'].includes(advanced.quote.status), 'authorized quote advances');

  const events = await request(`/v1/swaps/quotes/${quoted.quote.id}/events`);
  assert.ok(events.events.length >= 3, 'quote event log contains lifecycle entries');
  console.log(`OK authorize/advance/events: ${events.events.length} events`);

  const metrics = await request('/v1/metrics');
  assert.equal(metrics.service, 'atomic-payments', 'metrics endpoint reports service name');
  assert.ok(metrics.requestCount >= 8, 'metrics endpoint tracks request count');
  assert.ok(metrics.routes.some((route) => route.route === 'GET /v1/health'), 'metrics endpoint tracks health route');
  assert.ok(metrics.routes.some((route) => route.route.includes('/authorize')), 'metrics endpoint tracks authorization route');
  console.log(`OK metrics: ${metrics.requestCount} requests tracked`);

  const progress = await request('/v1/project/progress');
  assert.equal(progress.service, 'atomic-payments', 'progress endpoint reports service name');
  assert.equal(progress.overallCompletionPct, 82, 'progress endpoint reports overall completion');
  assert.ok(progress.workstreams.some((item) => item.id === 'defi-swap'), 'progress endpoint includes DeFi workstream');
  console.log(`OK project progress: ${progress.overallCompletionRange} overall`);

  if (OPERATOR_API_KEY) {
    await Promise.all([
      assertStatusWithoutOperatorKey('/v1/metrics', 401),
      assertStatusWithoutOperatorKey('/v1/project/progress', 401),
      assertStatusWithoutOperatorKey('/v1/admin/compliance/reviews', 401)
    ]);
    console.log('OK operator protected routes reject missing operator key');
  }

  const reviewQuote = trackQuote(await request('/v1/swaps/quote', {
    method: 'POST',
    body: JSON.stringify({
      ...quotePayload,
      amount: '250000',
      userAddress: '0x987654321'
    })
  }));
  assert.equal(reviewQuote.complianceReview.status, 'MANUAL_REVIEW', 'invalid EVM address creates manual review');
  assert.equal(reviewQuote.complianceReview.riskTier, 'HIGH', 'manual review carries high risk tier');
  assert.equal(reviewQuote.complianceReview.vendorDecision, 'review', 'manual review carries vendor review decision');

  const reviewList = await request('/v1/admin/compliance/reviews?status=MANUAL_REVIEW');
  const review = reviewList.reviews.find((item) => item.id === reviewQuote.complianceReview.id);
  assert.ok(review, 'manual review appears in admin queue');
  assert.ok(review.swapQuote, 'admin review includes swap quote context');
  assert.equal(review.vendorProvider, 'atomic-simulated-kyt', 'admin review preserves vendor provider');
  assert.equal(review.vendorMetadata.screeningModel, 'deterministic_v1', 'admin review preserves vendor metadata');

  const evidence = await request(`/v1/admin/compliance/reviews/${review.id}/evidence`);
  assert.equal(evidence.evidence.schemaVersion, 'compliance-evidence.v1', 'evidence export includes schema version');
  assert.equal(evidence.evidence.review.id, review.id, 'evidence export includes review id');
  assert.equal(evidence.evidence.review.swapQuote.id, review.swapQuote.id, 'evidence export includes quote context');
  assert.match(evidence.evidence.evidenceHash, /^[a-f0-9]{64}$/, 'evidence export includes sha256 hash');

  const decision = await request(`/v1/admin/compliance/reviews/${review.id}/decision`, {
    method: 'POST',
    body: JSON.stringify({
      decision: 'APPROVED',
      reviewedBy: 'smoke',
      notes: 'Automated smoke approval'
    })
  });
  assert.equal(decision.review.status, 'APPROVED', 'admin decision approves review');
  assert.ok(decision.review.swapQuote, 'decision response preserves quote context');
  console.log(`OK compliance evidence exported: ${evidence.evidence.evidenceHash.slice(0, 12)}`);
  console.log(`OK compliance review approved: ${review.id}`);

  console.log('Smoke complete');
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupSmokeData();
    } finally {
      await prisma.$disconnect();
    }
  });

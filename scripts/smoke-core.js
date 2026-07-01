const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

const BASE_URL = process.env.ATOMIC_BASE_URL || 'http://127.0.0.1:3005';
const KEEP_SMOKE_DATA = process.env.ATOMIC_SMOKE_KEEP_DATA === '1';
const OPERATOR_API_KEY = process.env.ATOMIC_OPERATOR_API_KEY || '';
const prisma = new PrismaClient();
const createdQuoteIds = new Set();

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

function trackQuote(result) {
  if (result?.quote?.id) createdQuoteIds.add(result.quote.id);
  return result;
}

async function cleanupSmokeData() {
  if (KEEP_SMOKE_DATA || createdQuoteIds.size === 0) return;

  const ids = Array.from(createdQuoteIds);
  await prisma.swapQuote.deleteMany({
    where: { id: { in: ids } }
  });
  console.log(`OK smoke cleanup removed ${ids.length} quote records`);
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

  await Promise.all([
    assertContains('/defi-swap', 'data-atomic-language-select'),
    assertContains('/admin-compliance', 'data-atomic-language-select'),
    assertStatus('/project-plan', 404),
    assertContains('/assets/i18n.js', "'ja'"),
    assertContains('/assets/i18n.js', "'ar'")
  ]);
  console.log('OK consoles/i18n assets are served');

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
  assert.equal(progress.overallCompletionPct, 74, 'progress endpoint reports overall completion');
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

const assert = require('node:assert/strict');

const BASE_URL = process.env.ATOMIC_BASE_URL || 'http://127.0.0.1:3005';

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
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

async function main() {
  console.log(`Smoke target: ${BASE_URL}`);

  const [assets, config] = await Promise.all([
    request('/v1/swaps/assets'),
    request('/v1/swaps/config')
  ]);

  assert.ok(Array.isArray(assets.assets), 'assets response includes assets array');
  assert.ok(assets.assets.length >= 20, 'asset registry has at least 20 enabled assets');
  assert.equal(config.platformSpreadBps, 50, 'platform spread is 50 bps');
  assert.equal(config.priceImpactLimitPct, 1.5, 'price-impact guardrail is 1.5%');
  console.log(`OK assets/config: ${assets.assets.length} assets, ${config.providerMode} provider mode`);

  await Promise.all([
    assertContains('/defi-swap', 'data-atomic-language-select'),
    assertContains('/admin-compliance', 'data-atomic-language-select'),
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
  const quoted = await request('/v1/swaps/quote', {
    method: 'POST',
    body: JSON.stringify(quotePayload)
  });

  assert.equal(quoted.quote.status, 'QUOTED', 'valid quote is quoted');
  assert.equal(quoted.quote.platformFeeBps, 50, 'quote embeds platform fee');
  assert.ok(quoted.quote.providerQuoteId, 'quote includes provider quote id');
  assert.ok(['AUTO_CLEARED', 'APPROVED'].includes(quoted.complianceReview.status), 'valid quote is compliance-cleared');
  console.log(`OK quote created: ${quoted.quote.id}`);

  const authorized = await request(`/v1/swaps/quotes/${quoted.quote.id}/authorize`, {
    method: 'POST',
    body: JSON.stringify({ signature: `smoke_signature_${Date.now()}` })
  });
  assert.equal(authorized.quote.status, 'AUTHORIZED', 'cleared quote authorizes');

  const advanced = await request(`/v1/swaps/quotes/${quoted.quote.id}/advance`, { method: 'POST' });
  assert.ok(['ROUTING', 'COMPLETE'].includes(advanced.quote.status), 'authorized quote advances');

  const events = await request(`/v1/swaps/quotes/${quoted.quote.id}/events`);
  assert.ok(events.events.length >= 3, 'quote event log contains lifecycle entries');
  console.log(`OK authorize/advance/events: ${events.events.length} events`);

  const reviewQuote = await request('/v1/swaps/quote', {
    method: 'POST',
    body: JSON.stringify({
      ...quotePayload,
      amount: '250000',
      userAddress: '0x987654321'
    })
  });
  assert.equal(reviewQuote.complianceReview.status, 'MANUAL_REVIEW', 'invalid EVM address creates manual review');
  assert.equal(reviewQuote.complianceReview.riskTier, 'HIGH', 'manual review carries high risk tier');

  const reviewList = await request('/v1/admin/compliance/reviews?status=MANUAL_REVIEW');
  const review = reviewList.reviews.find((item) => item.id === reviewQuote.complianceReview.id);
  assert.ok(review, 'manual review appears in admin queue');
  assert.ok(review.swapQuote, 'admin review includes swap quote context');

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
  console.log(`OK compliance review approved: ${review.id}`);

  console.log('Smoke complete');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

// Read the expected build version from package.json so this never goes stale on a
// version bump (a hard-coded value here silently broke CI after the 1.2.0 release).
const EXPECTED_VERSION = require('../package.json').version;

const BASE_URL = process.env.ATOMIC_BASE_URL || 'http://127.0.0.1:3005';
const KEEP_SMOKE_DATA = process.env.ATOMIC_SMOKE_KEEP_DATA === '1';
const OPERATOR_API_KEY = process.env.ATOMIC_OPERATOR_API_KEY || '';
const OPERATOR_READONLY_API_KEY = process.env.ATOMIC_OPERATOR_READONLY_API_KEY || '';
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

async function assertStatusWithReadOnlyOperatorKey(path, expectedStatus, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-atomic-request-id': `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      'x-atomic-operator-key': OPERATOR_READONLY_API_KEY,
      ...(options.headers || {})
    }
  });
  assert.equal(response.status, expectedStatus, `${options.method || 'GET'} ${path} should return ${expectedStatus} with read-only operator key`);
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

const createdUsernames = new Set();

async function cleanupSmokeData() {
  if (KEEP_SMOKE_DATA) return;

  if (createdUsernames.size > 0) {
    await prisma.user.deleteMany({ where: { username: { in: Array.from(createdUsernames) } } });
  }

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
  assert.equal(health.build.version, EXPECTED_VERSION, 'health endpoint reports build version');
  assert.ok(String(health.requestId || '').startsWith('smoke-'), 'health endpoint echoes request id');
  console.log(`OK health: ${health.database}, ${health.providerMode} provider mode`);

  assert.ok(Array.isArray(assets.assets), 'assets response includes assets array');
  assert.ok(assets.assets.length >= 20, 'asset registry has at least 20 enabled assets');
  assert.equal(config.platformSpreadBps, 250, 'platform spread is 250 bps');
  assert.equal(config.priceImpactLimitPct, 1.5, 'price-impact guardrail is 1.5%');
  console.log(`OK assets/config: ${assets.assets.length} assets, ${config.providerMode} provider mode`);

  const paymentRails = await request('/v1/payment_rails');
  assert.equal(paymentRails.railsCount, 13, 'payment rail catalog exposes all checkout rails');
  assert.deepEqual(paymentRails.tetheredAssets, ['USDC', 'USDT', 'PYUSD'], 'payment rail catalog exposes tethered assets');
  assert.ok(paymentRails.rails.some((rail) => rail.id === 'TETHER_TRON' && rail.stable), 'payment rail catalog includes USDT Tron rail');
  assert.ok(paymentRails.rails.some((rail) => rail.id === 'USD_COIN_SOLANA' && rail.stable), 'payment rail catalog includes USDC Solana rail');
  console.log(`OK payment rails: ${paymentRails.railsCount} rails, ${paymentRails.tetheredAssets.join('/')}`);

  const platformConnectors = await request('/v1/settlement/platform-connectors');
  assert.equal(platformConnectors.connectorCount, 15, 'platform transfer connector registry includes launch candidates');
  assert.equal(platformConnectors.tradingEnabledCount, 0, 'platform transfer connectors do not enable trading');
  assert.equal(platformConnectors.policy.intendedUse, 'deposits_and_transfers_only', 'platform connector policy is transfer-only');
  assert.ok(platformConnectors.connectors.some((connector) => connector.id === 'coinbase-advanced'), 'connector registry includes Coinbase Advanced');
  assert.ok(platformConnectors.connectors.every((connector) => connector.tradingEnabled === false), 'all connector candidates disable trading');
  console.log(`OK platform connectors: ${platformConnectors.connectorCount} transfer-only candidates`);

  const connectorAccount = await request('/v1/settlement/platform-connectors/coinbase-advanced/account');
  assert.equal(connectorAccount.account.transferOnly, true, 'connector account endpoint is transfer-only');
  assert.equal(connectorAccount.account.tradingEnabled, false, 'connector account endpoint disables trading');

  const connectorBalances = await request('/v1/settlement/platform-connectors/coinbase-advanced/balances');
  assert.ok(connectorBalances.balances.some((balance) => balance.asset === 'USDC'), 'connector balances include simulated USDC');

  const depositInstructions = await request('/v1/settlement/platform-connectors/coinbase-advanced/deposit-instructions?asset=USDC&network=base');
  assert.equal(depositInstructions.instructions.asset, 'USDC', 'connector deposit instructions normalize asset');
  assert.equal(depositInstructions.instructions.network, 'base', 'connector deposit instructions preserve requested network');

  const withdrawalPreview = await request('/v1/settlement/platform-connectors/coinbase-advanced/withdrawals/preview', {
    method: 'POST',
    body: JSON.stringify({
      asset: 'USDC',
      amount: '10.00',
      destinationAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      network: 'base'
    })
  });
  assert.equal(withdrawalPreview.preview.releaseDecision, 'ready', 'clean connector withdrawal preview is release-ready');
  assert.equal(withdrawalPreview.compliance.status, 'AUTO_CLEARED', 'clean connector withdrawal preview auto-clears');

  const blockedWithdrawalPreview = await request('/v1/settlement/platform-connectors/coinbase-advanced/withdrawals/preview', {
    method: 'POST',
    body: JSON.stringify({
      asset: 'USDC',
      amount: '10.00',
      destinationAddress: '0xsanction00000000000000000000000000000000',
      network: 'base'
    })
  });
  assert.equal(blockedWithdrawalPreview.preview.releaseDecision, 'hold', 'blocked connector withdrawal preview is held');
  assert.equal(blockedWithdrawalPreview.compliance.status, 'BLOCKED', 'blocked connector withdrawal preview returns blocked compliance');

  const withdrawal = await request('/v1/settlement/platform-connectors/coinbase-advanced/withdrawals', {
    method: 'POST',
    body: JSON.stringify({
      asset: 'USDC',
      amount: '10.00',
      destinationAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      network: 'base'
    })
  });
  assert.equal(withdrawal.transfer.direction, 'withdrawal', 'connector withdrawal request stays transfer-scoped');
  assert.equal(withdrawal.transfer.status, 'simulated_pending', 'connector withdrawal remains simulated');
  assert.equal(withdrawal.compliance.status, 'AUTO_CLEARED', 'valid connector withdrawal auto-clears compliance');

  const blockedWithdrawal = await assertJsonStatus('/v1/settlement/platform-connectors/coinbase-advanced/withdrawals', 403, {
    method: 'POST',
    body: JSON.stringify({
      asset: 'USDC',
      amount: '10.00',
      destinationAddress: '0xsanction00000000000000000000000000000000',
      network: 'base'
    })
  });
  assert.equal(blockedWithdrawal.compliance.status, 'BLOCKED', 'sanction keyword blocks connector withdrawal');
  assert.ok(blockedWithdrawal.compliance.flags.includes('sanctions_watchlist_keyword_match'), 'blocked withdrawal includes sanctions flag');
  console.log('OK connector adapter endpoints: account/balances/deposit/withdrawal compliance simulation');

  const fxQuote = await request('/v1/settlement/quotes', {
    method: 'POST',
    body: JSON.stringify({
      sourceCurrency: 'USD',
      targetCurrency: 'EUR',
      notional: 1000,
      side: 'sell'
    })
  });
  assert.equal(fxQuote.quote.status, 'QUOTED', 'settlement quote starts quoted');

  const acceptedFxQuote = await request(`/v1/settlement/quotes/${fxQuote.quote.id}/accept`, { method: 'POST' });
  assert.equal(acceptedFxQuote.quote.status, 'ACCEPTED', 'settlement quote accepts');
  assert.ok(acceptedFxQuote.settlementInstruction.releaseGates.includes('sanctions_screen'), 'settlement instruction includes release gates');

  const reconciliation = await request('/v1/settlement/reconciliation');
  assert.equal(reconciliation.report.status, 'balanced', 'settlement reconciliation is balanced');
  assert.equal(reconciliation.report.breakCount, 0, 'settlement reconciliation has no breaks');
  assert.ok(reconciliation.report.checkedInstructionCount >= 1, 'settlement reconciliation checks instructions');
  const reconciliationExport = await request('/v1/settlement/reconciliation/export');
  assert.equal(reconciliationExport.export.schemaVersion, 'settlement-reconciliation-export.v1', 'settlement reconciliation export includes schema version');
  assert.equal(reconciliationExport.export.report.status, 'balanced', 'settlement reconciliation export carries report');
  assert.match(reconciliationExport.export.exportHash, /^[a-f0-9]{64}$/, 'settlement reconciliation export includes sha256 hash');
  console.log(`OK settlement reconciliation: ${reconciliation.report.checkedInstructionCount} instructions checked`);
  console.log(`OK settlement reconciliation export: ${reconciliationExport.export.exportHash.slice(0, 12)}`);

  await Promise.all([
    assertContains('/defi-swap', 'data-atomic-language-select'),
    assertContains('/checkout', 'data-atomic-language-select'),
    assertContains('/admin-compliance', 'data-atomic-language-select'),
    assertContains('/admin-compliance', 'Funding Connectors'),
    assertContains('/admin-compliance', 'transferCapabilities'),
    assertContains('/admin-compliance', 'depositPayload.instructions'),
    assertContains('/admin-compliance', 'Withdrawal release gate preview'),
    assertContains('/admin-compliance', 'withdrawals/preview'),
    assertStatus('/project-plan', 404),
    assertContains('/assets/widget.js', 'new URL'),
    assertContains('/assets/widget.js', 'data-intent-id'),
    assertStatus('/favicon.ico', 200),
    assertContains('/assets/i18n.js', "'ja'"),
    assertContains('/assets/i18n.js', "'ar'")
  ]);
  console.log('OK consoles/i18n assets are served');

  // FUND SAFETY: a merchant with no receiving wallet must not be able to mint a
  // payable charge (a deposit address could otherwise only be a placeholder that
  // nobody controls). Assert the guard, then give the smoke merchant a real wallet.
  const walletlessMerchant = await prisma.merchant.create({
    data: {
      businessName: `Smoke Walletless ${Date.now()}`,
      apiKey: `smoke_key_nw_${Date.now()}_${Math.random().toString(16).slice(2)}`
    }
  });
  createdMerchantIds.add(walletlessMerchant.id);
  const noWallet = await assertJsonStatus('/v1/payment_intents', 409, {
    method: 'POST',
    headers: { 'x-atomic-key': walletlessMerchant.apiKey },
    body: JSON.stringify({ amount: 10, currency: 'USD' })
  });
  assert.equal(noWallet.code, 'MERCHANT_WALLET_NOT_SET', 'charge is refused when the merchant has no receiving wallet');
  console.log('OK charge refused without a receiving wallet (no placeholder deposit address)');

  const MERCHANT_WALLET = '0x1111111111111111111111111111111111111111';
  const merchant = await prisma.merchant.create({
    data: {
      businessName: `Smoke Merchant ${Date.now()}`,
      apiKey: `smoke_key_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      receiveAddress: MERCHANT_WALLET
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

  // Only the watcher-confirmable EVM stablecoin rails are settleable: they are the
  // ones we can both pay to the merchant's own wallet AND confirm on-chain.
  const tetheredRails = [
    { chain: 'USD_COIN_BASE', symbol: 'USDC', uriPrefix: 'ethereum:' },
    { chain: 'USD_COIN_ETHEREUM', symbol: 'USDC', uriPrefix: 'ethereum:' },
    { chain: 'TETHER_ETHEREUM', symbol: 'USDT', uriPrefix: 'ethereum:' },
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
    // Stablecoin parity holds, plus a tiny per-invoice matching entropy on EVM rails
    // (≤ 0.009) so the on-chain watcher maps one Transfer to exactly one invoice.
    assert.ok(railSelected.cryptoAmountRequired >= 120.5 && railSelected.cryptoAmountRequired < 120.51,
      `${rail.symbol} tethered rail preserves USD parity (± per-invoice matching entropy)`);
    assert.ok(railSelected.web3PaymentUri.includes(rail.uriPrefix), `${rail.symbol} tethered rail returns wallet payment URI`);
    // FUND SAFETY: the deposit address must be the MERCHANT'S OWN wallet — never a
    // placeholder. A regression here sends real customer funds into the void.
    assert.equal(railSelected.depositAddress, MERCHANT_WALLET,
      `${rail.symbol} deposit address is the merchant's own wallet`);
    assert.ok(railSelected.web3PaymentUri.includes(MERCHANT_WALLET),
      `${rail.symbol} payment URI pays the merchant's own wallet`);
  }

  // Rails we can neither pay to the merchant's wallet nor confirm on-chain must be
  // refused outright (they previously handed out placeholder addresses).
  for (const chain of ['USD_COIN_SOLANA', 'TETHER_TRON', 'BITCOIN_ONCHAIN', 'SOLANA']) {
    const refused = await assertJsonStatus(`/v1/payment_intents/${intentCreated.intent.id}/select_chain`, 400, {
      method: 'POST',
      body: JSON.stringify({ chain })
    });
    assert.ok(/not supported/i.test(refused.error), `${chain} (unsettleable rail) is refused`);
  }
  console.log('OK unsettleable rails refused; deposit address is always the merchant wallet');

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
  assert.equal(quoted.quote.platformFeeBps, 250, 'quote embeds platform fee');
  assert.ok(quoted.quote.providerQuoteId, 'quote includes provider quote id');
  assert.ok(['AUTO_CLEARED', 'APPROVED'].includes(quoted.complianceReview.status), 'valid quote is compliance-cleared');
  // Sanctions screening is live-by-default via the keyless on-chain Chainalysis
  // oracle (since 2026-07-09), so a clean address reports the on-chain oracle as the
  // vendor rather than the old 'simulation'/'ofac-sdn-local' defaults.
  assert.equal(quoted.complianceReview.vendorMode, 'live', 'compliance review includes vendor mode');
  assert.equal(quoted.complianceReview.vendorProvider, 'chainalysis-sanctions-oracle-onchain', 'compliance review includes vendor provider');
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

  const broadcast = await request(`/v1/swaps/quotes/${quoted.quote.id}/broadcast`, {
    method: 'POST',
    body: JSON.stringify({
      chain: 'EVM',
      signedTransaction: '0xabcdefabcdefabcdefabcdefabcdefabcdef',
      walletAddress: quotePayload.userAddress
    })
  });
  assert.equal(broadcast.broadcast.mode, 'simulation', 'wallet broadcast defaults to simulation');
  assert.equal(broadcast.quote.status, 'ROUTING', 'wallet broadcast moves quote into routing');
  assert.equal(broadcast.quote.currentState, 'MULTI_BRIDGE_ROUTING', 'wallet broadcast records routing state');
  assert.equal(broadcast.quote.walletAuthorization.metadata.walletBroadcast.rawSignedTransactionStored, false, 'broadcast avoids raw transaction storage');
  assert.ok(broadcast.broadcast.txHash.startsWith('0x'), 'wallet broadcast returns transaction hash');

  const advanced = await request(`/v1/swaps/quotes/${quoted.quote.id}/advance`, { method: 'POST' });
  assert.ok(['ROUTING', 'COMPLETE'].includes(advanced.quote.status), 'authorized quote advances');

  const events = await request(`/v1/swaps/quotes/${quoted.quote.id}/events`);
  assert.ok(events.events.length >= 4, 'quote event log contains lifecycle entries');
  assert.ok(events.events.some((event) => event.state === 'MULTI_BRIDGE_ROUTING'), 'swap event log captures wallet broadcast');
  console.log(`OK authorize/advance/events: ${events.events.length} events`);

  // Wallet-first user session: connect creates a user, reconnect recognizes it.
  const smokeAddr = '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const session1 = await request('/v1/users/wallet_session', {
    method: 'POST',
    body: JSON.stringify({ address: smokeAddr, walletType: 'evm', walletName: 'SmokeWallet' })
  });
  createdUsernames.add(session1.user.username);
  assert.equal(session1.user.isNew, true, 'first wallet connect creates a user');
  assert.ok(Array.isArray(session1.recentSwaps), 'wallet session returns recent swaps');
  const session2 = await request('/v1/users/wallet_session', {
    method: 'POST',
    body: JSON.stringify({ address: smokeAddr, walletType: 'evm' })
  });
  assert.equal(session2.user.isNew, false, 'second connect recognizes the returning user');
  assert.equal(session2.user.id, session1.user.id, 'same wallet maps to the same user');
  console.log(`OK wallet session: ${session1.user.username} created then recognized`);

  const transfers = await request('/v1/transfers?status=all&page=0&pageSize=20');
  assert.ok(Array.isArray(transfers.transfers), 'transfers feed returns an array');
  assert.ok(transfers.total >= 1, 'transfers feed reports at least the smoke conversion');
  assert.ok(transfers.statusCounts.all >= 1, 'transfers status counts include the smoke conversion');
  assert.equal(transfers.page, 0, 'transfers feed echoes requested page');
  assert.ok(transfers.totalPages >= 1, 'transfers feed reports total pages');
  assert.ok(transfers.transfers.some((t) => t.id === quoted.quote.id), 'transfers feed includes the smoke conversion row');
  const smokeRow = transfers.transfers.find((t) => t.id === quoted.quote.id);
  assert.ok(smokeRow.from.symbol && smokeRow.to.symbol, 'transfer row carries from/to asset symbols');
  assert.ok(['pending', 'complete', 'failed'].includes(smokeRow.statusGroup), 'transfer row carries a status group');
  const pendingTransfers = await request('/v1/transfers?status=pending&page=0');
  assert.equal(pendingTransfers.statusFilter, 'pending', 'transfers feed honors the status filter');
  await assertContains('/transfers', 'Transfers');
  console.log(`OK transfers explorer: ${transfers.total} total, ${transfers.statusCounts.complete} complete`);

  const metrics = await request('/v1/metrics');
  assert.equal(metrics.service, 'atomic-payments', 'metrics endpoint reports service name');
  assert.ok(metrics.requestCount >= 8, 'metrics endpoint tracks request count');
  assert.ok(metrics.routes.some((route) => route.route === 'GET /v1/health'), 'metrics endpoint tracks health route');
  assert.ok(metrics.routes.some((route) => route.route.includes('/authorize')), 'metrics endpoint tracks authorization route');
  console.log(`OK metrics: ${metrics.requestCount} requests tracked`);

  const observabilityReadiness = await request('/v1/observability/readiness');
  assert.equal(observabilityReadiness.service, 'atomic-payments', 'observability readiness reports service name');
  assert.equal(observabilityReadiness.status, 'blocked', 'local observability readiness reports missing production links');
  assert.ok(observabilityReadiness.requiredSignals.includes('route_latency_p95'), 'observability readiness includes latency signal');
  assert.ok(observabilityReadiness.alertTriggers.includes('wallet_broadcast_failure'), 'observability readiness includes wallet broadcast alert');
  console.log(`OK observability readiness: ${observabilityReadiness.missingCount} links pending`);

  const progress = await request('/v1/project/progress');
  assert.equal(progress.service, 'atomic-payments', 'progress endpoint reports service name');
  assert.equal(progress.build.version, EXPECTED_VERSION, 'progress endpoint reports build version');
  assert.equal(progress.overallCompletionPct, 95, 'progress endpoint reports overall completion');
  assert.equal(progress.launchReadinessPath, '/v1/project/launch-readiness', 'progress endpoint links launch readiness');
  assert.ok(progress.workstreams.some((item) => item.id === 'defi-swap'), 'progress endpoint includes DeFi workstream');
  console.log(`OK project progress: ${progress.overallCompletionRange} overall`);

  const build = await request('/v1/build');
  assert.equal(build.build.service, 'atomic-payments', 'build endpoint reports service name');
  assert.equal(build.build.version, EXPECTED_VERSION, 'build endpoint reports package version');
  assert.ok(build.build.buildSha, 'build endpoint reports build SHA or local fallback');
  console.log(`OK build version: ${build.build.version} (${build.build.buildChannel})`);

  const launchReadiness = await request('/v1/project/launch-readiness');
  assert.equal(launchReadiness.service, 'atomic-payments', 'launch readiness endpoint reports service name');
  assert.equal(launchReadiness.status, 'blocked', 'launch readiness reports remaining blockers');
  assert.ok(launchReadiness.blockerCount >= 1, 'launch readiness includes blockers');
  assert.ok(launchReadiness.finishLine.requiresExternalSignoff.includes('kyt-sanctions-vendor'), 'launch readiness identifies external compliance signoff');
  console.log(`OK launch readiness: ${launchReadiness.blockerCount} blockers tracked`);

  const launchEvidence = await request('/v1/project/launch-evidence');
  assert.equal(launchEvidence.service, 'atomic-payments', 'launch evidence endpoint reports service name');
  assert.equal(launchEvidence.completion.localSoftwareReadyForBugTest, true, 'launch evidence marks local software ready for bug test');
  assert.equal(launchEvidence.releaseDecision.decision, 'bug_test_candidate', 'launch evidence reports bug test candidate decision');
  assert.ok(launchEvidence.localVerification.some((item) => item.id === 'core-smoke'), 'launch evidence includes core smoke proof');
  assert.ok(launchEvidence.externalProofRequired.some((item) => item.id === 'hosted-postgres-migration'), 'launch evidence includes hosted Postgres external proof');
  console.log(`OK launch evidence: ${launchEvidence.externalProofRequired.length} external proofs pending`);

  if (OPERATOR_API_KEY) {
    await Promise.all([
      assertStatusWithoutOperatorKey('/v1/metrics', 401),
      assertStatusWithoutOperatorKey('/v1/observability/readiness', 401),
      assertStatusWithoutOperatorKey('/v1/project/progress', 401),
      assertStatusWithoutOperatorKey('/v1/project/launch-evidence', 401),
      assertStatusWithoutOperatorKey('/v1/project/launch-readiness', 401),
      assertStatusWithoutOperatorKey('/v1/admin/compliance/reviews', 401),
      assertStatusWithoutOperatorKey('/v1/settlement/platform-connectors', 401),
      assertStatusWithoutOperatorKey('/v1/settlement/reconciliation', 401),
      assertStatusWithoutOperatorKey('/v1/settlement/reconciliation/export', 401)
    ]);
    console.log('OK operator protected routes reject missing operator key');

    if (OPERATOR_READONLY_API_KEY) {
      await assertStatusWithReadOnlyOperatorKey('/v1/settlement/platform-connectors', 200);
      await assertStatusWithReadOnlyOperatorKey('/v1/settlement/platform-connectors/coinbase-advanced/withdrawals/preview', 200, {
        method: 'POST',
        body: JSON.stringify({
          asset: 'USDC',
          amount: '10.00',
          destinationAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          network: 'base'
        })
      });
      await assertStatusWithReadOnlyOperatorKey('/v1/settlement/platform-connectors/coinbase-advanced/withdrawals', 403, {
        method: 'POST',
        body: JSON.stringify({
          asset: 'USDC',
          amount: '10.00',
          destinationAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          network: 'base'
        })
      });
      console.log('OK read-only operator key can inspect but cannot create withdrawals');
    }
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
  // Live-by-default screening (keyless on-chain oracle, 2026-07-09): a non-sanctioned
  // address reports the on-chain oracle vendor + the v2 screening model.
  assert.equal(review.vendorProvider, 'chainalysis-sanctions-oracle-onchain', 'admin review preserves vendor provider');
  assert.equal(review.vendorMetadata.screeningModel, 'ofac_address_and_jurisdiction_v2_onchain_oracle', 'admin review preserves vendor metadata');

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
  const auditLog = await request('/v1/admin/audit-log?limit=25');
  assert.ok(auditLog.entries.some((entry) => entry.action === 'platform_withdrawal_request' && entry.outcome === 'AUTO_CLEARED'), 'audit log captures cleared platform withdrawal');
  assert.ok(auditLog.entries.some((entry) => entry.action === 'platform_withdrawal_request' && entry.outcome === 'BLOCKED'), 'audit log captures blocked platform withdrawal');
  assert.ok(auditLog.entries.some((entry) => entry.action === 'compliance_review_decision' && entry.subjectId === review.id), 'audit log captures compliance decision');
  const auditExport = await request('/v1/admin/audit-log/export?limit=25');
  assert.equal(auditExport.export.schemaVersion, 'operator-audit-export.v1', 'audit export includes schema version');
  assert.equal(auditExport.export.entryCount, auditExport.export.entries.length, 'audit export entry count matches entries');
  assert.match(auditExport.export.exportHash, /^[a-f0-9]{64}$/, 'audit export includes sha256 hash');
  console.log(`OK compliance evidence exported: ${evidence.evidence.evidenceHash.slice(0, 12)}`);
  console.log(`OK compliance review approved: ${review.id}`);
  console.log(`OK operator audit log: ${auditLog.entries.length} recent entries`);
  console.log(`OK operator audit export: ${auditExport.export.exportHash.slice(0, 12)}`);

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

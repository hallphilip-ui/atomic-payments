const assert = require('node:assert/strict');

require('ts-node/register');

const { listPlatformTransferConnectors } = require('../src/settlement/platformTransferConnectors');
const { createSimulatedTransferAdapter } = require('../src/settlement/platformTransferAdapters');

const connectors = listPlatformTransferConnectors();
const expectedConnectorIds = [
  'coinbase-advanced',
  'binance-global',
  'kraken',
  'okx',
  'bybit',
  'zerodha-kite',
  'upstox',
  'angel-one-smartapi',
  'groww',
  'lemon-markets',
  'upvest',
  'tiger-brokers',
  'futu-moomoo',
  'bitfinex',
  'gemini'
];
const allowedCapabilities = new Set([
  'deposit_address',
  'deposit_status',
  'withdrawal_request',
  'withdrawal_status',
  'internal_transfer',
  'balance_read',
  'account_status',
  'webhook_or_stream'
]);
const forbiddenWords = [
  'placeorder',
  'marketorder',
  'limitorder',
  'margin',
  'leverage',
  'derivatives_execution',
  'swap_execution',
  'trade_execution'
];
const forbiddenAdapterMethods = [
  'placeOrder',
  'marketOrder',
  'limitOrder',
  'trade',
  'swap',
  'openPosition',
  'closePosition'
];

assert.equal(connectors.length, expectedConnectorIds.length, 'connector registry has the expected launch candidate count');
assert.deepEqual(
  connectors.map((connector) => connector.id).sort(),
  [...expectedConnectorIds].sort(),
  'connector registry contains the approved launch candidate ids'
);

for (const connector of connectors) {
  assert.equal(connector.intendedUse, 'deposits_and_transfers_only', `${connector.id} is transfer-only`);
  assert.equal(connector.tradingEnabled, false, `${connector.id} disables trading`);
  assert.equal(connector.liveMode, 'not_connected', `${connector.id} is not connected live yet`);
  assert.equal(connector.onboardingStatus, 'candidate', `${connector.id} stays in candidate onboarding`);
  assert.ok(connector.transferCapabilities.length > 0, `${connector.id} declares transfer capabilities`);
  assert.ok(connector.verificationRequired.length > 0, `${connector.id} declares verification gates`);

  for (const capability of connector.transferCapabilities) {
    assert.ok(allowedCapabilities.has(capability), `${connector.id} capability ${capability} is transfer-scoped`);
  }

  const searchable = JSON.stringify({
    id: connector.id,
    transferCapabilities: connector.transferCapabilities,
    notes: connector.notes
  }).toLowerCase().replace(/[\s_-]/g, '');

  for (const word of forbiddenWords) {
    assert.equal(searchable.includes(word), false, `${connector.id} must not expose ${word}`);
  }

  const adapter = createSimulatedTransferAdapter(connector.id);
  assert.equal(adapter.connector.id, connector.id, `${connector.id} adapter preserves connector id`);
  assert.equal(adapter.mode, 'simulation', `${connector.id} adapter starts in simulation mode`);
  assert.deepEqual(adapter.allowedCapabilities, connector.transferCapabilities, `${connector.id} adapter mirrors transfer capabilities`);
  assert.equal(typeof adapter.getAccountStatus, 'function', `${connector.id} exposes account status`);
  assert.equal(typeof adapter.listBalances, 'function', `${connector.id} exposes balances`);
  assert.equal(typeof adapter.getDepositStatus, 'function', `${connector.id} exposes deposit status`);
  assert.equal(typeof adapter.getWithdrawalStatus, 'function', `${connector.id} exposes withdrawal status`);

  for (const method of forbiddenAdapterMethods) {
    assert.equal(method in adapter, false, `${connector.id} adapter must not expose ${method}`);
  }
}

async function verifySampleAdapter() {
  const adapter = createSimulatedTransferAdapter('coinbase-advanced');
  const account = await adapter.getAccountStatus();
  assert.equal(account.transferOnly, true, 'sample adapter account status is transfer-only');
  assert.equal(account.tradingEnabled, false, 'sample adapter account status disables trading');

  const balances = await adapter.listBalances();
  assert.ok(balances.some((balance) => balance.asset === 'USDC'), 'sample adapter exposes simulated balances');

  const deposit = await adapter.getDepositInstructions('USDC', 'base');
  assert.equal(deposit.connectorId, 'coinbase-advanced', 'sample adapter returns deposit instructions');
  assert.equal(deposit.asset, 'USDC', 'sample adapter normalizes deposit asset');

  const withdrawal = await adapter.requestWithdrawal({
    asset: 'USDC',
    amount: '10.00',
    destinationAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    network: 'base'
  });
  assert.equal(withdrawal.direction, 'withdrawal', 'sample adapter creates simulated withdrawal request');
  assert.equal(withdrawal.status, 'simulated_pending', 'sample adapter withdrawal remains simulated');
}

verifySampleAdapter()
  .then(() => {
    console.log(`OK platform transfer connector contract: ${connectors.length} transfer-only candidates`);
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

const assert = require('node:assert/strict');

require('ts-node/register');

const { listPlatformTransferConnectors } = require('../src/settlement/platformTransferConnectors');

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
}

console.log(`OK platform transfer connector contract: ${connectors.length} transfer-only candidates`);

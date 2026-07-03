const assert = require('node:assert/strict');

require('ts-node/register');

const { assessTransferCompliance } = require('../src/compliance/complianceEngine');

function assess(overrides = {}) {
  return assessTransferCompliance({
    connectorId: 'coinbase-advanced',
    asset: 'USDC',
    amount: '10.00',
    destinationAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    network: 'base',
    ...overrides
  });
}

const clean = assess();
assert.equal(clean.status, 'AUTO_CLEARED', 'clean EVM transfer auto-clears');
assert.equal(clean.riskTier, 'LOW', 'clean EVM transfer is low risk');
assert.ok(clean.checks.includes('outgoing_transfer_release_gate'), 'transfer assessment includes release gate check');
assert.ok(clean.checks.includes('evm_transfer_destination_format'), 'base transfer uses EVM format check');
assert.deepEqual(clean.flags, [], 'clean EVM transfer has no flags');

const invalidAddress = assess({ destinationAddress: 'not-an-evm-address' });
assert.equal(invalidAddress.status, 'MANUAL_REVIEW', 'invalid EVM address requires manual review');
assert.equal(invalidAddress.riskTier, 'HIGH', 'invalid EVM address is high risk');
assert.ok(invalidAddress.flags.includes('invalid_evm_transfer_destination_format'), 'invalid EVM address flag is present');

const sanctionedAddress = assess({ destinationAddress: '0xsanction00000000000000000000000000000000' });
assert.equal(sanctionedAddress.status, 'BLOCKED', 'sanctions keyword blocks transfer');
assert.equal(sanctionedAddress.riskTier, 'CRITICAL', 'sanctions keyword is critical risk');
assert.ok(sanctionedAddress.flags.includes('sanctions_watchlist_keyword_match'), 'sanctions flag is present');

const highValueTransfer = assess({ amount: '25000.00' });
assert.equal(highValueTransfer.status, 'MANUAL_REVIEW', 'large transfer requires manual review');
assert.equal(highValueTransfer.riskTier, 'MEDIUM', 'large transfer is medium risk');
assert.ok(highValueTransfer.flags.includes('large_transfer_threshold'), 'large transfer threshold flag is present');

const tronTransfer = assess({
  network: 'tron',
  destinationAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'
});
assert.equal(tronTransfer.status, 'MANUAL_REVIEW', 'TRON transfer requires enhanced review');
assert.equal(tronTransfer.riskTier, 'MEDIUM', 'TRON transfer is medium risk');
assert.ok(tronTransfer.flags.includes('enhanced_review_network'), 'TRON enhanced review flag is present');
assert.ok(tronTransfer.checks.includes('tron_transfer_destination_format'), 'TRON format check is present');

console.log('OK transfer compliance contract: release gate scoring and flags');

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

// `amount` is a human decimal string, not atomic base units — a decimal amount must
// not throw (BigInt-style normalization would), and must compare as written.
const decimalAmount = assess({ amount: '9999.99' });
assert.deepEqual(decimalAmount.flags, [], 'human decimal amount under threshold does not flag');
const decimalOverThreshold = assess({ amount: '10000.01' });
assert.ok(decimalOverThreshold.flags.includes('large_transfer_threshold'), 'human decimal amount over threshold flags');

// When a trusted USD notional is supplied it governs the threshold, so the flag
// means dollars rather than token count.
const usdOverThreshold = assess({ asset: 'TRX', amount: '50000', amountUsd: 12500 });
assert.ok(usdOverThreshold.flags.includes('large_transfer_over_10k_usd'), 'USD notional over threshold flags');
assert.ok(!usdOverThreshold.flags.includes('large_transfer_threshold'), 'USD path replaces the token-count flag');
assert.equal(usdOverThreshold.riskTier, 'MEDIUM', 'USD large transfer scores the same tier as before');

// 50,000 TRX is well over the token-count threshold but only ~$5k of notional —
// the USD figure must suppress the flag the raw token count would have raised.
const usdUnderThreshold = assess({ asset: 'TRX', amount: '50000', amountUsd: 5000 });
assert.deepEqual(usdUnderThreshold.flags, [], 'USD notional under threshold does not flag despite large token count');

// A non-finite USD figure must fall back to the token count, not silently skip the check.
const usdUnusable = assess({ amount: '25000.00', amountUsd: Number.NaN });
assert.ok(usdUnusable.flags.includes('large_transfer_threshold'), 'unusable USD figure falls back to token count');

const tronTransfer = assess({
  network: 'tron',
  destinationAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'
});
assert.equal(tronTransfer.status, 'MANUAL_REVIEW', 'TRON transfer requires enhanced review');
assert.equal(tronTransfer.riskTier, 'MEDIUM', 'TRON transfer is medium risk');
assert.ok(tronTransfer.flags.includes('enhanced_review_network'), 'TRON enhanced review flag is present');
assert.ok(tronTransfer.checks.includes('tron_transfer_destination_format'), 'TRON format check is present');

console.log('OK transfer compliance contract: release gate scoring and flags');

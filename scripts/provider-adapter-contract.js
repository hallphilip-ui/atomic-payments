const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const childMode = process.env.ATOMIC_PROVIDER_CONTRACT_CHILD;

function runChild(mode) {
  const result = spawnSync(process.execPath, [__filename], {
    env: {
      ...process.env,
      ATOMIC_PROVIDER_CONTRACT_CHILD: mode,
      ATOMIC_SWAP_PROVIDER_MODE: mode === 'fallback' ? 'live_with_fallback' : ''
    },
    encoding: 'utf8'
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${mode} provider contract child should pass`);
}

async function runContract() {
  require('ts-node/register');

  const {
    buildProviderPayload,
    getProviderModeLabel,
    getProviderQuote
  } = require('../src/cryptoCore/providerAdapters');

  if (childMode === 'fallback') {
    globalThis.fetch = async () => {
      throw new Error('contract_network_blocked');
    };
  }

  const evmRequest = {
    fromAsset: 'ETH.USDC',
    toAsset: 'BASE.USDC',
    amount: '100000000',
    userAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
  };
  const nativeRequest = {
    fromAsset: 'BITCOIN.BTC',
    toAsset: 'ETH.USDC',
    amount: '100000000',
    userAddress: 'bc1qatomiccontractdestination000000000000000000'
  };

  const rangoPayload = buildProviderPayload(evmRequest, 'RANGO');
  assert.equal(rangoPayload.endpoint, 'https://api.rango.exchange/v1/quote');
  assert.equal(rangoPayload.from, evmRequest.fromAsset);
  assert.equal(rangoPayload.to, evmRequest.toAsset);
  assert.equal(rangoPayload.referrerFee, '0.5');
  assert.ok(rangoPayload.referrerAddress.startsWith('0x'), 'Rango payload carries the Atomic treasury address');

  const thorPayload = buildProviderPayload(nativeRequest, 'THORCHAIN');
  assert.equal(thorPayload.endpoint, 'https://thornode.ninerealms.com/thorchain/quote/swap');
  assert.equal(thorPayload.from_asset, nativeRequest.fromAsset);
  assert.equal(thorPayload.to_asset, nativeRequest.toAsset);
  assert.equal(thorPayload.destination, nativeRequest.userAddress);
  assert.equal(thorPayload.affiliate_bps, '50');

  const quote = await getProviderQuote({
    request: childMode === 'fallback' ? nativeRequest : evmRequest,
    provider: childMode === 'fallback' ? 'THORCHAIN' : 'RANGO',
    amount: 100000000n
  });

  assert.equal(quote.estimatedOutputAmount, '99500000');
  assert.equal(quote.platformFeeAmount, '500000');
  assert.ok(quote.providerQuoteId.startsWith(`sim_${childMode === 'fallback' ? 'thorchain' : 'rango'}_`));
  assert.ok(Number.isFinite(quote.priceImpactPct));
  assert.ok(quote.priceImpactPct > 0);

  if (childMode === 'fallback') {
    assert.equal(getProviderModeLabel(), 'live_with_fallback');
    assert.equal(quote.mode, 'fallback');
    assert.ok(
      quote.diagnostics.some((item) => item.includes('provider_fallback:contract_network_blocked')),
      'fallback quote includes provider failure diagnostic'
    );
  } else {
    assert.equal(getProviderModeLabel(), 'simulation');
    assert.equal(quote.mode, 'simulation');
    assert.deepEqual(quote.diagnostics, ['simulation_quote_generated']);
  }

  console.log(`OK provider adapter contract: ${childMode}`);
}

if (!childMode) {
  runChild('simulation');
  runChild('fallback');
  console.log('Provider adapter contracts complete');
} else {
  runContract().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

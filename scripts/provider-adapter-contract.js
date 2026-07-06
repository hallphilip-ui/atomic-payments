const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const childMode = process.env.ATOMIC_PROVIDER_CONTRACT_CHILD;

function runChild(mode) {
  const result = spawnSync(process.execPath, [__filename], {
    env: {
      ...process.env,
      ATOMIC_PROVIDER_CONTRACT_CHILD: mode,
      ATOMIC_SWAP_PROVIDER_MODE: mode === 'fallback' ? 'live_with_fallback' : mode.startsWith('live_') ? 'live' : ''
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

  if (childMode === 'live_rango' || childMode === 'live_thorchain') {
    const expectedProvider = childMode === 'live_rango' ? 'RANGO' : 'THORCHAIN';
    const expectedRequest = childMode === 'live_rango' ? evmRequest : nativeRequest;

    // No asset is certified for live provider routing yet, so live mode must
    // fail closed — and it must do so BEFORE any network call, never sending an
    // internal asset ID (e.g. BITCOIN.BTC) to a real provider.
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('fetch_should_not_be_called_when_asset_uncertified');
    };

    await assert.rejects(
      getProviderQuote({
        request: expectedRequest,
        provider: expectedProvider,
        amount: BigInt(expectedRequest.amount)
      }),
      /is not certified for live/i,
      'live mode fails closed for uncertified assets'
    );

    assert.equal(fetchCalls, 0, 'fail-closed guard must run before any provider network call');
    assert.equal(getProviderModeLabel(), 'live');
    console.log(`OK provider adapter contract: ${childMode} (fail-closed for uncertified asset)`);
    return;
  }

  const rangoPayload = buildProviderPayload(evmRequest, 'RANGO');
  assert.equal(rangoPayload.endpoint, 'https://api.rango.exchange/basic/quote');
  assert.equal(rangoPayload.from, evmRequest.fromAsset);
  assert.equal(rangoPayload.to, evmRequest.toAsset);
  assert.equal(rangoPayload.referrerFee, '0.5');
  assert.equal(rangoPayload.referrerAddress, undefined, 'Rango payload must not carry a non-existent referrerAddress param');
  assert.equal(rangoPayload.apiKey, undefined, 'Rango apiKey must never appear in the stored request payload');

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
      quote.diagnostics.some((item) => item.includes('provider_fallback:') && item.includes('not certified')),
      'fallback quote surfaces the fail-closed provider diagnostic'
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
  runChild('live_rango');
  runChild('live_thorchain');
  console.log('Provider adapter contracts complete');
} else {
  runContract().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

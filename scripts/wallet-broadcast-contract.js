const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const childMode = process.env.ATOMIC_WALLET_BROADCAST_CONTRACT_CHILD;

function runChild(mode) {
  const result = spawnSync(process.execPath, [__filename], {
    env: {
      ...process.env,
      ATOMIC_WALLET_BROADCAST_CONTRACT_CHILD: mode,
      ATOMIC_WALLET_BROADCAST_MODE: mode === 'fallback' ? 'live_with_fallback' : mode === 'live' ? 'live' : ''
    },
    encoding: 'utf8'
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${mode} wallet broadcast child should pass`);
}

async function runContract() {
  require('ts-node/register');

  const {
    broadcastSignedTransaction,
    getWalletBroadcastModeLabel
  } = require('../src/cryptoCore/walletBroadcastAdapters');

  const evmRequest = {
    chain: 'EVM',
    signedTransaction: '0xabcdefabcdefabcdefabcdefabcdefabcdef',
    quoteId: 'quote_contract_1',
    walletAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
  };
  const solanaRequest = {
    chain: 'SOLANA',
    signedTransaction: '4Nd1mYpJfX3dWn8K8aG7qV6D5rC4bB3aA2zZ1yY9xX8w',
    quoteId: 'quote_contract_2',
    walletAddress: 'HN7c7w8DmQCvVx4jYdgY8rCDAMiNkaRPQE6vgbZTk6Z2'
  };

  if (childMode === 'live') {
    process.env.ATOMIC_EVM_RPC_URL = 'https://rpc.atomic.test/evm';
    process.env.ATOMIC_SOLANA_RPC_URL = 'https://rpc.atomic.test/solana';
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      const body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          result: body.method === 'eth_sendRawTransaction'
            ? '0xliveevmtxhash'
            : 'liveSolanaSignature'
        })
      };
    };

    const evm = await broadcastSignedTransaction(evmRequest);
    const solana = await broadcastSignedTransaction(solanaRequest);
    assert.equal(getWalletBroadcastModeLabel(), 'live');
    assert.equal(evm.mode, 'live');
    assert.equal(evm.txHash, '0xliveevmtxhash');
    assert.equal(solana.mode, 'live');
    assert.equal(solana.txHash, 'liveSolanaSignature');
    assert.equal(calls[0].body.method, 'eth_sendRawTransaction');
    assert.equal(calls[1].body.method, 'sendTransaction');
    console.log('OK wallet broadcast contract: live');
    return;
  }

  if (childMode === 'fallback') {
    process.env.ATOMIC_EVM_RPC_URL = 'https://rpc.atomic.test/evm';
    globalThis.fetch = async () => {
      throw new Error('contract_rpc_down');
    };
    const result = await broadcastSignedTransaction(evmRequest);
    assert.equal(getWalletBroadcastModeLabel(), 'live_with_fallback');
    assert.equal(result.mode, 'fallback');
    assert.ok(result.diagnostics.some((item) => item.includes('wallet_broadcast_fallback:contract_rpc_down')));
    console.log('OK wallet broadcast contract: fallback');
    return;
  }

  const result = await broadcastSignedTransaction(evmRequest);
  assert.equal(getWalletBroadcastModeLabel(), 'simulation');
  assert.equal(result.mode, 'simulation');
  assert.equal(result.chain, 'EVM');
  assert.ok(result.txHash.startsWith('0x'));
  assert.deepEqual(result.diagnostics, ['simulation_wallet_broadcast_recorded']);

  await assert.rejects(
    () => broadcastSignedTransaction({ ...evmRequest, signedTransaction: 'not-hex' }),
    /0x-prefixed hex/
  );
  await assert.rejects(
    () => broadcastSignedTransaction({ ...evmRequest, chain: 'DOGE' }),
    /Unsupported wallet broadcast chain/
  );

  console.log('OK wallet broadcast contract: simulation');
}

if (!childMode) {
  runChild('simulation');
  runChild('live');
  runChild('fallback');
  console.log('Wallet broadcast contracts complete');
} else {
  runContract().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

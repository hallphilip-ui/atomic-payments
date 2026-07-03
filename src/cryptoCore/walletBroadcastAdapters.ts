import crypto from 'crypto';

export type WalletBroadcastMode = 'simulation' | 'live' | 'live_with_fallback';
export type WalletBroadcastChain = 'EVM' | 'SOLANA';

export type WalletBroadcastRequest = {
  chain: WalletBroadcastChain;
  signedTransaction: string;
  quoteId: string;
  walletAddress: string;
};

export type WalletBroadcastResult = {
  mode: 'simulation' | 'live' | 'fallback';
  chain: WalletBroadcastChain;
  txHash: string;
  provider: string;
  diagnostics: string[];
  broadcastedAt: string;
};

function getWalletBroadcastMode(): WalletBroadcastMode {
  const mode = process.env.ATOMIC_WALLET_BROADCAST_MODE;
  if (mode === 'live' || mode === 'live_with_fallback') return mode;
  return 'simulation';
}

export function getWalletBroadcastModeLabel() {
  return getWalletBroadcastMode();
}

function normalizedChain(chain: string): WalletBroadcastChain {
  const normalized = chain.trim().toUpperCase();
  if (normalized === 'EVM' || normalized === 'ETHEREUM') return 'EVM';
  if (normalized === 'SOLANA' || normalized === 'SOL') return 'SOLANA';
  throw new Error(`Unsupported wallet broadcast chain: ${chain}.`);
}

function validateSignedTransaction(chain: WalletBroadcastChain, signedTransaction: string) {
  const value = signedTransaction.trim();
  if (chain === 'EVM' && !/^0x[a-fA-F0-9]{16,}$/.test(value)) {
    throw new Error('EVM signed transaction must be a 0x-prefixed hex payload.');
  }

  if (chain === 'SOLANA' && !/^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(value)) {
    throw new Error('Solana signed transaction must be a base58 payload.');
  }
}

function simulationBroadcast(request: WalletBroadcastRequest, diagnostics: string[] = []): WalletBroadcastResult {
  const txHash = crypto
    .createHash('sha256')
    .update(`${request.chain}:${request.quoteId}:${request.walletAddress}:${request.signedTransaction}`)
    .digest('hex');

  return {
    mode: diagnostics.length ? 'fallback' : 'simulation',
    chain: request.chain,
    txHash: request.chain === 'EVM' ? `0x${txHash}` : txHash,
    provider: 'atomic-wallet-sim',
    diagnostics: diagnostics.length ? diagnostics : ['simulation_wallet_broadcast_recorded'],
    broadcastedAt: new Date().toISOString()
  };
}

async function jsonRpc(url: string, method: string, params: unknown[]) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `atomic-${Date.now()}`,
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`RPC returned HTTP ${response.status}.`);
  }

  const payload = await response.json() as { result?: string; error?: { message?: string } };
  if (payload.error) {
    throw new Error(payload.error.message || 'RPC returned an error.');
  }
  if (!payload.result) {
    throw new Error('RPC response did not include a transaction hash/signature.');
  }

  return payload.result;
}

async function liveBroadcast(request: WalletBroadcastRequest): Promise<WalletBroadcastResult> {
  const rpcUrl = request.chain === 'EVM'
    ? process.env.ATOMIC_EVM_RPC_URL
    : process.env.ATOMIC_SOLANA_RPC_URL;

  if (!rpcUrl) {
    throw new Error(`${request.chain} RPC URL is not configured.`);
  }

  const txHash = request.chain === 'EVM'
    ? await jsonRpc(rpcUrl, 'eth_sendRawTransaction', [request.signedTransaction])
    : await jsonRpc(rpcUrl, 'sendTransaction', [request.signedTransaction]);

  return {
    mode: 'live',
    chain: request.chain,
    txHash,
    provider: request.chain === 'EVM' ? 'evm-json-rpc' : 'solana-json-rpc',
    diagnostics: ['live_wallet_broadcast_submitted'],
    broadcastedAt: new Date().toISOString()
  };
}

export async function broadcastSignedTransaction(input: {
  chain: string;
  signedTransaction: string;
  quoteId: string;
  walletAddress: string;
}): Promise<WalletBroadcastResult> {
  const request: WalletBroadcastRequest = {
    chain: normalizedChain(input.chain),
    signedTransaction: input.signedTransaction.trim(),
    quoteId: input.quoteId,
    walletAddress: input.walletAddress
  };
  validateSignedTransaction(request.chain, request.signedTransaction);

  const mode = getWalletBroadcastMode();
  if (mode === 'simulation') {
    return simulationBroadcast(request);
  }

  try {
    return await liveBroadcast(request);
  } catch (error: any) {
    if (mode === 'live_with_fallback') {
      return simulationBroadcast(request, [`wallet_broadcast_fallback:${error.message}`]);
    }
    throw error;
  }
}

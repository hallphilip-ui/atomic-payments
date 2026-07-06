import crypto from 'crypto';
import { TokenRegistryEntry, getSwapAsset, isNativeL1Asset } from './tokens';
import { getProviderQuote, ProviderExecution } from './providerAdapters';
import {
  PLATFORM_SPREAD_BPS,
  PLATFORM_SPREAD_PERCENT,
  PLATFORM_TREASURY_ADDRESS,
  PRICE_IMPACT_LIMIT_PCT,
  QUOTE_TTL_SECONDS,
  THOR_AFFILIATE_NAME
} from './swapConfig';

export {
  PLATFORM_SPREAD_BPS,
  PLATFORM_SPREAD_PERCENT,
  PLATFORM_TREASURY_ADDRESS,
  PRICE_IMPACT_LIMIT_PCT,
  QUOTE_TTL_SECONDS,
  THOR_AFFILIATE_NAME
};

export type UnifiedSwapQuoteRequest = {
  fromAsset: string;
  toAsset: string;
  amount: string;
  // Destination address (where the swapped funds land).
  userAddress: string;
  // Source/sender address on the FROM chain (the connected wallet). Required for
  // cross-chain quotes where the source and destination are different chains/
  // address types (e.g. BTC->ETH). Falls back to userAddress for same-chain.
  fromAddress?: string;
};

export type SwapRoutingProvider = 'RANGO' | 'THORCHAIN' | 'LIFI';
export type SwapQuoteStatus = 'QUOTED' | 'HALTED' | 'BLOCKED' | 'AUTHORIZED' | 'ROUTING' | 'COMPLETE' | 'EXPIRED';

export type UnifiedSwapQuote = {
  id: string;
  status: SwapQuoteStatus;
  provider: SwapRoutingProvider;
  fromAsset: TokenRegistryEntry;
  toAsset: TokenRegistryEntry;
  amount: string;
  estimatedOutputAmount: string;
  platformFeeBps: number;
  platformFeeAmount: string;
  priceImpactPct: number;
  priceImpactLimitPct: number;
  providerMode?: string;
  providerQuoteId?: string;
  providerLatencyMs?: number;
  providerDiagnostics?: string[];
  expiresAt: string;
  quoteTtlSeconds: number;
  requestPayload: Record<string, string>;
  executionStates: string[];
  guardrails: string[];
  // Transient (not persisted): the signable transaction for live client-side
  // execution. Present only for live provider quotes.
  execution?: ProviderExecution;
};

function requireAsset(assetId: string, fieldName: string): TokenRegistryEntry {
  const asset = getSwapAsset(assetId);
  if (!asset) {
    throw new Error(`${fieldName} ${assetId} is not enabled in the DeFi swap registry.`);
  }

  return asset;
}

function parseAtomicAmount(amount: string): bigint {
  if (!/^[0-9]+$/.test(amount)) {
    throw new Error('Amount must be an atomic integer string.');
  }

  const parsed = BigInt(amount);
  if (parsed <= 0n) {
    throw new Error('Amount must be greater than zero.');
  }

  return parsed;
}

function selectProvider(_fromAssetId: string, _toAssetId: string): SwapRoutingProvider {
  // LI.FI is the unified, gatekeeper-free backend: it covers native BTC, Solana,
  // EVM and cross-chain in one API with an integrator fee (no token, no on-chain
  // affiliate name). Assets it doesn't cover fail closed in buildProviderPayload.
  return 'LIFI';
}

export async function getEnforcedPlatformQuote(request: UnifiedSwapQuoteRequest): Promise<UnifiedSwapQuote> {
  const fromAsset = requireAsset(request.fromAsset, 'fromAsset');
  const toAsset = requireAsset(request.toAsset, 'toAsset');
  const amount = parseAtomicAmount(request.amount);

  if (fromAsset.assetId === toAsset.assetId) {
    throw new Error('fromAsset and toAsset must be different.');
  }

  if (!request.userAddress || String(request.userAddress).trim().length < 8) {
    throw new Error('A destination userAddress is required.');
  }

  const provider = selectProvider(fromAsset.assetId, toAsset.assetId);
  const providerQuote = await getProviderQuote({ request, provider, amount });
  const priceImpactPct = providerQuote.priceImpactPct;
  const priceImpactLimitPct = Math.min(fromAsset.priceImpactLimitPct, toAsset.priceImpactLimitPct, PRICE_IMPACT_LIMIT_PCT);
  const status: SwapQuoteStatus = priceImpactPct > priceImpactLimitPct ? 'HALTED' : 'QUOTED';
  const now = new Date();

  return {
    id: crypto.randomUUID(),
    status,
    provider,
    fromAsset,
    toAsset,
    amount: amount.toString(),
    estimatedOutputAmount: providerQuote.estimatedOutputAmount,
    platformFeeBps: PLATFORM_SPREAD_BPS,
    platformFeeAmount: providerQuote.platformFeeAmount,
    priceImpactPct,
    priceImpactLimitPct,
    providerMode: providerQuote.mode,
    providerQuoteId: providerQuote.providerQuoteId,
    providerLatencyMs: providerQuote.latencyMs,
    providerDiagnostics: providerQuote.diagnostics,
    expiresAt: new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000).toISOString(),
    quoteTtlSeconds: QUOTE_TTL_SECONDS,
    requestPayload: providerQuote.requestPayload,
    executionStates: ['SOURCING', 'ESCROW_ESCORTING', 'MULTI_BRIDGE_ROUTING', 'TREASURY_CLEARING', 'DISTRIBUTION_COMPLETE'],
    execution: providerQuote.execution,
    guardrails: [
      'immutable_30_second_quote_ttl',
      'price_impact_halt_above_1_5_pct',
      'platform_fee_embedded_in_provider_payload',
      'self_custodial_user_signature_required'
    ]
  };
}

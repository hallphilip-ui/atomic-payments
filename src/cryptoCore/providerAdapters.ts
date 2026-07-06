import {
  PLATFORM_SPREAD_BPS,
  PLATFORM_SPREAD_PERCENT,
  PRICE_IMPACT_LIMIT_PCT,
  RANGO_API_KEY,
  RANGO_QUOTE_ENDPOINT,
  RANGO_REFERRER_CODE,
  THOR_AFFILIATE_NAME,
  THOR_CLIENT_ID,
  THOR_QUOTE_ENDPOINT
} from './swapConfig';
import { getProviderAssetId } from './tokens';
import { SwapRoutingProvider, UnifiedSwapQuoteRequest } from './routing';

export type ProviderMode = 'simulation' | 'live' | 'fallback';

export type ProviderQuoteResult = {
  mode: ProviderMode;
  providerQuoteId: string;
  estimatedOutputAmount: string;
  platformFeeAmount: string;
  priceImpactPct: number;
  requestPayload: Record<string, string>;
  latencyMs: number;
  diagnostics: string[];
};

type SimulationInput = {
  request: UnifiedSwapQuoteRequest;
  provider: SwapRoutingProvider;
  amount: bigint;
};

const LIVE_MODE = process.env.ATOMIC_SWAP_PROVIDER_MODE === 'live';
const LIVE_WITH_FALLBACK = process.env.ATOMIC_SWAP_PROVIDER_MODE === 'live_with_fallback';

function applyPlatformFee(amount: bigint): { output: string; fee: string } {
  const feeAmount = amount * BigInt(PLATFORM_SPREAD_BPS) / 10000n;
  return {
    output: (amount - feeAmount).toString(),
    fee: feeAmount.toString()
  };
}

function estimatePriceImpactPct(amount: bigint, provider: SwapRoutingProvider): number {
  const amountDigits = amount.toString().length;
  const baseImpact = provider === 'THORCHAIN' ? 0.45 : 0.3;
  const sizeImpact = Math.max(0, amountDigits - 8) * 0.11;
  return Number(Math.min(4.5, baseImpact + sizeImpact).toFixed(2));
}

// Resolve the provider-specific routing ID for an asset. In live mode an
// uncertified asset (no verified provider ID) throws so we never send an
// internal ID like BITCOIN.BTC to a real provider; in simulation we fall back
// to the internal ID purely for display in the stored request payload.
function resolveAssetForPayload(
  assetId: string,
  provider: SwapRoutingProvider,
  live: boolean
): string {
  const providerId = getProviderAssetId(assetId, provider);
  if (providerId) return providerId;
  if (live) {
    throw new Error(`Asset ${assetId} is not certified for live ${provider} routing.`);
  }
  return assetId;
}

export function buildProviderPayload(
  request: UnifiedSwapQuoteRequest,
  provider: SwapRoutingProvider,
  live = false
): Record<string, string> {
  const fromId = resolveAssetForPayload(request.fromAsset, provider, live);
  const toId = resolveAssetForPayload(request.toAsset, provider, live);

  if (provider === 'THORCHAIN') {
    return {
      endpoint: THOR_QUOTE_ENDPOINT,
      from_asset: fromId,
      to_asset: toId,
      amount: request.amount,
      destination: request.userAddress,
      affiliate: THOR_AFFILIATE_NAME,
      affiliate_bps: String(PLATFORM_SPREAD_BPS)
    };
  }

  // Rango Basic API: referrer monetization is referrerFee (percent) + an
  // optional referrerCode. `referrerAddress` is NOT a Rango parameter. The
  // apiKey is intentionally omitted here and injected only at fetch time so it
  // never appears in the stored/returned request payload.
  return {
    endpoint: RANGO_QUOTE_ENDPOINT,
    from: fromId,
    to: toId,
    amount: request.amount,
    slippage: '1.0',
    referrerFee: PLATFORM_SPREAD_PERCENT,
    ...(RANGO_REFERRER_CODE ? { referrerCode: RANGO_REFERRER_CODE } : {})
  };
}

function simulationQuote(input: SimulationInput, diagnostics: string[] = []): ProviderQuoteResult {
  const fee = applyPlatformFee(input.amount);

  return {
    mode: diagnostics.length ? 'fallback' : 'simulation',
    providerQuoteId: `sim_${input.provider.toLowerCase()}_${Date.now()}`,
    estimatedOutputAmount: fee.output,
    platformFeeAmount: fee.fee,
    priceImpactPct: estimatePriceImpactPct(input.amount, input.provider),
    requestPayload: buildProviderPayload(input.request, input.provider),
    latencyMs: 0,
    diagnostics: diagnostics.length ? diagnostics : ['simulation_quote_generated']
  };
}

function buildProviderUrl(payload: Record<string, string>): string {
  const endpoint = payload.endpoint;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(payload)) {
    if (key !== 'endpoint') params.set(key, value);
  }

  return `${endpoint}?${params.toString()}`;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  }

  return undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return undefined;
}

async function fetchProviderJson(
  payload: Record<string, string>,
  provider: SwapRoutingProvider
): Promise<any> {
  let url = buildProviderUrl(payload);
  const headers: Record<string, string> = { accept: 'application/json' };

  // Inject credentials at request time so secrets never enter the returned
  // request payload. Rango authenticates with an apiKey query param; THORNodes
  // identify callers with an x-client-id header.
  if (provider === 'RANGO' && RANGO_API_KEY) {
    url += `${url.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(RANGO_API_KEY)}`;
  }
  if (provider === 'THORCHAIN' && THOR_CLIENT_ID) {
    headers['x-client-id'] = THOR_CLIENT_ID;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`Provider returned HTTP ${response.status}`);
  }

  return response.json();
}

async function liveQuote(input: SimulationInput): Promise<ProviderQuoteResult> {
  const startedAt = Date.now();
  const payload = buildProviderPayload(input.request, input.provider, true);
  const json = await fetchProviderJson(payload, input.provider);
  const output = pickString(
    json?.expected_amount_out,
    json?.expectedAmountOut,
    json?.estimatedOutputAmount,
    json?.outputAmount,
    json?.route?.outputAmount,
    json?.result?.outputAmount
  );
  const impact = pickNumber(
    json?.priceImpact,
    json?.priceImpactPct,
    json?.route?.priceImpact,
    json?.result?.priceImpact
  );

  // Rango signals routing failures via resultType (OK | HIGH_IMPACT |
  // INPUT_LIMIT_ISSUE | NO_ROUTE) with a null route; surface it explicitly.
  if (typeof json?.resultType === 'string' && json.resultType !== 'OK' && !output) {
    throw new Error(`Provider returned resultType ${json.resultType} with no route.`);
  }

  if (!output) {
    throw new Error('Provider response did not include a parseable output amount.');
  }

  const grossOutput = BigInt(output.replace(/\D/g, '') || '0');
  const fee = applyPlatformFee(grossOutput > 0n ? grossOutput : input.amount);

  return {
    mode: 'live',
    providerQuoteId: pickString(json?.quoteId, json?.id, json?.requestId) ?? `live_${input.provider.toLowerCase()}_${Date.now()}`,
    estimatedOutputAmount: fee.output,
    platformFeeAmount: fee.fee,
    priceImpactPct: Number((impact ?? estimatePriceImpactPct(input.amount, input.provider)).toFixed(2)),
    requestPayload: payload,
    latencyMs: Date.now() - startedAt,
    diagnostics: ['live_provider_quote_received']
  };
}

export async function getProviderQuote(input: SimulationInput): Promise<ProviderQuoteResult> {
  if (!LIVE_MODE && !LIVE_WITH_FALLBACK) {
    return simulationQuote(input);
  }

  try {
    return await liveQuote(input);
  } catch (error: any) {
    if (LIVE_MODE) throw error;
    return simulationQuote(input, [`provider_fallback:${error.message}`]);
  }
}

export function getProviderModeLabel(): string {
  if (LIVE_MODE) return 'live';
  if (LIVE_WITH_FALLBACK) return 'live_with_fallback';
  return 'simulation';
}

export { PRICE_IMPACT_LIMIT_PCT };

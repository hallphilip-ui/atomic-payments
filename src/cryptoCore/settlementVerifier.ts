import { LIFI_API_KEY } from './swapConfig';
import { getLifiAsset } from './tokens';

// On-chain settlement verification for partner payouts.
//
// Partner earnings must never be trusted from the self-reported swap status — the
// /v1/swaps/quotes/:id/{authorize,advance} endpoints are public and can be driven
// to COMPLETE with no real transaction. Instead we ask LI.FI (the aggregator we
// actually route through) to confirm the reported txHash settled. Its status API
// returns both the settlement state AND the real USD value that moved, so a quote
// inflated to $300k but backed by a $1 tx credits only $1. Fails CLOSED: anything
// we can't positively confirm as DONE is treated as not-yet-settled (never paid).
const LIFI_STATUS_ENDPOINT = 'https://li.quest/v1/status';
const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export type SettlementResult =
  | { settled: true; amountUsd: number; txHash: string }
  | { settled: false; reason: string };

export async function verifyLifiSettlement(params: {
  txHash: string | undefined | null;
  fromAssetId: string;
}): Promise<SettlementResult> {
  const txHash = (params.txHash ?? '').trim();
  // Only EVM tx hashes are verifiable here; non-EVM settlements fall to manual review.
  if (!EVM_TX_HASH.test(txHash)) return { settled: false, reason: 'no_evm_txhash' };

  const from = getLifiAsset(params.fromAssetId);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (LIFI_API_KEY) headers['x-lifi-api-key'] = LIFI_API_KEY;

  const url = `${LIFI_STATUS_ENDPOINT}?txHash=${encodeURIComponent(txHash)}` +
    (from ? `&fromChain=${encodeURIComponent(from.chain)}` : '');

  let json: any;
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return { settled: false, reason: `lifi_status_http_${r.status}` };
    json = await r.json();
  } catch {
    return { settled: false, reason: 'lifi_status_unreachable' };
  }

  const status = String(json?.status ?? '').toUpperCase();
  if (status !== 'DONE') return { settled: false, reason: `status_${status || 'unknown'}` };

  // Real input USD that actually moved — the basis for the commission, not the
  // partner-supplied quote amount. Prefer sending.amountUSD; fall back defensively.
  const amountUsd = Number(
    json?.sending?.amountUSD ?? json?.fromAmountUSD ?? json?.sending?.amountUsd
  );
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { settled: false, reason: 'no_settled_usd' };

  return { settled: true, amountUsd, txHash };
}

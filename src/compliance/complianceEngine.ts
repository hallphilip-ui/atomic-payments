import { TokenRegistryEntry } from '../cryptoCore/tokens';

export type ComplianceStatus = 'AUTO_CLEARED' | 'MANUAL_REVIEW' | 'BLOCKED';
export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ComplianceAssessment = {
  status: ComplianceStatus;
  riskScore: number;
  riskTier: RiskTier;
  checks: string[];
  flags: string[];
};

const blockedAddressFragments = [
  'sanction',
  'blocked',
  'ofac',
  'terror',
  'mix',
  'tornado'
];

const enhancedReviewChains = new Set(['BITCOIN', 'DOGE', 'LITECOIN', 'TRON']);

function getAddressFormatCheck(asset: TokenRegistryEntry, address: string): { ok: boolean; check: string } {
  const normalized = address.trim();

  if (asset.chainFamily === 'evm') {
    return { ok: /^0x[a-fA-F0-9]{40}$/.test(normalized), check: 'evm_hex_destination_format' };
  }

  if (asset.chainFamily === 'svm') {
    return { ok: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(normalized), check: 'solana_base58_destination_format' };
  }

  if (asset.chain === 'BITCOIN') {
    return { ok: /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(normalized), check: 'bitcoin_destination_format' };
  }

  if (asset.chain === 'LITECOIN') {
    return { ok: /^(ltc1|[LM3])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(normalized), check: 'litecoin_destination_format' };
  }

  if (asset.chain === 'DOGE') {
    return { ok: /^D{1}[5-9A-HJ-NP-U]{1}[1-9A-HJ-NP-Za-km-z]{32}$/.test(normalized), check: 'dogecoin_destination_format' };
  }

  return { ok: normalized.length >= 8, check: 'generic_destination_format' };
}

function tierFromScore(score: number): RiskTier {
  if (score >= 90) return 'CRITICAL';
  if (score >= 70) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

function statusFromTier(tier: RiskTier): ComplianceStatus {
  if (tier === 'CRITICAL') return 'BLOCKED';
  if (tier === 'HIGH' || tier === 'MEDIUM') return 'MANUAL_REVIEW';
  return 'AUTO_CLEARED';
}

export function assessSwapCompliance(input: {
  fromAsset: TokenRegistryEntry;
  toAsset: TokenRegistryEntry;
  amount: string;
  userAddress: string;
  priceImpactPct: number;
  amountUsd?: number;
}): ComplianceAssessment {
  const checks: string[] = ['sanctions_keyword_screen', 'destination_address_format', 'travel_rule_threshold_screen'];
  const flags: string[] = [];
  let riskScore = 5;
  const normalizedAddress = input.userAddress.trim().toLowerCase();
  const format = getAddressFormatCheck(input.toAsset, input.userAddress);

  checks.push(format.check);
  if (!format.ok) {
    riskScore += 55;
    flags.push(`invalid_${format.check}`);
  }

  if (blockedAddressFragments.some((fragment) => normalizedAddress.includes(fragment))) {
    riskScore += 95;
    flags.push('sanctions_watchlist_keyword_match');
  }

  if (enhancedReviewChains.has(input.fromAsset.chain) || enhancedReviewChains.has(input.toAsset.chain)) {
    riskScore += 15;
    flags.push('enhanced_review_chain');
  }

  if (input.priceImpactPct > 1) {
    riskScore += 10;
    flags.push('elevated_price_impact');
  }

  // Large-value flag — USD-denominated so it's meaningful across assets. A raw
  // atomic threshold is nonsense: 10^10 units is $10k of a 6-decimal stablecoin but
  // $0.00002 of 18-decimal ETH (which false-flagged every ETH swap). Prefer the
  // provider's USD figure; fall back to a decimals-aware human amount.
  if (typeof input.amountUsd === 'number' && Number.isFinite(input.amountUsd)) {
    if (input.amountUsd >= 10000) { riskScore += 20; flags.push('large_notional_over_10k_usd'); }
  } else {
    const human = Number(BigInt(input.amount)) / 10 ** input.fromAsset.decimals;
    if (Number.isFinite(human) && human >= 100000) { riskScore += 20; flags.push('large_human_amount_fallback'); }
  }

  riskScore = Math.min(100, riskScore);
  const riskTier = tierFromScore(riskScore);

  return {
    status: statusFromTier(riskTier),
    riskScore,
    riskTier,
    checks,
    flags
  };
}

function getTransferAddressFormatCheck(network: string, address: string): { ok: boolean; check: string } {
  const normalizedNetwork = network.trim().toLowerCase();
  const normalizedAddress = address.trim();

  if (['base', 'ethereum', 'eth', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'avax', 'bnb'].includes(normalizedNetwork)) {
    return { ok: /^0x[a-fA-F0-9]{40}$/.test(normalizedAddress), check: 'evm_transfer_destination_format' };
  }

  if (['solana', 'sol'].includes(normalizedNetwork)) {
    return { ok: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(normalizedAddress), check: 'solana_transfer_destination_format' };
  }

  if (['tron', 'trx'].includes(normalizedNetwork)) {
    return { ok: /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(normalizedAddress), check: 'tron_transfer_destination_format' };
  }

  return { ok: normalizedAddress.length >= 8, check: 'generic_transfer_destination_format' };
}

export function assessTransferCompliance(input: {
  connectorId: string;
  // Ticker only (e.g. 'USDC'), not a registry entry — so no decimals are available
  // here, and none are needed: see the `amount` note below.
  asset: string;
  // HUMAN-denominated decimal string (e.g. '25000.00'), NOT atomic base units.
  // This differs from assessSwapCompliance, whose `amount` is atomic and must be
  // divided by the asset's decimals. Do not apply that normalization here — the
  // value is already human, and BigInt('25000.00') throws.
  amount: string;
  destinationAddress: string;
  network?: string;
  // USD notional from a TRUSTED server-side price source. Never populate this from
  // client/request input: a caller who can set it could understate notional and
  // suppress the large-transfer review flag.
  amountUsd?: number;
}): ComplianceAssessment {
  const checks: string[] = ['sanctions_keyword_screen', 'transfer_destination_format', 'outgoing_transfer_release_gate'];
  const flags: string[] = [];
  let riskScore = 5;
  const network = input.network || 'default';
  const normalizedAddress = input.destinationAddress.trim().toLowerCase();
  const format = getTransferAddressFormatCheck(network, input.destinationAddress);

  checks.push(format.check);
  if (!format.ok) {
    riskScore += 65;
    flags.push(`invalid_${format.check}`);
  }

  if (blockedAddressFragments.some((fragment) => normalizedAddress.includes(fragment))) {
    riskScore += 95;
    flags.push('sanctions_watchlist_keyword_match');
  }

  // Large-value flag. Prefer a USD figure so the threshold means dollars across
  // assets — a bare token count only tracks notional for ~$1 stablecoins (10,000
  // TRX and 10,000 ETH are wildly different money). Falls back to the token-count
  // comparison when no trusted USD figure is supplied, which is today's behaviour.
  if (typeof input.amountUsd === 'number' && Number.isFinite(input.amountUsd)) {
    if (input.amountUsd >= 10000) {
      riskScore += 35;
      flags.push('large_transfer_over_10k_usd');
    }
  } else {
    const amount = Number(input.amount);
    if (Number.isFinite(amount) && amount >= 10000) {
      riskScore += 35;
      flags.push('large_transfer_threshold');
    }
  }

  if (['tron', 'trx'].includes(network.trim().toLowerCase())) {
    riskScore += 30;
    flags.push('enhanced_review_network');
  }

  riskScore = Math.min(100, riskScore);
  const riskTier = tierFromScore(riskScore);

  return {
    status: statusFromTier(riskTier),
    riskScore,
    riskTier,
    checks,
    flags
  };
}

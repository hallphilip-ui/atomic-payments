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

  if (BigInt(input.amount) >= 10_000_000_000n) {
    riskScore += 20;
    flags.push('large_atomic_amount_threshold');
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

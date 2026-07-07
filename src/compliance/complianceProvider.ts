import { TokenRegistryEntry } from '../cryptoCore/tokens';
import { ComplianceAssessment, assessSwapCompliance } from './complianceEngine';
import { screenAddresses, screenCountry, isChainalysisConfigured, localListSize, SanctionsHit } from './sanctions';

export type ComplianceProviderMode = 'simulation' | 'live' | 'live_with_fallback';

export type ComplianceProviderResult = ComplianceAssessment & {
  vendorMode: ComplianceProviderMode;
  vendorProvider: string;
  vendorReferenceId: string;
  vendorDecision: string;
  vendorLatencyMs: number;
  vendorMetadata: Record<string, string | number | boolean>;
};

type ComplianceScreenInput = {
  fromAsset: TokenRegistryEntry;
  toAsset: TokenRegistryEntry;
  amount: string;
  userAddress: string;
  priceImpactPct: number;
  sourceAddress?: string;
  countryCode?: string;
};

// Redact a matched address in logs/evidence: keep enough to reconcile, not the whole thing.
function redactAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function providerMode(): ComplianceProviderMode {
  const mode = process.env.ATOMIC_COMPLIANCE_PROVIDER_MODE;
  if (mode === 'live') return 'live';
  if (mode === 'live_with_fallback') return 'live_with_fallback';
  return 'simulation';
}

export async function screenSwapCompliance(input: ComplianceScreenInput): Promise<ComplianceProviderResult> {
  const startedAt = Date.now();
  const assessment = assessSwapCompliance(input);
  const mode = providerMode();

  // Real sanctions screening: OFAC address list (offline, always) + Chainalysis
  // oracle (if configured) on the destination and source addresses, plus an OFAC
  // jurisdiction block from the request country. Any hit forces a hard BLOCK.
  const sanctionsHit: SanctionsHit | null = await screenAddresses([input.userAddress, input.sourceAddress]);
  const jurisdictionBlocked = screenCountry(input.countryCode);
  const chainalysisOn = isChainalysisConfigured();

  const checks = [...assessment.checks, 'ofac_sanctioned_address_screen', 'jurisdiction_screen'];
  const flags = [...assessment.flags];
  let status = assessment.status;
  let riskScore = assessment.riskScore;
  let riskTier = assessment.riskTier;

  if (sanctionsHit) {
    status = 'BLOCKED';
    riskScore = 100;
    riskTier = 'CRITICAL';
    flags.push(`sanctioned_address:${sanctionsHit.source}`);
  }
  if (jurisdictionBlocked) {
    status = 'BLOCKED';
    riskScore = 100;
    riskTier = 'CRITICAL';
    flags.push(`sanctioned_jurisdiction:${(input.countryCode || '').toUpperCase()}`);
  }

  const decision = status === 'BLOCKED' ? 'deny' : status === 'MANUAL_REVIEW' ? 'review' : 'clear';
  // Live when the Chainalysis oracle is wired; otherwise the offline OFAC list +
  // jurisdiction block still run — so screening is never fully "simulation".
  const vendorMode = chainalysisOn ? 'live' : mode === 'live' ? 'live_with_fallback' : mode;
  const vendorProvider = sanctionsHit
    ? sanctionsHit.source === 'chainalysis_oracle' ? 'chainalysis-sanctions-oracle' : 'ofac-sdn-local'
    : chainalysisOn ? 'chainalysis-sanctions-oracle' : 'ofac-sdn-local';

  return {
    status,
    riskScore,
    riskTier,
    checks,
    flags,
    vendorMode,
    vendorProvider,
    vendorReferenceId: `kyt_${input.toAsset.chain.toLowerCase()}_${Date.now()}`,
    vendorDecision: decision,
    vendorLatencyMs: Date.now() - startedAt,
    vendorMetadata: {
      screeningModel: 'ofac_address_and_jurisdiction_v1',
      chainalysisConfigured: chainalysisOn,
      ofacLocalListSize: localListSize(),
      countryScreened: (input.countryCode || 'unknown').toUpperCase(),
      jurisdictionBlocked,
      sanctionsMatch: sanctionsHit ? redactAddress(sanctionsHit.matchedAddress) : '',
      sanctionsMatchSource: sanctionsHit ? sanctionsHit.source : '',
      chain: input.toAsset.chain,
      assetContext: `${input.fromAsset.assetId}->${input.toAsset.assetId}`
    }
  };
}

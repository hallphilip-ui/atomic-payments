import { TokenRegistryEntry } from '../cryptoCore/tokens';
import { ComplianceAssessment, assessSwapCompliance } from './complianceEngine';
import { screenAddresses, screenCountry, isChainalysisConfigured, isLiveSanctionsAvailable, localListSize, SanctionsHit } from './sanctions';

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
  amountUsd?: number;
  sourceAddress?: string;
  countryCode?: string;
  // False only when an edge secret is configured AND the request didn't present it
  // (i.e. it bypassed our Cloudflare edge) — jurisdiction then can't be trusted.
  jurisdictionTrusted?: boolean;
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
  // Fail safe: if the caller told us the jurisdiction signal is untrusted (request
  // bypassed our edge while an edge secret is configured), treat it as blocked — we
  // can't verify the visitor isn't in an embargoed country.
  const jurisdictionUntrusted = input.jurisdictionTrusted === false;
  const jurisdictionBlocked = jurisdictionUntrusted || screenCountry(input.countryCode);
  const chainalysisOn = isChainalysisConfigured();
  const liveScreen = isLiveSanctionsAvailable(); // keyless on-chain oracle → live by default

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
    flags.push(jurisdictionUntrusted
      ? 'jurisdiction_unverifiable_untrusted_edge'
      : `sanctioned_jurisdiction:${(input.countryCode || '').toUpperCase()}`);
  }

  const decision = status === 'BLOCKED' ? 'deny' : status === 'MANUAL_REVIEW' ? 'review' : 'clear';
  // Screening is LIVE by default now: the keyless Chainalysis on-chain oracle runs
  // on every EVM address (no key needed), on top of the offline OFAC list + the
  // jurisdiction block. The HTTP API adds extra coverage only when a key is set.
  const vendorMode = liveScreen ? 'live' : mode;
  const providerFor = (s: SanctionsHit['source']) =>
    s === 'ofac_sdn_local' ? 'ofac-sdn-local'
      : s === 'chainalysis_oracle_onchain' ? 'chainalysis-sanctions-oracle-onchain'
        : 'chainalysis-sanctions-oracle';
  const vendorProvider = sanctionsHit ? providerFor(sanctionsHit.source) : 'chainalysis-sanctions-oracle-onchain';

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
      screeningModel: 'ofac_address_and_jurisdiction_v2_onchain_oracle',
      liveSanctionsOnchain: liveScreen,
      chainalysisHttpConfigured: chainalysisOn,
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

import { TokenRegistryEntry } from '../cryptoCore/tokens';
import { ComplianceAssessment, assessSwapCompliance } from './complianceEngine';

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
};

function providerMode(): ComplianceProviderMode {
  const mode = process.env.ATOMIC_COMPLIANCE_PROVIDER_MODE;
  if (mode === 'live') return 'live';
  if (mode === 'live_with_fallback') return 'live_with_fallback';
  return 'simulation';
}

function vendorDecisionFromAssessment(assessment: ComplianceAssessment): string {
  if (assessment.status === 'BLOCKED') return 'deny';
  if (assessment.status === 'MANUAL_REVIEW') return 'review';
  return 'clear';
}

export async function screenSwapCompliance(input: ComplianceScreenInput): Promise<ComplianceProviderResult> {
  const startedAt = Date.now();
  const assessment = assessSwapCompliance(input);
  const mode = providerMode();

  return {
    ...assessment,
    vendorMode: mode === 'live' ? 'simulation' : mode,
    vendorProvider: 'atomic-simulated-kyt',
    vendorReferenceId: `kyt_${input.toAsset.chain.toLowerCase()}_${Date.now()}`,
    vendorDecision: vendorDecisionFromAssessment(assessment),
    vendorLatencyMs: Date.now() - startedAt,
    vendorMetadata: {
      screeningModel: 'deterministic_v1',
      vendorReady: false,
      chain: input.toAsset.chain,
      assetContext: `${input.fromAsset.assetId}->${input.toAsset.assetId}`,
      fallbackReason: mode === 'live' ? 'live_vendor_not_configured' : ''
    }
  };
}

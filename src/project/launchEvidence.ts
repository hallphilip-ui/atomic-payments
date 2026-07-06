import { getProductionObservabilityReadiness } from '../observability/productionObservability';
import { getBuildInfo } from './buildInfo';
import { getLaunchReadiness } from './launchReadiness';
import { getProjectProgress } from './progress';

export type LaunchEvidenceItem = {
  id: string;
  label: string;
  status: 'local_verified' | 'external_required';
  proof: string;
};

export function getLaunchEvidenceBundle() {
  const progress = getProjectProgress();
  const launchReadiness = getLaunchReadiness();
  const observability = getProductionObservabilityReadiness();
  const externalProofRequired = launchReadiness.blockers
    .filter((blocker) => blocker.externalDependency)
    .map((blocker) => ({
      id: blocker.id,
      area: blocker.area,
      owner: blocker.owner,
      requiredProof: blocker.requiredProof,
      nextAction: blocker.nextAction
    }));

  const localVerification: LaunchEvidenceItem[] = [
    {
      id: 'core-smoke',
      label: 'Core payment and swap smoke',
      status: 'local_verified',
      proof:
        'npm run smoke:core:isolated covers health, assets, checkout intent lifecycle, swap authorization, wallet broadcast simulation, metrics, compliance review, audit export, settlement reconciliation, and operator protection.'
    },
    {
      id: 'deploy-readiness',
      label: 'Deployment readiness gate',
      status: 'local_verified',
      proof:
        'npm run check:deploy validates deploy posture locally and fails strict production mode when required infrastructure, secrets, observability, or build metadata are missing.'
    },
    {
      id: 'operator-security',
      label: 'Operator route protection',
      status: 'local_verified',
      proof: 'npm run test:operator-auth verifies privileged route guards, API key validation, and read-only role rules.'
    },
    {
      id: 'observability-contract',
      label: 'Production observability contract',
      status: 'local_verified',
      proof: 'npm run test:observability verifies log redaction and production observability readiness metadata.'
    },
    {
      id: 'provider-boundaries',
      label: 'Provider and transfer-only boundaries',
      status: 'local_verified',
      proof:
        'Provider, platform connector, transfer compliance, wallet broadcast, and test-account contract scripts are present for CI and release validation.'
    }
  ];

  return {
    service: 'atomic-payments',
    generatedAt: new Date().toISOString(),
    build: getBuildInfo(),
    completion: {
      overallCompletionPct: progress.overallCompletionPct,
      overallCompletionRange: progress.overallCompletionRange,
      localSoftwareReadyForBugTest: launchReadiness.localSoftwareBlockerCount === 0,
      productionLaunchReady: launchReadiness.status === 'ready'
    },
    localVerification,
    externalProofRequired,
    observability: {
      status: observability.status,
      configuredCount: observability.configuredCount,
      missingCount: observability.missingCount,
      requiredSignals: observability.requiredSignals,
      alertTriggers: observability.alertTriggers
    },
    releaseDecision: {
      decision: launchReadiness.localSoftwareBlockerCount === 0 ? 'bug_test_candidate' : 'local_blocked',
      reason:
        launchReadiness.localSoftwareBlockerCount === 0
          ? 'The local software gates are packaged for bug testing; production launch still requires external proof items.'
          : 'Local software blockers remain and should be cleared before bug testing.',
      remainingExternalSignoffs: launchReadiness.finishLine.requiresExternalSignoff
    }
  };
}

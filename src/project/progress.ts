export type ProjectWorkstream = {
  id: string;
  label: string;
  completionRange: string;
  completionPct: number;
  status: 'complete' | 'in_progress' | 'blocked';
};

export type ProjectProgress = {
  service: 'atomic-payments';
  updatedAt: string;
  overallCompletionRange: string;
  overallCompletionPct: number;
  summary: string;
  workstreams: ProjectWorkstream[];
  nextSlices: string[];
};

const UPDATED_AT = '2026-07-03';

export function getProjectProgress(): ProjectProgress {
  return {
    service: 'atomic-payments',
    updatedAt: UPDATED_AT,
    overallCompletionRange: '84-86%',
    overallCompletionPct: 85,
    summary: 'Working local foundation is in place with Cloudflare readiness checks, a Postgres schema path, mocked live-provider contract coverage, a cross-platform checkout UI, real local payment-intent checkout contracts, tethered-asset checkout rails, transfer-only platform connector boundaries, simulated withdrawal compliance gates, and CI-backed contract coverage; remaining work is official live provider certification, wallet broadcast, production KYT vendors, hosted migration, role controls, reconciliation, and operations.',
    workstreams: [
      { id: 'core-api', label: 'Core API and Docker', completionRange: '82-84%', completionPct: 83, status: 'in_progress' },
      { id: 'settlement', label: 'Off-exchange settlement', completionRange: '61-65%', completionPct: 63, status: 'in_progress' },
      { id: 'defi-swap', label: 'DeFi swap core', completionRange: '66-69%', completionPct: 68, status: 'in_progress' },
      { id: 'compliance', label: 'AML and compliance', completionRange: '64-68%', completionPct: 66, status: 'in_progress' },
      { id: 'console-ux', label: 'Console UX and brand', completionRange: '75-78%', completionPct: 77, status: 'in_progress' },
      { id: 'smoke-coverage', label: 'Smoke coverage', completionRange: '79-82%', completionPct: 81, status: 'in_progress' }
    ],
    nextSlices: [
      'Hosted Postgres migration and smoke test',
      'Official Rango and THORChain live-doc verification',
      'Production wallet transaction broadcast',
      'Production KYT/sanctions vendor bridge'
    ]
  };
}

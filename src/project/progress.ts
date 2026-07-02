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

const UPDATED_AT = '2026-07-02';

export function getProjectProgress(): ProjectProgress {
  return {
    service: 'atomic-payments',
    updatedAt: UPDATED_AT,
    overallCompletionRange: '76-78%',
    overallCompletionPct: 77,
    summary: 'Working local foundation is in place with Cloudflare readiness checks and a Postgres schema path; remaining work is live providers, wallet broadcast, compliance vendors, hosted migration, and operations.',
    workstreams: [
      { id: 'core-api', label: 'Core API and Docker', completionRange: '74-78%', completionPct: 76, status: 'in_progress' },
      { id: 'settlement', label: 'Off-exchange settlement', completionRange: '52-57%', completionPct: 55, status: 'in_progress' },
      { id: 'defi-swap', label: 'DeFi swap core', completionRange: '63-66%', completionPct: 65, status: 'in_progress' },
      { id: 'compliance', label: 'AML and compliance', completionRange: '57-60%', completionPct: 59, status: 'in_progress' },
      { id: 'console-ux', label: 'Console UX and brand', completionRange: '58-62%', completionPct: 60, status: 'in_progress' },
      { id: 'smoke-coverage', label: 'Smoke coverage', completionRange: '66-70%', completionPct: 68, status: 'in_progress' }
    ],
    nextSlices: [
      'Hosted Postgres migration and smoke test',
      'Live Rango and THORChain payload verification',
      'Production wallet transaction broadcast',
      'Production KYT/sanctions vendor bridge'
    ]
  };
}

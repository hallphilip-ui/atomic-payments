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

const UPDATED_AT = '2026-07-01';

export function getProjectProgress(): ProjectProgress {
  return {
    service: 'atomic-payments',
    updatedAt: UPDATED_AT,
    overallCompletionRange: '73-75%',
    overallCompletionPct: 74,
    summary: 'Working local foundation is in place; remaining work is production hardening, live providers, wallet broadcast, compliance vendors, and operations.',
    workstreams: [
      { id: 'core-api', label: 'Core API and Docker', completionRange: '70-74%', completionPct: 72, status: 'in_progress' },
      { id: 'settlement', label: 'Off-exchange settlement', completionRange: '50-55%', completionPct: 53, status: 'in_progress' },
      { id: 'defi-swap', label: 'DeFi swap core', completionRange: '63-66%', completionPct: 65, status: 'in_progress' },
      { id: 'compliance', label: 'AML and compliance', completionRange: '55-58%', completionPct: 57, status: 'in_progress' },
      { id: 'console-ux', label: 'Console UX and brand', completionRange: '58-62%', completionPct: 60, status: 'in_progress' },
      { id: 'smoke-coverage', label: 'Smoke coverage', completionRange: '58-61%', completionPct: 60, status: 'in_progress' }
    ],
    nextSlices: [
      'Managed database migration path',
      'Live Rango and THORChain payload verification',
      'Production wallet transaction broadcast',
      'Production KYT/sanctions vendor bridge'
    ]
  };
}

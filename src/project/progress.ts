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
    overallCompletionRange: '77-79%',
    overallCompletionPct: 78,
    summary: 'Working local foundation is in place with Cloudflare readiness checks, a Postgres schema path, and mocked live-provider contract coverage; remaining work is official live provider certification, wallet broadcast, compliance vendors, hosted migration, and operations.',
    workstreams: [
      { id: 'core-api', label: 'Core API and Docker', completionRange: '74-78%', completionPct: 76, status: 'in_progress' },
      { id: 'settlement', label: 'Off-exchange settlement', completionRange: '52-57%', completionPct: 55, status: 'in_progress' },
      { id: 'defi-swap', label: 'DeFi swap core', completionRange: '66-69%', completionPct: 68, status: 'in_progress' },
      { id: 'compliance', label: 'AML and compliance', completionRange: '57-60%', completionPct: 59, status: 'in_progress' },
      { id: 'console-ux', label: 'Console UX and brand', completionRange: '58-62%', completionPct: 60, status: 'in_progress' },
      { id: 'smoke-coverage', label: 'Smoke coverage', completionRange: '68-72%', completionPct: 70, status: 'in_progress' }
    ],
    nextSlices: [
      'Hosted Postgres migration and smoke test',
      'Official Rango and THORChain live-doc verification',
      'Production wallet transaction broadcast',
      'Production KYT/sanctions vendor bridge'
    ]
  };
}

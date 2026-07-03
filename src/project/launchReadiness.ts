export type LaunchReadinessStatus = 'ready' | 'blocked' | 'external_required';

export type LaunchBlocker = {
  id: string;
  area: string;
  status: LaunchReadinessStatus;
  owner: string;
  requiredProof: string;
  nextAction: string;
  externalDependency: boolean;
};

const launchBlockers: LaunchBlocker[] = [
  {
    id: 'hosted-postgres-migration',
    area: 'Infrastructure',
    status: 'external_required',
    owner: 'platform',
    requiredProof: 'Managed Postgres DATABASE_URL, migration log, and hosted smoke run',
    nextAction: 'Provision hosted database, run Prisma migration, and execute isolated smoke against the hosted service.',
    externalDependency: true
  },
  {
    id: 'live-swap-provider-certification',
    area: 'DeFi swap core',
    status: 'external_required',
    owner: 'provider-integrations',
    requiredProof: 'Official Rango and THORChain live request/response contract captures',
    nextAction: 'Verify current live provider payloads and run provider contract tests with captured fixtures.',
    externalDependency: true
  },
  {
    id: 'wallet-broadcast',
    area: 'Wallet execution',
    status: 'external_required',
    owner: 'wallets',
    requiredProof: 'Signed EVM and Solana transaction broadcast receipts on supported networks',
    nextAction: 'Configure live RPC URLs, run guarded broadcast checks, and capture chain receipts.',
    externalDependency: true
  },
  {
    id: 'kyt-sanctions-vendor',
    area: 'AML and compliance',
    status: 'external_required',
    owner: 'compliance',
    requiredProof: 'KYT/sanctions provider credentials, request IDs, decisions, and case references',
    nextAction: 'Connect production vendor credentials and map provider responses into compliance evidence exports.',
    externalDependency: true
  },
  {
    id: 'immutable-evidence-archive',
    area: 'Operations',
    status: 'external_required',
    owner: 'operations',
    requiredProof: 'Immutable archive writes for operator audit and settlement reconciliation exports',
    nextAction: 'Configure archive storage and write verified export payloads during operational review cycles.',
    externalDependency: true
  },
  {
    id: 'live-reconciliation-ingestion',
    area: 'Settlement operations',
    status: 'external_required',
    owner: 'settlement',
    requiredProof: 'Provider transfer events matched to treasury ledger entries and reconciliation exports',
    nextAction: 'Ingest live platform transfer events and compare them against settlement instructions.',
    externalDependency: true
  },
  {
    id: 'production-observability',
    area: 'Operations',
    status: 'external_required',
    owner: 'platform',
    requiredProof: 'Log shipping, metrics dashboards, alert rules, and incident runbook links',
    nextAction: 'Configure production observability URLs and verify alert response links before launch.',
    externalDependency: true
  }
];

export function getLaunchReadiness() {
  const readyCount = launchBlockers.filter((blocker) => blocker.status === 'ready').length;
  const blockedCount = launchBlockers.filter((blocker) => blocker.status === 'blocked').length;
  const externalRequiredCount = launchBlockers.filter((blocker) => blocker.status === 'external_required').length;

  return {
    service: 'atomic-payments',
    target: 'production_launch',
    status: readyCount === launchBlockers.length ? 'ready' : 'blocked',
    completionPct: 91,
    blockerCount: launchBlockers.length - readyCount,
    blockedCount,
    externalRequiredCount,
    localSoftwareBlockerCount: blockedCount,
    blockers: launchBlockers,
    finishLine: {
      canFinishLocallyToday: [],
      requiresExternalSignoff: launchBlockers
        .filter((blocker) => blocker.externalDependency)
        .map((blocker) => blocker.id)
    }
  };
}

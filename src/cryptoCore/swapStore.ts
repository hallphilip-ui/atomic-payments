import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { UnifiedSwapQuote, UnifiedSwapQuoteRequest, getEnforcedPlatformQuote } from './routing';
import { getSwapAsset } from './tokens';
import { screenSwapCompliance } from '../compliance/complianceProvider';
import { toComplianceReviewView } from '../compliance/complianceStore';
import { broadcastSignedTransaction } from './walletBroadcastAdapters';

const prisma = new PrismaClient();

type StoredSwapQuote = {
  id: string;
  status: string;
  provider: string;
  fromAsset: string;
  toAsset: string;
  amount: string;
  userAddress: string;
  estimatedOutputAmount: string;
  platformFeeBps: number;
  platformFeeAmount: string;
  priceImpactPct: number;
  priceImpactLimitPct: number;
  providerMode: string;
  providerQuoteId: string | null;
  providerLatencyMs: number;
  providerDiagnostics: string;
  quoteTtlSeconds: number;
  expiresAt: Date;
  requestPayload: string;
  executionStates: string;
  guardrails: string;
  currentState: string;
  walletType: string | null;
  walletAddress: string | null;
  signatureKind: string | null;
  signatureHash: string | null;
  signedMessageHash: string | null;
  authorizationMetadata: string;
  authorizedAt: Date | null;
  createdAt: Date;
};

type StoredComplianceReview = {
  id: string;
  subjectType: string;
  subjectId: string;
  swapQuoteId: string | null;
  status: string;
  riskScore: number;
  riskTier: string;
  walletAddress: string | null;
  assetContext: string | null;
  checks: string;
  flags: string;
  vendorMode: string;
  vendorProvider: string;
  vendorReferenceId: string | null;
  vendorDecision: string | null;
  vendorLatencyMs: number;
  vendorMetadata: string;
  decisionNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

type StoredSwapEvent = {
  id: string;
  quoteId: string;
  state: string;
  status: string;
  message: string;
  createdAt: Date;
};

type SwapExecutionEventView = {
  id: string;
  quoteId: string;
  state: string;
  status: string;
  message: string;
  createdAt: string;
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toEventView(event: StoredSwapEvent): SwapExecutionEventView {
  return {
    id: event.id,
    quoteId: event.quoteId,
    state: event.state,
    status: event.status,
    message: event.message,
    createdAt: event.createdAt.toISOString()
  };
}

function toSwapQuoteView(quote: StoredSwapQuote): UnifiedSwapQuote & {
  currentState: string;
  userAddress: string;
  walletAuthorization: {
    walletType: string | null;
    walletAddress: string | null;
    signatureKind: string | null;
    signatureHash: string | null;
    signedMessageHash: string | null;
    metadata: Record<string, unknown>;
    authorizedAt: string | null;
  };
  createdAt: string;
} {
  const fromAsset = getSwapAsset(quote.fromAsset);
  const toAsset = getSwapAsset(quote.toAsset);

  if (!fromAsset || !toAsset) {
    throw new Error('Stored swap quote references an asset that is no longer enabled.');
  }

  return {
    id: quote.id,
    status: quote.status as UnifiedSwapQuote['status'],
    provider: quote.provider as UnifiedSwapQuote['provider'],
    fromAsset,
    toAsset,
    amount: quote.amount,
    estimatedOutputAmount: quote.estimatedOutputAmount,
    platformFeeBps: quote.platformFeeBps,
    platformFeeAmount: quote.platformFeeAmount,
    priceImpactPct: quote.priceImpactPct,
    priceImpactLimitPct: quote.priceImpactLimitPct,
    providerMode: quote.providerMode,
    providerQuoteId: quote.providerQuoteId ?? undefined,
    providerLatencyMs: quote.providerLatencyMs,
    providerDiagnostics: parseJson<string[]>(quote.providerDiagnostics, []),
    expiresAt: quote.expiresAt.toISOString(),
    quoteTtlSeconds: quote.quoteTtlSeconds,
    requestPayload: parseJson<Record<string, string>>(quote.requestPayload, {}),
    executionStates: parseJson<string[]>(quote.executionStates, []),
    guardrails: parseJson<string[]>(quote.guardrails, []),
    currentState: quote.currentState,
    userAddress: quote.userAddress,
    walletAuthorization: {
      walletType: quote.walletType,
      walletAddress: quote.walletAddress,
      signatureKind: quote.signatureKind,
      signatureHash: quote.signatureHash,
      signedMessageHash: quote.signedMessageHash,
      metadata: parseJson<Record<string, unknown>>(quote.authorizationMetadata, {}),
      authorizedAt: quote.authorizedAt?.toISOString() ?? null
    },
    createdAt: quote.createdAt.toISOString()
  };
}

export async function createStoredSwapQuote(request: UnifiedSwapQuoteRequest) {
  const quote = await getEnforcedPlatformQuote(request);
  const compliance = await screenSwapCompliance({
    fromAsset: quote.fromAsset,
    toAsset: quote.toAsset,
    amount: quote.amount,
    userAddress: request.userAddress,
    priceImpactPct: quote.priceImpactPct
  });

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.swapQuote.create({
      data: {
        status: quote.status === 'QUOTED' && compliance.status === 'BLOCKED' ? 'BLOCKED' : quote.status,
        provider: quote.provider,
        fromAsset: quote.fromAsset.assetId,
        toAsset: quote.toAsset.assetId,
        amount: quote.amount,
        userAddress: request.userAddress,
        estimatedOutputAmount: quote.estimatedOutputAmount,
        platformFeeBps: quote.platformFeeBps,
        platformFeeAmount: quote.platformFeeAmount,
        priceImpactPct: quote.priceImpactPct,
        priceImpactLimitPct: quote.priceImpactLimitPct,
        providerMode: quote.providerMode ?? 'simulation',
        providerQuoteId: quote.providerQuoteId,
        providerLatencyMs: quote.providerLatencyMs ?? 0,
        providerDiagnostics: JSON.stringify(quote.providerDiagnostics ?? []),
        quoteTtlSeconds: quote.quoteTtlSeconds,
        expiresAt: new Date(quote.expiresAt),
        requestPayload: JSON.stringify(quote.requestPayload),
        executionStates: JSON.stringify(quote.executionStates),
        guardrails: JSON.stringify(quote.guardrails),
        currentState: quote.status === 'HALTED' ? 'HALTED' : compliance.status === 'BLOCKED' ? 'COMPLIANCE_BLOCKED' : quote.executionStates[0]
      }
    });

    const review = await tx.complianceReview.create({
      data: {
        subjectType: 'SWAP_QUOTE',
        subjectId: created.id,
        swapQuoteId: created.id,
        status: compliance.status,
        riskScore: compliance.riskScore,
        riskTier: compliance.riskTier,
        walletAddress: request.userAddress,
        assetContext: `${quote.fromAsset.assetId}->${quote.toAsset.assetId}`,
        checks: JSON.stringify(compliance.checks),
        flags: JSON.stringify(compliance.flags),
        vendorMode: compliance.vendorMode,
        vendorProvider: compliance.vendorProvider,
        vendorReferenceId: compliance.vendorReferenceId,
        vendorDecision: compliance.vendorDecision,
        vendorLatencyMs: compliance.vendorLatencyMs,
        vendorMetadata: JSON.stringify(compliance.vendorMetadata)
      }
    });

    await tx.swapExecutionEvent.create({
      data: {
        quoteId: created.id,
        state: created.currentState,
        status: created.status,
        message: created.status === 'HALTED'
          ? 'Quote halted because price impact exceeded the configured limit.'
          : compliance.status === 'BLOCKED'
            ? 'Quote blocked by compliance screening.'
            : compliance.status === 'MANUAL_REVIEW'
              ? 'Quote created with compliance review required before authorization.'
              : 'Quote created, auto-cleared by compliance, and waiting for client signature.'
      }
    });

    return { created, review };
  });

  return {
    // execution is transient (not persisted) and only returned for a clean,
    // compliance-cleared QUOTED status so a blocked/halted quote can't be signed.
    quote: {
      ...toSwapQuoteView(result.created),
      execution: result.created.status === 'QUOTED' ? quote.execution : undefined
    },
    complianceReview: toComplianceReviewView(result.review as StoredComplianceReview)
  };
}

export async function listStoredSwapQuotes() {
  const quotes = await prisma.swapQuote.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  return quotes.map(toSwapQuoteView);
}

// Public transfers explorer: groups swap conversions into pending/complete/
// failed buckets, paginates, and reports per-bucket counts for the filter tabs.
const TRANSFER_STATUS_GROUPS: Record<string, string[]> = {
  pending: ['QUOTED', 'AUTHORIZED', 'ROUTING'],
  complete: ['COMPLETE'],
  failed: ['HALTED', 'BLOCKED', 'EXPIRED']
};

function statusGroupFor(status: string): 'pending' | 'complete' | 'failed' {
  for (const [group, members] of Object.entries(TRANSFER_STATUS_GROUPS)) {
    if (members.includes(status)) return group as 'pending' | 'complete' | 'failed';
  }
  return 'pending';
}

function formatAtomicAmount(amount: string, decimals: number): string {
  if (!/^[0-9]+$/.test(amount)) return amount;
  const padded = amount.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals) || '0';
  const fraction = (decimals > 0 ? padded.slice(padded.length - decimals) : '').replace(/0+$/, '').slice(0, 6);
  const wholeGrouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${wholeGrouped}.${fraction}` : wholeGrouped;
}

function truncateAddress(address: string | null | undefined): string | null {
  const a = (address ?? '').trim();
  if (!a) return null;
  return a.length <= 14 ? a : `${a.slice(0, 8)}…${a.slice(-6)}`;
}

export async function listTransfers(options: { statusGroup?: string; page?: number; pageSize?: number }) {
  const requested = (options.statusGroup ?? 'all').toLowerCase();
  const group = ['pending', 'complete', 'failed'].includes(requested) ? requested : 'all';
  const page = Number.isFinite(options.page) && (options.page as number) > 0 ? Math.floor(options.page as number) : 0;
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20)));
  const where = group === 'all' ? {} : { status: { in: TRANSFER_STATUS_GROUPS[group] } };

  const [rows, total, grouped] = await Promise.all([
    prisma.swapQuote.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * pageSize, take: pageSize }),
    prisma.swapQuote.count({ where }),
    prisma.swapQuote.groupBy({ by: ['status'], _count: { _all: true } })
  ]);

  const statusCounts = { all: 0, pending: 0, complete: 0, failed: 0 };
  for (const entry of grouped) {
    const count = (entry as { _count: { _all: number } })._count._all;
    statusCounts.all += count;
    statusCounts[statusGroupFor(entry.status)] += count;
  }

  const transfers = rows.map((row) => {
    const fromAsset = getSwapAsset(row.fromAsset);
    const toAsset = getSwapAsset(row.toAsset);
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      status: row.status,
      statusGroup: statusGroupFor(row.status),
      currentState: row.currentState,
      provider: row.provider,
      priceImpactPct: row.priceImpactPct,
      platformFeeBps: row.platformFeeBps,
      from: {
        symbol: fromAsset?.symbol ?? row.fromAsset,
        chain: fromAsset?.chain ?? row.fromAsset.split('.')[0],
        amount: formatAtomicAmount(row.amount, fromAsset?.decimals ?? 0)
      },
      to: {
        symbol: toAsset?.symbol ?? row.toAsset,
        chain: toAsset?.chain ?? row.toAsset.split('.')[0],
        // Simulation quotes express estimatedOutputAmount in the INPUT asset's
        // atomic units (input minus fee), so format with the from-asset decimals
        // to avoid underflow to 0. Real per-asset output scaling arrives with
        // live provider certification (see docs/provider-certification-checklist).
        amount: formatAtomicAmount(row.estimatedOutputAmount, fromAsset?.decimals ?? toAsset?.decimals ?? 0)
      },
      address: truncateAddress(row.walletAddress ?? row.userAddress)
    };
  });

  return {
    transfers,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    statusFilter: group,
    statusCounts,
    generatedAt: new Date().toISOString()
  };
}

export async function getStoredSwapQuote(quoteId: string) {
  const quote = await prisma.swapQuote.findUnique({ where: { id: quoteId } });
  if (!quote) {
    throw new Error('Swap quote not found.');
  }

  return toSwapQuoteView(quote);
}

export async function listSwapExecutionEvents(quoteId: string) {
  const events = await prisma.swapExecutionEvent.findMany({
    where: { quoteId },
    orderBy: { createdAt: 'asc' }
  });

  return events.map(toEventView);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function authorizeStoredSwapQuote(quoteId: string, authorization: {
  signature: string;
  walletType?: string;
  walletAddress?: string;
  signatureKind?: string;
  signedMessage?: string;
  chainIntent?: string;
}) {
  const signature = authorization.signature?.trim() ?? '';
  if (signature.length < 8) {
    throw new Error('A wallet signature or transaction hash is required.');
  }

  const quote = await prisma.swapQuote.findUnique({ where: { id: quoteId } });
  if (!quote) {
    throw new Error('Swap quote not found.');
  }

  if (quote.status === 'HALTED') {
    throw new Error('Halted quotes cannot be authorized.');
  }

  if (quote.status === 'BLOCKED') {
    throw new Error('Blocked quotes cannot be authorized.');
  }

  const complianceReview = await prisma.complianceReview.findFirst({
    where: { swapQuoteId: quote.id },
    orderBy: { createdAt: 'desc' }
  });

  if (complianceReview && ['MANUAL_REVIEW', 'BLOCKED', 'REJECTED'].includes(complianceReview.status)) {
    throw new Error(`Compliance status ${complianceReview.status} prevents authorization.`);
  }

  if (new Date() > quote.expiresAt) {
    const expired = await prisma.swapQuote.update({
      where: { id: quote.id },
      data: { status: 'EXPIRED', currentState: 'EXPIRED' }
    });

    await prisma.swapExecutionEvent.create({
      data: {
        quoteId: quote.id,
        state: 'EXPIRED',
        status: 'EXPIRED',
        message: 'Quote expired before wallet authorization.'
      }
    });

    throw new Error(`Quote expired at ${expired.expiresAt.toISOString()}.`);
  }

  const updatedQuote = await prisma.$transaction(async (tx) => {
    const signedMessage = authorization.signedMessage?.trim() ?? '';
    const walletAddress = authorization.walletAddress?.trim() || quote.userAddress;
    const walletType = authorization.walletType?.trim() || 'manual';
    const signatureKind = authorization.signatureKind?.trim() || 'message_signature';
    const signatureHash = sha256(signature);
    const signedMessageHash = signedMessage ? sha256(signedMessage) : null;
    const authorizationMetadata = {
      chainIntent: authorization.chainIntent?.trim() || 'signature_only',
      quoteStatusBeforeAuthorization: quote.status,
      authorizationMode: 'wallet_attestation',
      rawSignatureStored: false
    };
    const updated = await tx.swapQuote.update({
      where: { id: quote.id },
      data: {
        status: 'AUTHORIZED',
        currentState: 'ESCROW_ESCORTING',
        walletType,
        walletAddress,
        signatureKind,
        signatureHash,
        signedMessageHash,
        authorizationMetadata: JSON.stringify(authorizationMetadata),
        authorizedAt: new Date()
      }
    });

    await tx.swapExecutionEvent.create({
      data: {
        quoteId: quote.id,
        state: 'ESCROW_ESCORTING',
        status: 'AUTHORIZED',
        message: `Wallet authorization captured for ${walletType}:${walletAddress.slice(0, 12)} with ${signatureKind}.`
      }
    });

    return updated;
  });

  return toSwapQuoteView(updatedQuote);
}

export async function broadcastStoredSwapQuote(quoteId: string, broadcast: {
  chain: string;
  signedTransaction: string;
  walletAddress?: string;
}) {
  const quote = await prisma.swapQuote.findUnique({ where: { id: quoteId } });
  if (!quote) {
    throw new Error('Swap quote not found.');
  }

  if (!['AUTHORIZED', 'ROUTING'].includes(quote.status)) {
    throw new Error(`Swap quote must be AUTHORIZED or ROUTING before broadcast; current status is ${quote.status}.`);
  }

  const walletAddress = broadcast.walletAddress?.trim() || quote.walletAddress || quote.userAddress;
  const result = await broadcastSignedTransaction({
    chain: broadcast.chain,
    signedTransaction: broadcast.signedTransaction,
    quoteId: quote.id,
    walletAddress
  });
  const existingMetadata = parseJson<Record<string, unknown>>(quote.authorizationMetadata, {});
  const authorizationMetadata = {
    ...existingMetadata,
    walletBroadcast: {
      mode: result.mode,
      chain: result.chain,
      txHash: result.txHash,
      provider: result.provider,
      diagnostics: result.diagnostics,
      broadcastedAt: result.broadcastedAt,
      rawSignedTransactionStored: false
    }
  };

  const updatedQuote = await prisma.$transaction(async (tx) => {
    const updated = await tx.swapQuote.update({
      where: { id: quote.id },
      data: {
        status: 'ROUTING',
        currentState: 'MULTI_BRIDGE_ROUTING',
        authorizationMetadata: JSON.stringify(authorizationMetadata)
      }
    });

    await tx.swapExecutionEvent.create({
      data: {
        quoteId: quote.id,
        state: 'MULTI_BRIDGE_ROUTING',
        status: 'ROUTING',
        message: `Wallet broadcast ${result.mode} submission recorded for ${result.chain} transaction ${result.txHash.slice(0, 18)}.`
      }
    });

    return updated;
  });

  return {
    quote: toSwapQuoteView(updatedQuote),
    broadcast: result
  };
}

export async function advanceStoredSwapQuote(quoteId: string) {
  const quote = await prisma.swapQuote.findUnique({ where: { id: quoteId } });
  if (!quote) {
    throw new Error('Swap quote not found.');
  }

  if (!['AUTHORIZED', 'ROUTING'].includes(quote.status)) {
    throw new Error(`Swap quote must be AUTHORIZED or ROUTING before advancing; current status is ${quote.status}.`);
  }

  const states = parseJson<string[]>(quote.executionStates, []);
  const currentIndex = states.indexOf(quote.currentState);
  const nextState = states[Math.min(currentIndex + 1, states.length - 1)];
  const nextStatus = nextState === 'DISTRIBUTION_COMPLETE' ? 'COMPLETE' : 'ROUTING';

  const updatedQuote = await prisma.$transaction(async (tx) => {
    const updated = await tx.swapQuote.update({
      where: { id: quote.id },
      data: { status: nextStatus, currentState: nextState }
    });

    await tx.swapExecutionEvent.create({
      data: {
        quoteId: quote.id,
        state: nextState,
        status: nextStatus,
        message: nextStatus === 'COMPLETE'
          ? 'Swap simulation completed and distribution state reached.'
          : `Swap simulation advanced to ${nextState}.`
      }
    });

    return updated;
  });

  return toSwapQuoteView(updatedQuote);
}

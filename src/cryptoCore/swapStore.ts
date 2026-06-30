import { PrismaClient } from '@prisma/client';
import { UnifiedSwapQuote, UnifiedSwapQuoteRequest, getEnforcedPlatformQuote } from './routing';
import { getSwapAsset } from './tokens';
import { assessSwapCompliance } from '../compliance/complianceEngine';
import { toComplianceReviewView } from '../compliance/complianceStore';

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
  quoteTtlSeconds: number;
  expiresAt: Date;
  requestPayload: string;
  executionStates: string;
  guardrails: string;
  currentState: string;
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
    expiresAt: quote.expiresAt.toISOString(),
    quoteTtlSeconds: quote.quoteTtlSeconds,
    requestPayload: parseJson<Record<string, string>>(quote.requestPayload, {}),
    executionStates: parseJson<string[]>(quote.executionStates, []),
    guardrails: parseJson<string[]>(quote.guardrails, []),
    currentState: quote.currentState,
    userAddress: quote.userAddress,
    createdAt: quote.createdAt.toISOString()
  };
}

export async function createStoredSwapQuote(request: UnifiedSwapQuoteRequest) {
  const quote = getEnforcedPlatformQuote(request);
  const compliance = assessSwapCompliance({
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
        flags: JSON.stringify(compliance.flags)
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
    quote: toSwapQuoteView(result.created),
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

export async function authorizeStoredSwapQuote(quoteId: string, signature: string) {
  if (!signature || signature.trim().length < 8) {
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
    const updated = await tx.swapQuote.update({
      where: { id: quote.id },
      data: { status: 'AUTHORIZED', currentState: 'ESCROW_ESCORTING' }
    });

    await tx.swapExecutionEvent.create({
      data: {
        quoteId: quote.id,
        state: 'ESCROW_ESCORTING',
        status: 'AUTHORIZED',
        message: `Wallet authorization captured: ${signature.slice(0, 12)}...`
      }
    });

    return updated;
  });

  return toSwapQuoteView(updatedQuote);
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

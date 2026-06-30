import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

type StoredSwapQuoteSummary = {
  id: string;
  status: string;
  provider: string;
  fromAsset: string;
  toAsset: string;
  amount: string;
  estimatedOutputAmount: string;
  providerMode: string;
  providerQuoteId: string | null;
  currentState: string;
  expiresAt: Date;
  createdAt: Date;
};

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function toComplianceReviewView(review: StoredComplianceReview & { swapQuote?: StoredSwapQuoteSummary | null }) {
  return {
    id: review.id,
    subjectType: review.subjectType,
    subjectId: review.subjectId,
    swapQuoteId: review.swapQuoteId,
    status: review.status,
    riskScore: review.riskScore,
    riskTier: review.riskTier,
    walletAddress: review.walletAddress,
    assetContext: review.assetContext,
    checks: parseList(review.checks),
    flags: parseList(review.flags),
    vendorMode: review.vendorMode,
    vendorProvider: review.vendorProvider,
    vendorReferenceId: review.vendorReferenceId,
    vendorDecision: review.vendorDecision,
    vendorLatencyMs: review.vendorLatencyMs,
    vendorMetadata: parseObject(review.vendorMetadata),
    swapQuote: review.swapQuote ? {
      id: review.swapQuote.id,
      status: review.swapQuote.status,
      provider: review.swapQuote.provider,
      fromAsset: review.swapQuote.fromAsset,
      toAsset: review.swapQuote.toAsset,
      amount: review.swapQuote.amount,
      estimatedOutputAmount: review.swapQuote.estimatedOutputAmount,
      providerMode: review.swapQuote.providerMode,
      providerQuoteId: review.swapQuote.providerQuoteId,
      currentState: review.swapQuote.currentState,
      expiresAt: review.swapQuote.expiresAt.toISOString(),
      createdAt: review.swapQuote.createdAt.toISOString()
    } : null,
    decisionNotes: review.decisionNotes,
    reviewedBy: review.reviewedBy,
    reviewedAt: review.reviewedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString()
  };
}

export async function listComplianceReviews(status?: string) {
  const reviews = await prisma.complianceReview.findMany({
    where: status ? { status } : undefined,
    include: {
      swapQuote: {
        select: {
          id: true,
          status: true,
          provider: true,
          fromAsset: true,
          toAsset: true,
          amount: true,
          estimatedOutputAmount: true,
          providerMode: true,
          providerQuoteId: true,
          currentState: true,
          expiresAt: true,
          createdAt: true
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  return reviews.map(toComplianceReviewView);
}

export async function decideComplianceReview(input: {
  id: string;
  decision: 'APPROVED' | 'REJECTED';
  reviewedBy?: string;
  notes?: string;
}) {
  const status = input.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
  const review = await prisma.complianceReview.update({
    where: { id: input.id },
    data: {
      status,
      decisionNotes: input.notes ?? null,
      reviewedBy: input.reviewedBy ?? 'ops',
      reviewedAt: new Date()
    },
    include: {
      swapQuote: {
        select: {
          id: true,
          status: true,
          provider: true,
          fromAsset: true,
          toAsset: true,
          amount: true,
          estimatedOutputAmount: true,
          providerMode: true,
          providerQuoteId: true,
          currentState: true,
          expiresAt: true,
          createdAt: true
        }
      }
    }
  });

  if (review.swapQuoteId) {
    await prisma.swapExecutionEvent.create({
      data: {
        quoteId: review.swapQuoteId,
        state: status === 'APPROVED' ? 'COMPLIANCE_APPROVED' : 'COMPLIANCE_REJECTED',
        status,
        message: input.notes ?? `Compliance review ${status.toLowerCase()}.`
      }
    });
  }

  return toComplianceReviewView(review);
}

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
  decisionNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
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

export function toComplianceReviewView(review: StoredComplianceReview) {
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
    decisionNotes: review.decisionNotes,
    reviewedBy: review.reviewedBy,
    reviewedAt: review.reviewedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString()
  };
}

export async function listComplianceReviews(status?: string) {
  const reviews = await prisma.complianceReview.findMany({
    where: status ? { status } : undefined,
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

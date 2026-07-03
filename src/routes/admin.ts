import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { decideComplianceReview, getComplianceEvidence, listComplianceReviews } from '../compliance/complianceStore';
import { listOperatorAuditLogs, recordOperatorAudit } from '../security/operatorAudit';

const prisma = new PrismaClient();
const router = Router();

// Set/Update Platform Fee (e.g., 0.015 for 1.5%)
router.post('/v1/admin/config/fee', async (req, res) => {
  const { feeRate } = req.body;
  const config = await prisma.configuration.upsert({
    where: { id: 'global_settings' },
    update: { feeRate: parseFloat(feeRate) },
    create: { id: 'global_settings', feeRate: parseFloat(feeRate) }
  });
  res.json({ message: "Fee updated", config });
});

router.get('/v1/admin/compliance/reviews', async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  return res.json({ reviews: await listComplianceReviews(status) });
});

router.get('/v1/admin/audit-log', async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  return res.json({ entries: await listOperatorAuditLogs(limit) });
});

router.get('/v1/admin/compliance/reviews/:id/evidence', async (req, res) => {
  const evidence = await getComplianceEvidence(req.params.id);

  if (!evidence) {
    return res.status(404).json({ error: 'Compliance review not found.' });
  }

  return res.json({ evidence });
});

router.post('/v1/admin/compliance/reviews/:id/decision', async (req, res) => {
  try {
    const review = await decideComplianceReview({
      id: req.params.id,
      decision: req.body.decision,
      reviewedBy: req.body.reviewedBy,
      notes: req.body.notes
    });
    await recordOperatorAudit({
      action: 'compliance_review_decision',
      subjectType: 'compliance_review',
      subjectId: review.id,
      operatorRole: res.locals.operatorRole,
      requestId: res.locals.requestId,
      method: req.method || 'POST',
      path: req.originalUrl || `/v1/admin/compliance/reviews/${req.params.id}/decision`,
      outcome: review.status,
      metadata: {
        decision: String(req.body.decision || ''),
        reviewedBy: String(req.body.reviewedBy || '')
      }
    });

    return res.json({ review });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

export default router;

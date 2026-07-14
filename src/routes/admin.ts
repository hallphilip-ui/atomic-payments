import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { decideComplianceReview, getComplianceEvidence, listComplianceReviews } from '../compliance/complianceStore';
import { getOperatorAuditExport, listOperatorAuditLogs, recordOperatorAudit } from '../security/operatorAudit';
import { notifyConfirmedIntent } from '../payments/paymentWatcher';

const prisma = new PrismaClient();
const router = Router();

// Sanctions-held payments (status REVIEW): the watcher detected a valid on-chain
// payment but the PAYER screened as sanctioned, so it withheld confirmation, the
// merchant webhook, and the customer receipt. These endpoints are the operator's
// disposition workflow — review the queue, then clear (settle + fire the withheld
// notifications) or reject. Operator-gated via /v1/admin.
router.get('/v1/admin/review-queue', async (_req, res) => {
  const items = await prisma.paymentIntent.findMany({
    where: { status: 'REVIEW' },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { merchant: { select: { businessName: true, email: true, receiveAddress: true } } }
  });
  return res.json({
    count: items.length,
    items: items.map((i) => ({
      id: i.id, amount: i.amount, currency: i.currency, asset: i.selectedChain,
      depositAddress: i.depositAddress, txHash: i.txHash, reference: i.reference,
      customerEmail: i.customerEmail, createdAt: i.createdAt,
      merchant: i.merchant ? { businessName: i.merchant.businessName, email: i.merchant.email } : null
    }))
  });
});

router.post('/v1/admin/review-queue/:id/decision', async (req, res) => {
  try {
    const decision = String(req.body?.decision || '').toLowerCase();
    if (decision !== 'clear' && decision !== 'reject') {
      return res.status(400).json({ error: "decision must be 'clear' or 'reject'." });
    }
    const intent = await prisma.paymentIntent.findUnique({ where: { id: req.params.id } });
    if (!intent) return res.status(404).json({ error: 'Payment not found.' });
    if (intent.status !== 'REVIEW') {
      return res.status(409).json({ error: `Payment is ${intent.status}, not REVIEW — nothing to disposition.` });
    }
    if (decision === 'clear') {
      // Settle the held payment and fire the notifications the watcher withheld.
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'CONFIRMED', confirmedAt: intent.confirmedAt || new Date() }
      });
      await notifyConfirmedIntent(intent.id).catch(() => {});
    } else {
      await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: 'REJECTED' } });
    }
    await recordOperatorAudit({
      action: 'sanctions_review_decision',
      subjectType: 'payment_intent',
      subjectId: intent.id,
      operatorRole: res.locals.operatorRole,
      requestId: res.locals.requestId,
      method: req.method || 'POST',
      path: req.originalUrl || `/v1/admin/review-queue/${req.params.id}/decision`,
      outcome: decision === 'clear' ? 'CONFIRMED' : 'REJECTED',
      metadata: { decision, reviewedBy: String(req.body?.reviewedBy || ''), notes: String(req.body?.notes || '').slice(0, 500) }
    });
    return res.json({ id: intent.id, status: decision === 'clear' ? 'CONFIRMED' : 'REJECTED' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Set/Update Platform Fee (e.g., 0.015 for 1.5%). NOTE: the LIVE swap fee is
// PLATFORM_SPREAD_BPS in swapConfig.ts — this Configuration.feeRate row is not read
// by the swap/settlement engine yet; kept for future admin-tunable pricing. Validate
// the input so a bad value can't persist a NaN/negative/absurd rate.
router.post('/v1/admin/config/fee', async (req, res) => {
  const feeRate = Number(req.body?.feeRate);
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 0.1) {
    return res.status(400).json({ error: 'feeRate must be a number between 0 and 0.1 (0–10%).' });
  }
  const config = await prisma.configuration.upsert({
    where: { id: 'global_settings' },
    update: { feeRate },
    create: { id: 'global_settings', feeRate }
  });
  res.json({ message: 'Fee updated', config });
});

router.get('/v1/admin/compliance/reviews', async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  return res.json({ reviews: await listComplianceReviews(status) });
});

router.get('/v1/admin/audit-log', async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  return res.json({ entries: await listOperatorAuditLogs(limit) });
});

router.get('/v1/admin/audit-log/export', async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  return res.json({ export: await getOperatorAuditExport(limit) });
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

import { Router } from 'express';
import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

/**
 * Curated public "Known Issues" register. This is the operator-maintained view
 * of what we already know about — mirrors docs/KNOWN_BUGS.md. User-submitted
 * reports are stored separately (BugReport) and reviewed via /v1/admin/bugs;
 * we don't publish raw submissions to avoid spam on the public tracker.
 *
 * severity: blocker | major | minor | tracked
 * status:   open | investigating | fixed
 */
export const KNOWN_ISSUES = [
  { id: 'B1', area: 'Wallet connect', severity: 'blocker', status: 'investigating',
    title: 'Safari: "Connect Wallet" does nothing (works in Chrome).',
    note: 'Likely EIP-6963 discovery timing or dynamic import behavior in Safari. Reproducing and adding a fallback.' },
  { id: 'B2', area: 'Wallet connect', severity: 'blocker', status: 'investigating',
    title: 'WalletConnect QR needs end-to-end verification.',
    note: 'We render our own QR from the display_uri event; verifying a real mobile scan connects fully.' },
  { id: 'B3', area: 'Execution', severity: 'blocker', status: 'open',
    title: 'End-to-end live swap not yet completed with real funds.',
    note: 'A ~$10 EVM test (Base USDC → Ethereum USDC) is the launch gate; approve→send→settle→fee is built but unproven in production.' },
  { id: 'B4', area: 'BTC execution', severity: 'major', status: 'open',
    title: 'Bitcoin send path (Unisat / Xverse / Leather) untested with a real wallet.' },
  { id: 'B5', area: 'SOL execution', severity: 'major', status: 'open',
    title: 'Solana send path (@solana/web3.js sign & send) untested with a real wallet.' },
  { id: 'B6', area: 'Quotes', severity: 'minor', status: 'open',
    title: 'Network-fallback simulation can show an "Estimated Received" that is not executable.',
    note: 'Guarded for wallet/source mismatch; a pure-network fallback still shows a simulated number.' },
  { id: 'B7', area: 'UI', severity: 'minor', status: 'open',
    title: 'Admin compliance page still uses the old dark theme.' },
  { id: 'B8', area: 'Email', severity: 'minor', status: 'open',
    title: 'Daily P&L email can land in spam — DKIM not yet enabled (SPF + DMARC done).' },
  { id: 'B9', area: 'UX', severity: 'minor', status: 'open',
    title: '30-second quote lock expires quickly; user must re-quote.' },
  { id: 'L2', area: 'Fees', severity: 'tracked', status: 'open',
    title: 'Customer all-in fee ≈ 2.75% (our 2.5% + LI.FI 0.25% + gas).',
    note: 'By design today; direct-rail routing to trim the aggregator fee is queued.' },
  { id: 'L3', area: 'Assets', severity: 'tracked', status: 'open',
    title: '15 assets certified for live routing; long-tail L1s fail-closed until mapped.' },
  { id: 'L4', area: 'Embedded wallet', severity: 'tracked', status: 'open',
    title: 'Self-hosted email→wallet (Openfort/opensigner) not yet deployed — awaiting the new server.' },
  // Recently shipped — shown so users see momentum.
  { id: 'F1', area: 'Wallet connect', severity: 'major', status: 'fixed',
    title: 'Multi-wallet connect silent failure → EIP-6963 discovery + connecting spinner + timeout.' },
  { id: 'F2', area: 'UX', severity: 'minor', status: 'fixed',
    title: 'Atomic-units amount input → human amounts (type "10", not "10000000").' },
  { id: 'F3', area: 'Fees', severity: 'minor', status: 'fixed',
    title: 'Fee over-gross-up corrected to net exactly 2.5% (LI.FI fee is additive).' },
  { id: 'F4', area: 'Infra', severity: 'major', status: 'fixed',
    title: 'Cloudflare 525 (wrong origin A-record) resolved; site live over HTTPS.' }
];

const KNOWN_UPDATED_AT = '2026-07-07';

const CATEGORIES = new Set(['bug', 'feedback', 'question']);

function clip(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

// Best-effort notification email. Never blocks or fails the submission.
async function notifyOperator(report: {
  reference: string; category: string; title: string; description: string; pageUrl?: string; contact?: string;
}): Promise<void> {
  const host = process.env.ATOMIC_SMTP_HOST;
  const to = process.env.ATOMIC_REPORT_TO;
  if (!host || !to) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.ATOMIC_SMTP_PORT ?? 587),
      secure: String(process.env.ATOMIC_SMTP_SECURE ?? 'false') === 'true',
      auth: process.env.ATOMIC_SMTP_USER
        ? { user: process.env.ATOMIC_SMTP_USER, pass: process.env.ATOMIC_SMTP_PASS }
        : undefined
    });
    await transport.sendMail({
      from: process.env.ATOMIC_REPORT_FROM ?? process.env.ATOMIC_SMTP_USER ?? to,
      to,
      subject: `[Atomic ${report.category}] ${report.reference}: ${report.title}`.slice(0, 180),
      text: [
        `Reference: ${report.reference}`,
        `Category:  ${report.category}`,
        `Title:     ${report.title}`,
        `Page:      ${report.pageUrl || '—'}`,
        `Contact:   ${report.contact || '—'}`,
        '',
        report.description
      ].join('\n')
    });
  } catch {
    /* email is best-effort; the report is already persisted */
  }
}

// Public: curated known-issues register for the on-site tracker.
router.get('/v1/bugs', (_req, res) => {
  res.json({ updatedAt: KNOWN_UPDATED_AT, issues: KNOWN_ISSUES });
});

// Public: submit a bug report / feedback. Rate-limited by the global limiter.
router.post('/v1/bugs', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const category = clip(body.category, 20).toLowerCase() || 'bug';
    const title = clip(body.title, 140);
    const description = clip(body.description, 4000);
    const pageUrl = clip(body.pageUrl, 500) || undefined;
    const contact = clip(body.contact, 200) || undefined;
    const userAgent = clip(req.headers['user-agent'], 400) || undefined;

    if (!CATEGORIES.has(category)) {
      return res.status(400).json({ error: 'Invalid category.' });
    }
    if (title.length < 3) {
      return res.status(400).json({ error: 'A short title is required.' });
    }
    if (description.length < 5) {
      return res.status(400).json({ error: 'Please describe the issue.' });
    }
    if (contact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) {
      return res.status(400).json({ error: 'Contact must be a valid email (or leave it blank).' });
    }

    const reference = 'BR-' + randomBytes(3).toString('hex').toUpperCase();
    await prisma.bugReport.create({
      data: { reference, category, title, description, pageUrl, contact, userAgent }
    });

    void notifyOperator({ reference, category, title, description, pageUrl, contact });

    return res.status(201).json({
      reference,
      status: 'received',
      message: 'Thanks — your report was received. Keep this reference to follow up.'
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'Could not submit report.' });
  }
});

// Operator-only: review submitted reports (auto-protected via /v1/admin prefix).
router.get('/v1/admin/bugs', async (req, res) => {
  try {
    const status = req.query.status ? clip(req.query.status, 20) : undefined;
    const take = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit ?? '100'), 10) || 100));
    const reports = await prisma.bugReport.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take
    });
    return res.json({ count: reports.length, reports });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'Could not load reports.' });
  }
});

export default router;

import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { partnerAuth, partnerRateLimit, generateApiKey } from '../security/partnerAuth';
import { generateWebhookSecret, isSafeWebhookUrl } from '../security/partnerWebhook';
import { sendPartnerVerificationEmail } from '../notify/partnerEmail';
import { createStoredSwapQuote, getStoredSwapQuote } from '../cryptoCore/swapStore';
import { verifyLifiSettlement } from '../cryptoCore/settlementVerifier';
import { listSwapAssets, getLifiAsset, getSwapAsset } from '../cryptoCore/tokens';
import { PLATFORM_SPREAD_BPS, PARTNER_REVENUE_SHARE_BPS, PARTNER_MAX_MARKUP_BPS, PARTNER_MAX_PAYOUT_USD } from '../cryptoCore/swapConfig';
import { upstreamsFor } from './rpc';

// USDC on Base — partner commissions are settled here. Payouts sign server-side with
// the ATOMIC_PAYOUT_KEY treasury (kept in .env, funded with USDC). ethers reused from
// the integrity-pinned vendor bundle (no new dependency).
const ethers: any = require(join(process.cwd(), 'public', 'vendor', 'ethers-6.13.4.umd.min.js'));
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// BigInt atomic -> human decimal string (no float rounding).
function fmtUnits(raw: bigint, decimals: number): string {
  const s = (raw < 0n ? -raw : raw).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, '') : '';
  return `${whole}${frac ? '.' + frac : ''}`;
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// Public registration is spam-prone (creates a row + key) — tight per-IP limit.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => { const cf = req.headers['cf-connecting-ip']; return typeof cf === 'string' && cf.length ? cf : req.ip || 'unknown'; }
});

// Partner Swap API — "Swaps-as-a-Service". Authenticated with a partner API key,
// non-custodial: we return a quote + a signable transaction; the partner's own
// user signs and broadcasts it. Atomic's integrator fee is embedded in the route.
const prisma = new PrismaClient();
const router = Router();

// Public origin for links we email out (verification). Overridable per-deploy.
const PUBLIC_ORIGIN = (process.env.ATOMIC_PUBLIC_ORIGIN ?? 'https://atomicpay.cloud').replace(/\/$/, '');
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

// Gate the "use the swap engine" endpoints on a verified email. Everything else
// (portal /me, settings, key rotation) stays reachable so an unverified partner can
// still see the "check your inbox" state. emailVerified defaults true, so existing
// and operator-minted partners pass untouched — only self-serve signups are gated.
function requireVerifiedPartner(_req: unknown, res: Response, next?: NextFunction) {
  const p = (res.locals as any).partner;
  if (p && p.emailVerified === false) {
    return res.status(403).json({ error: 'Verify your email to activate API access — check your inbox, or POST /v1/partner/resend-verification.', emailVerified: false });
  }
  return next?.();
}

// The signable txHash the client reported at broadcast lives in the swap's
// authorizationMetadata. Pull it back out for on-chain settlement verification.
function broadcastTxHash(authorizationMetadata: string): string | undefined {
  try {
    const meta = JSON.parse(authorizationMetadata || '{}');
    const h = meta?.walletBroadcast?.txHash;
    return typeof h === 'string' && h ? h : undefined;
  } catch { return undefined; }
}

// Resolve what a partner is actually owed. Only swaps whose on-chain settlement we
// can positively confirm count — for any unpaid, not-yet-verified swap we ask LI.FI
// whether its reported tx settled, and if so stamp onchainVerifiedAt + rewrite
// partnerEarnedUsd from the REAL settled USD (not the partner-supplied quote size).
// Fails closed: an unconfirmable swap simply never becomes payable.
async function collectPayableSwaps(partnerId: string) {
  const candidates = await prisma.swapQuote.findMany({
    where: { partnerId, partnerPaidAt: null, onchainVerifiedAt: null },
    select: { id: true, fromAsset: true, partnerFeeBps: true, authorizationMetadata: true }
  });
  for (const c of candidates) {
    const txHash = broadcastTxHash(c.authorizationMetadata);
    if (!txHash) continue;
    const result = await verifyLifiSettlement({ txHash, fromAssetId: c.fromAsset });
    if (!result.settled) continue;
    const earnedUsd = result.amountUsd * (PARTNER_REVENUE_SHARE_BPS + (c.partnerFeeBps || 0)) / 10000;
    try {
      await prisma.swapQuote.update({
        where: { id: c.id },
        data: { onchainVerifiedAt: new Date(), settlementTxHash: result.txHash, partnerEarnedUsd: earnedUsd }
      });
    } catch { /* settlementTxHash unique clash — tx already credited to another swap; skip */ }
  }
  const payable = await prisma.swapQuote.findMany({
    where: { partnerId, partnerPaidAt: null, onchainVerifiedAt: { not: null } },
    select: { id: true, partnerEarnedUsd: true }
  });
  const owedUsd = Number(payable.reduce((s, r) => s + (r.partnerEarnedUsd || 0), 0).toFixed(6));
  return { payable, owedUsd };
}

// List the assets certified for live routing (what a partner can quote/swap).
router.get('/v1/partner/assets', partnerRateLimit, partnerAuth, requireVerifiedPartner, (_req, res) => {
  const assets = listSwapAssets()
    .filter((a) => getLifiAsset(a.assetId))
    .map((a) => ({ assetId: a.assetId, symbol: a.symbol, name: a.name, chain: a.chain, chainFamily: a.chainFamily, decimals: a.decimals }));
  return res.json({ assets, count: assets.length });
});

// Create a swap quote. Body: { fromAsset, toAsset, amount (atomic int string),
// userAddress (destination), fromAddress? (source). Returns the quote incl. the
// signable `execution.transactionRequest` for QUOTED status.
router.post('/v1/partner/quote', partnerRateLimit, partnerAuth, requireVerifiedPartner, async (req, res) => {
  const partner = (res.locals as any).partner;
  try {
    // Partner economics: a fixed revenue-share slice of our base + the partner's
    // stacked markup (capped). Total fee charged to the customer = base + markup;
    // the partner earns share + markup; we net base - share. The markup is set here
    // (never from the caller's body) and snapshotted on the swap for settlement.
    const markupBps = Math.max(0, Math.min(PARTNER_MAX_MARKUP_BPS, Math.floor(partner.feeBps || 0)));
    const totalFeeBps = PLATFORM_SPREAD_BPS + markupBps;
    // Allow-list the caller's fields; feeBps is set server-side from the partner's
    // record (never spread from the body) so a partner can't stack an uncapped fee.
    const b = (req.body ?? {}) as Record<string, unknown>;
    const request = {
      fromAsset: String(b.fromAsset ?? ''),
      toAsset: String(b.toAsset ?? ''),
      amount: String(b.amount ?? ''),
      userAddress: String(b.userAddress ?? ''),
      fromAddress: b.fromAddress != null ? String(b.fromAddress) : undefined,
      feeBps: totalFeeBps
    };

    const cfCountry = req.headers['cf-ipcountry'];
    const result = await createStoredSwapQuote(request, {
      countryCode: typeof cfCountry === 'string' ? cfCountry : undefined,
      partnerId: partner.id,
      partnerFeeBps: markupBps
    });
    prisma.apiPartner.update({ where: { id: partner.id }, data: { swapCount: { increment: 1 } } }).catch(() => {});
    const quote = result.quote;
    const statusCode = quote.status === 'BLOCKED' ? 403 : quote.status === 'HALTED' ? 409 : 201;
    return res.status(statusCode).json({
      quote,
      fee: {
        totalBps: totalFeeBps,                                     // customer pays this
        partnerBps: PARTNER_REVENUE_SHARE_BPS + markupBps,         // partner earns this
        platformBps: PLATFORM_SPREAD_BPS - PARTNER_REVENUE_SHARE_BPS, // we net this
        markupBps
      },
      partner: { name: partner.name, markupBps },
      nextStep: quote.status === 'QUOTED'
        ? 'Have your user sign & broadcast quote.execution.transactionRequest before expiresAt.'
        : quote.status === 'BLOCKED' ? 'Compliance blocked this quote.' : 'Try a smaller amount or different pair.'
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// Partner earnings summary — sum of (revenue share + markup) over the partner's
// completed/authorized swaps, for periodic settlement. Amounts are in the FROM
// asset's atomic units per swap; we report bps + notional so settlement is simple.
router.get('/v1/partner/earnings', partnerRateLimit, partnerAuth, async (_req, res) => {
  const partner = (res.locals as any).partner;
  const rows = await prisma.swapQuote.findMany({
    where: { partnerId: partner.id, status: { in: ['AUTHORIZED', 'ROUTING', 'COMPLETE'] } },
    select: { fromAsset: true, amount: true, partnerFeeBps: true, status: true, authorizationMetadata: true, onchainVerifiedAt: true, createdAt: true }
  });
  // Only count swaps that were actually BROADCAST on-chain — not ones self-reported
  // to AUTHORIZED via the public status endpoints. This keeps the dashboard in step
  // with the on-chain-verified settlement that payouts actually pay on. `settled`
  // marks the stricter payout-verified subset.
  const swaps = rows.filter((r) => broadcastTxHash(r.authorizationMetadata)).map((r) => {
    const earnedBps = PARTNER_REVENUE_SHARE_BPS + (r.partnerFeeBps || 0);
    const earned = (BigInt(/^[0-9]+$/.test(r.amount) ? r.amount : '0') * BigInt(earnedBps) / 10000n).toString();
    return { fromAsset: r.fromAsset, amount: r.amount, earnedBps, earnedAtomic: earned, status: r.status, settled: !!r.onchainVerifiedAt, at: r.createdAt.toISOString() };
  });
  return res.json({ partner: { name: partner.name, revenueShareBps: PARTNER_REVENUE_SHARE_BPS, markupBps: partner.feeBps }, swapCount: swaps.length, swaps });
});

// Status of a quote — scoped to the calling partner (can't read others' quotes).
router.get('/v1/partner/quote/:id', partnerRateLimit, partnerAuth, async (req, res) => {
  const partner = (res.locals as any).partner;
  try {
    const row = await prisma.swapQuote.findUnique({ where: { id: req.params.id }, select: { partnerId: true } });
    if (!row || row.partnerId !== partner.id) return res.status(404).json({ error: 'Quote not found.' });
    return res.json({ quote: await getStoredSwapQuote(req.params.id) });
  } catch (error: any) {
    return res.status(404).json({ error: error.message });
  }
});

// Operator-only (auto-protected by the /v1/admin prefix in operatorRules): mint a
// partner + API key. The key is returned ONCE and cannot be retrieved again.
router.post('/v1/admin/partners', async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'name is required.' });
    // feeBps here is the partner's stacked MARKUP (0..PARTNER_MAX_MARKUP_BPS). They
    // also earn a fixed PARTNER_REVENUE_SHARE_BPS on top, from our base.
    const feeBps = Math.max(0, Math.min(PARTNER_MAX_MARKUP_BPS, Math.floor(Number(req.body?.feeBps) || 0)));
    const payoutAddress = req.body?.payoutAddress && EVM_ADDRESS.test(String(req.body.payoutAddress).trim()) ? String(req.body.payoutAddress).trim() : null;
    const { key, prefix, hash } = generateApiKey();
    const partner = await prisma.apiPartner.create({ data: { name, keyPrefix: prefix, keyHash: hash, feeBps, payoutAddress } });
    return res.status(201).json({
      id: partner.id, name: partner.name, keyPrefix: prefix, feeBps, payoutAddress,
      apiKey: key,
      warning: 'Store this apiKey now — it is shown once and cannot be retrieved again.'
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Operator-only: list partners (no keys — only prefixes + usage).
router.get('/v1/admin/partners', async (_req, res) => {
  const partners = await prisma.apiPartner.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, email: true, keyPrefix: true, feeBps: true, payoutAddress: true, active: true, swapCount: true, createdAt: true }
  });
  return res.json({ partners });
});

// Operator-only: preview what a partner is owed. Only on-chain-VERIFIED settlements
// count (see collectPayableSwaps) — self-reported swap status is never trusted.
router.get('/v1/admin/partners/:id/payout', async (req, res) => {
  const partner = await prisma.apiPartner.findUnique({ where: { id: req.params.id } });
  if (!partner) return res.status(404).json({ error: 'Partner not found.' });
  const { payable, owedUsd } = await collectPayableSwaps(partner.id);
  return res.json({
    partner: { id: partner.id, name: partner.name, payoutAddress: partner.payoutAddress },
    owedUsd, swapCount: payable.length, basis: 'onchain_verified_settlement',
    maxPayoutUsd: PARTNER_MAX_PAYOUT_USD, exceedsCap: owedUsd > PARTNER_MAX_PAYOUT_USD,
    payoutAsset: 'USDC', payoutChain: 'Base', configured: !!process.env.ATOMIC_PAYOUT_KEY
  });
});

// Operator-only: execute a payout — send USDC on Base from the ATOMIC_PAYOUT_KEY
// treasury to the partner's wallet. Swaps are CLAIMED (partnerPaidAt + payoutId)
// atomically BEFORE the transfer, so a crash or a concurrent run can never pay the
// same swap twice; a pre-broadcast send failure releases the claim so earnings
// aren't stranded. A run over PARTNER_MAX_PAYOUT_USD is refused for manual review.
router.post('/v1/admin/partners/:id/payout', async (req, res) => {
  const key = (process.env.ATOMIC_PAYOUT_KEY || '').trim();
  if (!key) return res.status(503).json({ error: 'Payout treasury not configured (set ATOMIC_PAYOUT_KEY).' });
  const partner = await prisma.apiPartner.findUnique({ where: { id: req.params.id } });
  if (!partner) return res.status(404).json({ error: 'Partner not found.' });
  if (!partner.payoutAddress) return res.status(400).json({ error: 'Partner has no payout wallet set.' });

  const { payable, owedUsd } = await collectPayableSwaps(partner.id);
  if (owedUsd < 0.01) return res.status(400).json({ error: 'Nothing to pay (owed < $0.01 of verified settlement).' });
  if (owedUsd > PARTNER_MAX_PAYOUT_USD) {
    return res.status(409).json({ error: `Owed $${owedUsd} exceeds the $${PARTNER_MAX_PAYOUT_USD} single-run cap — review and settle manually.`, owedUsd, maxPayoutUsd: PARTNER_MAX_PAYOUT_USD });
  }

  const payout = await prisma.partnerPayout.create({ data: { partnerId: partner.id, amountUsd: owedUsd, swapCount: payable.length, toAddress: partner.payoutAddress, status: 'pending' } });

  // Claim the swaps to THIS payout before sending. `partnerPaidAt: null` in the
  // filter means a swap already claimed by a concurrent run is skipped, so we only
  // ever pay for what we exclusively claimed.
  await prisma.swapQuote.updateMany({
    where: { id: { in: payable.map((s) => s.id) }, partnerPaidAt: null },
    data: { partnerPaidAt: new Date(), partnerPayoutId: payout.id }
  });
  const claimed = await prisma.swapQuote.findMany({ where: { partnerPayoutId: payout.id }, select: { partnerEarnedUsd: true } });
  const claimedUsd = Number(claimed.reduce((s, r) => s + (r.partnerEarnedUsd || 0), 0).toFixed(6));
  if (claimedUsd < 0.01) {
    await prisma.partnerPayout.update({ where: { id: payout.id }, data: { status: 'failed', amountUsd: 0, swapCount: 0 } }).catch(() => {});
    return res.status(409).json({ error: 'Swaps were already claimed by a concurrent payout — nothing left to pay.' });
  }

  try {
    const url = upstreamsFor(8453)[0];
    const provider = new ethers.JsonRpcProvider(url, 8453, { staticNetwork: true });
    const wallet = new ethers.Wallet(key, provider);
    const usdc = new ethers.Contract(USDC_BASE, ['function transfer(address,uint256) returns (bool)'], wallet);
    const amount = BigInt(Math.round(claimedUsd * 1e6)); // USDC = 6 decimals
    const tx = await usdc.transfer(partner.payoutAddress, amount);
    await prisma.partnerPayout.update({ where: { id: payout.id }, data: { status: 'sent', txHash: tx.hash, amountUsd: claimedUsd, swapCount: claimed.length } });
    return res.json({ paid: true, amountUsd: claimedUsd, swapCount: claimed.length, txHash: tx.hash, to: partner.payoutAddress });
  } catch (e: any) {
    // The transfer never broadcast (no tx handle) — release the claim so the
    // earnings remain payable on a later run rather than being lost.
    await prisma.swapQuote.updateMany({ where: { partnerPayoutId: payout.id }, data: { partnerPaidAt: null, partnerPayoutId: null } }).catch(() => {});
    await prisma.partnerPayout.update({ where: { id: payout.id }, data: { status: 'failed' } }).catch(() => {});
    return res.status(502).json({ error: 'Payout transfer failed: ' + (e?.shortMessage || e?.message || 'unknown') });
  }
});

// ---------- Self-serve partner portal ----------

// Public: register as a partner. Creates the account + first API key (shown once).
router.post('/v1/partner/register', registerLimiter, async (req, res) => {
  try {
    const name = String(req.body?.businessName ?? req.body?.name ?? '').trim().slice(0, 80);
    const email = String(req.body?.email ?? '').trim().slice(0, 200);
    if (name.length < 2) return res.status(400).json({ error: 'A business name is required.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
    const payoutAddress = req.body?.payoutAddress && EVM_ADDRESS.test(String(req.body.payoutAddress).trim()) ? String(req.body.payoutAddress).trim() : null;
    const { key, prefix, hash } = generateApiKey();
    // Anti-abuse: hold API access until the email is confirmed. Create UNVERIFIED with
    // a one-time token, then email the link. If the mail can't be sent (no SMTP), we
    // flip to verified so self-serve signup never hard-breaks.
    const token = crypto.randomBytes(32).toString('hex');
    const partner = await prisma.apiPartner.create({ data: {
      name, email, keyPrefix: prefix, keyHash: hash, feeBps: 0, payoutAddress,
      emailVerified: false, verifyTokenHash: sha256(token), verifyTokenExpiresAt: new Date(Date.now() + VERIFY_TTL_MS)
    }});
    const { sent } = await sendPartnerVerificationEmail(email, `${PUBLIC_ORIGIN}/partner-verify?token=${token}`);
    if (!sent) {
      await prisma.apiPartner.update({ where: { id: partner.id }, data: { emailVerified: true, verifyTokenHash: null, verifyTokenExpiresAt: null } });
    }
    return res.status(201).json({
      id: partner.id, name: partner.name, email: partner.email, keyPrefix: prefix,
      payoutAddress, payoutAsset: 'USDC', payoutChain: 'Base',
      apiKey: key,
      emailVerified: !sent,
      verificationRequired: sent,
      revenueShareBps: PARTNER_REVENUE_SHARE_BPS, maxMarkupBps: PARTNER_MAX_MARKUP_BPS,
      warning: 'Save this API key now — it is shown once and cannot be retrieved again.',
      nextStep: sent ? 'Check your email and click the verification link to activate API access.' : undefined
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Public: confirm a verification token (the /partner-verify page POSTs here). Marks
// the partner verified and clears the one-time token. Token is matched by its hash.
router.post('/v1/partner/verify-email', async (req, res) => {
  const token = String(req.body?.token ?? '').trim();
  if (!token) return res.status(400).json({ error: 'A verification token is required.' });
  const partner = await prisma.apiPartner.findFirst({ where: { verifyTokenHash: sha256(token) } });
  if (!partner) return res.status(400).json({ error: 'Invalid or already-used verification link.' });
  if (partner.verifyTokenExpiresAt && partner.verifyTokenExpiresAt.getTime() < Date.now()) {
    return res.status(400).json({ error: 'This verification link has expired — request a new one.', expired: true });
  }
  await prisma.apiPartner.update({ where: { id: partner.id }, data: { emailVerified: true, verifyTokenHash: null, verifyTokenExpiresAt: null } });
  return res.json({ verified: true, name: partner.name });
});

// Public: resend the verification link. Rate-limited; responds the same whether or
// not the email exists (no account enumeration).
router.post('/v1/partner/resend-verification', registerLimiter, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().slice(0, 200);
  const ack = { ok: true, note: 'If that email has an unverified partner account, a new verification link is on its way.' };
  if (!EMAIL_RE.test(email)) return res.json(ack);
  const partner = await prisma.apiPartner.findFirst({ where: { email, emailVerified: false } });
  if (partner) {
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.apiPartner.update({ where: { id: partner.id }, data: { verifyTokenHash: sha256(token), verifyTokenExpiresAt: new Date(Date.now() + VERIFY_TTL_MS) } });
    await sendPartnerVerificationEmail(email, `${PUBLIC_ORIGIN}/partner-verify?token=${token}`);
  }
  return res.json(ack);
});

// Partner-authed: account summary for the dashboard.
router.get('/v1/partner/me', partnerRateLimit, partnerAuth, (req, res) => {
  const p = (res.locals as any).partner;
  return res.json({
    id: p.id, name: p.name, email: p.email, keyPrefix: p.keyPrefix,
    markupBps: p.feeBps, revenueShareBps: PARTNER_REVENUE_SHARE_BPS, maxMarkupBps: PARTNER_MAX_MARKUP_BPS,
    payoutAddress: p.payoutAddress, payoutAsset: 'USDC', payoutChain: 'Base',
    webhookUrl: p.webhookUrl, webhookConfigured: !!p.webhookUrl,
    emailVerified: p.emailVerified,
    active: p.active, swapCount: p.swapCount, createdAt: p.createdAt
  });
});

// Partner-authed: set (or clear) the webhook URL. Setting a URL returns the signing
// secret (HMAC-SHA256 key). Sending an empty url disables webhooks.
router.post('/v1/partner/webhook', partnerRateLimit, partnerAuth, async (req, res) => {
  const p = (res.locals as any).partner;
  const url = String(req.body?.url ?? '').trim().slice(0, 500);
  if (url && !/^https:\/\//i.test(url)) return res.status(400).json({ error: 'Webhook URL must be https://.' });
  // SSRF guard at set-time (mirrors the fire-time guard): reject private/internal
  // hosts up front so a partner gets immediate feedback and we never store one.
  if (url && !(await isSafeWebhookUrl(url))) {
    return res.status(400).json({ error: 'Webhook host must be a public https endpoint (private, loopback, and internal addresses are not allowed).' });
  }
  const secret = url ? (p.webhookSecret || generateWebhookSecret()) : null;
  await prisma.apiPartner.update({ where: { id: p.id }, data: { webhookUrl: url || null, webhookSecret: secret } });
  return res.json({
    webhookUrl: url || null, webhookSecret: secret,
    events: ['swap.authorized', 'swap.broadcast', 'swap.updated', 'swap.completed'],
    note: url ? 'Verify each POST: HMAC-SHA256 of the raw body with this secret == the x-atomic-signature header.' : 'Webhooks disabled.'
  });
});

// Partner-authed: set the payout wallet — commissions are settled in USDC (on Base).
router.post('/v1/partner/payout', partnerRateLimit, partnerAuth, async (req, res) => {
  const p = (res.locals as any).partner;
  const addr = String(req.body?.payoutAddress ?? '').trim();
  if (!EVM_ADDRESS.test(addr)) return res.status(400).json({ error: 'A valid EVM wallet address (0x…) is required for USDC payouts.' });
  await prisma.apiPartner.update({ where: { id: p.id }, data: { payoutAddress: addr } });
  return res.json({ payoutAddress: addr, payoutAsset: 'USDC', payoutChain: 'Base' });
});

// Partner-authed: set the commission markup (0..PARTNER_MAX_MARKUP_BPS).
router.post('/v1/partner/commission', partnerRateLimit, partnerAuth, async (req, res) => {
  const p = (res.locals as any).partner;
  const markupBps = Math.max(0, Math.min(PARTNER_MAX_MARKUP_BPS, Math.floor(Number(req.body?.markupBps))));
  if (!Number.isFinite(markupBps)) return res.status(400).json({ error: `markupBps must be 0..${PARTNER_MAX_MARKUP_BPS}.` });
  await prisma.apiPartner.update({ where: { id: p.id }, data: { feeBps: markupBps } });
  return res.json({ markupBps, revenueShareBps: PARTNER_REVENUE_SHARE_BPS, totalEarnBps: PARTNER_REVENUE_SHARE_BPS + markupBps });
});

// Partner-authed: rotate the API key. The old key stops working immediately.
router.post('/v1/partner/rotate-key', partnerRateLimit, partnerAuth, async (req, res) => {
  const p = (res.locals as any).partner;
  const { key, prefix, hash } = generateApiKey();
  await prisma.apiPartner.update({ where: { id: p.id }, data: { keyPrefix: prefix, keyHash: hash } });
  return res.json({ apiKey: key, keyPrefix: prefix, warning: 'Save this key now — it replaces your old key, which no longer works.' });
});

// Partner-authed: monthly statements — earnings rolled up by month and asset.
router.get('/v1/partner/statements', partnerRateLimit, partnerAuth, async (_req, res) => {
  const p = (res.locals as any).partner;
  const rows = await prisma.swapQuote.findMany({
    where: { partnerId: p.id, status: { in: ['AUTHORIZED', 'ROUTING', 'COMPLETE'] } },
    select: { fromAsset: true, amount: true, partnerFeeBps: true, authorizationMetadata: true, createdAt: true }
  });
  type Asset = { assetId: string; symbol: string; decimals: number; volume: bigint; earned: bigint };
  type Month = { month: string; swapCount: number; assets: Record<string, Asset> };
  const months: Record<string, Month> = {};
  // Only swaps actually broadcast on-chain — matches /earnings and the payout basis.
  for (const r of rows.filter((row) => broadcastTxHash(row.authorizationMetadata))) {
    const month = r.createdAt.toISOString().slice(0, 7);
    const m = (months[month] ||= { month, swapCount: 0, assets: {} });
    m.swapCount++;
    const asset = getSwapAsset(r.fromAsset);
    const a = (m.assets[r.fromAsset] ||= { assetId: r.fromAsset, symbol: asset?.symbol ?? r.fromAsset, decimals: asset?.decimals ?? 0, volume: 0n, earned: 0n });
    const amt = BigInt(/^[0-9]+$/.test(r.amount) ? r.amount : '0');
    a.volume += amt;
    a.earned += (amt * BigInt(PARTNER_REVENUE_SHARE_BPS + (r.partnerFeeBps || 0))) / 10000n;
  }
  const statements = Object.values(months)
    .sort((x, y) => y.month.localeCompare(x.month))
    .map((m) => ({
      month: m.month, swapCount: m.swapCount,
      assets: Object.values(m.assets).map((a) => ({ assetId: a.assetId, symbol: a.symbol, volume: fmtUnits(a.volume, a.decimals), earned: fmtUnits(a.earned, a.decimals) }))
    }));
  return res.json({ revenueShareBps: PARTNER_REVENUE_SHARE_BPS, markupBps: p.feeBps, statements });
});

export default router;

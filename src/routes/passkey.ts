import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// Passkey (email) wallet directory.
//
// Threat model (M2): these endpoints are necessarily unauthenticated — the user
// has no account before their passkey exists. So they are designed to be USELESS
// to an attacker rather than merely guarded:
//
//  * /lookup answers ONLY "does a wallet exist for this email" — never the
//    address, never the credential id. Email -> wallet-address harvesting is
//    therefore impossible, as is tricking a user into funding someone else's
//    address that a squatter registered.
//  * The client NEVER trusts a server-supplied credential id for unlocking. It
//    uses the device-local credential, or falls back to a discoverable passkey
//    (the platform picker, scoped to our RP ID). So a squatted row cannot hijack
//    or lock out a real user — the passkey is the only root of trust.
//  * An email's address is immutable once set (409), so a record can't be
//    silently repointed.
//  * Both endpoints carry tight, IP-keyed rate limits to stop bulk probing.
//
// The private key is never sent to or stored on the server; it is re-derived
// on-device from the passkey via WebAuthn PRF for every signature.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const clip = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

const clientIp = (req: any): string => {
  const cf = req.headers['cf-connecting-ip'];
  return typeof cf === 'string' && cf.length ? cf : req.ip || 'unknown';
};
const lookupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 60, // existence probes per IP per hour
  standardHeaders: true, legacyHeaders: false, keyGenerator: clientIp
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10, // wallet registrations per IP per hour
  standardHeaders: true, legacyHeaders: false, keyGenerator: clientIp
});

// Existence hint only — powers the "Unlock vs Create" UX. Deliberately leaks
// nothing else: no address, no credential id.
router.get('/v1/passkey/lookup', lookupLimiter, async (req, res) => {
  try {
    const email = clip(req.query.email, 200).toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required.' });
    const rec = await prisma.passkeyCredential.findUnique({ where: { email }, select: { id: true } });
    return res.json({ exists: !!rec });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'Lookup failed.' });
  }
});

// Record that a wallet exists for this email. Address is immutable once set, and
// the response never echoes any address (an attacker must learn nothing).
router.post('/v1/passkey/register', registerLimiter, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = clip(body.email, 200).toLowerCase();
    const credentialId = clip(body.credentialId, 512);
    const address = clip(body.address, 64);
    const chainMode = clip(body.chainMode, 12).toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required.' });
    if (!credentialId) return res.status(400).json({ error: 'credentialId required.' });
    if (!ADDRESS_RE.test(address)) return res.status(400).json({ error: 'Valid address required.' });

    const existing = await prisma.passkeyCredential.findUnique({ where: { email } });
    if (existing && existing.address.toLowerCase() !== address.toLowerCase()) {
      // Immutable binding. No address echoed back — see threat model above.
      return res.status(409).json({ error: 'A wallet already exists for this email. Unlock it instead of creating a new one.' });
    }

    await prisma.passkeyCredential.upsert({
      where: { email },
      create: { email, credentialId, address, chainMode },
      update: { credentialId, chainMode }
    });
    return res.status(existing ? 200 : 201).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'Register failed.' });
  }
});

export default router;

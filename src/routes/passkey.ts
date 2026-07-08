import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// Passkey (email) wallet cross-device sync. We persist ONLY the WebAuthn
// credential id (an identifier, not a secret) + the derived EOA address, keyed
// by email — so a user can unlock the same wallet from any device. The private
// key is never sent to or stored on the server; it is re-derived on-device from
// the passkey via WebAuthn PRF. See wallet-test.html / passkey-wallet.js.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const clip = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

// Look up an existing wallet for an email (any device).
router.get('/v1/passkey/lookup', async (req, res) => {
  try {
    const email = clip(req.query.email, 200).toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required.' });
    const rec = await prisma.passkeyCredential.findUnique({ where: { email } });
    if (!rec) return res.json({ exists: false });
    return res.json({ exists: true, credentialId: rec.credentialId, address: rec.address, chainMode: rec.chainMode });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'Lookup failed.' });
  }
});

// Register (or refresh) the credential for an email after a passkey wallet is
// created/unlocked. Idempotent upsert; a mismatched address for an existing
// email is rejected (don't silently overwrite a funded wallet mapping).
router.post('/v1/passkey/register', async (req, res) => {
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
      return res.status(409).json({
        error: 'A different wallet already exists for this email. Unlock the existing wallet instead of creating a new one.',
        address: existing.address
      });
    }

    const rec = await prisma.passkeyCredential.upsert({
      where: { email },
      create: { email, credentialId, address, chainMode },
      update: { credentialId, chainMode }
    });
    return res.status(existing ? 200 : 201).json({ email: rec.email, address: rec.address, chainMode: rec.chainMode });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'Register failed.' });
  }
});

export default router;

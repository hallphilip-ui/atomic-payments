import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

// Partner Swap API auth. Partners send their key as `Authorization: Bearer <key>`
// (or `x-atomic-api-key`). We store ONLY the sha256 hash + a short prefix — the
// plaintext key is shown once at creation and never persisted, so a DB leak can't
// expose usable keys.
const prisma = new PrismaClient();

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key.trim()).digest('hex');
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = 'ak_live_' + crypto.randomBytes(24).toString('hex');
  return { key, prefix: key.slice(0, 14), hash: hashApiKey(key) };
}

function extractKey(req: Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const h = req.headers['x-atomic-api-key'];
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Per-key rate limit for the partner API (keyed on the key, falling back to IP).
export const partnerRateLimit = rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => extractKey(req) || (req.headers['cf-connecting-ip'] as string) || req.ip || 'unknown'
});

export async function partnerAuth(req: Request, res: Response, next?: NextFunction) {
  try {
    const key = extractKey(req);
    if (!key) return res.status(401).json({ error: 'API key required. Send "Authorization: Bearer <key>".' });
    const partner = await prisma.apiPartner.findUnique({ where: { keyHash: hashApiKey(key) } });
    if (!partner || !partner.active) return res.status(401).json({ error: 'Invalid or disabled API key.' });
    (res.locals as any).partner = partner;
    return next?.();
  } catch {
    return res.status(500).json({ error: 'Authorization error.' });
  }
}

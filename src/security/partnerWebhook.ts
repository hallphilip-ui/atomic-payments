import crypto from 'crypto';
import net from 'net';
import { lookup } from 'dns/promises';
import { PrismaClient } from '@prisma/client';

// Partner webhooks. When a partner-originated swap changes state, we POST a signed
// event to their configured URL. Signature = HMAC-SHA256(body, webhookSecret) in the
// `x-atomic-signature` header so partners can verify authenticity. Best-effort and
// fully non-blocking — a partner's slow/broken endpoint never affects the swap flow.
const prisma = new PrismaClient();

export function generateWebhookSecret(): string {
  return 'whsec_' + crypto.randomBytes(24).toString('hex');
}

// SSRF guard. A partner controls their webhookUrl, so before we POST to it from the
// production box we must refuse private/loopback/link-local/reserved destinations —
// otherwise a partner could point it at an internal service or the cloud metadata
// endpoint (169.254.169.254). We resolve the host and reject if ANY resolved IP is
// non-public (defends against split-horizon DNS too).
function ipv4Private(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 ||                 // this-network, private, loopback
    (a === 169 && b === 254) ||                          // link-local (incl. metadata)
    (a === 172 && b >= 16 && b <= 31) ||                 // private
    (a === 192 && b === 168) ||                          // private
    (a === 100 && b >= 64 && b <= 127) ||                // CGNAT
    a >= 224                                             // multicast + reserved (224-255)
  );
}
function ipPrivate(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return ipv4Private(ip);
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;            // loopback / unspecified
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);   // IPv4-mapped
    if (mapped) return ipv4Private(mapped[1]);
    return lower.startsWith('fc') || lower.startsWith('fd')        // unique-local fc00::/7
      || lower.startsWith('fe8') || lower.startsWith('fe9')        // link-local fe80::/10
      || lower.startsWith('fea') || lower.startsWith('feb')
      || lower.startsWith('ff');                                   // multicast
  }
  return true; // not a recognized IP → refuse
}
export async function isSafeWebhookUrl(url: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (net.isIP(host)) return !ipPrivate(host);     // IP literal
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !ipPrivate(a.address));
  } catch {
    return false; // unresolvable → refuse
  }
}

export type WebhookEvent = { type: string; quoteId: string; status: string; [k: string]: unknown };

export async function firePartnerWebhook(partnerId: string | null | undefined, event: WebhookEvent): Promise<void> {
  if (!partnerId) return;
  try {
    const partner = await prisma.apiPartner.findUnique({ where: { id: partnerId }, select: { webhookUrl: true, webhookSecret: true } });
    if (!partner?.webhookUrl) return;
    // SSRF guard: never POST to a private/internal destination, even if a bad URL
    // slipped past registration or a hostname later resolves to a private IP.
    if (!(await isSafeWebhookUrl(partner.webhookUrl))) {
      console.warn('[webhook] refused non-public webhook URL for partner', partnerId);
      return;
    }
    const body = JSON.stringify({ ...event, sentAt: new Date().toISOString() });
    const sig = partner.webhookSecret ? crypto.createHmac('sha256', partner.webhookSecret).update(body).digest('hex') : '';
    // Fire-and-forget with a timeout; swallow all errors.
    fetch(partner.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-atomic-signature': sig, 'user-agent': 'Atomic-Webhooks/1' },
      body, signal: AbortSignal.timeout(6000)
    }).catch(() => {});
  } catch { /* best-effort */ }
}

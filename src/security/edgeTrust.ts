import crypto from 'crypto';
import type { Request } from 'express';

// Defense-in-depth for the Cloudflare-derived jurisdiction country (CF-IPCountry).
// The origin is already locked to Cloudflare IP ranges at nginx, but CF-IPCountry is
// a plain header — a request that reaches the origin directly could forge it. As a
// second barrier we can require a shared secret the edge injects.
//
// When ATOMIC_EDGE_SECRET is set, a request is "edge-trusted" only if it presents the
// matching x-atomic-edge-secret header (add it via a Cloudflare Transform Rule or an
// nginx `proxy_set_header`). When the secret is set but the header is absent/wrong,
// the request did NOT transit our edge, so its CF-IPCountry can't be trusted and
// jurisdiction screening fails safe (blocks). When the secret is unset, behaviour is
// unchanged — CF-IPCountry is trusted and the nginx CF-IP lockdown is the control.

export function edgeSecretConfigured(): boolean {
  return !!(process.env.ATOMIC_EDGE_SECRET && process.env.ATOMIC_EDGE_SECRET.trim());
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function isEdgeTrusted(req: Request): boolean {
  if (!edgeSecretConfigured()) return true;
  const secret = (process.env.ATOMIC_EDGE_SECRET as string).trim();
  const h = req.headers['x-atomic-edge-secret'];
  const provided = Array.isArray(h) ? h[0] : h;
  return typeof provided === 'string' && timingSafeEqual(provided, secret);
}

// Country to screen + whether we can trust it. trusted:false (only possible when a
// secret is configured and the request isn't from our edge) tells screening to fail
// safe instead of accepting a forgeable header.
export function resolveJurisdiction(req: Request): { countryCode?: string; trusted: boolean } {
  const trusted = isEdgeTrusted(req);
  const cf = req.headers['cf-ipcountry'];
  const countryCode = typeof cf === 'string' ? cf : undefined;
  return { countryCode, trusted };
}

import crypto from 'crypto';

// Cloudflare Access (Zero Trust) JWT verification — for the Arb Desk ONLY.
//
// When the Arb Desk path sits behind a Cloudflare Access application, Cloudflare
// authenticates the person (email OTP / SSO) at the edge and injects a signed JWT
// (`Cf-Access-Jwt-Assertion`) on the request to the origin. We verify that JWT here
// so a team member logs in with their OWN identity — no shared operator key — and
// Cloudflare's Access logs give a per-person audit trail.
//
// Dependency-free RS256 + JWKS verification with Node crypto, same approach as
// keycloakVerifier.ts. OFF unless BOTH env vars are set:
//   ARB_ACCESS_TEAM_DOMAIN  e.g. hall-philip.cloudflareaccess.com
//   ARB_ACCESS_AUD          the Access application's Application Audience (AUD) tag

const TEAM_DOMAIN = (process.env.ARB_ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
const AUD = (process.env.ARB_ACCESS_AUD || '').trim();
const CLOCK_SKEW_SEC = 60;

export function isCfAccessEnabled(): boolean {
  return TEAM_DOMAIN.length > 0 && AUD.length > 0;
}

type Jwk = { kid?: string; kty?: string; n?: string; e?: string };

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
let lastFetchAttempt = 0;
const JWKS_TTL_MS = 10 * 60 * 1000;
const REFETCH_MS = 30 * 1000;

async function fetchJwks(): Promise<Jwk[]> {
  const url = `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`;
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Access JWKS fetch failed: HTTP ${r.status}`);
  const data = (await r.json()) as { keys?: Jwk[] };
  if (!Array.isArray(data.keys)) throw new Error('Access JWKS missing keys');
  jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

async function keyForKid(kid: string): Promise<Jwk | null> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    const hit = jwksCache.keys.find((k) => k.kid === kid);
    if (hit) return hit;
  }
  if (Date.now() - lastFetchAttempt < REFETCH_MS && jwksCache) {
    return jwksCache.keys.find((k) => k.kid === kid) ?? null;
  }
  lastFetchAttempt = Date.now();
  const keys = await fetchJwks();
  return keys.find((k) => k.kid === kid) ?? null;
}

function b64urlJson(part: string): any {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// Verify a Cloudflare Access JWT. Returns the authenticated email, or null for any
// invalid/expired/wrong-audience token. Never throws to the caller path.
export async function verifyCfAccessEmail(token: string | undefined): Promise<string | null> {
  if (!isCfAccessEnabled() || !token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = b64urlJson(parts[0]);
    if (header?.alg !== 'RS256' || typeof header?.kid !== 'string') return null;

    const jwk = await keyForKid(header.kid);
    if (!jwk || jwk.kty !== 'RSA') return null;

    const publicKey = crypto.createPublicKey({ key: jwk as any, format: 'jwk' });
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], 'base64url');
    if (!crypto.verify('RSA-SHA256', signed, publicKey, signature)) return null;

    const payload = b64urlJson(parts[1]);
    const now = Math.floor(Date.now() / 1000);

    if (payload?.iss !== `https://${TEAM_DOMAIN}`) return null;
    if (typeof payload?.exp === 'number' && now > payload.exp + CLOCK_SKEW_SEC) return null;
    if (typeof payload?.nbf === 'number' && now + CLOCK_SKEW_SEC < payload.nbf) return null;

    const aud = Array.isArray(payload?.aud) ? payload.aud : payload?.aud ? [payload.aud] : [];
    if (!aud.includes(AUD)) return null;

    const email = typeof payload?.email === 'string' ? payload.email : null;
    return email;
  } catch {
    return null;
  }
}

export function cfAccessConfigSummary() {
  return { enabled: isCfAccessEnabled(), teamDomain: TEAM_DOMAIN || null, audSet: AUD.length > 0 };
}

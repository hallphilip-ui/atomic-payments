import crypto from 'crypto';
import type { OperatorRole } from './operatorRules';

// Keycloak (OIDC) access-token verification for the OPERATOR/ADMIN plane only.
//
// Design goals:
//  * Dependency-free: JWKS fetch + strict RS256 verification with Node's crypto,
//    so we don't add a JWT library to the funds backend.
//  * Fail-safe migration: entirely OFF unless ATOMIC_KEYCLOAK_ISSUER is set, so
//    the static operator key keeps working until the realm/client/roles exist.
//  * Strict: alg is pinned to RS256 (no 'none'/HS256 alg-confusion), the key comes
//    only from the issuer's JWKS, and issuer/expiry/azp/role are all checked.
//
// This is NOT used for end users — the swap/wallet flow stays wallet-native.
// Set up in Keycloak realm `autotraderx` (shared with AutoTraderX):
//   * a client `atomic-admin` (bearer-only / confidential),
//   * realm (or client) roles `atomic-admin` and `atomic-readonly`,
//   * operators assigned the appropriate role.

const ISSUER = (process.env.ATOMIC_KEYCLOAK_ISSUER || '').trim().replace(/\/$/, '');
const CLIENT_ID = (process.env.ATOMIC_KEYCLOAK_CLIENT_ID || 'atomic-admin').trim();
const ADMIN_ROLE = (process.env.ATOMIC_KEYCLOAK_ADMIN_ROLE || 'atomic-admin').trim();
const READONLY_ROLE = (process.env.ATOMIC_KEYCLOAK_READONLY_ROLE || 'atomic-readonly').trim();
const CLOCK_SKEW_SEC = 60;

export function isKeycloakEnabled(): boolean {
  return ISSUER.length > 0;
}

export function extractBearer(header: unknown): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

type Jwk = { kid?: string; kty?: string; alg?: string; use?: string; n?: string; e?: string };

// JWKS cache. Refetch on an unknown kid, but no more than once per REFETCH_MS so
// a flood of bogus kids can't be used to hammer the Keycloak certs endpoint.
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
let lastFetchAttempt = 0;
const JWKS_TTL_MS = 10 * 60 * 1000;
const REFETCH_MS = 30 * 1000;

async function fetchJwks(): Promise<Jwk[]> {
  const url = `${ISSUER}/protocol/openid-connect/certs`;
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`JWKS fetch failed: HTTP ${r.status}`);
  const data = (await r.json()) as { keys?: Jwk[] };
  if (!Array.isArray(data.keys)) throw new Error('JWKS response missing keys');
  jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

async function keyForKid(kid: string): Promise<Jwk | null> {
  const fresh = jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh) {
    const hit = jwksCache!.keys.find((k) => k.kid === kid);
    if (hit) return hit;
  }
  // Unknown kid or stale cache — refetch, but rate-limit the attempts.
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

function rolesFrom(payload: any): string[] {
  const realm = Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : [];
  const client = Array.isArray(payload?.resource_access?.[CLIENT_ID]?.roles)
    ? payload.resource_access[CLIENT_ID].roles
    : [];
  return [...realm, ...client].filter((r) => typeof r === 'string');
}

// Verify a Keycloak access token and map it to an operator role. Returns null for
// any invalid/expired/unauthorized token (never throws to the caller path).
export async function verifyKeycloakOperator(token: string): Promise<OperatorRole | null> {
  if (!isKeycloakEnabled()) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = b64urlJson(parts[0]);
    // Pin the algorithm — reject 'none', HS256 (alg confusion), everything but RS256.
    if (header?.alg !== 'RS256' || typeof header?.kid !== 'string') return null;

    const jwk = await keyForKid(header.kid);
    if (!jwk || jwk.kty !== 'RSA') return null;

    const publicKey = crypto.createPublicKey({ key: jwk as any, format: 'jwk' });
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], 'base64url');
    if (!crypto.verify('RSA-SHA256', signed, publicKey, signature)) return null;

    const payload = b64urlJson(parts[1]);
    const now = Math.floor(Date.now() / 1000);

    if (payload?.iss !== ISSUER) return null;
    if (typeof payload?.exp === 'number' && now > payload.exp + CLOCK_SKEW_SEC) return null;
    if (typeof payload?.nbf === 'number' && now + CLOCK_SKEW_SEC < payload.nbf) return null;

    // Bind the token to our client: Keycloak sets `azp` to the requesting client,
    // and/or lists it in `aud`. Accept either so a mapper-added aud also works.
    const aud = Array.isArray(payload?.aud) ? payload.aud : payload?.aud ? [payload.aud] : [];
    const boundToClient = payload?.azp === CLIENT_ID || aud.includes(CLIENT_ID);
    if (!boundToClient) return null;

    const roles = rolesFrom(payload);
    if (roles.includes(ADMIN_ROLE)) return 'admin';
    if (roles.includes(READONLY_ROLE)) return 'readonly';
    return null;
  } catch {
    return null;
  }
}

export function keycloakConfigSummary() {
  return { enabled: isKeycloakEnabled(), issuer: ISSUER || null, clientId: CLIENT_ID, adminRole: ADMIN_ROLE, readonlyRole: READONLY_ROLE };
}

import { OFAC_SANCTIONED_ADDRESSES } from './ofacSanctionedAddresses';

export type SanctionsHit = {
  listed: boolean;
  source: 'ofac_sdn_local' | 'chainalysis_oracle';
  category: string;
  matchedAddress: string;
};

// Comprehensively embargoed jurisdictions (OFAC). Country-level only — sub-national
// sanctioned regions (Crimea, Donetsk, Luhansk) cannot be resolved from a country
// code alone. Override with ATOMIC_BLOCKED_COUNTRIES (comma-separated ISO codes)
// so compliance can set policy without a code change.
const DEFAULT_BLOCKED_COUNTRIES = ['CU', 'IR', 'KP', 'SY'];

export function blockedCountries(): Set<string> {
  const override = process.env.ATOMIC_BLOCKED_COUNTRIES;
  if (override && override.trim()) {
    return new Set(override.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean));
  }
  return new Set(DEFAULT_BLOCKED_COUNTRIES);
}

export function screenCountry(countryCode?: string | null): boolean {
  if (!countryCode) return false;
  return blockedCountries().has(countryCode.trim().toUpperCase());
}

export function isChainalysisConfigured(): boolean {
  return Boolean(process.env.ATOMIC_CHAINALYSIS_API_KEY && process.env.ATOMIC_CHAINALYSIS_API_KEY.trim());
}

function normalize(address: string): string {
  return address.trim().toLowerCase();
}

// Offline OFAC list check — always available, deterministic, no dependency.
export function screenAddressLocal(address: string): SanctionsHit | null {
  if (!address) return null;
  if (OFAC_SANCTIONED_ADDRESSES.has(normalize(address))) {
    return { listed: true, source: 'ofac_sdn_local', category: 'sanctions', matchedAddress: address };
  }
  return null;
}

// Chainalysis free sanctions oracle. Authoritative live OFAC coverage.
// GET https://public.chainalysis.com/api/v1/address/{address}
// A non-empty `identifications` array means the address is sanctioned.
// Fail-open on vendor/network error: the local list has already run and remains
// authoritative, so a Chainalysis outage never blocks legitimate users.
export async function screenAddressChainalysis(address: string): Promise<SanctionsHit | null> {
  const key = process.env.ATOMIC_CHAINALYSIS_API_KEY;
  if (!key || !address) return null;
  try {
    const res = await fetch(`https://public.chainalysis.com/api/v1/address/${encodeURIComponent(address.trim())}`, {
      headers: { 'X-API-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { identifications?: Array<{ category?: string }> };
    const ids = Array.isArray(data.identifications) ? data.identifications : [];
    if (ids.length > 0) {
      return { listed: true, source: 'chainalysis_oracle', category: ids[0]?.category || 'sanctions', matchedAddress: address };
    }
    return null;
  } catch {
    return null;
  }
}

// Screen a single address: local OFAC list first (offline), then the Chainalysis
// oracle if configured. Returns the first hit, or null if clear.
export async function screenAddress(address: string): Promise<SanctionsHit | null> {
  const local = screenAddressLocal(address);
  if (local) return local;
  return screenAddressChainalysis(address);
}

// Screen every provided address; returns the first sanctions hit or null.
export async function screenAddresses(addresses: Array<string | undefined | null>): Promise<SanctionsHit | null> {
  const seen = new Set<string>();
  for (const address of addresses) {
    if (!address) continue;
    const key = normalize(address);
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = await screenAddress(address);
    if (hit) return hit;
  }
  return null;
}

export function localListSize(): number {
  return OFAC_SANCTIONED_ADDRESSES.size;
}

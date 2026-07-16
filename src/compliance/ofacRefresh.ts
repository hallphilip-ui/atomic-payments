// Daily refresh of the local OFAC sanctioned-address list from the official
// Treasury SDN feed — free, keyless, no vendor account required.
//
// WHY: the compiled-in baseline (ofacSanctionedAddresses.ts) is only as fresh
// as the last deploy, and OFAC designations move in BOTH directions — Tornado
// Cash was delisted in March 2025, so a stale list over-blocks as well as
// under-blocks. This job REPLACES the runtime set on every sane download so
// listings and delistings both propagate without a redeploy.
//
// MEMORY: sdn_advanced.xml is ~120MB. The response is stream-parsed with a
// small carry buffer — the whole document is never held in memory (the box is
// 3.8GB shared with the opensigner Docker stack).
//
// FAIL-OPEN: any fetch/parse problem leaves the current set untouched and logs
// loudly. A truncated or format-changed download is rejected by the
// MIN_SANE_ADDRESSES guard rather than wiping screening. The last good
// download is persisted (prisma/ is the app's writable dir) so a restart keeps
// freshness instead of regressing to the compiled baseline until the next poll.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { OFAC_SANCTIONED_ADDRESSES } from './ofacSanctionedAddresses';

const SDN_URL =
  process.env.OFAC_SDN_URL || 'https://sanctionslistservice.ofac.treas.gov/api/download/sdn_advanced.xml';
const POLL_MS = Number(process.env.ATOMIC_OFAC_REFRESH_MS) || 24 * 60 * 60 * 1000; // 24h
const CACHE_PATH = join(process.cwd(), 'prisma', 'ofac_sdn_cache.json');
// The live list has ~900 entries; anything under this is a broken download,
// not a real delisting wave — keep what we have.
const MIN_SANE_ADDRESSES = 200;

// Address shapes we screen. Keep in sync with scripts/update-ofac-addresses.js
// (the dev-time counterpart that rewrites the compiled baseline).
const ADDRESS_PATTERNS = [
  /^0x[a-fA-F0-9]{40}$/, // EVM (ETH, etc.)
  /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/, // Bitcoin
  /^(ltc1|[LM])[a-km-zA-HJ-NP-Z1-9]{26,45}$/, // Litecoin
  /^T[1-9A-HJ-NP-Za-km-z]{33}$/ // Tron
];

function looksLikeCryptoAddress(value: string): boolean {
  return ADDRESS_PATTERNS.some((re) => re.test(value));
}

// Digital-currency addresses live in <VersionDetail> values; filter by shape.
// Streaming: each chunk is scanned together with a small tail carried from the
// previous chunk so a tag split across a chunk boundary is still matched.
async function fetchAddresses(): Promise<Set<string>> {
  const res = await fetch(SDN_URL, {
    headers: { Accept: 'application/xml' },
    signal: AbortSignal.timeout(180000)
  });
  if (!res.ok || !res.body) throw new Error(`OFAC download failed: HTTP ${res.status}`);

  const found = new Set<string>();
  const decoder = new TextDecoder();
  const TAG_RE = /<VersionDetail[^>]*>([^<]+)<\/VersionDetail>/g;
  let carry = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    const text = carry + decoder.decode(chunk, { stream: true });
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text))) {
      const value = m[1].trim();
      if (looksLikeCryptoAddress(value)) found.add(value.toLowerCase());
      lastEnd = TAG_RE.lastIndex;
    }
    // Keep only the unmatched tail (a VersionDetail entry is well under 4KB).
    carry = text.slice(Math.max(lastEnd, text.length - 4096));
  }
  return found;
}

// Swap the runtime set in one synchronous pass — screening reads .has() between
// ticks, so no request ever observes a partially filled set.
function applyAddresses(addresses: Iterable<string>): number {
  OFAC_SANCTIONED_ADDRESSES.clear();
  let count = 0;
  for (const address of addresses) {
    OFAC_SANCTIONED_ADDRESSES.add(address);
    count += 1;
  }
  return count;
}

export async function refreshOfacOnce(): Promise<{ count: number }> {
  const found = await fetchAddresses();
  if (found.size < MIN_SANE_ADDRESSES) {
    throw new Error(
      `parsed only ${found.size} addresses (< ${MIN_SANE_ADDRESSES}) — refusing to shrink the screening list`
    );
  }
  const count = applyAddresses(found);
  try {
    writeFileSync(
      CACHE_PATH,
      JSON.stringify({ refreshedAt: new Date().toISOString(), count, addresses: [...found] })
    );
  } catch (error) {
    console.warn('[ofac-refresh] could not persist cache (screening still updated):', (error as Error).message);
  }
  return { count };
}

// Boot: restore the last good download so freshness survives restarts.
function loadCache(): void {
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as { refreshedAt?: string; addresses?: string[] };
    if (Array.isArray(raw.addresses) && raw.addresses.length >= MIN_SANE_ADDRESSES) {
      const count = applyAddresses(raw.addresses.map((a) => String(a).toLowerCase()));
      console.log(`🛡️  OFAC list restored from cache (${count} addresses, refreshed ${raw.refreshedAt})`);
    }
  } catch {
    /* no cache yet — compiled baseline stays in effect until the first poll */
  }
}

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const { count } = await refreshOfacOnce();
    console.log(`🛡️  OFAC list refreshed from Treasury SDN (${count} addresses)`);
  } catch (error) {
    console.warn('[ofac-refresh] refresh failed — current list stays in effect:', (error as Error).message);
  } finally {
    ticking = false;
  }
}

export function startOfacRefresh(): void {
  loadCache();
  // First fetch shortly after boot (off the critical path), then daily.
  setTimeout(tick, 30 * 1000);
  setInterval(tick, POLL_MS);
  console.log(`🛡️  OFAC auto-refresh live (official Treasury SDN, every ${Math.round(POLL_MS / 3600000)}h)`);
}

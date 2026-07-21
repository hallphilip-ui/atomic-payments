// Arkham Intelligence address attribution — a paid layer ABOVE the free label corpus.
//
// WHAT IT ADDS: live entity attribution the free 33k-entry corpus structurally cannot do
// — which exchange an address belongs to, whether it's a deposit/hot wallet, a named
// individual, a DeFi router. "Funded by a Binance hot wallet" is a completely different
// provenance story from "funded by an unlabelled EOA", and until now we could not tell
// them apart. This feeds the funding-provenance and counterparty factors of the
// composite risk verdict.
//
// DESIGN PRINCIPLES, consistent with the rest of this codebase:
//   * FAILS OPEN. Arkham down, rate-limited, or unconfigured → returns null, and the
//     caller falls back to the free corpus. A paid dependency must never blank the
//     labels or break a wallet lookup.
//   * STATES ITS SOURCE. Every label it returns is tagged source:'arkham' so the UI can
//     distinguish a paid attribution from a corpus guess. We never present one as the other.
//   * CACHED. Attribution changes slowly; an in-memory TTL cache keeps us far under the
//     ~20 req/s Basic-tier limit even when a report touches many counterparties.
//   * KEY STAYS SERVER-SIDE. Read from env, never logged, never returned to the client.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ARKHAM_BASE = 'https://api.arkm.com';
const KEY = (process.env.ARKHAM_API_KEY || '').trim();

// Disk cache survives restarts; entries are cheap and attribution is stable. Memory
// cache in front avoids disk on the hot path.
const CACHE_PATH = process.env.ARKHAM_CACHE_PATH ||
  join(process.cwd(), 'prisma', 'arkham_cache.json');
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — entity attribution barely moves
const NEG_TTL_MS = 24 * 60 * 60 * 1000; // re-check "unknown" daily; Arkham adds labels over time

export type ArkhamLabel = {
  source: 'arkham';
  entity: string | null;      // e.g. "Binance", "Uniswap", "Vitalik Buterin"
  entity_type: string | null; // e.g. "cex", "dex", "individual"
  entity_id: string | null;   // stable slug, e.g. "binance"
  label: string | null;       // e.g. "Hot Wallet", "Router v2"
  is_contract: boolean;
  // A single human-readable line for display: "Binance — Hot Wallet".
  display: string;
};

type CacheEntry = { at: number; data: ArkhamLabel | null };
let mem: Record<string, CacheEntry> | null = null;

function loadCache(): Record<string, CacheEntry> {
  if (mem) return mem;
  try { mem = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {}; }
  catch { mem = {}; }
  return mem!;
}
let flushTimer: NodeJS.Timeout | null = null;
function scheduleFlush() {
  if (flushTimer || !mem) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try { writeFileSync(CACHE_PATH, JSON.stringify(mem)); } catch { /* read-only fs */ }
  }, 5000);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

export function arkhamConfigured(): boolean { return !!KEY; }

/**
 * Attribution for one EVM address. null = no data OR Arkham unavailable — the caller
 * MUST treat null as "consult the free corpus", never as "clean/unknown".
 */
export async function arkhamLabel(address?: string | null): Promise<ArkhamLabel | null> {
  if (!KEY || !address) return null;
  const key = address.toLowerCase();
  const cache = loadCache();
  const hit = cache[key];
  if (hit) {
    const ttl = hit.data ? TTL_MS : NEG_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.data;
  }

  let data: ArkhamLabel | null = null;
  try {
    const r = await fetch(`${ARKHAM_BASE}/intelligence/address/${key}?chain=ethereum`, {
      headers: { 'API-Key': KEY },
      signal: AbortSignal.timeout(8000),
    });
    // A 429/5xx must NOT be cached as "unknown" — that would suppress a real label for a
    // day. Only cache a clean 200 (whether or not it carried an entity).
    if (r.ok) {
      const j: any = await r.json();
      const e = j?.arkhamEntity || null;
      const l = j?.arkhamLabel || null;
      if (e?.name || l?.name) {
        const entity = e?.name || null;
        const label = l?.name || null;
        data = {
          source: 'arkham',
          entity, entity_type: e?.type || null, entity_id: e?.id || null, label,
          is_contract: !!j?.contract,
          display: [entity, label].filter(Boolean).join(' — ') || entity || label || '',
        };
      }
      cache[key] = { at: Date.now(), data };
      scheduleFlush();
    }
    // non-ok: leave cache untouched, return null → caller falls back to corpus
  } catch { /* network/timeout → null, fail open */ }
  return data;
}

/** Batch helper — de-duplicates and respects the cache; sequential to stay polite to
 *  the rate limit. Returns a map keyed by lowercased address (only resolved ones). */
export async function arkhamLabels(addresses: Array<string | null | undefined>): Promise<Record<string, ArkhamLabel>> {
  const out: Record<string, ArkhamLabel> = {};
  if (!KEY) return out;
  const uniq = [...new Set(addresses.filter(Boolean).map((a) => String(a).toLowerCase()))];
  for (const a of uniq) {
    const l = await arkhamLabel(a);
    if (l) out[a] = l;
  }
  return out;
}

// Address label corpus — turns hex into meaning ("KuCoin 2", "Uniswap Router",
// "known drainer"). Without this, the counterparty and transaction sections of a
// wallet report are unreadable hex, which is where diligence value actually lives.
//
// Same architecture as ofacRefresh.ts, for the same reasons: free, keyless, public
// sources refreshed on a schedule, cached to disk so a restart keeps the data, and
// guarded so a bad/partial download can never shrink the corpus.
//
// SOURCES (all verified reachable, no signup, no rate limit):
//   * etherscan-labels — ~30k Etherscan nametags: exchange hot wallets, protocols,
//     routers, pools, bridges, mev-bot/airdrop-hunter behavioural tags.
//   * ScamSniffer blacklist — ~2.5k active drainer/scam addresses.
//   * MyEtherWallet darklist — ~700 phishing addresses, each with a comment.
//
// KNOWN LIMIT, stated so nobody over-reads a clean result: these contain exchange
// HOT wallets, not the per-user DEPOSIT addresses exchanges generate. Deposit-address
// attribution requires clustering (Arkham/Nansen/Chainalysis) and is not available
// from free data. "No label" therefore means "not in the corpus", never "not an
// exchange".
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type AddressLabel = { name: string; tags: string[]; risk?: 'scam' };

const CACHE_PATH = join(process.cwd(), 'prisma', 'address_labels_cache.json');
const POLL_MS = Number(process.env.ATOMIC_LABELS_REFRESH_MS) || 24 * 60 * 60 * 1000;
// The corpus is ~33k; anything far below that is a broken download, not a real shrink.
const MIN_SANE = 5_000;

const ETHERSCAN_LABELS = 'https://raw.githubusercontent.com/brianleect/etherscan-labels/main/data/etherscan/combined/combinedAllLabels.json';
const SCAMSNIFFER = 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json';
const MEW_DARKLIST = 'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json';

// Exported so callers can read it directly; replaced in place on refresh.
export const ADDRESS_LABELS = new Map<string, AddressLabel>();

export function lookupLabel(address?: string | null): AddressLabel | null {
  if (!address) return null;
  return ADDRESS_LABELS.get(address.trim().toLowerCase()) || null;
}

async function getJson(url: string, timeoutMs = 25_000): Promise<any> {
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Build a fresh corpus. Scam sources are applied LAST so a scam flag always wins over
// a benign protocol label for the same address.
async function build(): Promise<Map<string, AddressLabel>> {
  const out = new Map<string, AddressLabel>();

  try {
    const d = (await getJson(ETHERSCAN_LABELS)) as Record<string, { name?: string; labels?: string[] }>;
    for (const [addr, v] of Object.entries(d || {})) {
      const a = String(addr).toLowerCase();
      const tags = (v?.labels || []).slice(0, 4);
      const name = (v?.name || '').trim();
      if (!name && !tags.length) continue;
      out.set(a, { name: name || tags[0] || '', tags });
    }
  } catch (e) {
    console.warn('[labels] etherscan-labels fetch failed:', (e as Error).message);
  }

  try {
    const scam = (await getJson(SCAMSNIFFER)) as string[];
    for (const addr of scam || []) {
      const a = String(addr).toLowerCase();
      const prev = out.get(a);
      out.set(a, { name: prev?.name || 'Reported scam/drainer address', tags: [...(prev?.tags || []), 'scam'].slice(0, 5), risk: 'scam' });
    }
  } catch (e) {
    console.warn('[labels] scamsniffer fetch failed:', (e as Error).message);
  }

  try {
    const dark = (await getJson(MEW_DARKLIST)) as Array<{ address?: string; comment?: string }>;
    for (const row of dark || []) {
      if (!row?.address) continue;
      const a = String(row.address).toLowerCase();
      const prev = out.get(a);
      const note = (row.comment || '').trim().slice(0, 120);
      out.set(a, { name: note || prev?.name || 'Reported phishing address', tags: [...(prev?.tags || []), 'phishing'].slice(0, 5), risk: 'scam' });
    }
  } catch (e) {
    console.warn('[labels] MEW darklist fetch failed:', (e as Error).message);
  }

  return out;
}

function apply(entries: Iterable<[string, AddressLabel]>): number {
  ADDRESS_LABELS.clear();
  let n = 0;
  for (const [k, v] of entries) { ADDRESS_LABELS.set(k, v); n++; }
  return n;
}

export async function refreshLabelsOnce(): Promise<{ count: number; scam: number }> {
  const built = await build();
  if (built.size < MIN_SANE) {
    throw new Error(`only ${built.size} labels parsed (< ${MIN_SANE}) — refusing to shrink the corpus`);
  }
  const count = apply(built.entries());
  const scam = [...built.values()].filter((v) => v.risk === 'scam').length;
  try {
    writeFileSync(CACHE_PATH, JSON.stringify({ refreshedAt: new Date().toISOString(), count, entries: [...built.entries()] }));
  } catch (e) {
    console.warn('[labels] could not persist cache (labels still live):', (e as Error).message);
  }
  return { count, scam };
}

function loadCache(): void {
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as { refreshedAt?: string; entries?: Array<[string, AddressLabel]> };
    if (Array.isArray(raw.entries) && raw.entries.length >= MIN_SANE) {
      const n = apply(raw.entries);
      console.log(`🏷️  Address labels restored from cache (${n.toLocaleString()} entries, refreshed ${raw.refreshedAt})`);
    }
  } catch { /* no cache yet — the first poll fills it */ }
}

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const { count, scam } = await refreshLabelsOnce();
    console.log(`🏷️  Address labels refreshed (${count.toLocaleString()} entries, ${scam.toLocaleString()} scam/phishing)`);
  } catch (e) {
    console.warn('[labels] refresh failed — existing corpus stays in effect:', (e as Error).message);
  } finally {
    ticking = false;
  }
}

export function startLabelRefresh(): void {
  loadCache();
  setTimeout(tick, 45 * 1000); // off the boot critical path
  setInterval(tick, POLL_MS);
  console.log(`🏷️  Address-label corpus live (etherscan-labels + ScamSniffer + MEW darklist, every ${Math.round(POLL_MS / 3600000)}h)`);
}

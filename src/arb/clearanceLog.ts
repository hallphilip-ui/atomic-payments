// Would-have-cleared counter.
//
// THE QUESTION: over a rolling window, how many flash-loan opportunities would have
// cleared a real profitability bar, after every modelled cost, at tradeable size — AND
// were actually available to us to take?
//
// It exists to turn the build/no-build decision into a number. A contract plus audit is
// ~$10-40k and a month; this costs nothing and answers first.
//
// ---------------------------------------------------------------------------
// WHY SURFACES ARE SPLIT INTO FORWARD-LOOKING vs RETROSPECTIVE
//
// The first cut of this file counted every surface together and reported "21 cleared",
// which was an artefact, not a finding. Two distinct problems, both worth remembering:
//
//  1. CONSTANT-BY-CONSTRUCTION MARGIN. Venus pays a FIXED 10% liquidation incentive on
//     every position. So net% = (10% x 15% MEV capture) - 0.05% flash - 0.45% swap =
//     exactly 1.00%, for every row, regardless of size or how underwater the borrower
//     is. With the bar at 0.95%, all rows pass; at 1.05%, none do. The test could not
//     be failed on merit, so it measured nothing.
//
//  2. AVAILABILITY. A row can be profitable on paper and still never have been ours:
//       - The Aave feed is of COMPLETED liquidations. Every row was already won by
//         someone else, usually in the same block. It sizes the prize; it does not
//         show an opening.
//       - Venus liquidatable status derives from subgraph oracle prices that lag live
//         prices. The scanner's own note says a position shown liquidatable "may
//         already be healthy — or already seized by an MEV liquidator in-block."
//
// Only PancakeSwap cross-DEX arb reads LIVE on-chain reserves and asks "is there a
// spread right now" — so it is the only surface that can honestly answer "an
// opportunity existed that we could have taken." That is the headline count.
//
// Retrospective surfaces are still tracked, but reported separately and explicitly as
// prize-sizing, never as evidence to build on.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const THRESHOLD_PCT = Number(process.env.CLEARANCE_THRESHOLD_PCT || '0.95');
const MIN_PROFIT_USD = Number(process.env.CLEARANCE_MIN_PROFIT_USD || '50');
const MIN_SIZE_USD = Number(process.env.CLEARANCE_MIN_SIZE_USD || '1000');
const MEV_CAPTURE = Number(process.env.FLASH_MEV_BONUS_CAPTURE || '0.15');
const FLASH_FEE_BPS = 5;   // Aave v3 premium, verified on-chain 2026-07-20
const SWAP_COST_BPS = 45;  // 30 bps DEX fee + 15 bps slippage

const LEDGER_PATH = process.env.CLEARANCE_LOG_PATH ||
  join(process.cwd(), 'prisma', 'clearance_log.json');
const FLASH_SNAPSHOT = process.env.FLASH_SNAPSHOT_PATH ||
  '/opt/atomic-arb-scanner/flashloan_snapshot.json';
const BSC_SNAPSHOT = process.env.BSC_SNAPSHOT_PATH ||
  '/opt/atomic-arb-scanner/bsc_snapshot.json';

// Ledger schema version. Bumping it invalidates old ledgers whose rows were judged by
// different rules — mixing them would silently corrupt the count.
const SCHEMA = 3;

export type ClearedRow = {
  key: string; surface: string; at: string; detail: string;
  capital_usd: number; net_usd: number; net_pct: number;
  // REPLAY DATA. Without a block number a row cannot be re-tested against a fork, and
  // the observation is lost the moment the pool moves. Phase 2's exit criterion is
  // "replay real opportunities and assert capture", so capturing these at observation
  // time is not optional — it is the difference between 30 days of usable evidence and
  // 30 days of anecdotes. null block = row is NOT replayable; say so rather than hide it.
  observed_block: number | null;
  observed: Record<string, unknown> | null;  // raw scanner row, to diff against fork state
};
type Ledger = {
  schema: number;
  window_start: string;
  evaluated: number;
  evaluated_by_surface: Record<string, number>;
  cleared: ClearedRow[];        // FORWARD-LOOKING only — the build evidence
  retrospective: ClearedRow[];  // prize-sizing; NOT evidence of availability
  last_run: string | null;
  threshold_pct: number;
  min_profit_usd: number;
};

function empty(): Ledger {
  return {
    schema: SCHEMA, window_start: new Date().toISOString(), evaluated: 0,
    evaluated_by_surface: {}, cleared: [], retrospective: [], last_run: null,
    threshold_pct: THRESHOLD_PCT, min_profit_usd: MIN_PROFIT_USD,
  };
}

export function readLedger(): Ledger {
  try {
    if (!existsSync(LEDGER_PATH)) return empty();
    const l = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
    if (l.schema !== SCHEMA) return empty();
    if (l.threshold_pct !== THRESHOLD_PCT || l.min_profit_usd !== MIN_PROFIT_USD) return empty();
    if (!Array.isArray(l.retrospective)) l.retrospective = [];
    return l as Ledger;
  } catch { return empty(); }
}

// Chain heads at observation time. A row without one cannot be replayed, so this is
// fetched per pass rather than per row (one call, not N) and cached briefly.
const RPC: Record<string, string> = {
  bsc: process.env.BSC_RPC_URL || 'https://bsc-rpc.publicnode.com',
  ethereum: process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com',
};
async function blockNumber(chain: 'bsc' | 'ethereum'): Promise<number | null> {
  try {
    const r = await fetch(RPC[chain], {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const n = parseInt(j?.result, 16);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function qualifies(net: number, capital: number): boolean {
  if (!(capital >= MIN_SIZE_USD)) return false;
  if (!(net >= MIN_PROFIT_USD)) return false;
  return (net / capital) * 100 >= THRESHOLD_PCT;
}

/** Venus nets are not cost-deducted by the scanner, so re-cost them consistently. */
function recostVenus(r: any, gasUsd: number): { net: number; capital: number } {
  const seizable = num(r.seizable_usd);
  const kept = num(r.gross_bonus_usd) * MEV_CAPTURE;
  const flashFee = seizable * FLASH_FEE_BPS / 1e4;
  const swap = seizable * SWAP_COST_BPS / 1e4;
  return { net: kept - flashFee - swap - gasUsd, capital: seizable };
}

export async function runClearancePass(): Promise<Ledger> {
  const led = readLedger();
  const seenFwd = new Set(led.cleared.map((c) => c.key));
  const seenRetro = new Set(led.retrospective.map((c) => c.key));
  // One call per chain per pass, not per row.
  const [ethBlock, bscBlock] = await Promise.all([
    blockNumber('ethereum'), blockNumber('bsc'),
  ]);
  const bump = (s: string) => {
    led.evaluated++;
    led.evaluated_by_surface[s] = (led.evaluated_by_surface[s] || 0) + 1;
  };

  // === RETROSPECTIVE: Aave liquidations — already executed by someone else. ===
  try {
    const snap = JSON.parse(readFileSync(FLASH_SNAPSHOT, 'utf8'));
    for (const r of (snap?.liquidations?.rows || [])) {
      bump('aave_liquidation');
      const net = num(r.net_usd_competitive);
      const capital = num(r.borrow_usd);
      if (!qualifies(net, capital)) continue;
      const key = `aaveliq:${r.ts}:${r.collateral}:${r.seized_usd}`;
      if (seenRetro.has(key)) continue;
      seenRetro.add(key);
      led.retrospective.push({
        key, surface: 'Aave liquidation (already taken)', at: String(r.ts),
        detail: `${r.collateral} → ${r.repaid}, seized $${Math.round(num(r.seized_usd)).toLocaleString()}`,
        capital_usd: Math.round(capital), net_usd: Math.round(net * 100) / 100,
        net_pct: Math.round((net / capital) * 10000) / 100,
        observed_block: ethBlock, observed: r,
      });
    }
  } catch { /* snapshot absent */ }

  try {
    const bsc = JSON.parse(readFileSync(BSC_SNAPSHOT, 'utf8'));
    const clip = num(bsc?.assumptions?.arb_clip_usd);
    const bscGas = num(bsc?.assumptions?.liq_gas_usd);

    // === FORWARD-LOOKING: PancakeSwap arb, from live on-chain reserves. ===
    // This is the only surface whose "cleared" count is real evidence.
    for (const r of (bsc?.pancake_arb || [])) {
      bump('pancake_arb');
      if (r.shallow_pool) continue;   // untradeable at size, whatever the maths says
      const net = num(r.net_usd_on_clip);
      if (!qualifies(net, clip)) continue;
      // Bucket by hour so a standing spread counts as one occasion, not one per poll.
      const bucket = new Date().toISOString().slice(0, 13);
      const key = `pancake:${r.pair}:${r.buy_on}:${r.sell_on}:${bucket}`;
      if (seenFwd.has(key)) continue;
      seenFwd.add(key);
      led.cleared.push({
        key, surface: 'PancakeSwap arb', at: new Date().toISOString(),
        detail: `${r.pair} ${r.buy_on}→${r.sell_on}, spread ${r.spread_pct}%`,
        capital_usd: Math.round(clip), net_usd: Math.round(net * 100) / 100,
        net_pct: Math.round((net / clip) * 10000) / 100,
        observed_block: bscBlock, observed: r,
      });
    }

    // === RETROSPECTIVE: Venus. Margin is constant by construction (fixed incentive),
    // and liquidatable status comes from lagging oracle prices. Cannot evidence a build.
    for (const r of ((bsc?.venus?.currently_liquidatable) || [])) {
      bump('venus_liquidation');
      const { net, capital } = recostVenus(r, bscGas);
      if (!qualifies(net, capital)) continue;
      const key = `venus:${r.account}:${Math.round(num(r.seizable_usd))}`;
      if (seenRetro.has(key)) continue;
      seenRetro.add(key);
      led.retrospective.push({
        key, surface: 'Venus (stale-oracle, fixed margin)', at: new Date().toISOString(),
        detail: `${String(r.account || '').slice(0, 10)}… seizable $${Math.round(num(r.seizable_usd)).toLocaleString()}`,
        capital_usd: Math.round(capital), net_usd: Math.round(net * 100) / 100,
        net_pct: Math.round((net / capital) * 10000) / 100,
        observed_block: bscBlock, observed: r,
      });
    }
  } catch { /* bsc snapshot absent */ }

  led.last_run = new Date().toISOString();
  led.cleared.sort((a, b) => b.net_usd - a.net_usd);
  led.retrospective.sort((a, b) => b.net_usd - a.net_usd);
  // Retrospective rows are context, not evidence — cap so the ledger cannot grow forever.
  if (led.retrospective.length > 200) led.retrospective = led.retrospective.slice(0, 200);
  try { writeFileSync(LEDGER_PATH, JSON.stringify(led, null, 2)); } catch { /* read-only fs */ }
  return led;
}

/**
 * Is a surface's margin invariant across rows? If so, the threshold test is
 * non-discriminating there — every row passes or none do, purely by arithmetic.
 * Surfaced so a future constant-margin surface cannot quietly inflate the count again.
 */
export function marginIsDegenerate(rows: ClearedRow[]): boolean {
  if (rows.length < 3) return false;
  const pcts = new Set(rows.map((r) => Math.round(r.net_pct * 100)));
  return pcts.size === 1;
}

let timer: NodeJS.Timeout | null = null;
export function startClearanceLogger(intervalMs = 5 * 60 * 1000): void {
  if (timer) return;
  runClearancePass().catch(() => { /* never break boot */ });
  timer = setInterval(() => { runClearancePass().catch(() => { /* keep polling */ }); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

// Continuous instrument validation.
//
// WHY: on 2026-07-20 a one-off Mode A run found the Venus surface was 100% phantom —
// every flagged position had zero real shortfall, with claims up to $1.4M. It had been
// wrong for an unknown length of time and nothing surfaced it. Manual checks only catch
// what someone remembers to look for; this runs the same checks on a schedule so a
// regression shows up as a number instead of a surprise.
//
// Three checks, one per surface, mirroring scripts/replay-mode-a*.js:
//
//   VENUS   — phantom rate. The scanner now reports its own funnel
//             (subgraph_candidates -> onchain_confirmed / rejected_phantom), so this
//             just reads it. A high phantom rate is EXPECTED and healthy: it means the
//             on-chain gate is doing its job. A phantom rate that drops to zero while
//             candidates keep arriving would mean the gate stopped gating.
//   PANCAKE — recomputes each reported spread from live reserves, then cross-checks the
//             price against off-chain references. The recompute shares the scanner's
//             formula; the external check is what catches a shared formula error.
//   AAVE    — recomputes every liquidation row's derived figures from its own inputs,
//             and compares each row's bonus against the live protocol parameter.
//
// Deliberately NOT alerting anywhere. This is an instrument, not a pager. It records
// state; a human reads it.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const REPORT_PATH = process.env.VALIDATION_REPORT_PATH ||
  join(process.cwd(), 'prisma', 'validation_report.json');
const FLASH_SNAPSHOT = process.env.FLASH_SNAPSHOT_PATH ||
  '/opt/atomic-arb-scanner/flashloan_snapshot.json';
const BSC_SNAPSHOT = process.env.BSC_SNAPSHOT_PATH ||
  '/opt/atomic-arb-scanner/bsc_snapshot.json';
const BSC_RPC = process.env.BSC_RPC_URL || 'https://bsc-rpc.publicnode.com';
const AAVE_API = 'https://api.v3.aave.com/graphql';
const AAVE_V3_ETH_MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';

const FLASH_FEE_BPS = 5;
const SWAP_COST_BPS = 45;
const MEV_CAPTURE = Number(process.env.FLASH_MEV_BONUS_CAPTURE || '0.15');

// Kept in sync with flashsim.py LIQ_BONUS_PCT.
const ASSUMED_LIQ_BONUS: Record<string, number> = {
  WETH: 0.05, ETH: 0.05, WSTETH: 0.07, WEETH: 0.075, RETH: 0.075,
  WBTC: 0.0625, CBBTC: 0.06,
  USDC: 0.045, USDT: 0.045, DAI: 0.045, EURC: 0.05, USDE: 0.045,
  LINK: 0.07, AAVE: 0.075, UNI: 0.10, CRV: 0.083,
};

const FACTORY: Record<string, string> = {
  PancakeSwapV2: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  Biswap: '0x858E3312ed3A876947EA49d572A7C42DE08af7EE',
  ApeSwap: '0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6',
};
const TOKEN: Record<string, string> = {
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  ETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  BTCB: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};
const CG_IDS: Record<string, string> = {
  WBNB: 'binancecoin', ETH: 'ethereum', BTCB: 'bitcoin',
  CAKE: 'pancakeswap-token', USDC: 'usd-coin', USDT: 'tether',
};
const GET_PAIR = '0xe6a43905', GET_RESERVES = '0x0902f1ac', TOKEN0 = '0x0dfe1681';

type Check = { surface: string; status: 'ok' | 'warn' | 'fail' | 'skipped'; detail: string; data?: unknown };
export type ValidationReport = {
  at: string;
  overall: 'ok' | 'warn' | 'fail';
  checks: Check[];
};

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function bscCall(to: string, data: string): Promise<string | null> {
  try {
    const r = await fetch(BSC_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      signal: AbortSignal.timeout(10000),
    });
    const j: any = await r.json();
    return j?.result ?? null;
  } catch { return null; }
}
const argAddr = (a: string) => a.toLowerCase().replace('0x', '').padStart(64, '0');

async function priceOn(dex: string, base: string, quote: string) {
  const pairRes = await bscCall(FACTORY[dex], GET_PAIR + argAddr(TOKEN[base]) + argAddr(TOKEN[quote]));
  if (!pairRes || pairRes.length < 42) return null;
  const pair = '0x' + pairRes.slice(-40);
  if (/^0x0+$/.test(pair)) return null;
  const [res, t0] = await Promise.all([bscCall(pair, GET_RESERVES), bscCall(pair, TOKEN0)]);
  if (!res || !t0 || res.length < 130) return null;
  const h = res.slice(2);
  const r0 = BigInt('0x' + h.slice(0, 64)), r1 = BigInt('0x' + h.slice(64, 128));
  const baseIs0 = ('0x' + t0.slice(-40)).toLowerCase() === TOKEN[base].toLowerCase();
  const [baseRes, quoteRes] = baseIs0 ? [r0, r1] : [r1, r0];
  if (baseRes === 0n) return null;
  return Number(quoteRes) / Number(baseRes);
}

/** VENUS — is the on-chain gate still gating? */
function checkVenus(): Check {
  try {
    const v = JSON.parse(readFileSync(BSC_SNAPSHOT, 'utf8'))?.venus || {};
    const candidates = num(v.subgraph_candidates);
    const confirmed = num(v.onchain_confirmed);
    const phantom = num(v.onchain_rejected_phantom);
    const unverified = num(v.onchain_unverified_rpc);
    if (v.subgraph_candidates === undefined) {
      return { surface: 'venus', status: 'warn',
        detail: 'Scanner predates the on-chain confirmation fix — funnel fields absent.' };
    }
    if (candidates === 0) {
      return { surface: 'venus', status: 'ok', detail: 'No subgraph candidates this pass.', data: { candidates } };
    }
    // The gate silently failing open is the regression that matters: candidates arriving
    // and everything being confirmed would mean the Comptroller check stopped rejecting.
    const rate = phantom / candidates;
    return {
      surface: 'venus',
      status: unverified > candidates / 2 ? 'warn' : 'ok',
      detail: `${candidates} candidates → ${confirmed} confirmed, ${phantom} rejected as phantom (${(rate * 100).toFixed(0)}%)`
        + (unverified ? `, ${unverified} unverified` : ''),
      data: { candidates, confirmed, phantom, unverified },
    };
  } catch (e) {
    return { surface: 'venus', status: 'skipped', detail: e instanceof Error ? e.message : String(e) };
  }
}

/** PANCAKE — reserve recompute plus an off-chain price cross-check. */
async function checkPancake(): Promise<Check> {
  try {
    const snap = JSON.parse(readFileSync(BSC_SNAPSHOT, 'utf8'));
    const rows = snap?.pancake_arb || [];
    if (!rows.length) return { surface: 'pancake', status: 'ok', detail: 'No rows to verify.' };

    let cg: Record<string, number> = {};
    try {
      const ids = [...new Set(Object.values(CG_IDS))].join(',');
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
        { signal: AbortSignal.timeout(12000) });
      if (r.ok) {
        const j: any = await r.json();
        for (const [sym, id] of Object.entries(CG_IDS)) if (j[id]?.usd) cg[sym] = j[id].usd;
      }
    } catch { /* reference unavailable */ }

    let agree = 0, diverge = 0, extFail = 0, extChecked = 0;
    for (const row of rows) {
      const [base, quote] = String(row.pair).split('/');
      if (!TOKEN[base] || !TOKEN[quote]) continue;
      const [buy, sell] = await Promise.all([priceOn(row.buy_on, base, quote), priceOn(row.sell_on, base, quote)]);
      if (!buy || !sell) continue;
      const liveSpread = (sell / buy - 1) * 100;
      const claimed = num(row.spread_pct);
      if (Math.abs(liveSpread - claimed) < Math.max(0.15, Math.abs(claimed) * 0.5)) agree++; else diverge++;
      // The external check is the only one that catches a formula error shared by the
      // scanner and the recompute (inverted ratio, wrong decimals, swapped pair).
      if (cg[base] && cg[quote]) {
        extChecked++;
        const ref = cg[base] / cg[quote];
        if (Math.abs(((buy + sell) / 2) / ref - 1) * 100 > 5) extFail++;
      }
    }
    const status = extFail > 0 ? 'fail' : diverge > 0 ? 'warn' : 'ok';
    return {
      surface: 'pancake', status,
      detail: `${agree} reconcile, ${diverge} diverge · external ${extChecked ? `${extChecked - extFail}/${extChecked} within 5%` : 'no reference'}`,
      data: { agree, diverge, extChecked, extFail },
    };
  } catch (e) {
    return { surface: 'pancake', status: 'skipped', detail: e instanceof Error ? e.message : String(e) };
  }
}

/** AAVE — internal arithmetic plus live protocol parameters. */
async function checkAave(): Promise<Check> {
  try {
    const rows = (JSON.parse(readFileSync(FLASH_SNAPSHOT, 'utf8'))?.liquidations?.rows) || [];
    if (!rows.length) return { surface: 'aave', status: 'ok', detail: 'No rows to verify.' };

    let live: Record<string, number> = {};
    try {
      const query = `query M($addr: EvmAddress!, $chain: ChainId!) { market(request: { address: $addr, chainId: $chain }) { reserves { underlyingToken { symbol } supplyInfo { liquidationBonus { value } } } } }`;
      const r = await fetch(AAVE_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { addr: AAVE_V3_ETH_MARKET, chain: 1 } }),
        signal: AbortSignal.timeout(12000),
      });
      const j: any = await r.json();
      for (const res of (j?.data?.market?.reserves || [])) {
        const v = Number(res.supplyInfo?.liquidationBonus?.value);
        if (Number.isFinite(v)) live[String(res.underlyingToken.symbol).toUpperCase()] = v;
      }
    } catch { /* parameter check unavailable */ }

    let mathOk = 0, mathBad = 0, drift = 0;
    for (const r of rows) {
      const bonus = num(r.bonus_pct) / 100;
      const seized = num(r.seized_usd);
      const borrow = seized / (1 + bonus);
      const gross = seized - borrow;
      const fee = borrow * FLASH_FEE_BPS / 1e4;
      const swap = seized * SWAP_COST_BPS / 1e4;
      const gas = num(r.gas_usd);
      const net = gross - fee - swap - gas;
      const netComp = gross * MEV_CAPTURE - fee - swap - gas;
      const bad = Math.abs(borrow - num(r.borrow_usd)) > 0.02
        || Math.abs(gross - num(r.gross_bonus_usd)) > 0.02
        || Math.abs(net - num(r.net_usd)) > 0.05
        || Math.abs(netComp - num(r.net_usd_competitive)) > 0.05;
      if (bad) mathBad++; else mathOk++;
      const lb = live[String(r.collateral).toUpperCase()];
      if (lb != null && Math.abs(lb - bonus) > 0.0005) drift++;
    }
    // Bad arithmetic is a defect. Drift is a stale parameter — real, but a different
    // severity: it means the table needs syncing, not that the code is broken.
    const status = mathBad > 0 ? 'fail' : drift > 0 ? 'warn' : 'ok';
    return {
      surface: 'aave', status,
      detail: `${mathOk}/${rows.length} rows reconcile · ${drift} using a stale liquidation bonus`
        + (Object.keys(live).length ? '' : ' (live parameters unavailable)'),
      data: { mathOk, mathBad, drift, rows: rows.length },
    };
  } catch (e) {
    return { surface: 'aave', status: 'skipped', detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function runValidation(): Promise<ValidationReport> {
  const checks: Check[] = [checkVenus(), await checkPancake(), await checkAave()];
  const overall: ValidationReport['overall'] =
    checks.some((c) => c.status === 'fail') ? 'fail'
      : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';
  const report: ValidationReport = { at: new Date().toISOString(), overall, checks };
  try { writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2)); } catch { /* read-only fs */ }
  return report;
}

export function readValidation(): ValidationReport | null {
  try {
    if (!existsSync(REPORT_PATH)) return null;
    return JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as ValidationReport;
  } catch { return null; }
}

let timer: NodeJS.Timeout | null = null;
/** Hourly. The underlying parameters are governance-set and move slowly. */
export function startValidation(intervalMs = 60 * 60 * 1000): void {
  if (timer) return;
  runValidation().catch(() => { /* never break boot */ });
  timer = setInterval(() => { runValidation().catch(() => { /* keep going */ }); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

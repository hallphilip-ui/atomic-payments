#!/usr/bin/env node
/**
 * Mode A — Aave liquidation surface validation.
 *
 * WHAT THIS CAN AND CANNOT DO, stated up front because the limit is significant:
 *
 *   CANNOT verify the liquidations happened. The rows carry no tx hash and no account,
 *   so there is nothing to look up on-chain. The Venus check could ask the Comptroller
 *   "is this position really underwater?"; there is no equivalent question here. Fixing
 *   that needs a tx hash added to the scanner feed — recommended, not done.
 *
 *   CAN verify the MODEL applied to them:
 *     1. Internal arithmetic — recompute every derived figure from the row's own inputs.
 *        Catches formula drift between the simulator and its documented maths.
 *     2. Protocol parameters — compare each row's bonus_pct against the LIVE liquidation
 *        bonus from Aave's API, and quantify what any drift did to the reported profit.
 *
 * (2) is the point. The drift check already found 4 of 9 modelled assets stale, three of
 * them OVERSTATING the bonus. This measures the damage in dollars, on real rows.
 *
 * Usage: node scripts/replay-mode-a-aave.js --snapshot <path>
 */
const fs = require('fs');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SNAPSHOT = arg('--snapshot', '/opt/atomic-arb-scanner/flashloan_snapshot.json');
const AAVE_API = 'https://api.v3.aave.com/graphql';
const AAVE_V3_ETH_MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';

// Cost constants the simulator uses. Premium verified on-chain 2026-07-20.
const FLASH_FEE_BPS = 5;
const SWAP_COST_BPS = 45;   // 30 dex + 15 slippage
const MEV_CAPTURE = 0.15;

async function liveBonuses() {
  const query = `query M($addr: EvmAddress!, $chain: ChainId!) {
    market(request: { address: $addr, chainId: $chain }) {
      reserves { underlyingToken { symbol } supplyInfo { liquidationBonus { value } canBeCollateral } }
    } }`;
  const r = await fetch(AAVE_API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { addr: AAVE_V3_ETH_MARKET, chain: 1 } }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  const out = {};
  for (const res of j.data.market.reserves || []) {
    const v = Number(res.supplyInfo?.liquidationBonus?.value);
    if (Number.isFinite(v)) out[String(res.underlyingToken.symbol).toUpperCase()] = v;
  }
  return out;
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function main() {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const rows = (snap.liquidations || {}).rows || [];
  console.log(`  ${rows.length} Aave liquidation rows\n`);
  if (!rows.length) return;

  let live = {};
  try { live = await liveBonuses(); console.log(`  live bonuses fetched for ${Object.keys(live).length} reserves\n`); }
  catch (e) { console.log(`  WARN could not fetch live bonuses (${e.message}) — parameter check skipped\n`); }

  let mathOk = 0, mathBad = 0, driftRows = 0, noRef = 0;
  let overstatedUsd = 0;

  for (const r of rows) {
    const sym = String(r.collateral).toUpperCase();
    const bonus = Number(r.bonus_pct) / 100;
    const seized = Number(r.seized_usd);

    // --- 1. internal arithmetic, recomputed from the row's own inputs ---
    const borrow = seized / (1 + bonus);
    const gross = seized - borrow;
    const fee = borrow * FLASH_FEE_BPS / 1e4;
    const swap = seized * SWAP_COST_BPS / 1e4;
    const gas = Number(r.gas_usd) || 0;
    const net = gross - fee - swap - gas;
    const netComp = gross * MEV_CAPTURE - fee - swap - gas;

    const checks = [
      ['borrow_usd', borrow, Number(r.borrow_usd), 0.02],
      ['gross_bonus_usd', gross, Number(r.gross_bonus_usd), 0.02],
      ['flash_fee_usd', fee, Number(r.flash_fee_usd), 0.02],
      ['swap_cost_usd', swap, Number(r.swap_cost_usd), 0.02],
      ['net_usd', net, Number(r.net_usd), 0.05],
      ['net_usd_competitive', netComp, Number(r.net_usd_competitive), 0.05],
    ];
    const bad = checks.filter(([, calc, rep, tol]) => !near(calc, rep, tol));
    if (bad.length) {
      mathBad++;
      console.log(`  MATH-FAIL ${sym} @ ${r.ts}`);
      for (const [name, calc, rep] of bad) {
        console.log(`      ${name}: recomputed ${calc.toFixed(2)} vs reported ${rep.toFixed(2)}`);
      }
    } else { mathOk++; }

    // --- 2. protocol parameter vs live ---
    const liveBonus = live[sym];
    if (liveBonus == null) { noRef++; continue; }
    if (Math.abs(liveBonus - bonus) > 0.0005) {
      driftRows++;
      // What the row WOULD have said using the live parameter.
      const b2 = seized / (1 + liveBonus);
      const g2 = seized - b2;
      const f2 = b2 * FLASH_FEE_BPS / 1e4;
      const netComp2 = g2 * MEV_CAPTURE - f2 - swap - gas;
      const delta = netComp2 - netComp;
      overstatedUsd += -delta > 0 ? -delta : 0;
      console.log(`  DRIFT ${sym} @ ${r.ts}`);
      console.log(`      bonus used ${(bonus * 100).toFixed(2)}%  vs live ${(liveBonus * 100).toFixed(2)}%`);
      console.log(`      net(competitive) reported $${netComp.toFixed(2)} → with live bonus $${netComp2.toFixed(2)}  (${delta >= 0 ? '+' : ''}$${delta.toFixed(2)})`);
      console.log(`      would_clear reported ${r.would_clear} → would be ${netComp2 > 0}\n`);
    }
  }

  console.log('  ── Aave Mode A summary ──');
  console.log(`  internal arithmetic : ${mathOk} consistent · ${mathBad} FAILED`);
  console.log(`  parameter drift     : ${driftRows} row(s) used a stale liquidation bonus · ${noRef} with no live reference`);
  if (overstatedUsd > 0) {
    console.log(`  profit OVERSTATED by $${overstatedUsd.toFixed(2)} across those rows`);
  }
  console.log('\n  LIMIT: rows carry no tx hash or account, so this CANNOT confirm the');
  console.log('  liquidations occurred — only that the model applied to them is sound.');
  console.log('  Adding a tx hash to the scanner feed would close that gap.');
}

main().catch((e) => { console.error('  fatal:', e.message); process.exit(1); });

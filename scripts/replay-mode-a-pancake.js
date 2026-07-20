#!/usr/bin/env node
/**
 * Mode A — PancakeSwap surface validation.
 *
 * The Venus check asked "did this position really exist?". The Pancake equivalent asks
 * "was this spread really there?" — by reading each DEX pair's reserves DIRECTLY from
 * chain and recomputing price and spread independently, then comparing against what the
 * scanner reported in its snapshot.
 *
 * WHY THIS MATTERS: PancakeSwap arb is the ONLY surface whose "cleared" count is treated
 * as build evidence. Venus turned out to be 100% phantom. If this surface is also
 * mis-measuring, the entire Phase 0 experiment is measuring noise and the 0.95% bar is
 * meaningless.
 *
 * HONEST LIMIT: this recomputes from the same primitives the scanner uses (getPair /
 * getReserves / token0). It will therefore catch stale data, wrong pairs, dead pools and
 * arithmetic drift — but NOT a shared conceptual error in the price formula itself. An
 * external price cross-check is included for exactly that reason.
 *
 * Usage: node scripts/replay-mode-a-pancake.js --snapshot <path> --rpc <bsc-url>
 */
const fs = require('fs');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SNAPSHOT = arg('--snapshot', '/opt/atomic-arb-scanner/bsc_snapshot.json');
const RPC = arg('--rpc', process.env.BSC_ARCHIVE_RPC || 'https://bsc-rpc.publicnode.com');

// Independently declared — deliberately NOT imported from the scanner, so a wrong
// address there cannot silently agree with itself here.
const FACTORY = {
  PancakeSwapV2: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  Biswap: '0x858E3312ed3A876947EA49d572A7C42DE08af7EE',
  ApeSwap: '0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6',
};
const TOKEN = {
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  ETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  BTCB: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};
const GET_PAIR = '0xe6a43905', GET_RESERVES = '0x0902f1ac', TOKEN0 = '0x0dfe1681';
const ZERO40 = '0'.repeat(40);

async function call(to, data, block) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to, data }, block || 'latest'] }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const argAddr = (a) => a.toLowerCase().replace('0x', '').padStart(64, '0');

async function priceOn(dex, base, quote, block) {
  const pairRes = await call(FACTORY[dex], GET_PAIR + argAddr(TOKEN[base]) + argAddr(TOKEN[quote]), block);
  const pair = '0x' + pairRes.slice(-40);
  if (pair.slice(2) === ZERO40) return null;
  const [res, t0] = await Promise.all([
    call(pair, GET_RESERVES, block), call(pair, TOKEN0, block),
  ]);
  const h = res.slice(2);
  if (h.length < 128) return null;
  const r0 = BigInt('0x' + h.slice(0, 64)), r1 = BigInt('0x' + h.slice(64, 128));
  const baseIs0 = ('0x' + t0.slice(-40)).toLowerCase() === TOKEN[base].toLowerCase();
  const [baseRes, quoteRes] = baseIs0 ? [r0, r1] : [r1, r0];
  if (baseRes === 0n) return null;
  // All listed BSC tokens are 18dp, so the raw ratio is already quote-per-base.
  const price = Number(quoteRes) / Number(baseRes);
  return { price, quoteLiq: Number(quoteRes) / 1e18, pair };
}

// ---------------------------------------------------------------------------
// EXTERNAL PRICE CROSS-CHECK
//
// Recomputing from getReserves catches stale data and wrong pairs, but it shares the
// scanner's price FORMULA — so a conceptual error there (inverted ratio, wrong decimals,
// base/quote swapped) would make both agree and both be wrong. An off-chain reference
// is the only thing that catches that class of bug.
//
// Two sources are used because one can be unavailable: Binance is geo-restricted from
// some locations, CoinGecko is keyless everywhere. Neither is perfectly "independent" —
// CoinGecko aggregates exchanges, some of which are DEXes — but both are independent of
// OUR arithmetic, which is the thing under test.
//
// Expect small divergence as NORMAL: DEX-vs-CEX basis, and BTCB/ETH on BSC are pegged
// wrappers that trade a touch off spot. A formula error does not look like 0.3% — it
// looks like an inverted price or an order of magnitude.
const CG_IDS = {
  WBNB: 'binancecoin', ETH: 'ethereum', BTCB: 'bitcoin',
  CAKE: 'pancakeswap-token', USDC: 'usd-coin', USDT: 'tether',
};
const BINANCE_USD = { WBNB: 'BNBUSDT', ETH: 'ETHUSDT', BTCB: 'BTCUSDT', CAKE: 'CAKEUSDT', USDC: 'USDCUSDT' };

async function externalUsd() {
  const out = { cg: {}, binance: {}, sources: [] };
  try {
    const ids = [...new Set(Object.values(CG_IDS))].join(',');
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const j = await r.json();
      for (const [sym, id] of Object.entries(CG_IDS)) {
        if (j[id] && Number.isFinite(j[id].usd)) out.cg[sym] = j[id].usd;
      }
      if (Object.keys(out.cg).length) out.sources.push('coingecko');
    }
  } catch { /* source unavailable */ }
  try {
    const syms = JSON.stringify(Object.values(BINANCE_USD));
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(syms)}`,
      { signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j)) {
        const bySym = Object.fromEntries(j.map((x) => [x.symbol, Number(x.price)]));
        for (const [sym, bsym] of Object.entries(BINANCE_USD)) {
          if (Number.isFinite(bySym[bsym])) out.binance[sym] = bySym[bsym];
        }
        out.binance.USDT = 1; // the quote asset of every Binance pair above
        if (Object.keys(out.binance).length > 1) out.sources.push('binance');
      }
    }
  } catch { /* geo-restricted or down */ }
  return out;
}

/** Reference price of base expressed in quote, from one external source. */
function refPrice(px, base, quote) {
  const b = px[base], q = px[quote];
  return Number.isFinite(b) && Number.isFinite(q) && q > 0 ? b / q : null;
}

async function main() {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const rows = snap.pancake_arb || [];
  const ageSec = Math.round((Date.now() - Date.parse(snap.updated)) / 1000);
  const bnbPrice = Number((snap.assumptions || {}).bnb_price_usd) || null;
  const ext = await externalUsd();
  console.log(`  snapshot age: ${ageSec}s · ${rows.length} pancake rows · BNB $${bnbPrice}`);
  console.log(`  external sources: ${ext.sources.length ? ext.sources.join(', ') : 'NONE REACHABLE — formula unverified'}\n`);
  if (!rows.length) { console.log('  nothing to verify'); return; }

  let agree = 0, diverge = 0, unresolved = 0;
  let extOk = 0, extWarn = 0, extFail = 0, extSkip = 0;
  for (const row of rows) {
    const [base, quote] = String(row.pair).split('/');
    if (!TOKEN[base] || !TOKEN[quote]) { console.log(`  SKIP ${row.pair} — unknown token`); unresolved++; continue; }
    let buy, sell;
    try {
      [buy, sell] = await Promise.all([
        priceOn(row.buy_on, base, quote), priceOn(row.sell_on, base, quote),
      ]);
    } catch (e) { console.log(`  RPC  ${row.pair} — ${e.message}`); unresolved++; continue; }
    if (!buy || !sell) { console.log(`  SKIP ${row.pair} — pair not resolvable on chain`); unresolved++; continue; }

    const liveSpread = (sell.price / buy.price - 1) * 100;
    const claimed = Number(row.spread_pct);
    const delta = liveSpread - claimed;
    // The snapshot is up to a poll-interval old, so exact equality is not expected.
    // A spread that has MOVED is normal; one that never existed is not.
    const ok = Math.abs(delta) < Math.max(0.15, Math.abs(claimed) * 0.5);
    // A spread can agree in absolute terms while having moved enormously in relative
    // terms. Both matter: absolute decides whether it clears the bar, relative tells you
    // how fast the opportunity decays — which is the capturability question.
    const relMove = Math.abs(claimed) > 1e-9 ? Math.abs(delta / claimed) : Infinity;
    const flipped = Math.sign(liveSpread) !== Math.sign(claimed);
    if (ok) agree++; else diverge++;
    console.log(`  ${ok ? 'AGREE  ' : 'DIVERGE'} ${row.pair.padEnd(11)} ${row.buy_on}→${row.sell_on}`);
    console.log(`      scanner spread : ${claimed.toFixed(4)}%`);
    console.log(`      on-chain now   : ${liveSpread.toFixed(4)}%   (delta ${delta >= 0 ? '+' : ''}${delta.toFixed(4)}pp${Number.isFinite(relMove) ? `, ${(relMove * 100).toFixed(0)}% relative` : ''}${flipped ? ', DIRECTION FLIPPED' : ''})`);
    console.log(`      buy px  ${buy.price.toPrecision(8)} vs scanner ${Number(row.buy_px).toPrecision(8)}`);
    console.log(`      sell px ${sell.price.toPrecision(8)} vs scanner ${Number(row.sell_px).toPrecision(8)}`);
    // The quote-side reserve is denominated in the QUOTE TOKEN, not dollars. Printing a
    // WBNB-quoted reserve with a $ sign understates depth ~570x and makes a perfectly
    // healthy pool look dead — CAKE/WBNB showed "$46" when it holds ~$26k. Convert first.
    const toUsd = (v) => (quote === 'WBNB' && bnbPrice ? v * bnbPrice : v);
    const raw = quote === 'WBNB' ? `  (${buy.quoteLiq.toFixed(1)} / ${sell.quoteLiq.toFixed(1)} WBNB)` : '';
    console.log(`      quote liq: buy $${Math.round(toUsd(buy.quoteLiq)).toLocaleString()} · sell $${Math.round(toUsd(sell.quoteLiq)).toLocaleString()}${raw}`);

    // --- external cross-check: does our PRICE FORMULA produce a sane number at all? ---
    const mid = (buy.price + sell.price) / 2;
    const refs = [];
    for (const [name, px] of [['coingecko', ext.cg], ['binance', ext.binance]]) {
      const rp = refPrice(px, base, quote);
      if (rp) refs.push([name, rp]);
    }
    if (!refs.length) {
      extSkip++;
      console.log(`      external  : no reference for ${base}/${quote} — formula UNVERIFIED\n`);
    } else {
      const parts = refs.map(([name, rp]) => {
        const dev = (mid / rp - 1) * 100;
        return `${name} ${rp.toPrecision(8)} (${dev >= 0 ? '+' : ''}${dev.toFixed(3)}%)`;
      });
      const worst = Math.max(...refs.map(([, rp]) => Math.abs((mid / rp - 1) * 100)));
      // >5% is not basis — it is an inverted ratio, wrong decimals, or a swapped pair.
      const tag = worst > 5 ? 'FAIL' : worst > 1 ? 'WARN' : 'OK';
      if (tag === 'FAIL') extFail++; else if (tag === 'WARN') extWarn++; else extOk++;
      console.log(`      external  : ${tag}  on-chain mid ${mid.toPrecision(8)} vs ${parts.join(' · ')}\n`);
    }
  }

  console.log('  ── Pancake Mode A summary ──');
  console.log(`  reserve recompute → agree ${agree} · diverge ${diverge} · unresolved ${unresolved}`);
  console.log(`  external price    → ok ${extOk} · warn ${extWarn} · FAIL ${extFail} · no-ref ${extSkip}`);
  if (extFail > 0) {
    console.log('\n  EXTERNAL FAIL: an on-chain price is >5% from independent references.');
    console.log('  That is not DEX/CEX basis — it points at an inverted ratio, wrong decimals,');
    console.log('  or a swapped base/quote in the price formula SHARED by scanner and checker.');
  } else if (extOk + extWarn > 0) {
    console.log('\n  Price formula corroborated against off-chain references — the one class of');
    console.log('  error a reserve-recompute cannot catch, since it shares the same arithmetic.');
  }
  if (diverge === 0 && agree > 0) {
    console.log('\n  The scanner\'s pancake prices reconcile with chain state. This surface is');
    console.log('  measuring something real — unlike Venus, which was 100% phantom.');
  } else if (diverge > 0) {
    console.log('\n  DIVERGENCE. Spreads the scanner reported do not reconcile with chain state.');
    console.log('  Since pancake is the ONLY surface counted as build evidence, Phase 0 is');
    console.log('  measuring noise until this is explained.');
  }
}

main().catch((e) => { console.error('  fatal:', e.message); process.exit(1); });

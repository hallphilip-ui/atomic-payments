#!/usr/bin/env node
/**
 * MEV capture probe — measures the 15% assumption against ground truth.
 *
 * THE NUMBER UNDER TEST: our flash-loan model assumes a liquidator keeps only ~15% of a
 * liquidation's gross bonus, having bid the other ~85% away as priority fee to win the
 * block. That number was a guess. Every conclusion about liquidation profitability rests
 * on it, and it has never been measured.
 *
 * WHY NOT A MEMPOOL PROBE: the mempool shows what searchers BID; the 15% is about what
 * they KEEP. Those differ. This reads SETTLED liquidations and measures what the winner
 * actually surrendered — ground truth, not intent. For each real Aave V3 liquidation:
 *
 *   gross bonus (USD)   = seized collateral USD − debt repaid USD
 *   priority fee (USD)  = gasUsed × (effectiveGasPrice − baseFee) × ETH price
 *   builder tip (USD)   = direct value transfers to the block's fee recipient (traced)
 *   total bid           = priority fee + builder tip
 *   implied capture     = (gross bonus − total bid) / gross bonus
 *
 * If searchers bid ~85% away, the 15% assumption holds. If they bid ~5%, our model is far
 * too pessimistic and we have been DISCARDING opportunities that were actually profitable
 * — an error in the direction that matters, because it would mean the edge exists and we
 * mis-modelled it away.
 *
 * HONEST LIMITS (printed in the report, not buried):
 *   - `implied capture` IGNORES the swap cost to unwind seized collateral and the flash
 *     fee, so it is an UPPER BOUND on capture. Real keep is lower.
 *   - If tracing is unavailable, builder tips (Flashbots-style direct payments) are
 *     invisible and capture is overstated further. Rows say which mode produced them.
 *   - Small sample. This is a probe, not a study. It sizes the assumption; it does not
 *     replace it.
 *
 * Usage: node scripts/mev-capture-probe.js --rpc <archive-url> --graph-key <k> [--limit 40]
 */
const https = require('https');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const RPC = arg('--rpc', process.env.ETH_ARCHIVE_RPC || '');
const GRAPH_KEY = arg('--graph-key', process.env.GRAPH_API_KEY || '');
const SUBGRAPH = arg('--subgraph', 'Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g');
const LIMIT = Number(arg('--limit', '40'));
const ALCHEMY_KEY = arg('--alchemy-key', process.env.ATOMIC_ALCHEMY_KEY || '');

const STABLE = new Set(['USDC', 'USDT', 'DAI', 'GHO', 'USDS', 'PYUSD', 'FRAX', 'LUSD', 'USDE', 'USDC.E']);
const CG = {
  WBTC: 'wrapped-bitcoin', TBTC: 'tbtc', CBBTC: 'coinbase-wrapped-btc', WETH: 'weth', ETH: 'ethereum',
  WSTETH: 'wrapped-steth', RETH: 'rocket-pool-eth', WEETH: 'wrapped-eeth', LINK: 'chainlink',
  AAVE: 'aave', UNI: 'uniswap', CRV: 'curve-dao-token', SNX: 'havven', MKR: 'maker', LDO: 'lido-dao',
};

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return r.json();
}
async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  return r.json();
}
const rpc = (m, p) => post(RPC, { jsonrpc: '2.0', id: 1, method: m, params: p });
const hexN = (h) => (h == null ? null : Number(BigInt(h)));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function main() {
  if (!RPC || !GRAPH_KEY) { console.error('  --rpc and --graph-key required'); process.exit(1); }

  const q = `{ liquidationCalls(first:${LIMIT}, orderBy:timestamp, orderDirection:desc){ txHash timestamp collateralAmount collateralReserve{ symbol decimals } principalAmount principalReserve{ symbol decimals } } }`;
  const gr = await post(`https://gateway.thegraph.com/api/${GRAPH_KEY}/subgraphs/id/${SUBGRAPH}`, { query: q });
  const calls = gr?.data?.liquidationCalls || [];
  console.log(`  ${calls.length} recent Aave V3 (Ethereum) liquidations\n`);
  if (!calls.length) return;

  // Prices from Alchemy (on our key) rather than CoinGecko — CoinGecko's free tier
  // rate-limits, and by-symbol resolution covers the exotic collateral (weETH, etc.)
  // that a hand-maintained map would miss.
  const syms = [...new Set(calls.flatMap((c) => [c.collateralReserve.symbol, c.principalReserve.symbol]).map((x) => x.toUpperCase()).concat('ETH'))];
  const prices = {};
  const priceUrl = (arr) => `https://api.g.alchemy.com/prices/v1/${ALCHEMY_KEY}/tokens/by-symbol?` + arr.map((x) => `symbols=${encodeURIComponent(x)}`).join('&');
  const absorb = (r) => { for (const t of (r?.data || [])) { const v = Number((t.prices || [{}])[0].value); if (Number.isFinite(v)) prices[t.symbol.toUpperCase()] = v; } };
  for (let i = 0; i < syms.length; i += 5) {
    const chunk = syms.slice(i, i + 5);
    try { absorb(await get(priceUrl(chunk))); }
    catch {
      // One bad symbol 401s the batch. Retry each alone so the rest still price.
      for (const one of chunk) { try { absorb(await get(priceUrl([one]))); } catch { /* unpriceable */ } }
    }
  }
  const ethPrice = prices['ETH'];
  if (!ethPrice) { console.error('  price feed empty — cannot value bonuses. Aborting.'); process.exit(2); }
  console.log(`  priced ${Object.keys(prices).length}/${syms.length} symbols · ETH $${ethPrice}`);
  // Alchemy resolves stables too; fall back to $1 only for known stables it somehow missed.
  const usdOf = (sym, amt) => { const s = sym.toUpperCase(); if (prices[s]) return amt * prices[s]; if (STABLE.has(s)) return amt; return null; };

  // Is call tracing available on this endpoint? Probe once; degrade gracefully if not.
  let canTrace = false;
  try {
    const t = await rpc('debug_traceTransaction', [calls[0].txHash, { tracer: 'callTracer' }]);
    canTrace = !t.error && !!t.result;
  } catch { canTrace = false; }
  console.log(`  builder-tip tracing: ${canTrace ? 'ON' : 'OFF — priority-fee only, capture overstated'}\n`);

  const rows = [];
  const skip = { noPrice: 0, dust: 0, noReceipt: 0, unpriced: new Set() };
  for (const c of calls) {
    const cSym = c.collateralReserve.symbol, pSym = c.principalReserve.symbol;
    const cUsd = usdOf(cSym, Number(c.collateralAmount) / 10 ** Number(c.collateralReserve.decimals));
    const pUsd = usdOf(pSym, Number(c.principalAmount) / 10 ** Number(c.principalReserve.decimals));
    if (cUsd == null || pUsd == null) { skip.noPrice++; if (cUsd == null) skip.unpriced.add(cSym); if (pUsd == null) skip.unpriced.add(pSym); continue; }
    const grossBonus = cUsd - pUsd;
    if (!(grossBonus > 5)) { skip.dust++; continue; } // dust / near-zero → don't distort

    let receipt, block;
    try {
      receipt = (await rpc('eth_getTransactionReceipt', [c.txHash])).result;
      if (!receipt) { skip.noReceipt++; continue; }
      block = (await rpc('eth_getBlockByNumber', [receipt.blockNumber, false])).result;
    } catch { skip.noReceipt++; continue; }
    const gasUsed = hexN(receipt.gasUsed);
    const effGas = hexN(receipt.effectiveGasPrice);
    const baseFee = block?.baseFeePerGas ? hexN(block.baseFeePerGas) : 0;
    const miner = (block?.miner || '').toLowerCase();
    const priorityWei = gasUsed * Math.max(0, effGas - baseFee);
    const priorityUsd = priorityWei * ethPrice / 1e18;

    let tipUsd = 0, traced = false;
    if (canTrace && miner) {
      try {
        const tr = (await rpc('debug_traceTransaction', [c.txHash, { tracer: 'callTracer' }])).result;
        let tipWei = 0;
        const walk = (n) => { if (!n) return; if ((n.to || '').toLowerCase() === miner && n.value && n.value !== '0x0') tipWei += Number(BigInt(n.value)); (n.calls || []).forEach(walk); };
        walk(tr); tipUsd = tipWei * ethPrice / 1e18; traced = true;
      } catch { /* leave tip 0, mark untraced */ }
    }
    const totalBid = priorityUsd + tipUsd;
    const capture = (grossBonus - totalBid) / grossBonus; // UPPER bound (ignores swap + flash fee)
    rows.push({ tx: c.txHash, pair: `${c.collateralReserve.symbol}→${c.principalReserve.symbol}`,
      grossBonus, priorityUsd, tipUsd, totalBid, capture, traced });
  }

  if (!rows.length) {
    console.log(`  no measurable liquidations. skipped: ${skip.noPrice} unpriceable, ${skip.dust} dust, ${skip.noReceipt} no-receipt.`);
    if (skip.unpriced.size) console.log(`  symbols with no price mapping: ${[...skip.unpriced].join(', ')}`);
    return;
  }
  console.log(`  measured ${rows.length}; skipped ${skip.noPrice} unpriceable (${[...skip.unpriced].join(', ') || 'none'}), ${skip.dust} dust, ${skip.noReceipt} no-receipt\n`);
  rows.sort((a, b) => b.grossBonus - a.grossBonus);
  console.log('  bonus$    priority$  builderTip$  bid%    impliedCapture%   pair');
  for (const r of rows) {
    console.log(`  ${String(Math.round(r.grossBonus)).padStart(7)}  ${r.priorityUsd.toFixed(2).padStart(9)}  ${(r.traced ? r.tipUsd.toFixed(2) : 'n/a').padStart(10)}  ${(r.totalBid / r.grossBonus * 100).toFixed(1).padStart(5)}  ${(r.capture * 100).toFixed(1).padStart(14)}    ${r.pair}`);
  }

  const caps = rows.map((r) => r.capture);
  const med = median(caps);
  const tracedN = rows.filter((r) => r.traced).length;
  console.log('\n  ── MEV capture summary ──');
  console.log(`  liquidations measured : ${rows.length} (${tracedN} with builder-tip tracing)`);
  console.log(`  median implied capture: ${(med * 100).toFixed(1)}%   (model assumes 15%)`);
  console.log(`  median bid fraction   : ${((1 - med) * 100).toFixed(1)}% of the bonus surrendered`);
  console.log(`  rows above 15% capture: ${caps.filter((c) => c > 0.15).length}/${rows.length}`);
  const nearZeroPrio = rows.filter((r) => r.totalBid / r.grossBonus < 0.02).length;
  console.log('\n  ── interpretation ──');
  if (tracedN === 0 && nearZeroPrio > rows.length / 2) {
    console.log(`  ${nearZeroPrio}/${rows.length} winners paid ~0 visible priority fee. On Ethereum that is the`);
    console.log('  signature of PRIVATE orderflow (Flashbots-style): the bid is a direct payment to');
    console.log('  the block builder, invisible in the receipt without transaction TRACING — which');
    console.log('  this endpoint does not provide (builder-tip tracing: OFF).');
    console.log('  ');
    console.log('  So this run does NOT measure the 15% assumption. It establishes something else,');
    console.log('  and useful: these liquidations are won in the private mempool, where the real');
    console.log('  bid cannot be seen from public receipts. Measuring capture REQUIRES a');
    console.log('  trace-capable RPC (debug_traceTransaction / trace_transaction). That is the');
    console.log('  concrete blocker — and the one infrastructure gap where a paid endpoint earns');
    console.log('  its keep. The near-100% here is an artefact of invisible bids, not real capture.');
  } else {
    console.log('  implied capture is an UPPER bound (ignores swap + flash fee, and any untraced');
    console.log('  builder payment). Real capture is lower. Below 15% => model too optimistic;');
    console.log('  far above with tracing ON => too pessimistic.');
  }
}
main().catch((e) => { console.error('  fatal:', e.message); process.exit(1); });

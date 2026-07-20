#!/usr/bin/env node
/**
 * Mode A — model validation. No contract required.
 *
 * Replays each ledger row at its observed block and asks the ON-CHAIN protocol whether
 * the opportunity our scanner reported was actually there. This tests OUR SIMULATOR,
 * not any contract, and it can invalidate the project before a dollar of audit spend.
 *
 * Currently implements the Venus check, which is the sharpest one available: the scanner
 * derives "liquidatable" from subgraph oracle prices that lag live prices, and its own
 * note says a flagged position "may already be healthy". Venus's Comptroller settles it —
 * getAccountLiquidity() returns (error, liquidity, shortfall) from the live oracle.
 * shortfall == 0 means the position was NOT liquidatable and the row was a phantom.
 *
 * Usage: node scripts/replay-mode-a.js --fixture <path> --rpc <bsc-archive-url>
 */
const fs = require('fs');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const FIXTURE = arg('--fixture', 'test/fork/fixtures/ledger.json');
const RPC = arg('--rpc', process.env.BSC_ARCHIVE_RPC || '');

const VENUS_COMPTROLLER = '0xfD36E2c2a6789Db23113685031d7F16329158384';
const SEL_ACCOUNT_LIQUIDITY = '0x5ec88c79'; // getAccountLiquidity(address)

async function rpcCall(method, params) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${j.error.code}: ${j.error.message}`);
  return j.result;
}

/** Decode three uint256 words: (error, liquidity, shortfall). */
function decode3(hex) {
  const h = hex.replace(/^0x/, '');
  if (h.length < 192) throw new Error(`short return: ${hex}`);
  const w = (i) => BigInt('0x' + h.slice(i * 64, (i + 1) * 64));
  return { error: w(0), liquidity: w(1), shortfall: w(2) };
}
const toUsd = (v) => Number(v) / 1e18;

async function main() {
  if (!RPC) { console.error('  --rpc (archive) required'); process.exit(1); }
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

  // Prove the endpoint really serves archive state before trusting any result. Without
  // this, a node silently answering "latest" for a historical block would make every
  // row look consistent and the whole run would be meaningless.
  const head = parseInt(await rpcCall('eth_blockNumber', []), 16);
  console.log(`  chain head: ${head}`);

  const venus = fx.replayable.filter((r) => /venus/i.test(r.surface));
  const other = fx.replayable.filter((r) => !/venus/i.test(r.surface));
  console.log(`  fixture: ${fx.counts.replayable} replayable (${venus.length} venus, ${other.length} other), ${fx.counts.skipped} skipped\n`);

  const results = [];
  for (const row of venus) {
    const acct = (row.observed && row.observed.account) || null;
    if (!acct) { console.log(`  SKIP ${row.key} — no account in observed data`); continue; }
    if (head - row.block < 200) {
      console.log(`  NOTE ${row.key} — block ${row.block} is only ${head - row.block} behind head; not a true archive test`);
    }
    const data = SEL_ACCOUNT_LIQUIDITY + acct.replace(/^0x/, '').padStart(64, '0');
    let atBlock, atLatest;
    try {
      atBlock = decode3(await rpcCall('eth_call', [{ to: VENUS_COMPTROLLER, data }, '0x' + row.block.toString(16)]));
      atLatest = decode3(await rpcCall('eth_call', [{ to: VENUS_COMPTROLLER, data }, 'latest']));
    } catch (e) {
      console.log(`  FAIL ${row.key} — rpc: ${e.message}`);
      results.push({ key: row.key, verdict: 'rpc_error' });
      continue;
    }

    const shortfall = toUsd(atBlock.shortfall);
    const liquidity = toUsd(atBlock.liquidity);
    const claimed = (row.observed && row.observed.shortfall_usd) || 0;
    // The protocol's own answer. shortfall > 0 => liquidatable at that block.
    const liquidatable = atBlock.shortfall > 0n;
    const verdict = liquidatable ? 'CONFIRMED' : 'PHANTOM';
    results.push({ key: row.key, verdict, claimed_shortfall: claimed, onchain_shortfall: shortfall, onchain_liquidity: liquidity });

    console.log(`  ${verdict}  ${acct.slice(0, 12)}… @ block ${row.block}`);
    console.log(`      scanner claimed shortfall : $${Number(claimed).toLocaleString()}`);
    console.log(`      on-chain shortfall        : $${shortfall.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`      on-chain excess liquidity : $${liquidity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`      predicted net             : $${row.predicted_net_usd} (${row.predicted_net_pct}%)`);
    console.log(`      (same account now)        : shortfall $${toUsd(atLatest.shortfall).toLocaleString(undefined, { maximumFractionDigits: 2 })}\n`);
  }

  const phantom = results.filter((r) => r.verdict === 'PHANTOM').length;
  const confirmed = results.filter((r) => r.verdict === 'CONFIRMED').length;
  console.log('  ── Mode A summary ──');
  console.log(`  confirmed (really liquidatable on-chain): ${confirmed}`);
  console.log(`  PHANTOM  (scanner said yes, chain says no): ${phantom}`);
  if (phantom > 0) {
    console.log('\n  A phantom row means the simulator counted an opportunity that did not exist.');
    console.log('  Every conclusion drawn from that surface is suspect until the scanner reads');
    console.log('  the live on-chain oracle rather than lagging subgraph prices.');
  }
  if (other.length) console.log(`\n  ${other.length} non-Venus row(s) not yet implemented in Mode A.`);
}

main().catch((e) => { console.error('  fatal:', e.message); process.exit(1); });

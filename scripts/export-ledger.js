#!/usr/bin/env node
/**
 * Export the clearance ledger to a fork-test fixture.
 *
 * The harness (docs/flash-loan-fork-test-harness.md) replays each row at its
 * `observed_block`. Rows without a block CANNOT be replayed — they are emitted into a
 * separate `skipped` list rather than dropped, because a harness that silently discards
 * un-replayable rows reports a clean pass over a subset and calls it a full pass.
 *
 * Usage:
 *   node scripts/export-ledger.js [--in path] [--out path]
 * Defaults: prisma/clearance_log.json -> test/fork/fixtures/ledger.json
 */
const fs = require('fs');
const path = require('path');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const IN = arg('--in', path.join(process.cwd(), 'prisma', 'clearance_log.json'));
const OUT = arg('--out', path.join(process.cwd(), 'test', 'fork', 'fixtures', 'ledger.json'));

// Which chain each surface trades on — the harness needs this to pick an RPC.
const CHAIN_BY_SURFACE = [
  [/pancake/i, 'bsc'],
  [/venus/i, 'bsc'],
  [/aave/i, 'ethereum'],
];
function chainFor(surface) {
  for (const [re, chain] of CHAIN_BY_SURFACE) if (re.test(surface)) return chain;
  return null;
}

function main() {
  if (!fs.existsSync(IN)) {
    console.error(`No ledger at ${IN}. Has the counter run?`);
    process.exit(1);
  }
  const led = JSON.parse(fs.readFileSync(IN, 'utf8'));

  const rows = [
    ...(led.cleared || []).map((r) => ({ ...r, evidence: true })),
    ...(led.retrospective || []).map((r) => ({ ...r, evidence: false })),
  ];

  const replayable = [];
  const skipped = [];
  for (const r of rows) {
    const chain = chainFor(r.surface || '');
    // A row is replayable only with BOTH a block and a known chain. Anything else is
    // recorded with a reason so the harness can report exactly what it could not test.
    if (r.observed_block == null) { skipped.push({ key: r.key, reason: 'no observed_block' }); continue; }
    if (!chain) { skipped.push({ key: r.key, reason: `unknown chain for surface "${r.surface}"` }); continue; }
    replayable.push({
      key: r.key,
      surface: r.surface,
      chain,
      block: r.observed_block,
      at: r.at,
      // What the simulator PREDICTED — this is the thing under test, not an input.
      predicted_net_usd: r.net_usd,
      predicted_net_pct: r.net_pct,
      capital_usd: r.capital_usd,
      // Whether this row counts as build evidence (forward-looking) or is prize-sizing.
      evidence: r.evidence,
      observed: r.observed || null,
    });
  }

  const fixture = {
    generated_at: new Date().toISOString(),
    source: IN,
    ledger_schema: led.schema ?? null,
    window_start: led.window_start ?? null,
    threshold_pct: led.threshold_pct ?? null,
    counts: {
      total: rows.length,
      replayable: replayable.length,
      skipped: skipped.length,
      evidence_rows: replayable.filter((r) => r.evidence).length,
    },
    replayable,
    skipped,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(fixture, null, 2));

  console.log(`  wrote ${OUT}`);
  console.log(`  total ${fixture.counts.total} · replayable ${fixture.counts.replayable} · skipped ${fixture.counts.skipped}`);
  console.log(`  of which build evidence (forward-looking): ${fixture.counts.evidence_rows}`);
  if (skipped.length) {
    console.log('  skipped reasons:');
    const byReason = {};
    for (const s of skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
    for (const [k, v] of Object.entries(byReason)) console.log(`    ${v} x ${k}`);
  }
}

main();

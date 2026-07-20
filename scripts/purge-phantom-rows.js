#!/usr/bin/env node
/**
 * Purge known-false rows from the clearance ledger.
 *
 * WHY THIS EXISTS: on 2026-07-20 a Mode A replay proved that every Venus row the scanner
 * had produced was a phantom — the subgraph inferred distress from oracle prices that
 * update only on interaction, so positions with ZERO real shortfall were being reported
 * as liquidatable (claims ran to $1.4M against an actual $0). The scanner was fixed to
 * confirm each position against the Venus Comptroller on-chain, but rows recorded BEFORE
 * that fix remain in the ledger and are known to be false.
 *
 * They do not affect the headline (Venus is classified retrospective, not evidence), but
 * they would pollute reports and any replay run. Leaving proven-false data in a research
 * instrument is worse than deleting it.
 *
 * SAFETY:
 *   * Writes a timestamped backup before touching anything.
 *   * Targets rows by an EXACT legacy surface label, so it cannot match post-fix rows.
 *   * --dry-run by default; requires --apply to write.
 *   * Never touches `cleared` (the build evidence) — only `retrospective`.
 *
 * Usage:
 *   node scripts/purge-phantom-rows.js                 # dry run
 *   node scripts/purge-phantom-rows.js --apply         # write
 */
const fs = require('fs');
const path = require('path');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const LEDGER = arg('--ledger', path.join(process.cwd(), 'prisma', 'clearance_log.json'));
const APPLY = process.argv.includes('--apply');

// Exact label written by the pre-fix code path. Matching exactly (not a substring) is
// deliberate: the post-fix label is 'Venus (on-chain confirmed, fixed margin)', and a
// loose match would delete genuine confirmed rows alongside the phantoms.
const PHANTOM_SURFACES = new Set(['Venus (stale-oracle, fixed margin)']);

function main() {
  if (!fs.existsSync(LEDGER)) { console.error(`  no ledger at ${LEDGER}`); process.exit(1); }
  const led = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const before = (led.retrospective || []).length;
  const doomed = (led.retrospective || []).filter((r) => PHANTOM_SURFACES.has(r.surface));
  const keep = (led.retrospective || []).filter((r) => !PHANTOM_SURFACES.has(r.surface));

  console.log(`  ledger      : ${LEDGER}`);
  console.log(`  cleared     : ${(led.cleared || []).length} (untouched — build evidence)`);
  console.log(`  retrospective before: ${before}`);
  console.log(`  phantom rows to purge: ${doomed.length}`);
  if (doomed.length) {
    const worst = doomed.slice().sort((a, b) => (b.net_usd || 0) - (a.net_usd || 0))[0];
    console.log(`  largest purged claim : $${worst.net_usd} — ${worst.detail}`);
  }
  console.log(`  retrospective after : ${keep.length}`);

  if (!APPLY) { console.log('\n  DRY RUN — pass --apply to write.'); return; }

  // Preserve the evidence before removing it. The finding is documented, but a backup
  // costs nothing and makes the deletion reversible.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = LEDGER.replace(/\.json$/, `.backup-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify(led, null, 2));

  led.retrospective = keep;
  led.purged = led.purged || [];
  led.purged.push({
    at: new Date().toISOString(),
    removed: doomed.length,
    reason: 'Venus rows recorded before the on-chain confirmation fix; Mode A proved all had zero real shortfall',
    backup: path.basename(backup),
  });
  fs.writeFileSync(LEDGER, JSON.stringify(led, null, 2));

  console.log(`\n  backup written: ${backup}`);
  console.log(`  purged ${doomed.length} phantom row(s). Purge recorded in ledger.purged[].`);
}

main();

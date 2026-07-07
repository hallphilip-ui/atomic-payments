const assert = require('node:assert/strict');

require('ts-node/register');

const {
  screenAddressLocal,
  screenCountry,
  screenAddress,
  blockedCountries,
  localListSize
} = require('../src/compliance/sanctions');
const { OFAC_SANCTIONED_ADDRESS_SEED } = require('../src/compliance/ofacSanctionedAddresses');
const { screenSwapCompliance } = require('../src/compliance/complianceProvider');
const { listSwapAssets } = require('../src/cryptoCore/tokens');

const SANCTIONED = OFAC_SANCTIONED_ADDRESS_SEED[0];
const CLEAN = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

function asset(id) {
  const found = listSwapAssets().find((a) => a.assetId === id);
  assert.ok(found, `asset ${id} exists in registry`);
  return found;
}

async function main() {
  // --- local OFAC list ---
  assert.ok(localListSize() > 0, 'OFAC local list is non-empty');
  const localHit = screenAddressLocal(SANCTIONED);
  assert.ok(localHit && localHit.listed, 'seed OFAC address is flagged locally');
  assert.equal(localHit.source, 'ofac_sdn_local', 'local hit source is ofac_sdn_local');
  // case-insensitive
  assert.ok(screenAddressLocal(SANCTIONED.toUpperCase()), 'OFAC match is case-insensitive');
  assert.equal(screenAddressLocal(CLEAN), null, 'clean address is not locally flagged');

  // --- screenAddress (local first; Chainalysis best-effort when unconfigured -> null) ---
  assert.ok(await screenAddress(SANCTIONED), 'screenAddress flags a sanctioned address');
  assert.equal(await screenAddress(CLEAN), null, 'screenAddress clears a clean address (no Chainalysis key)');

  // --- jurisdiction screen ---
  assert.equal(screenCountry('IR'), true, 'Iran is blocked');
  assert.equal(screenCountry('kp'), true, 'North Korea is blocked (case-insensitive)');
  assert.equal(screenCountry('US'), false, 'US is not blocked by default');
  assert.equal(screenCountry(undefined), false, 'missing country is not blocked');

  // --- ATOMIC_BLOCKED_COUNTRIES override ---
  const prev = process.env.ATOMIC_BLOCKED_COUNTRIES;
  process.env.ATOMIC_BLOCKED_COUNTRIES = 'RU, BY';
  assert.deepEqual([...blockedCountries()].sort(), ['BY', 'RU'], 'override sets the blocked-country set');
  assert.equal(screenCountry('RU'), true, 'override blocks RU');
  assert.equal(screenCountry('IR'), false, 'override replaces the default list');
  if (prev === undefined) delete process.env.ATOMIC_BLOCKED_COUNTRIES; else process.env.ATOMIC_BLOCKED_COUNTRIES = prev;

  // --- end-to-end screenSwapCompliance ---
  const base = { fromAsset: asset('BASE.USDC'), toAsset: asset('ETH.USDC'), amount: '1000000', priceImpactPct: 0.1 };

  const blockedByAddress = await screenSwapCompliance({ ...base, userAddress: SANCTIONED });
  assert.equal(blockedByAddress.status, 'BLOCKED', 'sanctioned address -> BLOCKED');
  assert.equal(blockedByAddress.vendorDecision, 'deny', 'sanctioned address -> deny');
  assert.ok(blockedByAddress.flags.some((f) => f.startsWith('sanctioned_address')), 'sanctioned address flag present');

  const blockedBySource = await screenSwapCompliance({ ...base, userAddress: CLEAN, sourceAddress: SANCTIONED });
  assert.equal(blockedBySource.status, 'BLOCKED', 'sanctioned SOURCE address -> BLOCKED');

  const blockedByCountry = await screenSwapCompliance({ ...base, userAddress: CLEAN, countryCode: 'IR' });
  assert.equal(blockedByCountry.status, 'BLOCKED', 'sanctioned jurisdiction -> BLOCKED');
  assert.ok(blockedByCountry.flags.some((f) => f.startsWith('sanctioned_jurisdiction')), 'jurisdiction flag present');

  const cleared = await screenSwapCompliance({ ...base, userAddress: CLEAN, countryCode: 'US' });
  assert.notEqual(cleared.status, 'BLOCKED', 'clean address + allowed country is not sanctions-blocked');
  assert.ok(cleared.checks.includes('ofac_sanctioned_address_screen'), 'OFAC screen recorded in checks');
  assert.ok(cleared.checks.includes('jurisdiction_screen'), 'jurisdiction screen recorded in checks');

  console.log('OK sanctions contract: local OFAC list, jurisdiction block, override, and end-to-end screening all enforced.');
  console.log(`   OFAC local list size: ${localListSize()} · default blocked countries: ${[...blockedCountries()].join(', ')}`);
}

main().catch((error) => {
  console.error('Sanctions contract failed:', error.message);
  process.exit(1);
});

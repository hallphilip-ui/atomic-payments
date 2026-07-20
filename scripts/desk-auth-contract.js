require('ts-node/register');

const assert = require('node:assert/strict');
const {
  parseDeskAdminEmails,
  isDeskAdminEmail,
  deskAdminListConfigured
} = require('../src/security/deskAdminRules');

// Regression contract for the arb-desk viewer/admin split.
//
// The bug this locks down: the desk treated ANY verified Cloudflare Access email as an
// admin, because the Access allow-list was assumed to be the admin list. Once a second
// person was granted desk access, they could rewrite live scanner thresholds and
// repoint the alert topic. Visibility and authority must stay separate.

// --- parsing -----------------------------------------------------------------
assert.deepEqual([...parseDeskAdminEmails(undefined)], [], 'undefined -> empty');
assert.deepEqual([...parseDeskAdminEmails('')], [], 'empty string -> empty');
assert.deepEqual([...parseDeskAdminEmails('a@x.com')], ['a@x.com'], 'single entry');
assert.deepEqual(
  [...parseDeskAdminEmails(' A@x.com , b@Y.com ,, ')],
  ['a@x.com', 'b@y.com'],
  'trims, lowercases, drops empty entries'
);

// --- FAIL CLOSED: the property that actually matters -------------------------
// An unset or blank list must grant admin to NOBODY. If this ever flips to
// "unset means allow", the original hole is back.
assert.equal(isDeskAdminEmail('anyone@example.com', undefined), false, 'unset grants nobody admin');
assert.equal(isDeskAdminEmail('anyone@example.com', ''), false, 'blank grants nobody admin');
assert.equal(isDeskAdminEmail('anyone@example.com', '   '), false, 'whitespace-only grants nobody admin');
assert.equal(isDeskAdminEmail('anyone@example.com', ',,,'), false, 'separators-only grants nobody admin');
assert.equal(deskAdminListConfigured(''), false, 'blank list reports unconfigured');
assert.equal(deskAdminListConfigured('a@x.com'), true, 'populated list reports configured');

// --- membership --------------------------------------------------------------
const LIST = 'owner@example.com, second@example.com';
assert.equal(isDeskAdminEmail('owner@example.com', LIST), true, 'listed email is admin');
assert.equal(isDeskAdminEmail('second@example.com', LIST), true, 'second listed email is admin');
assert.equal(isDeskAdminEmail('OWNER@EXAMPLE.COM', LIST), true, 'match is case-insensitive');
assert.equal(isDeskAdminEmail('  owner@example.com  ', LIST), true, 'input is trimmed');

// An authenticated NON-listed viewer must not be an admin. This is the Fabrizio case:
// on the Access allow-list (so they can see the desk) but not an admin.
assert.equal(isDeskAdminEmail('viewer@cradle.capital', LIST), false, 'unlisted viewer is not admin');

// --- no accidental matching --------------------------------------------------
assert.equal(isDeskAdminEmail('', LIST), false, 'empty email is not admin');
assert.equal(isDeskAdminEmail(null, LIST), false, 'null email is not admin');
assert.equal(isDeskAdminEmail(undefined, LIST), false, 'undefined email is not admin');
assert.equal(isDeskAdminEmail('owner@example.com.evil.com', LIST), false, 'suffix-extended domain is not admin');
assert.equal(isDeskAdminEmail('notowner@example.com', LIST), false, 'prefix-extended local part is not admin');
assert.equal(isDeskAdminEmail('owner@example', LIST), false, 'truncated domain is not admin');

console.log('OK desk auth contract: Access identity does not confer admin; unset list fails closed');
console.log('Desk auth contract complete.');

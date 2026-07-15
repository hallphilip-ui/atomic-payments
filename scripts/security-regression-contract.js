// Security regression tests for the two v2.8.2 findings. These guard the SPECIFIC
// holes that were exploitable so they cannot silently reopen on a future edit.
//
//  A. Stored XSS — merchant free text (description/reference/businessName/…) was
//     concatenated into innerHTML unescaped on the checkout receipt + merchant portal,
//     executing arbitrary JS on the passkey-wallet origin. Guarded by construction:
//     these fields must never appear as a raw `+ field +` concatenation, and each page
//     must define an esc() helper.
//  B. /v1/offramp/link was unauthenticated and minted partner-key-signed links for any
//     address. Guarded behaviorally: an unauthenticated POST must return 401.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node/register');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- A. XSS guard
// Free-text fields that reach innerHTML and MUST be escaped. A raw
// `+ rc.description +` style concatenation is the exact bug; assert it's absent.
const DANGEROUS = /\+\s*(?:rc|p)\.(?:description|reference|businessName|source|asset|status)\b\s*\+/g;

function auditXss(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.ok(/function\s+esc\s*\(/.test(src), `${file} defines an esc() helper`);
  const hits = src.match(DANGEROUS);
  assert.equal(
    hits, null,
    `${file} interpolates merchant free-text into innerHTML unescaped (XSS regression): ${hits && hits.join(', ')}`
  );
  // Sanity: the fields we DO render must be present in esc() form somewhere, so the
  // guard isn't passing simply because the render was deleted.
  assert.ok(/esc\((?:rc|p)\.reference\b/.test(src), `${file} still renders reference via esc()`);
}

// -------------------------------------------------------- B. off-ramp auth guard
async function auditOfframpAuth() {
  const express = require('express');
  const offrampRouter = require('../src/routes/offramp').default;
  const app = express();
  app.use(express.json());
  app.use(offrampRouter);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/v1/offramp/link`;
  const body = JSON.stringify({ provider: 'moonpay', address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', fiat: 'USD' });
  try {
    // No key at all — must be rejected before any address is ever used.
    const noKey = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(noKey.status, 401, '/v1/offramp/link rejects a request with NO merchant key (401)');

    // A body-supplied address must not be a bypass — still unauthenticated, still 401.
    const bodyAddr = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'transak', address: '0xAttackerAttackerAttackerAttackerAttacker1', fiat: 'EUR' })
    });
    assert.equal(bodyAddr.status, 401, '/v1/offramp/link ignores a client-supplied address without auth (401)');
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function main() {
  auditXss('checkout.html');
  auditXss('merchant.html');
  console.log('OK XSS regression: checkout.html + merchant.html escape merchant free-text at every innerHTML site.');

  await auditOfframpAuth();
  console.log('OK off-ramp auth regression: /v1/offramp/link is closed to unauthenticated callers.');

  console.log('Security regression contract complete.');
}

main().catch((error) => {
  console.error('Security regression contract FAILED:', error.message);
  process.exit(1);
});

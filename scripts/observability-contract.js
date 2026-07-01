require('ts-node/register');

const assert = require('node:assert/strict');
const { sanitizeRequestPath } = require('../src/observability/redaction');

function main() {
  const sanitized = sanitizeRequestPath('/v1/admin/compliance/reviews?status=MANUAL_REVIEW&token=abc123&webhook_secret=whsec_prod_secret');

  assert.equal(
    sanitized,
    '/v1/admin/compliance/reviews?status=MANUAL_REVIEW&token=%5BREDACTED%5D&webhook_secret=%5BREDACTED%5D'
  );
  assert.equal(sanitizeRequestPath('/v1/health'), '/v1/health');
  assert.equal(sanitizeRequestPath('/v1/swaps/quote?client-secret=s3cr3t&amount=100'), '/v1/swaps/quote?client-secret=%5BREDACTED%5D&amount=100');

  console.log('OK observability contract: sensitive query values redacted');
}

main();

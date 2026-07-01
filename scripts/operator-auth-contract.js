require('ts-node/register');

const assert = require('node:assert/strict');
const {
  requiresOperatorAuth,
  validateOperatorApiKey,
  isOperatorAuthEnabled
} = require('../src/security/operatorRules');

function withOperatorKey(value, callback) {
  const previous = process.env.ATOMIC_OPERATOR_API_KEY;
  process.env.ATOMIC_OPERATOR_API_KEY = value;

  try {
    callback();
  } finally {
    if (previous === undefined) {
      delete process.env.ATOMIC_OPERATOR_API_KEY;
    } else {
      process.env.ATOMIC_OPERATOR_API_KEY = previous;
    }
  }
}

function main() {
  assert.equal(requiresOperatorAuth('/v1/admin/compliance/reviews'), true);
  assert.equal(requiresOperatorAuth('/v1/metrics?token=abc'), true);
  assert.equal(requiresOperatorAuth('/v1/project/progress'), true);
  assert.equal(requiresOperatorAuth('/v1/settlement/treasury/ledger'), true);
  assert.equal(requiresOperatorAuth('/v1/settlement/currencies'), false);
  assert.equal(requiresOperatorAuth('/v1/swaps/assets'), false);

  withOperatorKey('', () => {
    assert.equal(isOperatorAuthEnabled(), false);
    assert.equal(validateOperatorApiKey(undefined), true);
  });

  withOperatorKey('operator_secret_1234567890', () => {
    assert.equal(isOperatorAuthEnabled(), true);
    assert.equal(validateOperatorApiKey('operator_secret_1234567890'), true);
    assert.equal(validateOperatorApiKey('wrong'), false);
    assert.equal(validateOperatorApiKey(undefined), false);
  });

  console.log('OK operator auth contract: privileged route guard and API key validation');
}

main();

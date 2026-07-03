require('ts-node/register');

const assert = require('node:assert/strict');
const {
  requiresOperatorAuth,
  requiresOperatorWriteAccess,
  validateOperatorCredential,
  validateOperatorApiKey,
  isOperatorAuthEnabled
} = require('../src/security/operatorRules');

function withOperatorKeys(adminValue, readOnlyValue, callback) {
  const previous = process.env.ATOMIC_OPERATOR_API_KEY;
  const previousReadOnly = process.env.ATOMIC_OPERATOR_READONLY_API_KEY;
  process.env.ATOMIC_OPERATOR_API_KEY = adminValue;
  process.env.ATOMIC_OPERATOR_READONLY_API_KEY = readOnlyValue;

  try {
    callback();
  } finally {
    if (previous === undefined) {
      delete process.env.ATOMIC_OPERATOR_API_KEY;
    } else {
      process.env.ATOMIC_OPERATOR_API_KEY = previous;
    }

    if (previousReadOnly === undefined) {
      delete process.env.ATOMIC_OPERATOR_READONLY_API_KEY;
    } else {
      process.env.ATOMIC_OPERATOR_READONLY_API_KEY = previousReadOnly;
    }
  }
}

function main() {
  assert.equal(requiresOperatorAuth('/v1/admin/compliance/reviews'), true);
  assert.equal(requiresOperatorAuth('/v1/metrics?token=abc'), true);
  assert.equal(requiresOperatorAuth('/v1/project/progress'), true);
  assert.equal(requiresOperatorAuth('/v1/project/launch-readiness'), true);
  assert.equal(requiresOperatorAuth('/v1/settlement/treasury/ledger'), true);
  assert.equal(requiresOperatorAuth('/v1/settlement/reconciliation/export'), true);
  assert.equal(requiresOperatorAuth('/v1/settlement/currencies'), false);
  assert.equal(requiresOperatorAuth('/v1/swaps/assets'), false);
  assert.equal(requiresOperatorWriteAccess('/v1/admin/compliance/reviews/abc/decision', 'POST'), true);
  assert.equal(requiresOperatorWriteAccess('/v1/admin/compliance/reviews', 'GET'), false);
  assert.equal(requiresOperatorWriteAccess('/v1/settlement/platform-connectors/coinbase-advanced/withdrawals', 'POST'), true);
  assert.equal(requiresOperatorWriteAccess('/v1/settlement/platform-connectors/coinbase-advanced/withdrawals/preview', 'POST'), false);

  withOperatorKeys('', '', () => {
    assert.equal(isOperatorAuthEnabled(), false);
    assert.equal(validateOperatorApiKey(undefined), true);
    assert.equal(validateOperatorCredential(undefined), 'admin');
  });

  withOperatorKeys('operator_secret_1234567890', '', () => {
    assert.equal(isOperatorAuthEnabled(), true);
    assert.equal(validateOperatorApiKey('operator_secret_1234567890'), true);
    assert.equal(validateOperatorCredential('operator_secret_1234567890'), 'admin');
    assert.equal(validateOperatorApiKey('wrong'), false);
    assert.equal(validateOperatorApiKey(undefined), false);
  });

  withOperatorKeys('operator_secret_1234567890', 'readonly_secret_1234567890', () => {
    assert.equal(isOperatorAuthEnabled(), true);
    assert.equal(validateOperatorCredential('operator_secret_1234567890'), 'admin');
    assert.equal(validateOperatorCredential('readonly_secret_1234567890'), 'readonly');
    assert.equal(validateOperatorCredential('wrong'), null);
  });

  console.log('OK operator auth contract: privileged route guard, API key validation, and read-only role rules');
}

main();

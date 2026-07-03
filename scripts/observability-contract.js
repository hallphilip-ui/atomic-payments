require('ts-node/register');

const assert = require('node:assert/strict');
const { sanitizeRequestPath } = require('../src/observability/redaction');
const { getProductionObservabilityReadiness } = require('../src/observability/productionObservability');

function main() {
  const sanitized = sanitizeRequestPath('/v1/admin/compliance/reviews?status=MANUAL_REVIEW&token=abc123&webhook_secret=whsec_prod_secret');

  assert.equal(
    sanitized,
    '/v1/admin/compliance/reviews?status=MANUAL_REVIEW&token=%5BREDACTED%5D&webhook_secret=%5BREDACTED%5D'
  );
  assert.equal(sanitizeRequestPath('/v1/health'), '/v1/health');
  assert.equal(sanitizeRequestPath('/v1/swaps/quote?client-secret=s3cr3t&amount=100'), '/v1/swaps/quote?client-secret=%5BREDACTED%5D&amount=100');

  const blocked = getProductionObservabilityReadiness();
  assert.equal(blocked.service, 'atomic-payments');
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.missingCount, 4);
  assert.ok(blocked.requiredSignals.includes('wallet_broadcast_failure_count'));
  assert.ok(blocked.alertTriggers.includes('settlement_reconciliation_break'));

  process.env.ATOMIC_LOG_DRAIN_URL = 'https://observability.atomic.test/logs';
  process.env.ATOMIC_METRICS_DASHBOARD_URL = 'https://observability.atomic.test/dashboard';
  process.env.ATOMIC_ALERT_POLICY_URL = 'https://observability.atomic.test/alerts';
  process.env.ATOMIC_INCIDENT_RUNBOOK_URL = 'https://observability.atomic.test/runbook';
  const ready = getProductionObservabilityReadiness();
  assert.equal(ready.status, 'ready');
  assert.equal(ready.configuredCount, 4);

  console.log('OK observability contract: redaction and production readiness metadata');
}

main();

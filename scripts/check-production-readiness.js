const fs = require('fs');
const path = require('path');

const checks = [];

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env');

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (name && process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function addCheck(name, status, detail, remediation) {
  checks.push({ name, status, detail, remediation });
}

function isPlaceholderSecret(value) {
  return !value || value === 'whsec_prod_secret' || value.length < 24;
}

function readPrismaDatasourceProvider() {
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');

  if (!fs.existsSync(schemaPath)) {
    return '';
  }

  const schema = fs.readFileSync(schemaPath, 'utf8');
  const datasourceMatch = schema.match(/datasource\s+db\s+\{([\s\S]*?)\}/);

  if (!datasourceMatch) {
    return '';
  }

  const providerMatch = datasourceMatch[1].match(/provider\s*=\s*"([^"]+)"/);
  return providerMatch ? providerMatch[1] : '';
}

loadLocalEnv();

const deployEnv = env('ATOMIC_DEPLOY_ENV', env('NODE_ENV') === 'production' ? 'production' : 'local');
const strict = deployEnv === 'production';
const databaseUrl = env('DATABASE_URL');
const swapProviderMode = env('ATOMIC_SWAP_PROVIDER_MODE', 'simulation');
const complianceProviderMode = env('ATOMIC_COMPLIANCE_PROVIDER_MODE', 'simulation');
const webhookSecret = env('ATOMIC_WEBHOOK_SECRET');
const operatorApiKey = env('ATOMIC_OPERATOR_API_KEY');
const prismaDatasourceProvider = readPrismaDatasourceProvider();

addCheck(
  'DATABASE_URL',
  databaseUrl ? (strict && databaseUrl.startsWith('file:') ? 'fail' : 'pass') : 'fail',
  databaseUrl
    ? databaseUrl.startsWith('file:')
      ? 'SQLite is configured.'
      : 'External database URL is configured.'
    : 'DATABASE_URL is missing.',
  strict
    ? 'Use managed production persistence before launch.'
    : 'Set DATABASE_URL in .env or the deployment environment.'
);

addCheck(
  'PRISMA_DATASOURCE_PROVIDER',
  strict && prismaDatasourceProvider === 'sqlite' ? 'fail' : prismaDatasourceProvider ? 'pass' : 'fail',
  prismaDatasourceProvider
    ? `Prisma datasource provider is ${prismaDatasourceProvider}.`
    : 'Prisma datasource provider could not be read.',
  strict
    ? 'Move the Prisma datasource to the selected managed database provider before production launch.'
    : 'Keep SQLite for local development or migrate the schema before production.'
);

addCheck(
  'ATOMIC_WEBHOOK_SECRET',
  isPlaceholderSecret(webhookSecret) ? (strict ? 'fail' : 'warn') : 'pass',
  isPlaceholderSecret(webhookSecret)
    ? 'Webhook secret is missing or looks like a placeholder.'
    : 'Webhook secret is configured.',
  'Set a high-entropy ATOMIC_WEBHOOK_SECRET in the deployment secret store.'
);

addCheck(
  'ATOMIC_OPERATOR_API_KEY',
  isPlaceholderSecret(operatorApiKey) ? (strict ? 'fail' : 'warn') : 'pass',
  isPlaceholderSecret(operatorApiKey)
    ? 'Operator API key is missing or looks like a placeholder.'
    : 'Operator API key is configured.',
  'Set a high-entropy ATOMIC_OPERATOR_API_KEY before exposing admin, metrics, internal progress, or treasury routes.'
);

addCheck(
  'ATOMIC_SWAP_PROVIDER_MODE',
  swapProviderMode === 'simulation' ? (strict ? 'fail' : 'warn') : 'pass',
  `Swap provider mode is ${swapProviderMode}.`,
  'Use live_with_fallback for pre-production provider verification and live only after contract tests pass.'
);

addCheck(
  'ATOMIC_COMPLIANCE_PROVIDER_MODE',
  complianceProviderMode === 'simulation' ? (strict ? 'fail' : 'warn') : 'pass',
  `Compliance provider mode is ${complianceProviderMode}.`,
  'Connect KYT/sanctions provider credentials before production launch.'
);

addCheck(
  'PORT',
  Number.isInteger(Number(env('PORT', '3005'))) ? 'pass' : 'fail',
  `PORT is ${env('PORT', '3005')}.`,
  'Set PORT to a valid integer.'
);

const failures = checks.filter((check) => check.status === 'fail');
const warnings = checks.filter((check) => check.status === 'warn');

console.log(JSON.stringify({
  service: 'atomic-payments',
  deployEnv,
  strict,
  summary: {
    pass: checks.filter((check) => check.status === 'pass').length,
    warn: warnings.length,
    fail: failures.length
  },
  checks
}, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}

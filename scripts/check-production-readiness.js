const fs = require('fs');
const http = require('http');
const https = require('https');
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
  const schemaPath = path.join(
    __dirname,
    '..',
    env('ATOMIC_PRISMA_SCHEMA_PATH', 'prisma/schema.prisma')
  );

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

function readPackageScripts() {
  const packagePath = path.join(__dirname, '..', 'package.json');

  if (!fs.existsSync(packagePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf8')).scripts || {};
  } catch (_err) {
    return {};
  }
}

function parsePublicUrl(value) {
  if (!value) return null;

  try {
    return new URL(value);
  } catch (_err) {
    return null;
  }
}

function requestPublicUrl(url, timeoutMs = 8000) {
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const request = client.request(
      url,
      {
        method: 'HEAD',
        timeout: timeoutMs,
        headers: {
          'user-agent': 'atomic-payments-deploy-check/1.0'
        }
      },
      (response) => {
        response.resume();
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 400,
          statusCode: response.statusCode,
          server: response.headers.server || '',
          cfRay: response.headers['cf-ray'] || ''
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms`));
    });

    request.on('error', (error) => {
      resolve({
        ok: false,
        error: error.message
      });
    });

    request.end();
  });
}

async function main() {
loadLocalEnv();

const deployEnv = env('ATOMIC_DEPLOY_ENV', env('NODE_ENV') === 'production' ? 'production' : 'local');
const strict = deployEnv === 'production';
const databaseUrl = env('DATABASE_URL');
const swapProviderMode = env('ATOMIC_SWAP_PROVIDER_MODE', 'simulation');
const complianceProviderMode = env('ATOMIC_COMPLIANCE_PROVIDER_MODE', 'simulation');
const webhookSecret = env('ATOMIC_WEBHOOK_SECRET');
const operatorApiKey = env('ATOMIC_OPERATOR_API_KEY');
const prismaDatasourceProvider = readPrismaDatasourceProvider();
const publicBaseUrl = env('ATOMIC_PUBLIC_BASE_URL');
const parsedPublicUrl = parsePublicUrl(publicBaseUrl);
const skipPublicUrlCheck = env('ATOMIC_SKIP_PUBLIC_URL_CHECK') === '1';
const packageScripts = readPackageScripts();

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

const requiredContractScripts = [
  'test:observability',
  'test:operator-auth',
  'test:providers',
  'test:platform-connectors',
  'test:transfer-compliance'
];
const missingContractScripts = requiredContractScripts.filter((scriptName) => !packageScripts[scriptName]);

addCheck(
  'LOCAL_CONTRACT_TESTS',
  missingContractScripts.length === 0 ? 'pass' : strict ? 'fail' : 'warn',
  missingContractScripts.length === 0
    ? `Contract test scripts are present: ${requiredContractScripts.join(', ')}.`
    : `Missing contract test scripts: ${missingContractScripts.join(', ')}.`,
  'Keep contract tests wired before production promotion.'
);

addCheck(
  'ATOMIC_PUBLIC_BASE_URL',
  parsedPublicUrl && parsedPublicUrl.protocol === 'https:' ? 'pass' : strict ? 'fail' : 'warn',
  publicBaseUrl
    ? parsedPublicUrl
      ? `Public base URL is ${publicBaseUrl}.`
      : `Public base URL is invalid: ${publicBaseUrl}.`
    : 'Public base URL is not configured.',
  'Set ATOMIC_PUBLIC_BASE_URL to the HTTPS customer-facing origin, such as https://atomicpay.cloud.'
);

if (parsedPublicUrl && parsedPublicUrl.protocol === 'https:') {
  if (skipPublicUrlCheck) {
    addCheck(
      'PUBLIC_HTTPS_REACHABILITY',
      strict ? 'warn' : 'pass',
      'Skipped public HTTPS reachability probe because ATOMIC_SKIP_PUBLIC_URL_CHECK=1.',
      'Remove ATOMIC_SKIP_PUBLIC_URL_CHECK before final production promotion.'
    );
  } else {
    const publicProbe = await requestPublicUrl(parsedPublicUrl);
    const cloudflareDetail = publicProbe.cfRay ? ` Cloudflare ray ${publicProbe.cfRay}.` : '';
    const serverDetail = publicProbe.server ? ` Server header: ${publicProbe.server}.` : '';

    addCheck(
      'PUBLIC_HTTPS_REACHABILITY',
      publicProbe.ok ? 'pass' : strict ? 'fail' : 'warn',
      publicProbe.statusCode
        ? `Public HTTPS returned ${publicProbe.statusCode}.${serverDetail}${cloudflareDetail}`
        : `Public HTTPS probe failed: ${publicProbe.error || 'unknown error'}.`,
      'Confirm the origin has a valid HTTPS listener/certificate and Cloudflare SSL mode matches the origin.'
    );
  }
}

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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

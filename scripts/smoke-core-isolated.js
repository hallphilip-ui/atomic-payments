const { spawn } = require('node:child_process');
const { closeSync, existsSync, openSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');

const repoRoot = join(__dirname, '..');
const port = process.env.ATOMIC_SMOKE_PORT || '3105';
const databaseFile = process.env.ATOMIC_SMOKE_DB_FILE || `smoke-${process.pid}.db`;
const databaseUrl = process.env.ATOMIC_SMOKE_DATABASE_URL || `file:./${databaseFile}`;
const baseUrl = process.env.ATOMIC_BASE_URL || `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PORT: port,
  DATABASE_URL: databaseUrl,
  ATOMIC_BASE_URL: baseUrl
};

let server;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: options.stdio || 'inherit',
      shell: process.platform === 'win32'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function waitForApi() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/v1/swaps/config`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`API did not become ready at ${baseUrl}`);
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server || server.killed) {
      resolve();
      return;
    }

    server.once('exit', () => resolve());
    server.kill('SIGTERM');
    setTimeout(() => {
      if (!server.killed) server.kill('SIGKILL');
      resolve();
    }, 3000);
  });
}

function cleanupDatabaseFile() {
  if (process.env.ATOMIC_SMOKE_KEEP_DB === '1') return;
  const filename = databaseFilename();
  if (filename.startsWith('./')) {
    const dbPath = join(repoRoot, 'prisma', filename.slice(2));
    for (const suffix of ['', '-journal']) {
      const target = `${dbPath}${suffix}`;
      if (existsSync(target)) unlinkSync(target);
    }
  }
}

function databaseFilename() {
  return databaseUrl.replace(/^file:/, '').replace(/^"|"$/g, '');
}

function ensureDatabaseFile() {
  const filename = databaseFilename();
  if (!filename.startsWith('./')) return;

  const dbPath = join(repoRoot, 'prisma', filename.slice(2));
  if (!existsSync(dbPath)) {
    closeSync(openSync(dbPath, 'w'));
  }
}

async function main() {
  console.log(`Isolated smoke database: ${databaseUrl}`);
  console.log(`Isolated smoke API: ${baseUrl}`);

  ensureDatabaseFile();
  await run('npx', ['prisma', 'db', 'push', '--skip-generate']);

  server = spawn('npm', ['start'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  server.stdout.on('data', (chunk) => process.stdout.write(chunk));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));

  await waitForApi();
  await run('node', ['scripts/smoke-core.js']);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
    cleanupDatabaseFile();
  });

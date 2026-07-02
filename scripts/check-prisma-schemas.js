const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const schemas = [
  {
    label: 'sqlite',
    schema: path.join('prisma', 'schema.prisma'),
    databaseUrl: 'file:./schema-check.db'
  },
  {
    label: 'postgresql',
    schema: path.join('prisma', 'schema.postgres.prisma'),
    databaseUrl: 'postgresql://atomic:atomic@localhost:5432/atomic_schema_check'
  }
];

function runPrisma(label, args, databaseUrl) {
  const result = spawnSync(
    'npx',
    ['prisma', ...args],
    {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl
      },
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    console.error(`${label} failed`);
    process.exit(result.status || 1);
  }
}

function validateSchema(item) {
  const schemaPath = path.join(__dirname, '..', item.schema);

  if (!fs.existsSync(schemaPath)) {
    console.error(`Missing ${item.label} Prisma schema at ${item.schema}`);
    process.exit(1);
  }

  runPrisma(`${item.label} Prisma schema validation`, ['validate', '--schema', item.schema], item.databaseUrl);
  console.log(`OK ${item.label} Prisma schema validates`);
}

for (const item of schemas) {
  validateSchema(item);
}

runPrisma(
  'default sqlite Prisma client generation',
  ['generate', '--schema', path.join('prisma', 'schema.prisma')],
  'file:./schema-check.db'
);
console.log('OK default sqlite Prisma client generates');

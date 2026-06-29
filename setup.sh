mkdir -p src/routes prisma

cat << 'EOF' > tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
EOF

cat << 'EOF' > .env
PORT=3000
DATABASE_URL="file:./dev.db"
EOF

cat << 'EOF' > prisma/schema.prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Merchant {
  id            String          @id @default(uuid())
  businessName  String
  apiKey        String          @unique
  createdAt     DateTime        @default(now())
  intents       PaymentIntent[]
}

model PaymentIntent {
  id             String   @id @default(uuid())
  merchantId     String
  merchant       Merchant @relation(fields: [merchantId], references: [id])
  amountFiat     Float
  currencyFiat   String   @default("USD")
  status         String   @default("PENDING")
  createdAt      DateTime @default(now())
  expiresAt      DateTime
}
EOF

cat << 'EOF' > src/routes/intents.ts
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

router.post('/v1/payment_intents', async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const apiKey = req.headers['x-atomic-key'] as string;

    if (!apiKey) {
      return res.status(401).json({ error: 'Missing x-atomic-key header' });
    }

    const merchant = await prisma.merchant.findUnique({
      where: { apiKey }
    });

    if (!merchant) {
      return res.status(401).json({ error: 'Invalid API Key' });
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const intent = await prisma.paymentIntent.create({
      data: {
        merchantId: merchant.id,
        amountFiat: parseFloat(amount),
        currencyFiat: currency || 'USD',
        expiresAt,
        status: 'PENDING'
      }
    });

    return res.json({
      id: intent.id,
      amount: intent.amountFiat,
      currency: intent.currencyFiat,
      status: intent.status,
      expiresAt: intent.expiresAt
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
EOF

cat << 'EOF' > src/index.ts
import express from 'express';
import dotenv from 'dotenv';
import intentRoutes from './routes/intents';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'Atomic Payments API is active' });
});

app.use(intentRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Atomic Payments engine running on http://localhost:${PORT}`);
});
EOF

cat << 'EOF' > prisma/seed.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.paymentIntent.deleteMany({});
  await prisma.merchant.deleteMany({});

  const sampleMerchant = await prisma.merchant.create({
    data: {
      businessName: "Satoshi Coffee Shop",
      apiKey: "at_live_secret_key_12345"
    }
  });

  console.log("\n🌱 Database seeded successfully!");
  console.log("==========================================");
  console.log(`Merchant Created: ${sampleMerchant.businessName}`);
  console.log(`Your Live Test API Key: ${sampleMerchant.apiKey}`);
  console.log("==========================================\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
EOF

node -e '
const fs = require("fs");
const pkg = require("./package.json");
pkg.scripts = {
  "build": "tsc",
  "start": "node dist/index.js",
  "dev": "nodemon --watch \"src/**/*.ts\" --exec \"ts-node\" src/index.ts",
  "db:setup": "npx prisma db push && ts-node prisma/seed.ts"
};
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2));
'

npx prisma db push && npx ts-node prisma/seed.ts

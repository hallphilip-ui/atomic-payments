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

const assert = require('assert');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const expectedMerchantKeys = [
    'at_test_demo_coffee_0000000000000001',
    'at_test_demo_market_0000000000000002',
    'at_test_treasury_sandbox_0000000003'
  ];
  const merchants = await prisma.merchant.findMany({
    where: { apiKey: { in: expectedMerchantKeys } },
    orderBy: { businessName: 'asc' }
  });
  assert.equal(merchants.length, expectedMerchantKeys.length, 'seeded test merchants are present');
  assert.ok(merchants.every((merchant) => merchant.apiKey.startsWith('at_test_')), 'test merchant keys use the test prefix');

  const users = await prisma.user.findMany({
    where: { username: { in: ['demo_alice', 'demo_bob', 'demo_ops'] } },
    include: {
      wallets: true,
      connections: {
        include: { linkedUser: true }
      }
    }
  });
  assert.equal(users.length, 3, 'seeded demo users are present');

  const alice = users.find((user) => user.username === 'demo_alice');
  const bob = users.find((user) => user.username === 'demo_bob');
  assert.ok(alice, 'demo_alice exists');
  assert.ok(bob, 'demo_bob exists');
  assert.ok(alice.wallets.some((wallet) => wallet.chain === 'ETHEREUM'), 'demo_alice has an EVM wallet');
  assert.ok(alice.wallets.some((wallet) => wallet.chain === 'SOLANA'), 'demo_alice has a Solana wallet');
  assert.ok(bob.wallets.some((wallet) => wallet.chain === 'ETHEREUM'), 'demo_bob has an EVM wallet');
  assert.ok(alice.connections.some((connection) => connection.linkedUser.username === 'demo_bob'), 'demo_alice is connected to demo_bob');

  console.log('OK test account seed contract: merchants, users, wallets, and demo connection are present');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

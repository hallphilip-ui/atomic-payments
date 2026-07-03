import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const testMerchants = [
  {
    businessName: 'Atomic Demo Coffee',
    apiKey: 'at_test_demo_coffee_0000000000000001'
  },
  {
    businessName: 'Atomic Demo Market',
    apiKey: 'at_test_demo_market_0000000000000002'
  },
  {
    businessName: 'Atomic Treasury Sandbox',
    apiKey: 'at_test_treasury_sandbox_0000000003'
  }
];

const testUsers = [
  {
    username: 'demo_alice',
    email: 'demo.alice@atomicpay.test',
    wallets: [
      { chain: 'ETHEREUM', address: '0x1111111111111111111111111111111111111111' },
      { chain: 'SOLANA', address: 'HN7c7w8DmQCvVx4jYdgY8rCDAMiNkaRPQE6vgbZTk6Z2' }
    ]
  },
  {
    username: 'demo_bob',
    email: 'demo.bob@atomicpay.test',
    wallets: [
      { chain: 'ETHEREUM', address: '0x2222222222222222222222222222222222222222' },
      { chain: 'SOLANA', address: '4Nd1mYpJfX3dWn8K8aG7qV6D5rC4bB3aA2zZ1yY9xX8w' }
    ]
  },
  {
    username: 'demo_ops',
    email: 'demo.ops@atomicpay.test',
    wallets: [
      { chain: 'ETHEREUM', address: '0x3333333333333333333333333333333333333333' }
    ]
  }
];

async function upsertTestMerchants() {
  const merchants = [];

  for (const merchant of testMerchants) {
    merchants.push(
      await prisma.merchant.upsert({
        where: { apiKey: merchant.apiKey },
        update: { businessName: merchant.businessName },
        create: merchant
      })
    );
  }

  return merchants;
}

async function upsertTestUsers() {
  const users = [];

  for (const account of testUsers) {
    const user = await prisma.user.upsert({
      where: { username: account.username },
      update: { email: account.email },
      create: {
        username: account.username,
        email: account.email
      }
    });

    for (const wallet of account.wallets) {
      await prisma.wallet.upsert({
        where: {
          userId_chain: {
            userId: user.id,
            chain: wallet.chain
          }
        },
        update: { address: wallet.address },
        create: {
          userId: user.id,
          chain: wallet.chain,
          address: wallet.address
        }
      });
    }

    users.push(user);
  }

  await prisma.connection.upsert({
    where: {
      userId_linkedUserId: {
        userId: users[0].id,
        linkedUserId: users[1].id
      }
    },
    update: {},
    create: {
      userId: users[0].id,
      linkedUserId: users[1].id
    }
  });

  await prisma.connection.upsert({
    where: {
      userId_linkedUserId: {
        userId: users[1].id,
        linkedUserId: users[0].id
      }
    },
    update: {},
    create: {
      userId: users[1].id,
      linkedUserId: users[0].id
    }
  });

  return users;
}

async function main() {
  const merchants = await upsertTestMerchants();
  const users = await upsertTestUsers();

  console.log('\nAtomic Payments test accounts seeded');
  console.log('====================================');
  console.log('Merchant API keys:');
  for (const merchant of merchants) {
    console.log(`- ${merchant.businessName}: ${merchant.apiKey}`);
  }
  console.log('\nUser accounts:');
  for (const user of users) {
    console.log(`- ${user.username}: ${user.email}`);
  }
  console.log('====================================\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

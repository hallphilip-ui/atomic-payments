import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const router = Router();

router.post('/v1/onboarding/quick_setup', async (req, res) => {
  const { username, email, walletAddress, chain } = req.body;
  
  // 1. Create User
  const user = await prisma.user.create({ data: { username, email } });
  
  // 2. Link Wallet
  await prisma.wallet.create({ data: { userId: user.id, chain, address: walletAddress } });
  
  // 3. Generate Secret Key
  const apiKey = crypto.randomBytes(16).toString('hex');
  const merchant = await prisma.merchant.create({ data: { businessName: username, apiKey } });

  res.json({ message: "Atomic Pay Ready", apiKey, userId: user.id });
});

export default router;

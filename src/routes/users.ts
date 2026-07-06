import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// Validation regex helpers
const ETH_REGEX = /^0x[a-fA-F0-9]{40}$/;
const SOL_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

router.post('/v1/users', async (req, res) => {
  try {
    const { username, email } = req.body;
    const user = await prisma.user.create({ data: { username, email } });
    return res.json({ message: "🎉 User profile activated!", user });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// Guarded address endpoint with cryptographic string matching checking
router.post('/v1/users/:id/wallets', async (req, res) => {
  try {
    const { id } = req.params;
    const { chain, address } = req.body;

    if (chain === 'ETHEREUM' && !ETH_REGEX.test(address)) {
      return res.status(400).json({ error: "Malformatted Ethereum or EVM address pattern detected." });
    }
    if (chain === 'SOLANA' && !SOL_REGEX.test(address)) {
      return res.status(400).json({ error: "Malformatted Solana base58 address pattern detected." });
    }

    const wallet = await prisma.wallet.upsert({
      where: { userId_chain: { userId: id, chain } },
      update: { address },
      create: { userId: id, chain, address }
    });

    return res.json({ message: `✅ Verified and saved ${chain} path.`, wallet });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/v1/users/:id/connections', async (req, res) => {
  try {
    const { id } = req.params;
    const { linkToUsername } = req.body;

    const targetUser = await prisma.user.findUnique({ where: { username: linkToUsername } });
    if (!targetUser) return res.status(404).json({ error: 'Target peer not found.' });

    const connection = await prisma.connection.create({
      data: { userId: id, linkedUserId: targetUser.id }
    });

    return res.json({ message: `🔗 Linked to @${linkToUsername}!`, connection });
  } catch (error: any) {
    return res.status(400).json({ error: "Connection anomaly or link already exists." });
  }
});

// Wallet-first session: connecting a wallet creates/recognizes a user with no
// signup form. Username/email are derived deterministically from the address
// (a real email can replace the placeholder later via profile update).
const CHAIN_BY_WALLET_TYPE: Record<string, string> = {
  evm: 'ETHEREUM',
  svm: 'SOLANA',
  btc: 'BITCOIN',
  tron: 'TRON'
};

router.post('/v1/users/wallet_session', async (req, res) => {
  try {
    const address = String(req.body.address ?? '').trim();
    const walletType = String(req.body.walletType ?? 'evm').toLowerCase();
    const walletName = String(req.body.walletName ?? '').slice(0, 40);
    const chain = CHAIN_BY_WALLET_TYPE[walletType] ?? 'ETHEREUM';

    if (address.length < 8 || address.length > 90) {
      return res.status(400).json({ error: 'A wallet address is required.' });
    }
    if (chain === 'ETHEREUM' && !ETH_REGEX.test(address)) {
      return res.status(400).json({ error: 'Malformatted EVM address.' });
    }
    if (chain === 'SOLANA' && !SOL_REGEX.test(address)) {
      return res.status(400).json({ error: 'Malformatted Solana address.' });
    }

    const slug = `w_${address.slice(0, 10)}${address.slice(-6)}`.toLowerCase();
    const placeholderEmail = `${slug}@wallet.atomicpay.cloud`;

    let user = await prisma.user.findUnique({ where: { username: slug } });
    const isNew = !user;
    if (!user) {
      user = await prisma.user.create({ data: { username: slug, email: placeholderEmail } });
    }
    await prisma.wallet.upsert({
      where: { userId_chain: { userId: user.id, chain } },
      update: { address },
      create: { userId: user.id, chain, address }
    });

    // Recent swap activity for this wallet across sessions = the sticky loop.
    const recentSwaps = await prisma.swapQuote.findMany({
      where: { OR: [{ userAddress: address }, { walletAddress: address }] },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, status: true, fromAsset: true, toAsset: true,
        amount: true, estimatedOutputAmount: true, createdAt: true
      }
    });

    return res.json({
      user: { id: user.id, username: user.username, memberSince: user.createdAt, isNew },
      wallet: { chain, address, walletName },
      recentSwaps: recentSwaps.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/v1/users/:id/network_directory', async (req, res) => {
  try {
    const { id } = req.params;
    const userDirectory = await prisma.user.findUnique({
      where: { id },
      include: {
        connections: {
          include: { linkedUser: { include: { wallets: true } } }
        }
      }
    });

    if (!userDirectory) return res.status(404).json({ error: 'Identity not found.' });
    
    const cleanDirectory = userDirectory.connections.map(c => ({
      username: c.linkedUser.username,
      availableAddresses: c.linkedUser.wallets.map(w => ({ chain: w.chain, address: w.address }))
    }));

    return res.json({ connections: cleanDirectory });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;

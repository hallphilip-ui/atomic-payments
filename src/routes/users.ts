import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// wallet_session echoes an address's recent swap activity, so throttle it per-IP to
// stop bulk harvesting of who-swapped-what across the user base. (The address itself
// is public on-chain; this caps automated correlation of platform activity to it.)
const walletSessionLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => { const cf = req.headers['cf-connecting-ip']; return typeof cf === 'string' && cf.length ? cf : req.ip || 'unknown'; }
});

// Validation regex helpers
const ETH_REGEX = /^0x[a-fA-F0-9]{40}$/;
const SOL_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// NOTE: The legacy "social directory" endpoints (POST /v1/users, POST
// /v1/users/:id/wallets, POST /v1/users/:id/connections, GET
// /v1/users/:id/network_directory) were removed. They were unauthenticated and
// keyed only on a caller-supplied user id, so anyone could overwrite another
// user's wallet address (IDOR) or harvest other users' addresses. Nothing in the
// client called them. The wallet-native session below is the only user endpoint.

// Wallet-first session: connecting a wallet creates/recognizes a user with no
// signup form. Username/email are derived deterministically from the address
// (a real email can replace the placeholder later via profile update).
const CHAIN_BY_WALLET_TYPE: Record<string, string> = {
  evm: 'ETHEREUM',
  svm: 'SOLANA',
  btc: 'BITCOIN',
  tron: 'TRON'
};

router.post('/v1/users/wallet_session', walletSessionLimiter, async (req, res) => {
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

export default router;

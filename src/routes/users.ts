import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// 1. Register a Network Identity Profile
router.post('/v1/users', async (req, res) => {
  try {
    const { username, email } = req.body;
    const user = await prisma.user.create({
      data: { username, email }
    });
    return res.json({ message: "🎉 User directory profile activated!", user });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// 2. Save/Update a Wallet Address for a Specific Currency
router.post('/v1/users/:id/wallets', async (req, res) => {
  try {
    const { id } = req.params;
    const { chain, address } = req.body; // e.g., chain: "SOLANA", address: "HN7c7w..."

    const wallet = await prisma.wallet.upsert({
      where: {
        userId_chain: { userId: id, chain }
      },
      update: { address },
      create: { userId: id, chain, address }
    });

    return res.json({ message: `✅ Saved ${chain} routing address successfully.`, wallet });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// 3. Link Seamlessly to Another Network Peer
router.post('/v1/users/:id/connections', async (req, res) => {
  try {
    const { id } = req.params; // The source user initiating the link
    const { linkToUsername } = req.body; // The target user handle to connect with

    const targetUser = await prisma.user.findUnique({ where: { username: linkToUsername } });
    if (!targetUser) return res.status(404).json({ error: 'Target peer username not found in directory.' });
    if (id === targetUser.id) return res.status(400).json({ error: 'You cannot initiate a directory link to yourself.' });

    const connection = await prisma.connection.create({
      data: {
        userId: id,
        linkedUserId: targetUser.id
      }
    });

    return res.json({ message: `🔗 You are now seamlessly connected to @${linkToUsername}!`, connection });
  } catch (error: any) {
    return res.status(400).json({ error: "Connection mapping already exists or is invalid." });
  }
});

// 4. Resolve Peer Wallets Intuitively (Query what currency addresses your connections hold)
router.get('/v1/users/:id/network_directory', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Fetch user alongside everyone they've connected to, resolving their wallet setups instantly
    const userDirectory = await prisma.user.findUnique({
      where: { id },
      include: {
        connections: {
          include: {
            linkedUser: {
              include: { wallets: true }
            }
          }
        }
      }
    });

    if (!userDirectory) return res.status(404).json({ error: 'Identity not found.' });
    
    // Flatten out payload for clean frontend consumption
    const cleanDirectory = userDirectory.connections.map(c => ({
      userId: c.linkedUser.id,
      username: c.linkedUser.username,
      email: c.linkedUser.email,
      availableAddresses: c.linkedUser.wallets.map(w => ({ chain: w.chain, address: w.address }))
    }));

    return res.json({ connections: cleanDirectory });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;

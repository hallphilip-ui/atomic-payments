import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { join } from 'path';
import { upstreamsFor, rpcCall } from './rpc';

// Gas station (gas abstraction). A small, operator-funded hot wallet dispenses a
// tiny amount of native gas (ETH on Base) to a user whose wallet holds tokens but
// no gas, so a zero-ETH EOA (e.g. Trust Wallet) can still initiate an approve+swap.
//
// SECURITY MODEL — this is a HOT WALLET that signs value transfers:
//   * The private key is provided by the operator via ATOMIC_GAS_STATION_KEY and
//     lives only in .env (root-600). The code never generates or logs it. If it's
//     unset, the whole feature is OFF (endpoint returns 503) — fail-safe.
//   * Keep only a SMALL float in the station; drops are capped and metered so a
//     drained/farmed station loses at most the daily cap.
//   * Guards: fixed small drop amount; only when the recipient is below a gas
//     threshold (already-gassed wallets are refused); a per-address cooldown; a
//     per-IP rate limit; and a global daily spend cap. All bound the blast radius.
//
// ethers is loaded from the SAME integrity-pinned bundle the funds pages use — no
// new server dependency, and it's isomorphic (works under Node).
const ethers: any = require(join(process.cwd(), 'public', 'vendor', 'ethers-6.13.4.umd.min.js'));

const STATION_KEY = (process.env.ATOMIC_GAS_STATION_KEY || '').trim();
// Amount handed out per drop. A Base approve+swap (~350k gas) costs ~$0.01 at
// normal gas; 0.00004 ETH (~$0.07) covers it up to ~0.11 gwei — a solid spike
// cushion while minimizing what the user keeps (the drop can't be clawed back).
const DROP_WEI = BigInt(process.env.ATOMIC_GAS_DROP_WEI || '40000000000000'); // 0.00004 ETH
// Only fund a wallet whose native balance is below this (already-gassed → refuse).
const MIN_BALANCE_WEI = BigInt(process.env.ATOMIC_GAS_MIN_BALANCE_WEI || '40000000000000'); // 0.00004 ETH
// Global daily spend ceiling — a hard cap on how much the station can leak/day.
const DAILY_CAP_WEI = BigInt(process.env.ATOMIC_GAS_DAILY_CAP_WEI || '10000000000000000'); // 0.01 ETH
const PER_ADDRESS_COOLDOWN_MS = Number(process.env.ATOMIC_GAS_COOLDOWN_MS || 6 * 60 * 60 * 1000); // 6h
const CHAINS = new Set((process.env.ATOMIC_GAS_STATION_CHAINS || '8453').split(',').map((c) => Number(c.trim())).filter(Boolean));

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const clip = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

const router = Router();

// Per-address cooldown + rolling daily total (in-memory; per process — fine for a
// single node, and the on-chain min-balance check is the real backstop anyway).
const lastDrop = new Map<string, number>();
let daySpent = 0n;
let dayKey = new Date().toISOString().slice(0, 10);
function rollDay() { const k = new Date().toISOString().slice(0, 10); if (k !== dayKey) { dayKey = k; daySpent = 0n; } }

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => { const cf = req.headers['cf-connecting-ip']; return typeof cf === 'string' && cf.length ? cf : req.ip || 'unknown'; }
});

// Whether gas sponsorship is available (client uses this to decide whether to offer it).
router.get('/v1/gas/config', (_req, res) => {
  return res.json({ enabled: STATION_KEY.length > 0, chains: [...CHAINS], dropWei: DROP_WEI.toString(), minBalanceWei: MIN_BALANCE_WEI.toString() });
});

router.post('/v1/gas/topup', limiter, async (req, res) => {
  try {
    if (!STATION_KEY) return res.status(503).json({ funded: false, reason: 'Gas sponsorship is not configured.' });
    const address = clip((req.body || {}).address, 64);
    const chainId = Number((req.body || {}).chainId);
    if (!EVM_ADDRESS.test(address)) return res.status(400).json({ funded: false, reason: 'Valid EVM address required.' });
    if (!CHAINS.has(chainId)) return res.status(400).json({ funded: false, reason: 'Gas sponsorship not available on this chain.' });

    // Check cooldown + daily cap AND reserve them in one synchronous block — no await
    // in between — so concurrent requests can't all pass the checks before any of them
    // reserves (the TOCTOU that let a burst multi-drop / blow past the daily cap). Node
    // is single-threaded, so this block is atomic. We roll the reservation back below
    // if any async precondition (already-gassed, station low, send) fails.
    const key = address.toLowerCase();
    const now = Date.now();
    rollDay();
    const prev = lastDrop.get(key) || 0;
    if (now - prev < PER_ADDRESS_COOLDOWN_MS) {
      return res.status(429).json({ funded: false, reason: 'This wallet was topped up recently — try again later or add gas manually.' });
    }
    if (daySpent + DROP_WEI > DAILY_CAP_WEI) {
      return res.status(429).json({ funded: false, reason: 'Daily gas-sponsorship limit reached — please add gas manually.' });
    }
    lastDrop.set(key, now);
    daySpent += DROP_WEI;
    const rollback = () => { lastDrop.delete(key); daySpent -= DROP_WEI; };

    try {
      // Already has enough gas? Don't dispense (release the reservation).
      const balHex = await rpcCall(chainId, 'eth_getBalance', [address, 'latest']);
      const balance = BigInt(balHex && balHex !== '0x' ? balHex : '0x0');
      if (balance >= MIN_BALANCE_WEI) { rollback(); return res.json({ funded: false, reason: 'Wallet already has enough gas.', balance: balance.toString() }); }

      const url = upstreamsFor(chainId)[0];
      if (!url) { rollback(); return res.status(400).json({ funded: false, reason: 'No RPC upstream for this chain.' }); }
      const provider = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true });
      const wallet = new ethers.Wallet(STATION_KEY, provider);

      // Refuse if the station itself can't cover the drop (+ its own gas headroom).
      const stationBal: bigint = await provider.getBalance(wallet.address);
      if (stationBal < DROP_WEI + (DROP_WEI / 2n)) {
        rollback();
        console.warn('[gas] station balance low:', stationBal.toString());
        return res.status(503).json({ funded: false, reason: 'Gas sponsorship is temporarily unavailable.' });
      }

      const tx = await wallet.sendTransaction({ to: address, value: DROP_WEI });
      return res.json({ funded: true, txHash: tx.hash, dropWei: DROP_WEI.toString(), chainId });
    } catch (e: any) {
      rollback();
      console.warn('[gas] send failed:', e?.message);
      return res.status(502).json({ funded: false, reason: 'Gas top-up transaction failed — add gas manually.' });
    }
  } catch (e: any) {
    return res.status(500).json({ funded: false, reason: 'Gas sponsorship error.' });
  }
});

export default router;

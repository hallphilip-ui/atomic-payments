// Periodic sanctions re-screening. Addresses are screened at the point of use, but
// OFAC/EU/UN designations change over time — a wallet that was clean when a merchant
// set it can be listed later. This job re-screens every merchant's payout wallet on a
// schedule and flags any that now hit, so new charges are refused (see intents.ts) and
// an operator can act. Screening is the local OFAC list + the keyless on-chain oracle
// (see compliance/sanctions.ts) — no vendor key required.
import { PrismaClient } from '@prisma/client';
import { screenAddresses } from './sanctions';

const prisma = new PrismaClient();

const POLL_MS = Number(process.env.ATOMIC_RESCREEN_POLL_MS) || 12 * 60 * 60 * 1000; // 12h
const BATCH = 200;

export async function rescreenOnce(): Promise<{ checked: number; flagged: number }> {
  const merchants = await prisma.merchant.findMany({
    where: { receiveAddress: { not: null } },
    select: { id: true, receiveAddress: true, sanctionsFlagged: true },
    take: BATCH
  });
  let checked = 0;
  let newlyFlagged = 0;
  for (const m of merchants) {
    const addr = m.receiveAddress as string;
    let hit = false;
    try { hit = !!(await screenAddresses([addr])); }
    catch { continue; }                                  // screening outage — leave state as-is
    checked++;
    if (hit && !m.sanctionsFlagged) {
      newlyFlagged++;
      // eslint-disable-next-line no-console
      console.warn('[sanctions] re-screen flagged a merchant payout wallet', JSON.stringify({ merchantId: m.id, address: addr }));
    }
    await prisma.merchant.update({
      where: { id: m.id },
      data: { sanctionsFlagged: hit, sanctionsCheckedAt: new Date() }
    }).catch(() => {});
  }
  return { checked, flagged: newlyFlagged };
}

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try { await rescreenOnce(); } catch { /* non-fatal */ } finally { ticking = false; }
}

export function startSanctionsRescreen(): void {
  if (process.env.ATOMIC_RESCREEN === '0') return;   // opt-out
  setTimeout(tick, 60 * 1000);                       // first pass a minute after boot
  setInterval(tick, POLL_MS);
  // eslint-disable-next-line no-console
  console.log(`🛡️  Sanctions re-screen live (every ${Math.round(POLL_MS / 3600000)}h, merchant payout wallets)`);
}

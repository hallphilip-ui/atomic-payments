// On-chain payment watcher. Turns a PaymentIntent into a real, confirmed payment by
// detecting the ERC20 transfer that pays it — no custody: funds go straight to the
// merchant's wallet, we just watch the chain (via our own RPC proxy) and confirm.
//
// MVP scope: EVM stablecoin rails (USDC/USDT/PYUSD on Ethereum, USDC on Base).
// Matching is exact: each invoice's `cryptoAmountRequired` carries a tiny per-invoice
// entropy (see select_chain) so one Transfer maps to exactly one invoice.
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { rpcCall } from '../routes/rpc';
import { STABLECOIN_RAILS } from '../routes/intents';
import { isSafeWebhookUrl } from '../security/partnerWebhook';
import { sendReceiptEmail } from '../notify/merchantEmail';
import { screenAddresses } from '../compliance/sanctions';

const prisma = new PrismaClient();

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const CONFIRMATIONS = 2;                         // reorg buffer before we trust a log
const POLL_MS = Number(process.env.ATOMIC_PAYMENT_POLL_MS) || 20000;
const EXPIRY_GRACE_MS = 30 * 60 * 1000;          // still confirm payments that land just after expiry
const MAX_LOOKBACK = 100000n;                    // hard cap on the eth_getLogs window

function toTopicAddr(addr: string): string {
  return '0x000000000000000000000000' + addr.toLowerCase().replace(/^0x/, '');
}

// The ERC20 Transfer sender is the 2nd topic (indexed `from`), left-padded to 32 bytes.
function payerFromLog(log: any): string | null {
  const t = log?.topics?.[1];
  if (typeof t !== 'string' || t.length < 42) return null;
  const addr = '0x' + t.slice(-40);
  return /^0x[0-9a-fA-F]{40}$/.test(addr) ? addr : null;
}

async function fireMerchantWebhook(m: { webhookUrl: string | null; webhookSecret: string | null }, payload: unknown): Promise<void> {
  if (!m.webhookUrl) return;
  try { if (!(await isSafeWebhookUrl(m.webhookUrl))) return; } catch { return; }   // SSRF guard
  const body = JSON.stringify(payload);
  const sig = m.webhookSecret ? crypto.createHmac('sha256', m.webhookSecret).update(body).digest('hex') : '';
  fetch(m.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-atomic-signature': sig, 'user-agent': 'Atomic-Payments/1' },
    body, signal: AbortSignal.timeout(6000)
  }).catch(() => {});
}

async function checkIntent(intent: any): Promise<void> {
  const rail = STABLECOIN_RAILS[intent.selectedChain || ''];
  if (!rail || rail.uriScheme !== 'ethereum' || !rail.chainId || !rail.tokenAddress) return;  // EVM stablecoins only
  if (!intent.depositAddress || !intent.cryptoAmountRequired) return;

  const chainId = rail.chainId;
  const expected = BigInt(Math.round(Number(intent.cryptoAmountRequired) * 10 ** rail.decimals));
  if (expected <= 0n) return;

  const latest = BigInt(String(await rpcCall(chainId, 'eth_blockNumber', [])));
  const toBlock = latest > BigInt(CONFIRMATIONS) ? latest - BigInt(CONFIRMATIONS) : latest;
  let fromBlock = intent.watchFromBlock != null ? BigInt(intent.watchFromBlock) : (toBlock > MAX_LOOKBACK ? toBlock - MAX_LOOKBACK : 0n);
  if (toBlock > fromBlock + MAX_LOOKBACK) fromBlock = toBlock - MAX_LOOKBACK;      // keep the range bounded
  if (fromBlock > toBlock) return;

  const logs = await rpcCall(chainId, 'eth_getLogs', [{
    address: rail.tokenAddress,
    topics: [TRANSFER_TOPIC, null, toTopicAddr(intent.depositAddress)],
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock: '0x' + toBlock.toString(16)
  }]);
  if (!Array.isArray(logs)) return;

  for (const log of logs) {
    let amt: bigint;
    try { amt = BigInt(log.data); } catch { continue; }
    if (amt !== expected) continue;                                                // exact match (entropy guarantees uniqueness)

    // AML: screen the PAYER before we confirm. The sender is topic[1] of the ERC20
    // Transfer we just matched, so this costs us nothing to check. A hit is NOT
    // auto-confirmed: we park it in REVIEW and withhold the webhook and the customer
    // receipt, so a sanctioned payment is never silently settled and receipted.
    const payer = payerFromLog(log);
    if (payer) {
      let sanctioned = false;
      try { sanctioned = !!(await screenAddresses([payer])); }
      catch { sanctioned = false; }                                                // screening outage must not stall settlement
      if (sanctioned) {
        await prisma.paymentIntent.updateMany({
          where: { id: intent.id, status: { in: ['PENDING', 'PROCESSING'] } },
          data: { status: 'REVIEW', txHash: log.transactionHash }
        });
        // eslint-disable-next-line no-console
        console.warn('[sanctions] payment held for review — sanctioned payer', JSON.stringify({
          intentId: intent.id, payer, txHash: log.transactionHash, asset: rail.symbol, network: rail.network
        }));
        return;
      }
    }

    // Claim atomically — only if still awaiting payment — so we never double-fire
    // or race the operator simulate endpoint.
    const claimed = await prisma.paymentIntent.updateMany({
      where: { id: intent.id, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'CONFIRMED', txHash: log.transactionHash, confirmedAt: new Date() }
    });
    if (claimed.count !== 1) return;
    const full = await prisma.paymentIntent.findUnique({ where: { id: intent.id }, include: { merchant: true } });
    if (full?.merchant) {
      await fireMerchantWebhook(full.merchant, {
        event: 'payment.confirmed',
        data: {
          id: full.id, amount: full.amount, currency: full.currency,
          asset: rail.symbol, network: rail.network, txHash: log.transactionHash,
          paidTo: full.depositAddress, confirmedAt: (full.confirmedAt || new Date()).toISOString()
        }
      });
      // Email the customer a receipt (best-effort).
      if (full.customerEmail) {
        sendReceiptEmail({
          to: full.customerEmail, businessName: full.merchant.businessName, replyTo: full.merchant.email,
          amount: full.amount, currency: full.currency, description: full.description, reference: full.reference,
          asset: `${rail.symbol} on ${rail.network}`, txHash: log.transactionHash, intentId: full.id
        }).catch(() => {});
      }
    }
    return;
  }
}

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const intents = await prisma.paymentIntent.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        selectedChain: { not: null },
        depositAddress: { not: null },
        expiresAt: { gt: new Date(Date.now() - EXPIRY_GRACE_MS) }
      },
      take: 100
    });
    for (const it of intents) { try { await checkIntent(it); } catch { /* per-intent errors are non-fatal */ } }
  } catch { /* poll errors are non-fatal */ } finally {
    ticking = false;
  }
}

export function startPaymentWatcher(): void {
  if (process.env.ATOMIC_PAYMENTS_WATCH === '0') return;   // opt-out
  setInterval(tick, POLL_MS);
  // eslint-disable-next-line no-console
  console.log(`💳 Payment watcher live (poll ${POLL_MS}ms, ${CONFIRMATIONS}-conf, EVM stablecoin rails)`);
}

// Run a single poll pass — used by tests to drive the watcher deterministically.
export async function runWatcherOnce(): Promise<void> { await tick(); }

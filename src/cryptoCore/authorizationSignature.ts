import crypto from 'crypto';
import { join } from 'path';

// Wallet-attestation signature verification for the swap authorize step. Until now
// authorize accepted ANY string >= 8 chars as a "signature", so anyone who learned a
// quote id could bind an arbitrary wallet to it (hijack/grief the real payer). We now
// cryptographically verify the attestation actually came from the wallet it claims.
//
// The canonical message MUST match the client's quoteSignatureMessage() in
// defi-swap.html exactly, or a legitimate signature won't verify.

// ethers is reused from the integrity-pinned vendor bundle already shipped for the
// wallet path — no new server dependency, and the same code that signs client-side.
const ethers: any = require(join(process.cwd(), 'public', 'vendor', 'ethers-6.13.4.umd.min.js'));

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function buildAuthorizationMessage(quote: {
  id: string;
  fromAsset: string;
  toAsset: string;
  amount: string;
  expiresAt: Date;
}): string {
  // Mirror of defi-swap.html quoteSignatureMessage(). expiresAt is serialized the
  // same way the client saw it (the ISO string returned in the quote response).
  return [
    'Atomic Payments swap authorization',
    `Quote: ${quote.id}`,
    `Route: ${quote.fromAsset} -> ${quote.toAsset}`,
    `Amount: ${quote.amount}`,
    `Expires: ${quote.expiresAt.toISOString()}`
  ].join('\n');
}

function base58Decode(str: string): Buffer {
  const bytes: number[] = [0];
  for (const ch of str) {
    const value = BASE58.indexOf(ch);
    if (value === -1) throw new Error('invalid base58');
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let k = 0; k < str.length && str[k] === '1'; k++) bytes.push(0);
  return Buffer.from(bytes.reverse());
}

// Verify an ed25519 signature (Solana) via Node crypto. The Solana address IS the
// 32-byte ed25519 public key (base58). We wrap the raw key in the standard SPKI DER
// prefix so crypto.createPublicKey accepts it.
function verifyEd25519(message: string, base64Signature: string, address: string): boolean {
  const pub = base58Decode(address);
  if (pub.length !== 32) return false;
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]);
  const keyObject = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  const sig = Buffer.from(base64Signature, 'base64');
  if (sig.length !== 64) return false;
  return crypto.verify(null, Buffer.from(message, 'utf8'), keyObject, sig);
}

export type AuthorizationSignature = {
  signature: string;
  walletAddress?: string;
  signatureKind?: string;
};

type VerifyOutcome =
  | { status: 'ok'; address: string }
  | { status: 'fail'; reason: string }
  | { status: 'unsupported' };

// Attempt cryptographic verification of the attestation against the canonical
// message. Never throws — the caller decides whether a failure is fatal (strict).
function tryVerify(message: string, signature: string, claimed: string, kind: string): VerifyOutcome {
  // EVM personal_sign (MetaMask, Trust, the passkey EOA, WalletConnect wallets).
  const looksEvm = kind === 'evm_personal_sign' || (EVM_ADDRESS.test(claimed) && /^0x[0-9a-fA-F]+$/.test(signature));
  if (looksEvm) {
    if (!EVM_ADDRESS.test(claimed)) return { status: 'fail', reason: 'An EVM wallet address is required to verify this signature.' };
    let recovered: string;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      return { status: 'fail', reason: 'Wallet signature could not be verified — re-authorize from your wallet.' };
    }
    if (recovered.toLowerCase() !== claimed.toLowerCase()) {
      return { status: 'fail', reason: 'Wallet signature does not match the authorizing address.' };
    }
    return { status: 'ok', address: recovered };
  }

  // Solana signMessage — signature arrives as "solana:<base64>".
  if (kind === 'solana_sign_message' || signature.startsWith('solana:')) {
    if (!claimed) return { status: 'fail', reason: 'A wallet address is required to verify this signature.' };
    const b64 = signature.replace(/^solana:/, '');
    let ok = false;
    try { ok = verifyEd25519(message, b64, claimed); } catch { ok = false; }
    if (!ok) return { status: 'fail', reason: 'Solana signature does not match the authorizing address.' };
    return { status: 'ok', address: claimed };
  }

  // e.g. the UI's simulated_message_signature when no wallet is connected.
  return { status: 'unsupported' };
}

// Returns the verified wallet address, or throws with a user-facing reason. When
// requireStrict is true (production/live provider mode) ONLY a cryptographically
// verified signature is accepted — a mismatch, an unverifiable signature, or an
// unsupported/simulated kind all reject. When false (dev/simulation) verification is
// best-effort: a valid signature still binds the verified signer, but a failure or a
// simulated signature falls back to the claimed address so local demos keep working.
export function verifyAuthorizationSignature(
  message: string,
  auth: AuthorizationSignature,
  requireStrict: boolean
): string {
  const signature = (auth.signature ?? '').trim();
  const claimed = (auth.walletAddress ?? '').trim();
  const kind = (auth.signatureKind ?? '').trim();

  const outcome = tryVerify(message, signature, claimed, kind);
  if (outcome.status === 'ok') return outcome.address;

  if (requireStrict) {
    throw new Error(outcome.status === 'fail'
      ? outcome.reason
      : 'A verifiable wallet signature is required to authorize this swap.');
  }
  // Dev/simulation only: accept without a valid signature.
  return claimed || 'unverified';
}

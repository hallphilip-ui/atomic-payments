// Atomic passkey (email) wallet — reusable module.
//
// Touch ID / passkey → WebAuthn PRF → deterministic secp256k1 key → ethers EOA
// → multi-chain EIP-1193 provider (drop-in for the swap console's executeSwap).
// The private key is derived on-device each session and NEVER stored or sent to
// a server. Only the WebAuthn credential id + derived address are synced (so a
// user can unlock from any device).
//
// Mode gating: window.ATOMIC_PASSKEY_MODE === 'mainnet' enables mainnet chains;
// anything else stays on TESTNET (Base Sepolia). Mainnet custody of real funds
// via an in-page key requires a security review first — keep this on testnet
// until that's done.
(function () {
  const MODE = window.ATOMIC_PASSKEY_MODE === 'mainnet' ? 'mainnet' : 'testnet';
  const PRF_SALT = new TextEncoder().encode('atomic-evm-wallet-v1');
  const ETHERS_URL = 'https://esm.sh/ethers@6.13.4';
  const LS_KEY = 'atomic_passkey_wallets';
  const LS_LAST = 'atomic_passkey_last_email';

  const CHAINS = MODE === 'mainnet' ? {
    1:     { name: 'Ethereum',  rpc: 'https://eth.llamarpc.com',          explorer: 'https://etherscan.io' },
    8453:  { name: 'Base',      rpc: 'https://mainnet.base.org',          explorer: 'https://basescan.org' },
    42161: { name: 'Arbitrum',  rpc: 'https://arb1.arbitrum.io/rpc',      explorer: 'https://arbiscan.io' },
    10:    { name: 'Optimism',  rpc: 'https://mainnet.optimism.io',       explorer: 'https://optimistic.etherscan.io' },
    137:   { name: 'Polygon',   rpc: 'https://polygon-rpc.com',           explorer: 'https://polygonscan.com' },
    56:    { name: 'BNB Chain', rpc: 'https://bsc-dataseed.binance.org',  explorer: 'https://bscscan.com' },
    43114: { name: 'Avalanche', rpc: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io' }
  } : {
    84532: { name: 'Base Sepolia', rpc: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org' }
  };
  const DEFAULT_CHAIN = MODE === 'mainnet' ? 1 : 84532;

  let ethersMod = null;
  async function ethers() { if (!ethersMod) ethersMod = (await import(ETHERS_URL)).ethers; return ethersMod; }

  // Pin the WebAuthn RP ID to the registrable domain so the SAME wallet is
  // derived from apex + www (and any subdomain). Using location.hostname would
  // make www.atomicpay.cloud and atomicpay.cloud derive DIFFERENT keys. Falls
  // back to the raw hostname for localhost/dev.
  function walletRpId() {
    const h = location.hostname;
    return (h === 'atomicpay.cloud' || h.endsWith('.atomicpay.cloud')) ? 'atomicpay.cloud' : h;
  }

  const b64url = {
    enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
  };
  const local = {
    all: () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } },
    get: (email) => local.all()[email.toLowerCase()] || null,
    set: (email, rec) => { const a = local.all(); a[email.toLowerCase()] = rec; localStorage.setItem(LS_KEY, JSON.stringify(a)); localStorage.setItem(LS_LAST, email.toLowerCase()); },
    lastEmail: () => localStorage.getItem(LS_LAST) || ''
  };

  async function capabilities() {
    const webauthn = !!(window.PublicKeyCredential && navigator.credentials);
    let platform = false;
    try { platform = webauthn && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch {}
    return { webauthn, platform, mode: MODE };
  }

  // Find an existing wallet for an email: server first (cross-device), then local.
  async function lookup(email) {
    email = (email || '').trim().toLowerCase();
    if (!email) return { exists: false };
    try {
      const r = await fetch(`/v1/passkey/lookup?email=${encodeURIComponent(email)}`, { headers: { accept: 'application/json' } });
      if (r.ok) { const d = await r.json(); if (d.exists) return d; }
    } catch {}
    const l = local.get(email);
    return l ? { exists: true, credentialId: l.credentialId, address: l.address, chainMode: MODE, local: true } : { exists: false };
  }

  const rand = (n = 32) => crypto.getRandomValues(new Uint8Array(n));

  // Create a new passkey, or unlock an existing one, and derive the EOA.
  async function createOrUnlock({ email, create, credentialId, expectedAddress }) {
    email = (email || '').trim();
    if (!email) throw new Error('Email is required.');
    const E = await ethers();
    const rpId = walletRpId();
    let credId;
    let expectAddr = expectedAddress || null;

    if (create) {
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: rand(), rp: { name: 'Atomic', id: rpId },
        user: { id: rand(16), name: email, displayName: email },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        timeout: 60000, attestation: 'none', extensions: { prf: {} }
      }});
      credId = new Uint8Array(cred.rawId);
    } else {
      if (!credentialId || !expectAddr) { const found = await lookup(email); credentialId = credentialId || found.credentialId; expectAddr = expectAddr || found.address; }
      if (!credentialId) throw new Error('No wallet found for this email.');
      credId = b64url.dec(credentialId);
    }

    const assertion = await navigator.credentials.get({ publicKey: {
      challenge: rand(), rpId, allowCredentials: [{ id: credId, type: 'public-key' }],
      userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: PRF_SALT } } }
    }});
    const prf = assertion.getClientExtensionResults()?.prf?.results?.first;
    if (!prf) throw new Error('Your device/browser does not support the WebAuthn PRF extension (need Chrome/Safari + a platform passkey).');

    const pk = E.keccak256(new Uint8Array(prf));
    const baseWallet = new E.Wallet(pk); // unconnected; provider set per active chain
    const credentialIdB64 = b64url.enc(credId);
    const address = baseWallet.address;

    // On unlock, the derived address MUST match the known wallet — otherwise a
    // credential/PRF anomaly would silently hand the user a different (empty)
    // wallet and they could send funds from/to the wrong one. Fail loudly.
    if (!create && expectAddr && address.toLowerCase() !== expectAddr.toLowerCase()) {
      throw new Error(`Unlock produced an unexpected wallet address (${address.slice(0, 8)}…, expected ${expectAddr.slice(0, 8)}…). Aborting to protect funds — try again, or contact support.`);
    }

    local.set(email, { credentialId: credentialIdB64, address });
    // Best-effort server sync for cross-device unlock (never blocks the wallet).
    try {
      await fetch('/v1/passkey/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, credentialId: credentialIdB64, address, chainMode: MODE }) });
    } catch {}

    return { address, credentialId: credentialIdB64, provider: makeProvider(E, baseWallet) };
  }

  // Multi-chain EIP-1193 provider over the ethers wallet.
  function makeProvider(E, baseWallet) {
    let activeChain = DEFAULT_CHAIN;
    const providers = {};
    const rpcProvider = (id) => (providers[id] ||= new E.JsonRpcProvider(CHAINS[id].rpc, id));
    const signer = () => baseWallet.connect(rpcProvider(activeChain));
    const hex = (n) => '0x' + Number(n).toString(16);

    return {
      isAtomic: true, isPasskey: true,
      get chainId() { return hex(activeChain); },
      async request({ method, params = [] }) {
        switch (method) {
          case 'eth_requestAccounts': case 'eth_accounts': return [baseWallet.address];
          case 'eth_chainId': return hex(activeChain);
          case 'net_version': return String(activeChain);
          case 'wallet_switchEthereumChain': {
            const want = parseInt(params[0]?.chainId, 16);
            if (!CHAINS[want]) { const e = new Error(`Chain ${want} not supported by the Atomic wallet (${MODE}).`); e.code = 4902; throw e; }
            activeChain = want; return null;
          }
          case 'wallet_addEthereumChain': return null; // chains are fixed/curated
          case 'personal_sign': return await signer().signMessage(E.getBytes(params[0]));
          case 'eth_signTypedData_v4': {
            const d = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
            const { EIP712Domain, ...types } = d.types; return await signer().signTypedData(d.domain, types, d.message);
          }
          case 'eth_sendTransaction': {
            const p = params[0];
            const tx = await signer().sendTransaction({
              to: p.to, data: p.data, value: p.value ?? 0n,
              ...(p.gas ? { gasLimit: p.gas } : {})
            });
            return tx.hash;
          }
          default: return await rpcProvider(activeChain).send(method, params); // reads
        }
      },
      on() {}, removeListener() {} // no events needed for the swap flow
    };
  }

  window.atomicPasskey = { mode: MODE, chains: CHAINS, defaultChain: DEFAULT_CHAIN, capabilities, lookup, createOrUnlock, lastEmail: local.lastEmail };
})();

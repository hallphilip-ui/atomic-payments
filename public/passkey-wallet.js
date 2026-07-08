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
  const LS_KEY = 'atomic_passkey_wallets';
  const LS_LAST = 'atomic_passkey_last_email';

  const CHAINS = MODE === 'mainnet' ? {
    1:     { name: 'Ethereum',  symbol: 'ETH',  rpc: 'https://eth.llamarpc.com',          explorer: 'https://etherscan.io' },
    8453:  { name: 'Base',      symbol: 'ETH',  rpc: 'https://mainnet.base.org',          explorer: 'https://basescan.org' },
    42161: { name: 'Arbitrum',  symbol: 'ETH',  rpc: 'https://arb1.arbitrum.io/rpc',      explorer: 'https://arbiscan.io' },
    10:    { name: 'Optimism',  symbol: 'ETH',  rpc: 'https://mainnet.optimism.io',       explorer: 'https://optimistic.etherscan.io' },
    137:   { name: 'Polygon',   symbol: 'POL',  rpc: 'https://polygon-rpc.com',           explorer: 'https://polygonscan.com' },
    56:    { name: 'BNB Chain', symbol: 'BNB',  rpc: 'https://bsc-dataseed.binance.org',  explorer: 'https://bscscan.com' },
    43114: { name: 'Avalanche', symbol: 'AVAX', rpc: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io' }
  } : {
    84532: { name: 'Base Sepolia', symbol: 'ETH', rpc: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org' }
  };
  const DEFAULT_CHAIN = MODE === 'mainnet' ? 1 : 84532;

  // H2: ethers is served from OUR origin and pinned with an SRI integrity hash
  // (see the <script integrity="sha384-..."> tag). Never load key-touching code
  // from a public CDN — a compromised CDN would mean stolen private keys. If the
  // integrity check fails the browser refuses to run it and window.ethers is absent.
  async function ethers() {
    if (!window.ethers) throw new Error('Atomic wallet could not load its crypto library (integrity check may have failed). Reload the page — do not enter your passkey.');
    return window.ethers;
  }

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

    // Derive the address, then DISCARD the key immediately. The provider
    // re-derives it per signature behind a fresh Touch ID (H1) — the private key
    // is never retained between operations, so injected code can't sign silently.
    const address = new E.Wallet(E.keccak256(new Uint8Array(prf))).address;
    const credentialIdB64 = b64url.enc(credId);

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

    return { address, credentialId: credentialIdB64, provider: makeProvider(E, { credentialId: credentialIdB64, rpId, address }) };
  }

  const short = (a) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '—');
  function decodeMessage(E, msg) {
    try { if (typeof msg === 'string' && msg.startsWith('0x')) return E.toUtf8String(msg); } catch {}
    return typeof msg === 'string' ? msg : '(binary message)';
  }

  // Confirmation sheet. The Approve button performs the signing inside the click
  // gesture (WebAuthn requires user activation). Resolves with the signature /
  // tx hash, or rejects (code 4001) if the user cancels.
  function showSignModal(details, doSign) {
    return new Promise((resolve, reject) => {
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const rows = details.rows.map(([k, v]) =>
        `<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #eef0f4;font-size:13.5px;"><span style="color:#667085">${esc(k)}</span><span style="color:#14161c;font-weight:500;text-align:right;word-break:break-word;max-width:70%">${esc(v)}</span></div>`).join('');
      const wrap = document.createElement('div');
      wrap.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(10,12,20,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);font-family:Inter,system-ui,-apple-system,sans-serif;');
      wrap.innerHTML = `<div role="dialog" aria-modal="true" style="background:#fff;color:#14161c;width:min(400px,92vw);border-radius:16px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.35);">
        <div style="font-size:16px;font-weight:700;margin-bottom:3px;">🔒 ${esc(details.title)}</div>
        <p style="font-size:12.5px;color:#667085;margin:0 0 14px;">Review the details — signing requires your device passkey.</p>
        <div style="margin-bottom:16px;">${rows}</div>
        <div data-status style="font-size:12.5px;min-height:16px;margin-bottom:10px;color:#667085;"></div>
        <div style="display:flex;gap:10px;">
          <button data-cancel style="flex:1;height:44px;border:1px solid #e8e9f0;background:#fff;color:#14161c;border-radius:11px;font-weight:600;font-size:14px;cursor:pointer;">Cancel</button>
          <button data-approve style="flex:2;height:44px;border:none;background:#6d5cf5;color:#fff;border-radius:11px;font-weight:600;font-size:14px;cursor:pointer;">${esc(details.action)}</button>
        </div></div>`;
      document.body.appendChild(wrap);
      const cleanup = () => wrap.remove();
      const status = wrap.querySelector('[data-status]');
      wrap.querySelector('[data-cancel]').onclick = () => { cleanup(); reject(Object.assign(new Error('You cancelled the request.'), { code: 4001 })); };
      const approve = wrap.querySelector('[data-approve]');
      approve.onclick = async () => {
        approve.disabled = true; status.style.color = '#667085'; status.textContent = 'Waiting for Face ID / Touch ID…';
        try { const r = await doSign(); cleanup(); resolve(r); }
        catch (e) { approve.disabled = false; status.style.color = '#e5484d'; status.textContent = (e && e.message) || 'Failed — try again.'; }
      };
    });
  }

  // Multi-chain EIP-1193 provider. H1: the key is NOT retained — every signature
  // triggers a fresh Touch ID (WebAuthn PRF) behind the confirm sheet, re-derives
  // the key, uses it once, and discards it.
  function makeProvider(E, ctx) {
    let activeChain = DEFAULT_CHAIN;
    const providers = {};
    const rpcProvider = (id) => (providers[id] ||= new E.JsonRpcProvider(CHAINS[id].rpc, id));
    const hex = (n) => '0x' + Number(n).toString(16);

    // Fresh Touch ID -> re-derive key -> run op(wallet) -> discard key.
    async function withFreshKey(op) {
      const assertion = await navigator.credentials.get({ publicKey: {
        challenge: rand(), rpId: ctx.rpId, allowCredentials: [{ id: b64url.dec(ctx.credentialId), type: 'public-key' }],
        userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: PRF_SALT } } }
      }});
      const prf = assertion.getClientExtensionResults()?.prf?.results?.first;
      if (!prf) throw new Error('Passkey signature failed — no PRF output.');
      let wallet = new E.Wallet(E.keccak256(new Uint8Array(prf)));
      if (wallet.address.toLowerCase() !== ctx.address.toLowerCase()) { wallet = null; throw new Error('Passkey produced an unexpected key — signature aborted.'); }
      try { return await op(wallet); } finally { wallet = null; }
    }

    return {
      isAtomic: true, isPasskey: true,
      get chainId() { return hex(activeChain); },
      async request({ method, params = [] }) {
        switch (method) {
          case 'eth_requestAccounts': case 'eth_accounts': return [ctx.address];
          case 'eth_chainId': return hex(activeChain);
          case 'net_version': return String(activeChain);
          case 'wallet_switchEthereumChain': {
            const want = parseInt(params[0]?.chainId, 16);
            if (!CHAINS[want]) { const e = new Error(`Chain ${want} not supported by the Atomic wallet (${MODE}).`); e.code = 4902; throw e; }
            activeChain = want; return null;
          }
          case 'wallet_addEthereumChain': return null; // chains are fixed/curated
          case 'personal_sign':
            return await showSignModal(
              { title: 'Signature request', action: 'Sign with Face ID / Touch ID', rows: [['Network', CHAINS[activeChain].name], ['Message', decodeMessage(E, params[0])]] },
              () => withFreshKey((w) => w.signMessage(E.getBytes(params[0]))));
          case 'eth_signTypedData_v4': {
            const d = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
            const { EIP712Domain, ...types } = d.types;
            return await showSignModal(
              { title: 'Signature request', action: 'Sign with Face ID / Touch ID', rows: [['Network', CHAINS[activeChain].name], ['Type', d.primaryType || 'Typed data'], ['Contract', short(d.domain && d.domain.verifyingContract)]] },
              () => withFreshKey((w) => w.signTypedData(d.domain, types, d.message)));
          }
          case 'eth_sendTransaction': {
            const p = params[0];
            const c = CHAINS[activeChain];
            const amt = p.value ? E.formatEther(BigInt(p.value)) : '0';
            return await showSignModal(
              { title: 'Confirm transaction', action: 'Approve with Face ID / Touch ID',
                rows: [['Network', c.name], ['To', short(p.to)], ['Amount', `${amt} ${c.symbol}`]].concat(p.data && p.data !== '0x' ? [['Details', 'contract interaction']] : []) },
              () => withFreshKey(async (w) => {
                const tx = await w.connect(rpcProvider(activeChain)).sendTransaction({ to: p.to, data: p.data, value: p.value ?? 0n, ...(p.gas ? { gasLimit: p.gas } : {}) });
                return tx.hash;
              }));
          }
          default: return await rpcProvider(activeChain).send(method, params); // reads
        }
      },
      on() {}, removeListener() {} // no events needed for the swap flow
    };
  }

  window.atomicPasskey = { mode: MODE, chains: CHAINS, defaultChain: DEFAULT_CHAIN, capabilities, lookup, createOrUnlock, lastEmail: local.lastEmail };
})();

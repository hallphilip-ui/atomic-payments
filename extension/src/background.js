// MV3 service worker. Routes EIP-1193 requests coming from page providers:
//  - READ methods  -> Atomic's RPC proxy (POST /v1/rpc/:chainId). No keys involved.
//  - ACCOUNT/SIGN  -> escorted to the popup, where an atomicpay.cloud signer iframe
//                     performs the passkey (Face ID) signature in the correct origin.
// The worker is ephemeral (MV3) so it holds no long-lived secrets — session/account
// state lives in chrome.storage and the wallet identity lives on atomicpay.cloud.
const ATOMIC_ORIGIN = 'https://atomicpay.cloud';
const DEFAULT_CHAIN = 8453; // Base

// Methods safe to answer straight from the RPC proxy (no wallet interaction).
const READ_METHODS = new Set([
  'eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
  'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_getTransactionCount', 'eth_getBlockByNumber',
  'eth_getBlockByHash', 'eth_getLogs', 'eth_feeHistory', 'eth_maxPriorityFeePerGas',
  'net_version', 'web3_clientVersion'
]);
// Methods that require the wallet / user approval (escorted to the popup).
const SIGN_METHODS = new Set([
  'eth_requestAccounts', 'eth_accounts', 'personal_sign', 'eth_sign',
  'eth_signTypedData', 'eth_signTypedData_v4', 'eth_sendTransaction',
  'wallet_switchEthereumChain', 'wallet_addEthereumChain'
]);

async function currentChainId() {
  const { chainId } = await chrome.storage.session.get('chainId');
  return chainId || DEFAULT_CHAIN;
}

async function proxyRead(method, params) {
  const chainId = method === 'eth_chainId' ? await currentChainId() : await currentChainId();
  if (method === 'eth_chainId') return '0x' + Number(chainId).toString(16);
  const r = await fetch(`${ATOMIC_ORIGIN}/v1/rpc/${chainId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });
  if (!r.ok) throw new Error(`RPC proxy HTTP ${r.status}`);
  const body = await r.json();
  if (body.error) throw new Error(body.error.message || 'RPC error');
  return body.result;
}

// Park a signing/approval request for the popup and open it. The popup hosts the
// atomicpay.cloud signer iframe that actually authorizes it (passkey), then writes
// the result back — see popup.js. (Signer bridge page on the web app is the next
// milestone; until then the popup surfaces the request for approval.)
async function escortToPopup(method, params, origin) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const req = { id, method, params, origin, ts: Date.now(), status: 'pending' };
  const { pendingRequests = [] } = await chrome.storage.session.get('pendingRequests');
  pendingRequests.push(req);
  await chrome.storage.session.set({ pendingRequests });
  try { await chrome.action.openPopup(); } catch (_) { /* user can click the toolbar icon */ }
  // Wait for the popup to resolve this request.
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Approval timed out')); }, 180000);
    function onChange(changes, area) {
      if (area !== 'session' || !changes.resolvedRequests) return;
      const hit = (changes.resolvedRequests.newValue || []).find((r) => r.id === id);
      if (!hit) return;
      cleanup();
      if (hit.error) reject(new Error(hit.error));
      else resolve(hit.result);
    }
    function cleanup() { clearTimeout(timer); chrome.storage.onChanged.removeListener(onChange); }
    chrome.storage.onChanged.addListener(onChange);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'rpc') return;
  (async () => {
    try {
      let result;
      if (READ_METHODS.has(msg.method)) result = await proxyRead(msg.method, msg.params);
      else if (SIGN_METHODS.has(msg.method)) result = await escortToPopup(msg.method, msg.params, msg.origin);
      else result = await proxyRead(msg.method, msg.params); // best-effort passthrough
      sendResponse({ result });
    } catch (e) {
      sendResponse({ error: { code: -32603, message: e.message || String(e) } });
    }
  })();
  return true; // async response
});

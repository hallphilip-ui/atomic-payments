// Popup controller. Forwards signing requests (parked by the background worker) to
// the VISIBLE atomicpay.cloud bridge iframe, which runs the passkey confirm sheet +
// Face ID, then relays the result back to the background worker via chrome.storage.
const BRIDGE_ORIGIN = 'https://atomicpay.cloud';
const $ = (id) => document.getElementById(id);
const bridge = $('signer');
let bridgeReady = false;
const forwarded = new Set();

function switchTo(view) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $('homeView').style.display = view === 'home' ? 'block' : 'none';
  $('reqView').style.display = view === 'req' ? 'block' : 'none';
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTo(t.dataset.view)));

// Open the full swap console in a new tab (not an iframe) so the funds page keeps
// its strict anti-clickjacking headers. Then close the popup.
$('openSwap').addEventListener('click', () => {
  chrome.tabs.create({ url: BRIDGE_ORIGIN + '/defi-swap' });
  window.close();
});

async function refreshBadge() {
  const { pendingRequests = [] } = await chrome.storage.session.get('pendingRequests');
  const n = pendingRequests.filter((r) => r.status === 'pending').length;
  const b = $('reqBadge'); b.textContent = n; b.classList.toggle('show', n > 0);
}

async function forwardPending() {
  await refreshBadge();
  if (!bridgeReady) return;
  const { pendingRequests = [] } = await chrome.storage.session.get('pendingRequests');
  const open = pendingRequests.filter((r) => r.status === 'pending' && !forwarded.has(r.id));
  if (open.length) switchTo('req');
  for (const r of open) {
    forwarded.add(r.id);
    try { bridge.contentWindow.postMessage({ channel: 'atomic:signer:req', id: r.id, method: r.method, params: r.params }, BRIDGE_ORIGIN); } catch (_) {}
  }
}

window.addEventListener('message', async (e) => {
  if (e.origin !== BRIDGE_ORIGIN || !e.data) return;
  if (e.data.channel === 'atomic:signer:ready') {
    bridgeReady = true;
    if (!e.data.configured) { $('warn').style.display = 'block'; switchTo('req'); }
    forwardPending();
  } else if (e.data.channel === 'atomic:signer:res') {
    const store = await chrome.storage.session.get(['pendingRequests', 'resolvedRequests']);
    const pendingRequests = (store.pendingRequests || []).map((r) => r.id === e.data.id ? { ...r, status: 'done' } : r);
    const resolvedRequests = (store.resolvedRequests || []).concat([{ id: e.data.id, result: e.data.result, error: e.data.error }]);
    await chrome.storage.session.set({ pendingRequests, resolvedRequests });
    refreshBadge();
  }
});

chrome.storage.onChanged.addListener((c, area) => { if (area === 'session' && c.pendingRequests) forwardPending(); });
refreshBadge();

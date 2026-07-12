// Runs in the isolated content-script world. Two jobs:
//  1. Inject inpage.js into the page's MAIN world (so the provider lives on the
//     page, but this relay keeps chrome.* privileges out of the page).
//  2. Bridge messages: page (inpage) <-> background service worker.
(function () {
  const CHANNEL_REQ = 'atomic:pay:req';
  const CHANNEL_RES = 'atomic:pay:res';
  const CHANNEL_EVT = 'atomic:pay:evt';

  // 1. Inject the provider script.
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/inpage.js');
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
  } catch (e) { /* CSP may block on some sites; provider simply won't appear there */ }

  // 2a. inpage -> background
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.channel !== CHANNEL_REQ) return;
    const { id, method, params } = e.data;
    chrome.runtime.sendMessage({ type: 'rpc', method, params, origin: location.origin }, (res) => {
      const err = chrome.runtime.lastError;
      window.postMessage({
        channel: CHANNEL_RES, id, method,
        result: res && res.result,
        error: err ? { code: -32603, message: err.message } : (res && res.error)
      }, '*');
    });
  });

  // 2b. background -> inpage (wallet events: chainChanged / accountsChanged)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'event') {
      window.postMessage({ channel: CHANNEL_EVT, event: msg.event, payload: msg.payload }, '*');
    }
  });
})();

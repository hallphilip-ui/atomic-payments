// Floating "← Home" button injected site-wide (via the same middleware as consent.js).
// Self-contained, defensive: skips embedded iframes (checkout/wallet-bridge) and the
// home page itself, and never throws into the page.
(function () {
  try {
    if (window.top !== window.self) return;                 // embedded/iframe -> skip
    var p = location.pathname;
    if (p === '' || p === '/' || p === '/index.html') return; // already home

    function mount() {
      if (document.getElementById('atomic-homenav')) return;
      var a = document.createElement('a');
      a.id = 'atomic-homenav';
      a.href = '/';
      a.textContent = '← Home';
      a.setAttribute('aria-label', 'Back to home');
      a.style.cssText = [
        'position:fixed', 'left:12px', 'bottom:12px', 'z-index:2147483000',
        'background:#fff', 'border:1px solid #e8e9f0', 'border-radius:999px',
        'padding:8px 14px', 'font:600 13px/1 Inter,system-ui,-apple-system,sans-serif',
        'color:#6d5cf5', 'text-decoration:none', 'box-shadow:0 2px 10px rgba(16,18,30,.14)'
      ].join(';');
      (document.body || document.documentElement).appendChild(a);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  } catch (e) { /* never break the page */ }
})();

// PWA installer: registers the service worker and offers an "Install app" affordance.
//
// Android/Chrome fires `beforeinstallprompt`, so we can show a real install button.
// iOS/Safari has no such event — the user must use Share -> "Add to Home Screen" —
// so on iOS we show a one-time hint instead. Both are dismissible and never block.
//
// Safe by construction: does nothing inside an iframe (the checkout is embeddable),
// nothing when already installed, and never throws into the page.
(function () {
  try {
    if (window.top !== window.self) return;                     // embedded (checkout iframe)
    var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    // ---- service worker (see sw.js — it caches no code, by design) ----
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () { /* non-fatal */ });
      });
    }

    if (standalone) return;                                      // already installed — nothing to offer

    var DISMISS_KEY = 'atomic.pwa.dismissed';
    try { if (localStorage.getItem(DISMISS_KEY)) return; } catch (e) {}

    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    var deferred = null;

    function bar(html) {
      var el = document.createElement('div');
      el.setAttribute('role', 'dialog');
      el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;display:flex;' +
        'align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:#161923;color:#e9ebf2;' +
        'box-shadow:0 10px 34px rgba(0,0,0,.32);font:500 13.5px/1.45 Inter,system-ui,-apple-system,sans-serif;';
      el.innerHTML = html;
      document.body.appendChild(el);
      el.querySelector('[data-x]').addEventListener('click', function () {
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
        el.remove();
      });
      return el;
    }

    var ICON = '<img src="/assets/pwa/icon-192.png" alt="" style="width:34px;height:34px;border-radius:8px;flex:0 0 auto" onerror="this.style.display=\'none\'">';
    var X = '<button data-x aria-label="Dismiss" style="flex:0 0 auto;background:none;border:none;color:#8b98a9;font-size:18px;cursor:pointer;padding:2px 6px">×</button>';

    // ---- Android / Chrome: real install prompt ----
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      var el = bar(ICON +
        '<div style="flex:1">Install Atomic for a faster, full-screen app.</div>' +
        '<button data-go style="flex:0 0 auto;background:#6d5cf5;color:#fff;border:none;border-radius:9px;padding:9px 14px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer">Install</button>' + X);
      el.querySelector('[data-go]').addEventListener('click', function () {
        el.remove();
        if (!deferred) return;
        deferred.prompt();
        deferred.userChoice.finally(function () { deferred = null; });
      });
    });

    // ---- iOS: no prompt API — tell them where the button is ----
    if (isIOS && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)) {
      window.addEventListener('load', function () {
        setTimeout(function () {
          bar(ICON + '<div style="flex:1">Install Atomic: tap <b>Share</b> <span aria-hidden="true">􀈂</span> then <b>Add to Home Screen</b>.</div>' + X);
        }, 2500);
      });
    }
  } catch (e) { /* never break the page */ }
})();

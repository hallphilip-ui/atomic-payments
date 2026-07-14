// PWA installer: registers the service worker, exposes an install API, and offers a
// dismissible auto-banner.
//
// Android/Chrome fires `beforeinstallprompt`, so we can trigger a real install dialog.
// iOS/Safari has no such API — the user must use Share -> "Add to Home Screen" — so
// there we show instructions instead.
//
// IMPORTANT: `window.atomicPWA` is always defined (outside an iframe), even when the
// auto-banner is suppressed. Dismissing the banner must not disable the explicit
// "Install app" button in the merchant portal.
//
// Safe by construction: inert inside an iframe (the checkout is embeddable) and never
// throws into the page.
(function () {
  try {
    if (window.top !== window.self) return;                      // embedded (checkout iframe)

    var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    var deferred = null;

    // ---- service worker (see sw.js — it caches no code, by design) ----
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () { /* non-fatal */ });
      });
    }

    // A modal for platforms with no install API (iOS, and desktops that don't fire
    // beforeinstallprompt) — we can't install for them, so show them exactly how.
    function howTo(title, steps) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483001;background:rgba(10,12,18,.55);display:flex;align-items:center;justify-content:center;padding:20px;';
      wrap.innerHTML =
        '<div style="max-width:380px;width:100%;background:#fff;color:#14161c;border-radius:16px;padding:24px;' +
        'font:400 14.5px/1.55 Inter,system-ui,-apple-system,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
        '<div style="font-weight:800;font-size:16px;margin-bottom:10px">' + title + '</div>' +
        '<ol style="margin:0 0 18px;padding-left:20px;color:#475467">' + steps + '</ol>' +
        '<button data-close style="width:100%;background:#6d5cf5;color:#fff;border:none;border-radius:10px;' +
        'padding:11px;font:700 14px Inter,system-ui,sans-serif;cursor:pointer">Got it</button></div>';
      document.body.appendChild(wrap);
      var close = function () { wrap.remove(); };
      wrap.querySelector('[data-close]').addEventListener('click', close);
      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    }

    // ---- public API: pages can render their own "Install app" button ----
    window.atomicPWA = {
      get canPrompt() { return !!deferred; },
      get isStandalone() { return standalone; },
      get isIOS() { return isIOS; },
      install: function () {
        if (deferred) {                                          // Android/Chrome: the real dialog
          deferred.prompt();
          return deferred.userChoice.finally(function () { deferred = null; });
        }
        if (isIOS) {
          howTo('Add Atomic to your Home Screen',
            '<li>Tap the <b>Share</b> button in Safari&rsquo;s toolbar.</li>' +
            '<li>Scroll down and tap <b>Add to Home Screen</b>.</li>' +
            '<li>Tap <b>Add</b>. Atomic opens full-screen, like an app.</li>');
        } else {
          howTo('Install Atomic',
            '<li>Open this page in <b>Chrome</b>, <b>Edge</b> or <b>Safari</b> on your phone.</li>' +
            '<li>Use the browser menu and choose <b>Install app</b> (or <b>Add to Home Screen</b>).</li>');
        }
        return Promise.resolve();
      }
    };

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      window.dispatchEvent(new CustomEvent('atomic-pwa-available'));
      maybeBanner();
    });
    window.addEventListener('appinstalled', function () {
      deferred = null;
      standalone = true;
      window.dispatchEvent(new CustomEvent('atomic-pwa-installed'));
    });

    // ---- auto-banner (suppressed when installed or dismissed — the API above is NOT) ----
    var DISMISS_KEY = 'atomic.pwa.dismissed';
    function suppressed() {
      if (standalone) return true;
      try { return !!localStorage.getItem(DISMISS_KEY); } catch (e) { return false; }
    }
    var shown = false;

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

    function maybeBanner() {
      if (shown || suppressed() || !deferred) return;
      shown = true;
      var el = bar(ICON +
        '<div style="flex:1">Install Atomic for a faster, full-screen app.</div>' +
        '<button data-go style="flex:0 0 auto;background:#6d5cf5;color:#fff;border:none;border-radius:9px;padding:9px 14px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer">Install</button>' + X);
      el.querySelector('[data-go]').addEventListener('click', function () { el.remove(); window.atomicPWA.install(); });
    }

    // iOS gets a hint banner instead (no install event will ever fire there).
    if (isIOS && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)) {
      window.addEventListener('load', function () {
        setTimeout(function () {
          if (shown || suppressed()) return;
          shown = true;
          bar(ICON + '<div style="flex:1">Install Atomic: tap <b>Share</b> then <b>Add to Home Screen</b>.</div>' + X);
        }, 2500);
      });
    }
  } catch (e) { /* never break the page */ }
})();

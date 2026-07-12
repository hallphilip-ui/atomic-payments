// Atomic Pay browser-extension install prompt.
//  - Detects the browser and shows the right "Add to <Browser>" CTA.
//  - Dismissible banner with a "Don't show this again" checkbox → first-party
//    functional cookie (no tracking, no consent needed).
//  - window.atomicExtCTA.open() lets the Settings menu re-open the install flow
//    any time, even after the banner was permanently dismissed.
//
// Store URLs are filled in AFTER the extension is published. Until a URL exists for
// the visitor's browser, the auto-banner stays hidden (we don't promote a dead
// link); the Settings entry still opens a "coming soon" panel. Flip on by pasting
// the listing URLs below (or via window.ATOMIC_EXT_STORES before this script loads).
(function () {
  'use strict';

  var STORES = Object.assign({
    chrome: '',   // e.g. https://chromewebstore.google.com/detail/<id>
    edge: '',     // e.g. https://microsoftedge.microsoft.com/addons/detail/<id>
    firefox: '',  // e.g. https://addons.mozilla.org/firefox/addon/<slug>/
    safari: ''    // e.g. https://apps.apple.com/app/<id>
  }, window.ATOMIC_EXT_STORES || {});

  var COOKIE = 'atomic_ext_cta_dismissed';
  var SESSION_HIDE = 'atomic_ext_cta_hidden';

  function setCookie(name, val, days) {
    var d = new Date(); d.setTime(d.getTime() + days * 864e5);
    document.cookie = name + '=' + encodeURIComponent(val) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }
  function getCookie(name) {
    return document.cookie.split('; ').reduce(function (r, c) {
      var i = c.indexOf('='); var k = c.slice(0, i);
      return k === name ? decodeURIComponent(c.slice(i + 1)) : r;
    }, '');
  }

  function detectBrowser() {
    var ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\//.test(ua) || /\bOPT\//.test(ua)) return 'opera';
    if (/Firefox\//.test(ua) || /FxiOS/.test(ua)) return 'firefox';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua) && !/CriOS/.test(ua)) return 'safari';
    if (/Chrome\//.test(ua) || /Chromium\//.test(ua) || /CriOS/.test(ua)) return 'chrome';
    return 'other';
  }

  var NAMES = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', opera: 'Opera', other: 'your browser' };
  function storeUrlFor(b) {
    if (b === 'edge') return STORES.edge || STORES.chrome;   // Edge installs from the Chrome store too
    if (b === 'opera') return STORES.chrome;                 // Chromium
    if (b === 'firefox') return STORES.firefox;
    if (b === 'safari') return STORES.safari;
    return STORES.chrome;
  }

  function isMobile() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent); }
  function alreadyInstalled() {
    try { return !!window.__atomicPayInjected || !!(window.ethereum && window.ethereum.isAtomicPay); } catch (_) { return false; }
  }

  var CSS = '' +
    '.axcta-banner{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9998;width:min(440px,calc(100vw - 24px));' +
    'background:#fff;border:1px solid #e8e9f0;border-radius:16px;box-shadow:0 12px 40px rgba(20,22,28,.16);padding:16px 16px 12px;font-family:Inter,system-ui,-apple-system,sans-serif;color:#14161c;}' +
    '.axcta-row{display:flex;gap:12px;align-items:flex-start;}' +
    '.axcta-ic{width:34px;height:27px;flex:0 0 auto;}' +
    '.axcta-t{font-weight:700;font-size:14.5px;margin:0;}' +
    '.axcta-s{color:#667085;font-size:12.5px;margin:3px 0 0;}' +
    '.axcta-x{margin-left:auto;background:none;border:none;color:#98a2b3;font-size:18px;cursor:pointer;line-height:1;padding:0 2px;}' +
    '.axcta-cta{display:inline-block;margin-top:12px;background:#6d5cf5;color:#fff;text-decoration:none;border:none;cursor:pointer;font-weight:700;font-size:13.5px;padding:9px 16px;border-radius:10px;font-family:inherit;}' +
    '.axcta-foot{display:flex;align-items:center;justify-content:space-between;margin-top:11px;padding-top:9px;border-top:1px solid #f0f1f6;}' +
    '.axcta-chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#667085;cursor:pointer;user-select:none;}' +
    '.axcta-note{font-size:12px;color:#98a2b3;margin-top:6px;}' +
    '@media (prefers-color-scheme: dark){.axcta-banner{background:#171922;border-color:#262a36;color:#e7e9f0;}.axcta-foot{border-color:#262a36;}}';

  function injectCss() {
    if (document.getElementById('axcta-css')) return;
    var s = document.createElement('style'); s.id = 'axcta-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  var LOGO = '<img src="/assets/atomic-mark.png" class="axcta-ic" alt="" onerror="this.style.display=\'none\'">';

  function ctaHtml(browser, showCheck) {
    var url = storeUrlFor(browser);
    var name = NAMES[browser] || 'your browser';
    var action = url
      ? '<a class="axcta-cta" href="' + url + '" target="_blank" rel="noopener">Add to ' + name + '</a>'
      : '<button class="axcta-cta" type="button" disabled style="opacity:.55;cursor:default;">Coming soon</button>' +
        '<div class="axcta-note">Launching soon on the ' + (browser === 'safari' ? 'App Store' : browser === 'firefox' ? 'Firefox Add-ons' : 'Chrome Web Store' + (browser === 'edge' ? ' (works in Edge)' : '')) + '.</div>';
    return '<div class="axcta-row">' + LOGO +
      '<div style="flex:1;min-width:0;"><p class="axcta-t">Get the Atomic Pay extension</p>' +
      '<p class="axcta-s">Swap on any site + your email wallet, one click from the toolbar.</p></div>' +
      (showCheck ? '<button class="axcta-x" type="button" data-axcta-close aria-label="Dismiss">&#10005;</button>' : '') +
      '</div>' + action +
      (showCheck ? '<div class="axcta-foot"><label class="axcta-chk"><input type="checkbox" data-axcta-never>Don’t show this again</label></div>' : '');
  }

  function removeBanner() { var b = document.getElementById('axcta-banner'); if (b) b.remove(); }

  function showBanner() {
    injectCss();
    if (document.getElementById('axcta-banner')) return;
    var browser = detectBrowser();
    var el = document.createElement('div');
    el.id = 'axcta-banner'; el.className = 'axcta-banner'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Install Atomic Pay extension');
    el.innerHTML = ctaHtml(browser, true);
    el.querySelector('[data-axcta-close]').addEventListener('click', function () {
      var never = el.querySelector('[data-axcta-never]');
      if (never && never.checked) setCookie(COOKIE, '1', 365);   // permanent
      else try { sessionStorage.setItem(SESSION_HIDE, '1'); } catch (_) {}  // this session only
      removeBanner();
    });
    document.body.appendChild(el);
  }

  // Modal-less: the Settings entry just (re)shows the banner without the dismiss
  // gating, so users can always grab it. Reuses the same CTA.
  function openFromSettings() {
    injectCss();
    removeBanner();
    var browser = detectBrowser();
    var el = document.createElement('div');
    el.id = 'axcta-banner'; el.className = 'axcta-banner';
    el.innerHTML = ctaHtml(browser, true);
    el.querySelector('[data-axcta-close]').addEventListener('click', removeBanner);
    var never = el.querySelector('[data-axcta-never]'); if (never) never.closest('.axcta-foot').style.display = 'none';
    document.body.appendChild(el);
  }

  function shouldAutoShow() {
    if (isMobile()) return false;                         // extensions are desktop-only
    if (alreadyInstalled()) return false;                 // don't nag if it's already here
    if (!storeUrlFor(detectBrowser())) return false;      // no listing yet → don't promote a dead link
    if (getCookie(COOKIE) === '1') return false;          // permanently dismissed
    try { if (sessionStorage.getItem(SESSION_HIDE) === '1') return false; } catch (_) {}
    return true;
  }

  window.atomicExtCTA = {
    open: openFromSettings,
    resetDismissal: function () { setCookie(COOKIE, '', -1); try { sessionStorage.removeItem(SESSION_HIDE); } catch (_) {} },
    detect: detectBrowser
  };

  function boot() { if (shouldAutoShow()) setTimeout(showBanner, 1200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

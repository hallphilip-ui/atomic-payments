// Atomic cookie-consent manager. Region-aware:
//   • EU / EEA / UK / CH  → OPT-IN: non-essential (analytics) cookies are blocked
//     until the user clicks Accept (GDPR / UK GDPR / ePrivacy).
//   • US                  → OPT-OUT: analytics on by default, with a clear
//     "Do Not Sell or Share My Personal Information" control (CCPA/CPRA).
//   • Rest of world       → NOTICE: informational acknowledgement.
// The choice is recorded (versioned + timestamped + region) in a strictly-necessary
// cookie. analytics.js gates PostHog and ga.js gates Google Analytics on
// AtomicConsent.ready(). Copy + region list
// are sensible defaults — have your privacy counsel confirm for your cookie set.
(function () {
  'use strict';

  if (window.AtomicConsent) return;                 // idempotent (injected + loaded by analytics.js)
  var embedded; try { embedded = window.self !== window.top; } catch (e) { embedded = true; }

  var COOKIE = 'atomic_consent';
  var VERSION = 1;
  var MAX_AGE_DAYS = 180;                 // re-prompt roughly twice a year
  var PRIVACY_URL = '/privacy';

  // ISO-3166 alpha-2. EU27 + EEA (IS/LI/NO) + UK + Switzerland → prior opt-in.
  var OPT_IN = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
    'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','GB','IS','LI','NO','CH'];
  var OPT_OUT = ['US'];                    // CCPA / CPRA opt-out

  function setCookie(n, v, days) {
    var d = new Date(); d.setTime(d.getTime() + days * 864e5);
    document.cookie = n + '=' + encodeURIComponent(v) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }
  function getCookie(n) {
    return document.cookie.split('; ').reduce(function (r, c) {
      var i = c.indexOf('='); return c.slice(0, i) === n ? decodeURIComponent(c.slice(i + 1)) : r;
    }, '');
  }
  function stored() { try { var c = JSON.parse(getCookie(COOKIE) || 'null'); return (c && c.v === VERSION) ? c : null; } catch (e) { return null; } }
  function fresh(c) { return c && (Date.now() - (c.ts || 0)) < MAX_AGE_DAYS * 864e5; }

  function modelFor(country) {
    if (!country) return 'optin';                       // unknown → most protective
    country = country.toUpperCase();
    if (OPT_IN.indexOf(country) >= 0) return 'optin';
    if (OPT_OUT.indexOf(country) >= 0) return 'optout';
    return 'notice';
  }
  function detectCountry() {
    return fetch('/v1/geo', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) { return (d && d.country) || ''; })
      .catch(function () { return ''; });
  }

  // ---- state / API ----
  var readyCbs = [], decided = false, state = null;
  function resolve(s) {
    state = s; decided = true; AtomicConsent._state = s;
    readyCbs.forEach(function (cb) { try { cb(s); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent('atomic:consent', { detail: s })); } catch (e) {}
  }
  function persist(s) { setCookie(COOKIE, JSON.stringify(s), MAX_AGE_DAYS); }

  var AtomicConsent = window.AtomicConsent = {
    _state: null,
    granted: function (cat) { var s = state || stored(); if (!s) return false; return cat === 'necessary' ? true : !!s[cat]; },
    ready: function (cb) { if (decided) cb(state); else readyCbs.push(cb); },
    onChange: function (cb) { window.addEventListener('atomic:consent', function (e) { cb(e.detail); }); },
    show: function () { detectCountry().then(function (ct) { render(modelFor(ct), ct); }); }
  };

  function finalize(model, country, analytics) {
    var s = { v: VERSION, ts: Date.now(), country: country || null, model: model, necessary: true, analytics: !!analytics };
    persist(s); resolve(s);
    var el = document.getElementById('axcon'); if (el) el.remove();
  }

  // ---- banner ----
  var CSS = '' +
    '#axcon{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#fff;border-top:1px solid #e8e9f0;box-shadow:0 -8px 30px rgba(20,22,28,.10);' +
    'font-family:Inter,system-ui,-apple-system,sans-serif;color:#14161c;padding:15px clamp(14px,4vw,32px);}' +
    '#axcon .in{max-width:1080px;margin:0 auto;display:flex;gap:16px;align-items:center;flex-wrap:wrap;}' +
    '#axcon .tx{flex:1;min-width:240px;font-size:13px;line-height:1.5;color:#475467;}' +
    '#axcon .tx b{color:#14161c;} #axcon a{color:#6d5cf5;text-decoration:underline;}' +
    '#axcon .btns{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}' +
    '#axcon button{font-family:inherit;font-weight:700;font-size:13px;border-radius:9px;padding:9px 15px;cursor:pointer;border:1px solid #e8e9f0;background:#fff;color:#14161c;}' +
    '#axcon button.pri{background:#6d5cf5;border-color:#6d5cf5;color:#fff;}' +
    '#axcon button.link{border:none;background:none;color:#6d5cf5;text-decoration:underline;padding:9px 4px;}' +
    '#axcon .manage{flex-basis:100%;margin-top:6px;display:none;border-top:1px solid #f0f1f6;padding-top:10px;}' +
    '#axcon .manage.open{display:block;}' +
    '#axcon .cat{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 0;font-size:13px;}' +
    '#axcon .cat small{color:#98a2b3;display:block;font-weight:400;font-size:12px;}' +
    '#axcon .badge{font-size:11px;color:#0a7d33;font-weight:700;}' +
    '@media (prefers-color-scheme:dark){#axcon{background:#12141b;border-color:#262a36;color:#e7e9f0;}#axcon .tx{color:#98a2b3;}#axcon button{background:#1b1e27;border-color:#2a2f3c;color:#e7e9f0;}#axcon button.pri{background:#6d5cf5;border-color:#6d5cf5;color:#fff;}#axcon .manage{border-color:#262a36;}}';

  function injectCss() { if (!document.getElementById('axcon-css')) { var s = document.createElement('style'); s.id = 'axcon-css'; s.textContent = CSS; document.head.appendChild(s); } }

  function render(model, country) {
    injectCss();
    var old = document.getElementById('axcon'); if (old) old.remove();
    var bar = document.createElement('div'); bar.id = 'axcon'; bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-label', 'Cookie consent'); bar.setAttribute('aria-live', 'polite');

    var priv = '<a href="' + PRIVACY_URL + '">Privacy &amp; Cookie Policy</a>';
    var html = '<div class="in">';
    if (model === 'optin') {
      html += '<div class="tx"><b>We value your privacy.</b> We use strictly necessary cookies to run Atomic and, only with your consent, analytics cookies to improve it. See our ' + priv + '.</div>' +
        '<div class="btns"><button class="link" data-act="manage">Manage</button><button data-act="reject">Reject non-essential</button><button class="pri" data-act="accept">Accept all</button></div>' +
        '<div class="manage"><div class="cat"><div>Strictly necessary<small>Required to run Atomic — always on.</small></div><span class="badge">Always on</span></div>' +
        '<div class="cat"><div>Analytics<small>Helps us understand and improve the product (PostHog, Google Analytics).</small></div><label><input type="checkbox" id="axcon-an"> Allow</label></div>' +
        '<div class="btns" style="justify-content:flex-end;"><button class="pri" data-act="save">Save choices</button></div></div>';
    } else if (model === 'optout') {
      html += '<div class="tx"><b>Your privacy choices.</b> We use cookies for analytics to improve Atomic. California residents can opt out of the sale/sharing of personal information. See our ' + priv + '.</div>' +
        '<div class="btns"><button data-act="optout">Do Not Sell or Share My Personal Information</button><button class="pri" data-act="ack-on">Got it</button></div>';
    } else {
      html += '<div class="tx"><b>Cookies.</b> We use cookies to run and improve Atomic. By continuing you agree to our use of cookies — see our ' + priv + '.</div>' +
        '<div class="btns"><button data-act="reject">Decline analytics</button><button class="pri" data-act="ack-on">Got it</button></div>';
    }
    html += '</div>';
    bar.innerHTML = html;

    bar.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'manage') { bar.querySelector('.manage').classList.toggle('open'); return; }
      if (act === 'accept' || act === 'ack-on') return finalize(model, country, true);
      if (act === 'reject' || act === 'optout') return finalize(model, country, false);
      if (act === 'save') { var on = bar.querySelector('#axcon-an'); return finalize(model, country, !!(on && on.checked)); }
    });
    document.body.appendChild(bar);
  }

  // ---- boot ----
  var prior = stored();
  if (fresh(prior)) {
    resolve(prior);                                     // already decided this period
  } else {
    detectCountry().then(function (country) {
      var model = modelFor(country);
      // Provisional decision so analytics can start where implied consent applies;
      // opt-in stays OFF until the user accepts.
      resolve({ v: VERSION, ts: Date.now(), country: country || null, model: model, necessary: true,
        analytics: model !== 'optin', pending: true });
      // Don't nag inside an iframe (checkout widget, wallet-bridge) — the top-level
      // document owns cookie consent. AtomicConsent.show() still works on demand.
      if (!embedded) render(model, country);
    });
  }
})();

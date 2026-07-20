// Google Analytics 4 for Atomic. PostHog stays the product-analytics system of
// record (funnels, session replay, error tracking); GA4 sits alongside it for
// acquisition reporting — channel/campaign attribution and Search Console
// integration, which PostHog doesn't cover.
//
// GA4 sets first-party cookies (_ga, _ga_<id>), so it is non-essential and is
// gated on the same AtomicConsent decision that gates PostHog: under opt-in
// regions (EU/EEA/UK/CH) nothing loads until the visitor accepts.
//
// The measurement ID is a PUBLIC client-side identifier — safe to ship, same as
// the PostHog project key. No-ops entirely until configured, so this file is
// safe to deploy before the GA property exists.
(function () {
  'use strict';

  var MEASUREMENT_ID = 'G-XXXXXXXXXX'; // ← paste the GA4 measurement ID here

  if (!MEASUREMENT_ID || MEASUREMENT_ID === 'G-XXXXXXXXXX') return;

  // Don't double-count inside embedded iframes (checkout, wallet-bridge) — the
  // top-level document owns the pageview.
  var embedded; try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
  if (embedded) return;

  var DISABLE_FLAG = 'ga-disable-' + MEASUREMENT_ID; // GA's own opt-out kill switch
  var started = false;

  function initGA() {
    window[DISABLE_FLAG] = false;
    if (started) return;
    started = true;

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', MEASUREMENT_ID, {
      anonymize_ip: true,        // truncate the IP before storage (EU expectation)
      allow_google_signals: false, // no cross-device ads/remarketing personalisation
      allow_ad_personalization_signals: false
    });

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(MEASUREMENT_ID);
    s.onerror = function () { console.warn('GA load failed'); };
    (document.head || document.documentElement).appendChild(s);
  }

  // Consent refused or withdrawn. The kill switch is read by gtag.js on every
  // hit, so this stops collection even if the tag already loaded.
  function stopGA() { window[DISABLE_FLAG] = true; }

  function gate() {
    if (!window.AtomicConsent) return;
    window.AtomicConsent.ready(function (s) { if (s && s.analytics) initGA(); else stopGA(); });
    window.AtomicConsent.onChange(function (s) { if (s && s.analytics) initGA(); else stopGA(); });
  }

  // consent.js is injected site-wide by the server, so avoid loading a SECOND
  // copy (duplicate evaluation is the class of bug behind stray "already
  // declared" errors). Wait for it if a tag is present; inject only as a last resort.
  if (window.AtomicConsent) { gate(); }
  else if (document.querySelector('script[src*="/assets/consent.js"]')) {
    var tries = 0, iv = setInterval(function () {
      if (window.AtomicConsent) { clearInterval(iv); gate(); }
      else if (++tries > 60) { clearInterval(iv); }
    }, 50);
  } else {
    var cs = document.createElement('script'); cs.src = '/assets/consent.js'; cs.onload = gate;
    (document.head || document.documentElement).appendChild(cs);
  }
})();

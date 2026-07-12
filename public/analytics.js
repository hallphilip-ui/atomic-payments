// Atomic analytics + support. PostHog gives product analytics and session replay
// (replay a user's session when they report an issue = fast support). The project
// key is a PUBLIC client-side identifier — safe to ship. No-ops until configured.
(function () {
  var POSTHOG_KEY = 'phc_kC3jJX868sdYAWGNRvgyYBCRDtQu3eXrc2TQSTYvLA49';
  var POSTHOG_HOST = 'https://us.i.posthog.com'; // EU: https://eu.i.posthog.com
  var SUPPORT_EMAIL = 'support@atomicpay.cloud';

  var phStarted = false;
  function initPostHog() {
    if (phStarted) return;
    if (!POSTHOG_KEY || POSTHOG_KEY === 'REPLACE_WITH_POSTHOG_KEY') return;
    phStarted = true;
    import('/assets/vendor/esm/posthog-js.mjs').then(function (mod) {
      var posthog = mod.default || mod.posthog;
      if (!posthog || !posthog.init) return;
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        capture_pageview: true,
        capture_pageleave: true,
        capture_exceptions: true, // auto-capture JS errors → PostHog "Error tracking"
        person_profiles: 'identified_only'
        // session replay is enabled per-project in the PostHog dashboard
      });
      window.posthog = posthog;
    }).catch(function (e) { console.warn('PostHog load failed', e); });
  }

  // PostHog sets cookies, so it MUST wait for consent. The consent manager decides
  // per region (opt-in blocks it until Accept; opt-out/notice allow it by default,
  // honoring an opt-out). Load the manager if it isn't already present.
  function gate() {
    if (!window.AtomicConsent) return;
    window.AtomicConsent.ready(function (s) { if (s && s.analytics) initPostHog(); });
    window.AtomicConsent.onChange(function (s) { if (s && s.analytics) initPostHog(); });
  }
  // consent.js is injected site-wide by the server, so avoid loading a SECOND copy
  // (duplicate script evaluation is the class of bug behind stray "already declared"
  // errors). Wait for it if a tag is already present; only inject as a last resort.
  if (window.AtomicConsent) { gate(); }
  else if (document.querySelector('script[src*="/assets/consent.js"]')) {
    var tries = 0, iv = setInterval(function () { if (window.AtomicConsent) { clearInterval(iv); gate(); } else if (++tries > 60) { clearInterval(iv); } }, 50);
  } else {
    var cs = document.createElement('script'); cs.src = '/assets/consent.js'; cs.onload = gate;
    (document.head || document.documentElement).appendChild(cs);
  }

  // Help / Support entry point. Used by the "Help" links; captures the event in
  // PostHog (if loaded) and opens a support email. Swap for a PostHog survey or a
  // live-chat widget later without touching the pages.
  window.atomicSupport = function () {
    try { if (window.posthog) window.posthog.capture('support_opened'); } catch (e) {}
    var subject = encodeURIComponent('Atomic support');
    var body = encodeURIComponent('Describe your issue:\n\n\n---\nPage: ' + location.href + '\nUA: ' + navigator.userAgent);
    window.location.href = 'mailto:' + SUPPORT_EMAIL + '?subject=' + subject + '&body=' + body;
  };
})();

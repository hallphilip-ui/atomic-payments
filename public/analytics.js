// Atomic analytics + support. PostHog gives product analytics and session replay
// (replay a user's session when they report an issue = fast support). The project
// key is a PUBLIC client-side identifier — safe to ship. No-ops until configured.
(function () {
  var POSTHOG_KEY = 'phc_kC3jJX868sdYAWGNRvgyYBCRDtQu3eXrc2TQSTYvLA49';
  var POSTHOG_HOST = 'https://us.i.posthog.com'; // EU: https://eu.i.posthog.com
  var SUPPORT_EMAIL = 'support@atomicpay.cloud';

  if (POSTHOG_KEY && POSTHOG_KEY !== 'REPLACE_WITH_POSTHOG_KEY') {
    import('https://esm.sh/posthog-js@1').then(function (mod) {
      var posthog = mod.default || mod.posthog;
      if (!posthog || !posthog.init) return;
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        capture_pageview: true,
        capture_pageleave: true,
        person_profiles: 'identified_only'
        // session replay is enabled per-project in the PostHog dashboard
      });
      window.posthog = posthog;
    }).catch(function (e) { console.warn('PostHog load failed', e); });
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

// Atomic Pay service worker.
//
// DELIBERATELY CACHES NO CODE. This is a non-custodial wallet: the funds path loads
// SRI-pinned ethers and passkey-wallet.js, and a service worker that served a stale
// copy of either would be a security hole (and would defeat the cache-busting we
// already have to do at the CDN). So:
//
//   * JS / CSS / API / HTML  -> always straight to the network. Never cached.
//   * Navigations            -> network, with a tiny offline page as the only fallback.
//   * The ONLY cached asset is offline.html (static markup, no code).
//
// The fetch handler exists so the app is installable; it is not a performance cache.
// If you ever add real caching here, exclude /assets/*.js, /assets/vendor/* and /v1/*
// or you will eventually ship a stale wallet.

const OFFLINE_URL = '/offline.html';
const CACHE = 'atomic-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                     // never touch writes

  // Page navigations: go to the network; only if the device is offline do we show
  // the offline page. We never serve a cached document (it could be stale).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Everything else (scripts, styles, API, images): network only, no caching.
  event.respondWith(fetch(req));
});

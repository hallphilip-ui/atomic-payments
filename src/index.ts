import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import intentRoutes from './routes/intents';
import userRoutes from './routes/users';
import adminRoutes from './routes/admin';
import settlementRoutes from './routes/settlement';
import swapRoutes from './routes/swaps';
import transferRoutes from './routes/transfers';
import analyticsRoutes from './routes/analytics';
import healthRoutes from './routes/health';
import metricsRoutes from './routes/metrics';
import projectRoutes from './routes/project';
import buildRoutes from './routes/build';
import bugRoutes from './routes/bugs';
import passkeyRoutes from './routes/passkey';
import rpcRoutes from './routes/rpc';
import walletRoutes from './routes/wallet';
import gasRoutes from './routes/gas';
import partnerRoutes from './routes/partner';
import assistantRoutes from './routes/assistant';
import observabilityRoutes from './routes/observability';
import arbRoutes from './routes/arb';
import marketRoutes from './routes/markets';
import fxRoutes from './routes/fx';
import offrampRoutes from './routes/offramp';
import { startPaymentWatcher } from './payments/paymentWatcher';
import { startSanctionsRescreen } from './compliance/rescreen';
import { requestLogger } from './observability/requestLogger';
import { operatorAuth } from './security/operatorAuth';
import { renderSwapHub, renderSwapLandingPage, resolvePairSlug, swapPairSlugs } from './seo/swapLandingPages';
import { requiresOperatorAuth } from './security/operatorRules';

const app = express();
const port = Number(process.env.PORT ?? 3005);

// Behind Cloudflare -> nginx -> node, every request arrives from 127.0.0.1. Without
// this, req.ip is the proxy and the rate limiter buckets ALL traffic together (a
// single 127.0.0.1 key), so light load 429s the entire site. Trust the two proxies
// (Cloudflare + nginx) so req.ip resolves to the real client.
app.set('trust proxy', 2);

app.use(express.json());
app.use(requestLogger);

// Inject the cookie-consent manager into every full HTML page so the region-aware
// banner appears site-wide without editing each page. Only rewrites text/html
// bodies that contain </body>; JSON and /assets/*.js responses are untouched. The
// module is idempotent + iframe-guarded, so pages that also pull it in via
// analytics.js — and embedded iframes (checkout, wallet-bridge) — are unaffected.
app.use((_req: Request, res: Response, next: () => void) => {
  const orig = res.send.bind(res);
  res.send = ((body: unknown) => {
    try {
      // Only HTML documents/fragments (start with <!doctype|<html|<head|<meta).
      // This excludes sitemap XML (<?xml), JSON ({/[), and /assets/*.js (//…), so we
      // never corrupt a non-HTML body. Inject before </body>, else </html>, else append.
      if (typeof body === 'string' && /^\s*<(!doctype|html|head|meta)/i.test(body)) {
        const tag = '  <script src="/assets/consent.js" defer></script>\n  <script src="/assets/homenav.js" defer></script>\n';
        if (body.includes('</body>')) body = body.replace('</body>', tag + '</body>');
        else if (/<\/html>/i.test(body)) body = body.replace(/<\/html>/i, tag + '</html>');
        else body = body + '\n' + tag;
      }
    } catch { /* fall through with the original body */ }
    return orig(body as string);
  }) as typeof res.send;
  return next();
});

// Real per-visitor rate limiting. Cloudflare sets CF-Connecting-IP to the true
// client IP (and strips any client-supplied value, so it can't be spoofed); fall
// back to req.ip for direct-to-origin requests. Static assets, HTML pages and the
// health check don't count, so ordinary browsing never trips the limit — only the
// /v1 API is metered.
const clientIp = (req: Request): string => {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length) return cf;
  return req.ip || 'unknown';
};
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // per client IP per window — generous for active swapping, still caps abuse
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  skip: (req: Request) =>
    req.method === 'OPTIONS' ||
    !req.path?.startsWith('/v1') || // HTML pages, /assets/*, favicon, etc.
    req.path === '/v1/health'
}));

app.use((req: Request, res: Response, next?: () => void) => {
  // Baseline hardening on every response. HSTS is honoured only over HTTPS (via
  // Cloudflare); nosniff blocks MIME-confusion on any served asset.
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // CORS: the public swap/quote API is meant to be called cross-origin, but the
  // operator/admin plane must NOT be — withhold the allow-origin so a browser on
  // another site can't read admin/settlement/metrics/observability responses even if
  // it somehow holds a key, and reject its preflight.
  const isOperatorPlane = requiresOperatorAuth(req.path || '');
  if (!isOperatorPlane) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-atomic-key, x-atomic-request-id, x-atomic-operator-key');
    res.header('Access-Control-Expose-Headers', 'x-atomic-request-id');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(isOperatorPlane ? 403 : 200);
  return next?.();
});

app.use(operatorAuth);

app.use(intentRoutes);
app.use(userRoutes);
app.use(adminRoutes);
app.use(arbRoutes);
app.use(marketRoutes);
app.use(fxRoutes);
app.use(offrampRoutes);
app.use(settlementRoutes);
app.use(swapRoutes);
app.use(transferRoutes);
app.use(analyticsRoutes);
app.use(healthRoutes);
app.use(metricsRoutes);
app.use(projectRoutes);
app.use(buildRoutes);
app.use(bugRoutes);
app.use(passkeyRoutes);
app.use(rpcRoutes);
app.use(walletRoutes);
app.use(gasRoutes);
app.use(partnerRoutes);
app.use(assistantRoutes);
app.use(observabilityRoutes);

// Content-Security-Policy for the funds pages (M3). Locks script/connect sources
// so an injected <script src=evil> or exfil to an unknown host is refused. Note:
// 'unsafe-inline' is required for the pages' large inline scripts (nonce-ing them
// is a bigger refactor); H1's per-transaction Touch ID is the primary defence
// against inline injection, with CSP as defence-in-depth on external sources.
// NO third-party code host (esm.sh removed): every module — ethers, jsQR, qrcode,
// @solana/web3.js, WalletConnect, posthog-js — is now self-hosted under
// /assets/vendor/, so a compromised CDN can't inject key-stealing code into the
// wallet realm. Remaining external hosts are DATA/API endpoints (connect-src / font
// -src) that those libraries call at runtime — WalletConnect's relay/RPC/modal
// fonts and PostHog ingest — not script sources.
const CSP_SWAP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.posthog.com https://*.walletconnect.com https://*.walletconnect.org https://*.walletconnect.network wss://*.walletconnect.com wss://*.walletconnect.org https://fonts.reown.com https://4byte.sourcify.dev",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://fonts.reown.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'"
].join('; ');
// Content pages (landing, transfers, partners, help, releases, docs, legal, admin
// console). Self-hosted scripts + PostHog analytics only, no framing. 'unsafe-inline'
// is retained for the pages' inline scripts/styles (nonce-ing is a larger refactor).
const CSP_CONTENT = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'"
].join('; ');
// Checkout is an EMBEDDABLE payment widget (merchants iframe it), so it deliberately
// omits frame-ancestors/X-Frame-Options — but still locks script/connect sources.
const CSP_CHECKOUT = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.posthog.com https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "base-uri 'self'",
  "object-src 'none'"
].join('; ');
// The testnet wallet page loads nothing third-party (ethers is self-hosted, RPC
// is proxied through our origin) — so it gets a strict, no-external-host policy.
const CSP_WALLET_TEST = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'"
].join('; ');

// The signer bridge (/wallet-bridge) is a signing oracle for the browser extension:
// it performs passkey (Face ID) signatures on postMessage request. It MUST be
// embeddable ONLY by our own extension, so frame-ancestors is pinned to the
// configured chrome-extension:// / safari-web-extension:// origins. Empty config =>
// 'none' (fail closed: nothing can frame it). The same allowlist is injected into
// the page so its runtime origin check matches the CSP.
const EXTENSION_ORIGINS = (process.env.ATOMIC_EXTENSION_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const CSP_WALLET_BRIDGE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `frame-ancestors ${EXTENSION_ORIGINS.length ? EXTENSION_ORIGINS.join(' ') : "'none'"}`,
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'"
].join('; ');

// Security headers for the HTML pages that don't set their own CSP (the funds pages
// /defi-swap and /wallet-test set theirs inline below). Keyed on exact path so the
// /v1 API and static assets are untouched.
const CONTENT_PAGES = new Set([
  '/', '/transfers', '/partners', '/merchant', '/help', '/releases', '/partner-docs', '/partner-verify', '/terms', '/privacy', '/admin-compliance', '/arb-desk'
]);
app.use((req: Request, res: Response, next?: () => void) => {
  const p = req.path || '';
  if (CONTENT_PAGES.has(p)) {
    res.header('Content-Security-Policy', CSP_CONTENT);
    res.header('X-Frame-Options', 'DENY');
  } else if (p === '/checkout') {
    res.header('Content-Security-Policy', CSP_CHECKOUT); // embeddable: no frame denial
  }
  return next?.();
});

app.get('/', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

// SEO: robots.txt + sitemap.xml so crawlers can discover and map the public pages.
app.get('/robots.txt', (_req: Request, res: Response) => {
  const body = readFileSync(join(process.cwd(), 'robots.txt'), 'utf8');
  res.header('Content-Type', 'text/plain; charset=utf-8');
  res.header('Cache-Control', 'public, max-age=86400');
  return res.send(body);
});

// Sitemap generated dynamically so the swap-pair landing pages stay in sync with the
// SWAP_PAIRS source of truth (no hand-maintained drift).
app.get('/sitemap.xml', (_req: Request, res: Response) => {
  const today = new Date().toISOString().slice(0, 10);
  const core: Array<[string, string, string]> = [
    ['/', 'weekly', '1.0'],
    ['/defi-swap', 'weekly', '0.9'],
    ['/swap', 'weekly', '0.8'],
    ['/merchant', 'weekly', '0.8'],
    ['/partners', 'weekly', '0.8'],
    ['/partner-docs', 'monthly', '0.7'],
    ['/help', 'monthly', '0.7'],
    ['/transfers', 'daily', '0.6'],
    ['/checkout', 'monthly', '0.5'],
    ['/releases', 'weekly', '0.5'],
    ['/terms', 'yearly', '0.3'],
    ['/privacy', 'yearly', '0.3']
  ];
  const pairUrls = swapPairSlugs().map((slug): [string, string, string] => [`/swap/${slug}`, 'weekly', '0.6']);
  const urls = [...core, ...pairUrls]
    .map(([loc, freq, pri]) =>
      `  <url>\n    <loc>https://atomicpay.cloud${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${pri}</priority>\n  </url>`)
    .join('\n');
  res.header('Content-Type', 'application/xml; charset=utf-8');
  res.header('Cache-Control', 'public, max-age=86400');
  return res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// Programmatic long-tail SEO: /swap hub + /swap/<from>-to-<to> pair landing pages.
app.get('/swap', (_req: Request, res: Response) => {
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'public, max-age=3600');
  return res.send(renderSwapHub());
});

app.get('/swap/:pair', (req: Request, res: Response) => {
  const pair = resolvePairSlug(String(req.params.pair));
  res.header('Content-Type', 'text/html; charset=utf-8');
  if (!pair) {
    res.header('Cache-Control', 'no-store');
    return res.status(404).send(renderSwapHub());
  }
  res.header('Cache-Control', 'public, max-age=3600');
  return res.send(renderSwapLandingPage(pair.from, pair.to));
});

app.use('/defi-swap', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'defi-swap.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  // Funds page (embedded wallet) — never allow framing + lock external sources.
  res.header('X-Frame-Options', 'DENY');
  res.header('Content-Security-Policy', CSP_SWAP);
  return res.send(html);
});

app.use('/checkout', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'checkout.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/admin-compliance', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'admin-compliance.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/arb-desk', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'arb-desk.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/transfers', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'transfers.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/terms', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'terms.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/privacy', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'privacy.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/wallet-test', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'wallet-test.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  // Testnet wallet page — strict, no third-party hosts.
  res.header('X-Frame-Options', 'DENY');
  res.header('Content-Security-Policy', CSP_WALLET_TEST);
  return res.send(html);
});

// Signer bridge for the browser extension. Framed ONLY by the configured extension
// origins (frame-ancestors); the same allowlist is injected so the page's own
// postMessage origin check matches. NO X-Frame-Options (that would block the
// extension too — frame-ancestors is the per-origin control). Never cached.
app.use('/wallet-bridge', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'wallet-bridge.html'), 'utf8')
    .replace('window.__ATOMIC_EXT_ORIGINS__ = [];', `window.__ATOMIC_EXT_ORIGINS__ = ${JSON.stringify(EXTENSION_ORIGINS)};`);
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-store, must-revalidate');
  res.header('Content-Security-Policy', CSP_WALLET_BRIDGE);
  return res.send(html);
});

app.use('/help', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'help.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/partners', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'partners.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/merchant', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'merchant.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/partner-docs', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'partner-docs.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/partner-verify', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'partner-verify.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/releases', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'releases.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/assets/atomic-logo.png', (_req: Request, res: Response) => {
  const logo = readFileSync(join(process.cwd(), 'public', 'atomic-logo.png'));
  res.header('Content-Type', 'image/png');
  return res.send(logo);
});

app.use('/assets/atomic-mark.png', (_req: Request, res: Response) => {
  const logo = readFileSync(join(process.cwd(), 'public', 'atomic-mark.png'));
  res.header('Content-Type', 'image/png');
  return res.send(logo);
});

// Social share card (1200x630) — used as og:image / twitter:image on all pages.
app.use('/assets/atomic-og.png', (_req: Request, res: Response) => {
  const card = readFileSync(join(process.cwd(), 'public', 'atomic-og.png'));
  res.header('Content-Type', 'image/png');
  res.header('Cache-Control', 'public, max-age=86400');
  return res.send(card);
});

app.use('/favicon.ico', (_req: Request, res: Response) => {
  const logo = readFileSync(join(process.cwd(), 'public', 'atomic-mark.png'));
  res.header('Content-Type', 'image/png');
  return res.send(logo);
});

app.use('/assets/i18n.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'i18n.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  // The dictionary changes as pages are localized — revalidate (ETag) so
  // Cloudflare/browsers never serve a stale dict that renders raw i18n keys.
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(script);
});

app.use('/assets/widget.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'widget.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  return res.send(script);
});

app.use('/assets/fx.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'fx.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');   // like i18n.js — revalidate (CF still caches; version the URL)
  return res.send(script);
});

app.use('/assets/analytics.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'analytics.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  return res.send(script);
});

app.use('/assets/extension-cta.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'extension-cta.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  return res.send(script);
});

app.use('/assets/consent.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'consent.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  return res.send(script);
});

app.use('/assets/homenav.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'homenav.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  return res.send(script);
});

app.use('/assets/assistant.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'assistant.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  return res.send(script);
});

// Visitor country for region-aware cookie consent. Cloudflare sets CF-IPCountry;
// 'XX'/'T1' (unknown/Tor) → null so the client picks the most protective (opt-in)
// model. Strictly-necessary (needed to render the right banner) — no consent gate.
app.get('/v1/geo', (req: Request, res: Response) => {
  const cc = req.headers['cf-ipcountry'];
  const country = typeof cc === 'string' && /^[A-Z]{2}$/.test(cc) && cc !== 'XX' && cc !== 'T1' ? cc : null;
  res.header('Cache-Control', 'no-store');
  return res.json({ country });
});

// Vendored, integrity-pinned ethers. The funds path must never load key-touching
// code from a public CDN (a compromised CDN = stolen private keys). Loaded via
// <script integrity="sha384-..."> so the browser rejects any tampered bytes.
// Read once at boot; filename is version-pinned so it can be cached immutably.
const ETHERS_BUNDLE = readFileSync(join(process.cwd(), 'public', 'vendor', 'ethers-6.13.4.umd.min.js'), 'utf8');
app.use('/assets/vendor/ethers-6.13.4.umd.min.js', (_req: Request, res: Response) => {
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  res.header('Cache-Control', 'public, max-age=31536000, immutable');
  return res.send(ETHERS_BUNDLE);
});

// Self-hosted, faithfully-mirrored ESM graph for the funds-page libraries (jsQR,
// qrcode, @solana/web3.js, WalletConnect, posthog-js). Replaces the esm.sh CDN so
// no third-party code runs in the wallet realm. Only flat .mjs files from the mirror
// dir are served; the strict name regex (no slashes/dots-dots) blocks path traversal.
const ESM_VENDOR_DIR = join(process.cwd(), 'public', 'vendor', 'esm');
app.use('/assets/vendor/esm', (req: Request, res: Response) => {
  const name = (req.path || '').replace(/^\/+/, '');
  if (!/^[a-zA-Z0-9._-]+\.mjs$/.test(name)) return res.status(404).end();
  try {
    const body = readFileSync(join(ESM_VENDOR_DIR, name), 'utf8');
    res.header('Content-Type', 'application/javascript; charset=utf-8');
    // Revalidating (not immutable): the thin entry modules keep stable names but their
    // content can change if the graph is ever re-mirrored, so we must not hard-pin them.
    res.header('Cache-Control', 'public, max-age=3600, must-revalidate');
    return res.send(body);
  } catch {
    return res.status(404).end();
  }
});

app.use('/assets/passkey-wallet.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'passkey-wallet.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  // Security-critical (touches keys) — never let a CDN/browser serve a stale copy.
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.send(script);
});

// Bind to loopback by default so the app is only reachable through nginx, never
// directly on the public IP (which would bypass Cloudflare's WAF + our CF-IP
// controls). Override with ATOMIC_BIND_HOST if a different bind is ever needed.
const bindHost = process.env.ATOMIC_BIND_HOST ?? '127.0.0.1';
app.listen(port, bindHost, () => {
  console.log(`🚀 Atomic Admin Engine Live on ${bindHost}:${port}`);
  startPaymentWatcher();
  startSanctionsRescreen();
});

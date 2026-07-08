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
import observabilityRoutes from './routes/observability';
import { requestLogger } from './observability/requestLogger';
import { operatorAuth } from './security/operatorAuth';

const app = express();
const port = Number(process.env.PORT ?? 3005);

// Behind Cloudflare -> nginx -> node, every request arrives from 127.0.0.1. Without
// this, req.ip is the proxy and the rate limiter buckets ALL traffic together (a
// single 127.0.0.1 key), so light load 429s the entire site. Trust the two proxies
// (Cloudflare + nginx) so req.ip resolves to the real client.
app.set('trust proxy', 2);

app.use(express.json());
app.use(requestLogger);

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
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-atomic-key, x-atomic-request-id, x-atomic-operator-key');
  res.header('Access-Control-Expose-Headers', 'x-atomic-request-id');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  return next?.();
});

app.use(operatorAuth);

app.use(intentRoutes);
app.use(userRoutes);
app.use(adminRoutes);
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
app.use(observabilityRoutes);

// Content-Security-Policy for the funds pages (M3). Locks script/connect sources
// so an injected <script src=evil> or exfil to an unknown host is refused. Note:
// 'unsafe-inline' is required for the pages' large inline scripts (nonce-ing them
// is a bigger refactor); H1's per-transaction Touch ID is the primary defence
// against inline injection, with CSP as defence-in-depth on external sources.
const CSP_SWAP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://esm.sh https://*.posthog.com",
  "connect-src 'self' https://esm.sh https://*.posthog.com https://*.walletconnect.com https://*.walletconnect.org https://*.walletconnect.network wss://*.walletconnect.com wss://*.walletconnect.org",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'"
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

app.get('/', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
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

app.use('/help', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'help.html'), 'utf8');
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

app.use('/favicon.ico', (_req: Request, res: Response) => {
  const logo = readFileSync(join(process.cwd(), 'public', 'atomic-mark.png'));
  res.header('Content-Type', 'image/png');
  return res.send(logo);
});

app.use('/assets/i18n.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'i18n.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  return res.send(script);
});

app.use('/assets/widget.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'widget.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  return res.send(script);
});

app.use('/assets/analytics.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'analytics.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  return res.send(script);
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
app.listen(port, bindHost, () => console.log(`🚀 Atomic Admin Engine Live on ${bindHost}:${port}`));

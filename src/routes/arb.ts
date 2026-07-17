import { Router, Request, Response } from 'express';
import { readFileSync, statSync, writeFileSync } from 'fs';
import { validateOperatorCredential } from '../security/operatorRules';
import { verifyCfAccessEmail, isCfAccessEnabled } from '../security/cfAccessVerifier';

// Operator-gated read-only view of the arbitrage scanner's paper-trade forward test.
// The scanner (separate log-only service at /opt/atomic-arb-scanner) writes a compact
// arb_snapshot.json each pass; both it and this backend run as the `atomic` user, so
// this just reads that file. NO trading, NO funds — research/monitoring only.
//
// Two entry points:
//   GET /v1/admin/arb    — under /v1/admin, so operatorAuth gates it (operator key /
//                          Keycloak). For API/curl access with the shared key.
//   GET /arb-desk/data   — the browser desk's feed. Accepts EITHER the operator key
//                          OR a per-person Cloudflare Access login (Cf-Access-Jwt-
//                          Assertion). This is what makes the desk per-person: once
//                          the /arb-desk path sits behind a CF Access application,
//                          team members sign in with their own email and never touch
//                          the shared key. NOT under /v1/admin, so it enforces its own
//                          auth here (below) — never leave it open.
const router = Router();

const SNAPSHOT_PATH =
  process.env.ARB_SNAPSHOT_PATH || '/opt/atomic-arb-scanner/arb_snapshot.json';
const CONFIG_PATH =
  process.env.ARB_CONFIG_PATH || '/opt/atomic-arb-scanner/config.json';
const GRID_SNAPSHOT_PATH =
  process.env.GRID_SNAPSHOT_PATH || '/opt/atomic-arb-scanner/grid_snapshot.json';
const FLASH_SNAPSHOT_PATH =
  process.env.FLASH_SNAPSHOT_PATH || '/opt/atomic-arb-scanner/flashloan_snapshot.json';

// Admin-tunable scanner settings, with the SAME bounds the scanner clamps to.
const CONFIG_BOUNDS: Record<string, [number, number]> = {
  threshold_pct: [0.01, 10], alert_pct: [0.01, 20], notional_usd: [10, 1_000_000],
  max_assets: [5, 1000], interval_sec: [30, 3600], window_hours: [1, 168]
};

// Resolve the viewer for a desk request: operator ADMIN key, or a per-person Cloudflare
// Access login. Returns the identity string, or null if unauthenticated/insufficient.
async function deskAdmin(req: Request, requireAdmin: boolean): Promise<string | null> {
  const opHeader = req.headers['x-atomic-operator-key'];
  const opKey = Array.isArray(opHeader) ? opHeader[0] : opHeader;
  if (opKey) {
    const role = validateOperatorCredential(opKey);
    if (role === 'admin' || (role === 'readonly' && !requireAdmin)) return 'operator-key';
  }
  if (isCfAccessEnabled()) {
    const jwt = req.headers['cf-access-jwt-assertion'];
    const email = await verifyCfAccessEmail(Array.isArray(jwt) ? jwt[0] : jwt);
    if (email) return email; // Access allow-list already restricts who this can be
  }
  return null;
}

function readSnapshot(): any {
  const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
  const ageSec = Math.round((Date.now() - statSync(SNAPSHOT_PATH).mtimeMs) / 1000);
  const parsed = JSON.parse(raw);
  parsed.snapshot_age_sec = ageSec;
  // Grid Lab (paper spot grids) — optional sibling snapshot written by gridbot.py.
  // Absent file just means the service isn't running; the desk hides the card.
  try {
    parsed.grid = JSON.parse(readFileSync(GRID_SNAPSHOT_PATH, 'utf8'));
    parsed.grid.snapshot_age_sec = Math.round((Date.now() - statSync(GRID_SNAPSHOT_PATH).mtimeMs) / 1000);
  } catch {
    parsed.grid = null;
  }
  return parsed;
}

function sendSnapshot(res: Response, viewer: string) {
  try {
    const snap = readSnapshot();
    snap.viewer = viewer; // who is looking (email or "operator-key") — surfaced in the UI
    res.header('Cache-Control', 'no-store');
    return res.json(snap);
  } catch (err) {
    return res.status(503).json({
      error: 'Arb snapshot unavailable',
      detail: err instanceof Error ? err.message : String(err),
      hint: `Expected ${SNAPSHOT_PATH} written by the arb-scanner service.`
    });
  }
}

// API endpoint — operatorAuth (upstream) already required a valid operator credential.
router.get('/v1/admin/arb', (_req: Request, res: Response) => {
  return sendSnapshot(res, (res.locals.operatorRole as string) || 'operator');
});

// Browser desk feed — self-gated: operator key OR per-person Cloudflare Access login.
router.get('/arb-desk/data', async (req: Request, res: Response) => {
  const who = await deskAdmin(req, false); // read: operator (any role) or Access login
  if (!who) {
    return res.status(401).json({
      error: 'Sign in required.',
      accepts: ['x-atomic-operator-key: <key>', 'Cloudflare Access session (per-person)']
    });
  }
  return sendSnapshot(res, who);
});

// Flash-Loan Lab feed — LOG-ONLY simulator (flashloan_snapshot.json, written by
// the atomic-flash-sim service). Same self-gate as the desk: operator key OR a
// per-person Cloudflare Access login (the /arb-desk/* prefix is Access-protected).
router.get('/arb-desk/flash-data', async (req: Request, res: Response) => {
  const who = await deskAdmin(req, false);
  if (!who) {
    return res.status(401).json({
      error: 'Sign in required.',
      accepts: ['x-atomic-operator-key: <key>', 'Cloudflare Access session (per-person)']
    });
  }
  try {
    const snap = JSON.parse(readFileSync(FLASH_SNAPSHOT_PATH, 'utf8'));
    snap.snapshot_age_sec = Math.round((Date.now() - statSync(FLASH_SNAPSHOT_PATH).mtimeMs) / 1000);
    snap.viewer = who;
    res.header('Cache-Control', 'no-store');
    return res.json(snap);
  } catch (err) {
    return res.status(503).json({
      error: 'Flash-loan snapshot unavailable',
      detail: err instanceof Error ? err.message : String(err),
      hint: `Expected ${FLASH_SNAPSHOT_PATH} written by the atomic-flash-sim service.`
    });
  }
});

// Admin-tunable scanner controls: writes config.json that the scanner reads each cycle.
// Requires ADMIN (operator admin key, or a per-person Access login — the Access allow-list
// already restricts who that can be). NOT under /v1/admin, so it self-gates here.
router.post('/arb-desk/config', async (req: Request, res: Response) => {
  const who = await deskAdmin(req, true);
  if (!who) return res.status(401).json({ error: 'Admin sign-in required.' });

  const body = (req.body || {}) as Record<string, unknown>;
  // Merge onto existing config so saving one section can't wipe another (e.g. the ntfy topic).
  let out: Record<string, unknown> = {};
  try { out = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { /* start fresh */ }

  let changed = 0;
  for (const [k, [lo, hi]] of Object.entries(CONFIG_BOUNDS)) {
    const raw = body[k];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) return res.status(400).json({ error: `${k} must be a number` });
    out[k] = Math.min(hi, Math.max(lo, n)); changed++;
  }
  if ('ntfy_topic' in body) {
    const t = String((body as any).ntfy_topic ?? '').trim();
    if (t === '') { delete out.ntfy_topic; changed++; }
    else if (/^[A-Za-z0-9_-]{1,64}$/.test(t)) { out.ntfy_topic = t; changed++; }
    else return res.status(400).json({ error: 'ntfy_topic: 1–64 chars, letters/digits/_/- only' });
  }
  if (changed === 0) return res.status(400).json({ error: 'No valid fields to update.' });

  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2));
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to write scanner config',
      detail: err instanceof Error ? err.message : String(err)
    });
  }
  return res.json({ ok: true, saved: out, by: who, note: 'Scanner applies changes on its next cycle.' });
});

// Send a test push to the configured ntfy topic so the admin can confirm delivery.
router.post('/arb-desk/test-alert', async (req: Request, res: Response) => {
  const who = await deskAdmin(req, true);
  if (!who) return res.status(401).json({ error: 'Admin sign-in required.' });
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { /* none */ }
  const topic = typeof cfg.ntfy_topic === 'string' ? cfg.ntfy_topic.trim() : '';
  if (!topic) return res.status(400).json({ error: 'No ntfy topic saved yet — save one first.' });
  const url = topic.startsWith('http') ? topic : `https://ntfy.sh/${topic}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Title: 'Atomic Arb — test', Priority: 'high', Tags: 'white_check_mark',
                 Click: 'https://atomicpay.cloud/arb-desk' },
      body: `Test push from the Arb Desk (${who}). If this reached your phone/desktop, notifications are wired.`,
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('ntfy HTTP ' + r.status);
  } catch (err) {
    return res.status(502).json({ error: 'ntfy push failed', detail: err instanceof Error ? err.message : String(err) });
  }
  return res.json({ ok: true, sent_to: url });
});

export default router;

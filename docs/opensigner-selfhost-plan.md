# Self-Hosted Openfort (opensigner) — Deployment & Integration Plan

**Goal:** email → **Atomic embedded wallet**, fully self-hosted (no vendor dependency,
no per-MAU fee). A user signs in with an email, an EVM/Solana wallet is created for
them (keys Shamir-split), and its **EIP-1193 provider** drops straight into the
existing swap execute flow — so quotes/fees/execution work unchanged. This makes
"which wallet / connect is clunky / is my BTC showing" disappear for mainstream users.

## Where it runs
- **New IONOS server** (≥ 4 GB RAM, ≥ 2 vCPU). The current VPS (1-core / 833 MB) is
  far too small for Postgres + MySQL + 6 services.
- **Cloudflare in front** as edge/TLS for **`signer.atomicpay.cloud`** (opensigner
  behind it) — same pattern as `atomicpay.cloud`. Cloudflare is NOT the host.
- The `atomic-pay` app stays where it is for now (its front-end just calls the signer).

## Architecture (opensigner, MIT)
Docker-compose stack:
| Service | Port | Role |
|---|---|---|
| iframe | 7050 | client key-mgmt iframe (holds the **device share**) |
| iframe-sample | 7051 | demo page (don't expose in prod) |
| auth_service | 7052 | email/auth |
| cold_storage | 7053 | **cold share** (recovery) — funds-critical |
| hot_storage | 7054 | **hot share** (liveness) — funds-critical |
| docs | 7055 | docs (don't expose in prod) |
| postgres, mysql | internal | state |

Keys are split via **Shamir's Secret Sharing** into device / hot / cold shares. This
is **funds-critical**: mishandled secrets or a lost cold-storage DB = users lose access.

## Deploy sequence (server-day, on the new box)
1. Provision Ubuntu ≥ 4 GB, install **Docker + docker-compose**.
2. `git clone https://github.com/openfort-xyz/opensigner` → inspect `docker-compose.yml`
   + **opensigner.dev** docs for the exact env vars / secrets (TBD until then).
3. Generate strong, unique secrets for the **hot/cold share encryption / master keys**
   and DB creds. **Back the encryption secrets up OFFLINE** (password manager / HSM) —
   losing them is unrecoverable.
4. Configure **email auth** (SMTP or provider) + Postgres/MySQL creds.
5. `make run` (or `docker-compose up`). Verify 7050/7052/7053/7054 respond on localhost.
6. **nginx** reverse-proxies the **iframe (7050)** + **auth (7052)** under
   `signer.atomicpay.cloud`; put a **Cloudflare Origin cert** on nginx :443 and set CF
   SSL to **Full (strict)** — identical to how we fixed the main app's 525.
7. **Firewall:** expose only :443 via nginx/CF. Keep Postgres, MySQL, hot/cold storage
   on the internal docker network — never public. Do NOT expose iframe-sample/docs.

## Security checklist (funds-critical — do not skip)
- [ ] Strong unique secrets for hot/cold encryption; **offline backup** of the master/encryption keys.
- [ ] Databases + storage services bound to the internal docker network only.
- [ ] Encrypted, tested **DB backups** (cold-storage loss = no user recovery).
- [ ] TLS end-to-end (CF Origin cert on the signer box).
- [ ] Uptime monitoring + alerts (signer down = users can't sign/access wallets).
- [ ] Ideally a dedicated host (isolation from the payment app).
- [ ] Rotate/scope any API keys; least-privilege.

## Client integration (atomic-pay front-end)
- Load the Openfort client (`@openfort/openfort-js`, or opensigner's own client) via
  CDN in `defi-swap.html`, **configured to point at the self-hosted URLs** (iframe →
  `signer.atomicpay.cloud`, auth/backend → the self-hosted auth service, shield/storage
  → self-hosted). Exact config keys: confirm from opensigner docs on server-day.
- **Flow:** "✨ Sign in with email" (top of the connect modal) → email OTP → configure
  embedded signer against self-hosted Shield → get **EIP-1193 provider** →
  `state.wallet = { type:'evm', address, provider, wallet:'Atomic' }` → **existing
  `executeSwap` works unchanged**.
- The wallet-first `wallet_session` endpoint already gives returning-user stickiness.

## Open items to confirm on server-day
- Exact env var names + required secrets (from `docker-compose.yml` / opensigner.dev).
- Whether `openfort-js` accepts self-hosted URL overrides directly, or opensigner ships
  a dedicated client.
- Resource sizing under real load (Postgres + MySQL + 6 services).
- Backup/DR runbook + key-rotation procedure.

## What's ready now (no server needed)
- This plan + security checklist.
- The swap execute flow already consumes any EIP-1193 provider, so the embedded wallet
  is a drop-in once the signer is live.
- Cloudflare edge pattern is proven (we did it for `atomicpay.cloud`).

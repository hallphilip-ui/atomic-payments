# Changelog

## 2.0.0 - 2026-07-12

**Platform launch: an AI assistant front door, a hybrid browser wallet, the Partner Swap API, and a full security + discovery pass.**

- **AI assistant** — natural-language swap planner at `/v1/assistant/chat` with a chat widget on `/defi-swap`. Conversational onboarding ("I need to swap crypto" → guided → prepared quote). The AI proposes; the user signs (no signing tool). Provider-agnostic — Claude or OpenAI/GPT, selected by env. Live on Claude.
- **Browser extension (MV3, hybrid)** — injected **EIP-6963** wallet so "Atomic Pay" appears in any dapp's wallet picker, plus a quick-swap popup. Passkey **signer bridge** (`/wallet-bridge`, Face ID, origin-locked to the pinned extension id). Packaged; submitted to the Chrome Web Store.
- **Partner Swap API (Swaps-as-a-Service)** — API keys, self-serve portal, docs, HMAC webhooks, monthly statements. Fee model: partner earns 50bp + up to 50bp markup, settled in **USDC on Base**. Automated payouts gated on on-chain-verified settlement, idempotent, with a $25k single-run circuit breaker.
- **Security** — payout-drain closed (settlement verified via LI.FI status API); operator plane fails closed in production; consumer fee-bypass shut; real signature verification on authorize; **esm.sh removed from the funds page** (self-hosted module graph); webhook SSRF blocked; self-serve email verification.
- **Discovery / SEO** — sitemap of **53 URLs** incl. 42 programmatic `/swap/<pair>` landing pages, submitted to Google Search Console; JSON-LD + internal linking; Cloudflare AI-crawler policy (answer engines allowed, training scrapers blocked).
- **Privacy** — region-aware cookie consent (EU opt-in / US opt-out / notice) that gates analytics before consent, injected site-wide.
- **Wallet** — email/Face ID passkey wallet + gas station (gasless swaps), keyless on-chain sanctions oracle, recovery kit; first real mainnet swap completed.
- **Fixes** — fallback quotes no longer show a simulated "You receive"; partner earnings/statements count only on-chain-broadcast swaps; duplicate-script hardening.

## 1.2.0 - 2026-07-06

**Live swap product on atomicpay.cloud: real cross-chain swaps, embedded analytics, light redesign.**

- **LI.FI as the unified gatekeeper-free backend** — live BTC + EVM cross-chain swaps (`li.quest`), integrator fee, fail-closed asset map. Net platform fee **2.5%** (customer all-in ~2.75%).
- **Client-side execution** — connected wallet signs LI.FI's transaction; EVM approval + chain-switch handled; BTC (deposit-address) and Solana (serialized tx) paths added.
- **Wallet connect overhaul** — EIP-6963 multi-injected discovery (fixes multi-wallet conflicts), in-modal WalletConnect QR, 16 wallets incl. Bitcoin, connecting spinner + timeout, and a guard that blocks swaps when the wallet can't send the source asset.
- **Human-readable amounts** — type "10" not "10000000"; human receive/fee display.
- **Full light "Openfort" redesign** across landing, swap, transfers, checkout.
- **Public transfers/conversions explorer** (`/transfers` + `GET /v1/transfers`) with filtering, pagination, live refresh.
- **Daily P&L email** (`GET /v1/admin/pnl` + `scripts/pnl-report.js`), timezone-aware, 7 AM ET cron.
- **Wallet-first sessions** (`/v1/users/wallet_session`) — no signup, returns recent swaps for stickiness.
- **Exchange-style landing page** at `/`.
- **PostHog analytics + Help/Support** link.
- Fail-closed live routing; provider error messages surfaced; docs: opensigner self-host plan, provider certification, known-bugs register.

## 1.1.0 - 2026-07-03

- Added runtime build metadata through `/v1/build`, `/v1/health`, and `/v1/project/progress`.
- Added deterministic local test accounts and seed verification.

## 1.1.0 - 2026-07-03

- Added runtime build metadata through `/v1/build`, `/v1/health`, and `/v1/project/progress`.
- Added deterministic local test accounts and seed verification.
- Added guarded wallet broadcast adapters for EVM and Solana simulation/live/live-with-fallback modes.
- Added swap broadcast route with transaction proof capture and raw transaction redaction.
- Added production observability readiness contract for log drain, dashboard, alert policy, and incident runbook links.
- Added a protected launch-evidence bundle for bug-test handoff, local verification proof, production observability state, release decision, and remaining external signoffs.
- Added operator audit evidence exports with SHA-256 digests.
- Added settlement reconciliation evidence exports with SHA-256 digests.
- Added production readiness gates for evidence archive configuration and build identity.
- Expanded operator-protected smoke coverage for read-only inspection and privileged operations.

## 1.0.0 - 2026-06-29

- Initial Atomic Payments local MVP foundation.

# Changelog

## 2.4.0 - 2026-07-13

**Local-currency amount display (FX layer).**

- **Amounts now show a local-currency equivalent** in the viewer's currency, e.g. `$1.00 ≈ 0,88 €`. Live on the hosted checkout (invoice total), the merchant POS charge, and the swap-size cap message (e.g. "max ≈ €920,000").
- **New `/v1/fx/rates`** — public, server-cached USD→fiat rates (166 currencies, hourly refresh, last-known-good on source outage). Indicative and display-only — never used for settlement or the enforced USD cap.
- **`atomicFx` client helper** (`/assets/fx.js`) — detects the viewer's currency (region → currency, with a per-language default and a `atomic.currency` override), formats via `Intl.NumberFormat` in the active locale, and offers a declarative `data-fx-usd` annotator for reuse on any amount.

## 2.3.0 - 2026-07-13

**Full 15-language localization across the product.**

- **Every customer- and merchant-facing surface is now translated** into 15 languages (en, zh, hi, es, fr, ar, bn, pt, ru, ur, id, de, ja, sw, pa, incl. RTL): the hosted checkout, the entire merchant portal (auth, POS, invoices, payments, cash-out, transaction limits, settings, receipts), the transfers explorer, the help & bug tracker, and partner sign-in/verification. ~250 dictionary keys × 15 languages, with a language selector on every page; numbers and dates localize too.
- **atomicexchange** — the market dashboard gets its own self-contained i18n (49 keys × 15) with a language selector, ready for its first deploy.
- Legal text (terms/privacy), API docs, and version-history bodies remain in English by design (English governs; translations are for convenience).
- **Fix** — the i18n bundle is now cache-versioned so a dictionary update can't be masked by Cloudflare's edge cache.

## 2.2.1 - 2026-07-13

**Configurable transaction limits + a platform swap cap.**

- **Per-merchant transaction limits** — a "Transaction limits" panel in the merchant portal Settings (min/max per charge, in the charge currency, either optional). Enforced server-side across POS, invoices, API, and hosted checkout; a charge outside the range is rejected with a plain-language reason before an intent is created. Validates non-negative and max ≥ min.
- **Platform swap-size cap** — swaps above a configurable USD ceiling are refused with a clear, user-facing reason (shown in the swap UI, relayed by the AI assistant, returned by the partner API) rather than failing silently. Default **$1,000,000**, tunable via `ATOMIC_SWAP_MAX_USD` (`0` disables). Enforced at the single quote chokepoint for every swap path; applies when the swap's USD value is known and fails open otherwise.

## 2.2.0 - 2026-07-13

**Merchant fiat cash-out — a global off-ramp aggregator.**

- **"Cash out" tab** in the merchant portal (`/merchant`) — converts received crypto to local currency, paid to the merchant's bank or card. Non-custodial: the merchant sells straight from their own wallet through a **licensed partner** that runs KYC, custodies only during conversion, and pays out fiat — Atomic never holds funds.
- **Global coverage via aggregation** — auto-detects the merchant's country (`/v1/geo`) and lists every off-ramp that covers it: MoonPay, Transak, Ramp, Banxa, Mercuryo and Unlimit (global), plus Coinbase (US/EU) and Kado (Americas/Africa/SE-Asia). 25 payout currencies, 31 countries + a Global/Other default so every jurisdiction has options.
- **Stubbed integration** — provider keys live in an `OFFRAMP_KEYS` config; until they're filled, buttons open each provider's public off-ramp. Add partner keys to enable prefilled deep-links (amount, wallet, currency) and referral-fee attribution.

## 2.1.2 - 2026-07-13

**Customer checkout rebuild, longer-lived invoices, and gateway marketing.**

- **Rebuilt hosted checkout** (`/checkout`) — replaced the operator "gateway simulator" with a real customer checkout: auto-loads the invoice from `?intentId=`, shows the merchant, amount, description and reference, offers only the watcher-confirmable stablecoin rails (USDC on Base flagged lowest-fee, plus USDC/USDT/PYUSD on Ethereum), then renders the exact amount + deposit address + QR + open-in-wallet + live status → printable receipt on confirmation. Mobile-first, theme-aware, embeddable.
- **Invoice expiry fix** — payment-intent TTL now defaults by source: a POS QR stays a tight 15 min, but an **emailed invoice is payable for 7 days** (was 15 min, so emailed links expired almost immediately). Max TTL raised to 30 days. The checkout countdown now formats multi-hour/day windows.
- **Merchant gateway on marketing + AI** — landing page gains an "Accept payments" section, nav and footer links, and a sitemap entry (`/merchant`); the AI assistant now explains the merchant gateway and points businesses to `/merchant` to accept crypto.

## 2.1.1 - 2026-07-13

**Merchant customer emails.**

- **Invoice email** — creating an invoice with a customer email sends the customer a branded email with the amount, description, and a "Pay with crypto" button.
- **Receipt email** — on payment confirmation the watcher emails the customer a receipt (amount paid, asset, transaction), alongside the merchant webhook.
- Best-effort (never blocks a request or the watcher), Reply-To is the merchant, reuses the existing SMTP config.

## 2.1.0 - 2026-07-13

**Payment gateway + merchant portal — accept crypto payments end-to-end.**

- **Real on-chain payment confirmation** — replaces the simulated confirm with a watcher that detects the ERC20 `Transfer` paying an invoice (via our own RPC proxy, 2-conf), flips the intent to `CONFIRMED`, and fires a **signed `payment.confirmed` webhook**. Non-custodial — funds settle straight to the merchant's wallet. Verified against a real Base USDC payment.
- **Merchant portal** (`/merchant`) — self-serve signup + a full dashboard: **POS** (amount → QR → live paid status), **invoices** (payable links), **payments/reports** (filter + totals + CSV export), **printable receipts**, and **settings** (receiving wallet + webhook).
- **Merchant API** — `POST /v1/merchant/register`, `GET /v1/merchant/me`, `GET /v1/merchant/payments`, `POST /v1/merchant/settings`, `GET /v1/payment_intents/:id/receipt`; payment intents now carry description / reference / customer / source. A tiny per-invoice amount entropy makes each payment match exactly one invoice.
- **Rails** — added **USDC on Base** (low-fee) alongside USDC/USDT/PYUSD on Ethereum.
- **Fixes** — fallback swap quotes no longer show a simulated "You receive"; partner earnings/statements count only on-chain-broadcast swaps; duplicate-script hardening.

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

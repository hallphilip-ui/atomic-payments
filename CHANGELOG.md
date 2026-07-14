# Changelog

## 2.8.1 - 2026-07-14

- **"Install app" button in the merchant portal** (Settings) — installs Atomic POS to the phone's home screen. On Android it fires the real install dialog; on iOS (which has no install API) it shows the Share → Add to Home Screen steps. Hidden once installed. Translated into all 15 languages.
- **Fix: the merchant portal was broken at phone width** — with a single column the sidebar and main became grid *rows*, and the nav stretched to fill half the screen; "Sign out" was also clipped off the right edge. Nav is now a compact scrollable tab strip, the topbar fits at 375px, and form rows stack instead of cramming into two columns. (Found by testing the PWA at phone size — the app merchants were meant to install.)

## 2.8.0 - 2026-07-14

**Installable iOS + Android apps (PWA) — Atomic Pay, Atomic POS, and Atomic Exchange.**

- **Three installable apps**, all served from their own origin so the **passkey wallet derives the same key and the same address** — a native app deriving it elsewhere would hand the user a different wallet:
  - **Atomic Pay** (`/defi-swap`) — the swap + wallet app.
  - **Atomic Merchant POS** (`/merchant`) — its own manifest and scope, so a merchant installs the point-of-sale to their phone home screen.
  - **Atomic Exchange** — the market dashboard.
- Full icon set (192/512/maskable/apple-touch), standalone display, theme colors, an Android install prompt and an iOS "Add to Home Screen" hint (dismissible, never blocking, disabled inside the embeddable checkout iframe).
- **The service worker deliberately caches no code.** This is a non-custodial wallet: a stale `passkey-wallet.js` or SRI-pinned `ethers` would be a security hole, so scripts, styles and API calls always go to the network. The only cached asset is a static offline page.

## 2.7.1 - 2026-07-14

- **Operator UI for the sanctions review queue** (`/admin-review`) — lists each held payment with the flagged payer (linked to the block explorer), amount, merchant, and transaction, and lets an operator **clear** (settle + release the withheld webhook/receipt) or **reject** it. Authenticates with the operator key (`x-atomic-operator-key`). Payments now record the `flaggedPayer` address when parked in REVIEW.

## 2.7.0 - 2026-07-14

**Compliance hardening + localization polish (counsel-doc follow-ups).**

- **Sanctions re-screening** — a periodic job re-screens every merchant's payout wallet against the OFAC list + keyless on-chain oracle (designations change over time). A wallet that becomes sanctioned flags the merchant, who can then no longer create charges (`ACCOUNT_UNDER_REVIEW`). Env: `ATOMIC_RESCREEN_POLL_MS` (default 12h), `ATOMIC_RESCREEN=0` to disable.
- **Operator disposition workflow for held payments** — sanctioned-payer payments (status `REVIEW`) now have operator-gated endpoints: `GET /v1/admin/review-queue` and `POST /v1/admin/review-queue/:id/decision` (`clear` settles + fires the withheld webhook/receipt; `reject` marks it rejected). Every decision is audit-logged. Portal shows a `REVIEW` pill + filter.
- **Treasury placeholder removed** — `/v1/swaps/config` no longer publishes a hard-coded example `platformTreasuryAddress`; it's env-driven (`ATOMIC_PLATFORM_TREASURY_ADDRESS`) and omitted when unset.
- **Cash-out fully localized** — off-ramp provider coverage notes are now translated (15 languages), and country names localize automatically via `Intl.DisplayNames`; both re-render live on a language switch.

## 2.6.0 - 2026-07-14

**Security + AML release. Closes a fund-loss path and screens the payment gateway for sanctions.**

- **🔴 Fund-loss path closed.** If a merchant had not set a receiving wallet, invoices rendered a hard-coded *example* address (`0xde0B29…697BAe`) that **nobody controls** — a customer paying one would have lost the funds permanently. A deposit address may now **only** be the merchant's own verified wallet: every placeholder address is deleted from the codebase, the payment-URI builder requires a destination (no fallback), a charge cannot be created or rendered without a receiving wallet, and rails that cannot be settled or confirmed (BTC/SOL/ETH) are refused outright.
- **🔴 Sanctions screening added to the merchant gateway**, which previously had none. The merchant payout wallet is now screened at signup and whenever it changes (a listed address is rejected). The **payer is screened before a payment is confirmed** — the address is read from the on-chain `Transfer` event the watcher already parses — and a hit parks the payment in a new **`REVIEW`** state with the merchant webhook and customer receipt **withheld**. Screening uses the local OFAC list plus the keyless on-chain Chainalysis oracle (US/EU/UN); a screening outage fails open so it cannot stall settlement.
- **Fund-flows summary for regulatory counsel** added at `docs/fund-flows-for-counsel.md` — documents every value path, where custody does and does not exist, both defects above (including the historical exposure window), and the open compliance gaps.

## 2.5.5 - 2026-07-14

**Off-ramp sandbox toggle — validate cash-out with test keys before KYB.**

- `ATOMIC_OFFRAMP_ENV=sandbox` points every off-ramp partner at its **staging host** (MoonPay `sell-sandbox`, Transak `global-stg`, Ramp `app.demo`, Banxa `banxa-sandbox`, Mercuryo sandbox), so the whole cash-out flow can be exercised with test keys before any partner KYB completes. URL signing (MoonPay/Mercuryo) still applies in sandbox.
- Any base host can be pinned with `ATOMIC_OFFRAMP_<PROVIDER>_BASE` — providers move their staging domains, and this avoids a code change when they do.
- **Fails safe:** a provider with no known sandbox host (Kado, Unlimit) drops out of "Live" in sandbox and hands off to its public page, rather than silently firing a test key at production.
- The merchant portal shows a **"Sandbox mode — test keys, no real money moves"** banner whenever the flag is on, so a test hand-off can't be mistaken for a real payout.

## 2.5.4 - 2026-07-14

- **Landing page now sells the cash-out** — the "For business" section leads with "Take crypto. Get paid in cash." and adds a **Cash out to your bank** card: withdraw to a bank account or card in your local currency via licensed partners across 160+ countries, selling from your own wallet (we never hold the money).

## 2.5.3 - 2026-07-14

- Local-currency equivalent now also shows on **receipts** — both the merchant portal's printable receipt and the customer's checkout receipt.

## 2.5.2 - 2026-07-14

- Local-currency equivalent now also shows under each amount in the merchant **Invoices** table (matching Payments and Overview).

## 2.5.1 - 2026-07-14

**Local-currency equivalents everywhere + region autodetect.**

- The "≈ local currency" equivalent now shows on the merchant **Overview** (paid volume) and **Payments** (confirmed volume + every row), not just the POS charge — driven by the currency picker.
- **Region autodetect** — when a visitor hasn't picked a currency, the default now follows their actual country (Cloudflare edge `/v1/geo`), which is more accurate than the browser locale (e.g. an en-US browser physically in the EU → EUR). Soft default: it keeps following region/language until the user explicitly chooses.

## 2.5.0 - 2026-07-13

**Fiat off-ramp partner integration — cash out to a bank, wired end-to-end.**

- **Server-side off-ramp backend** (`/v1/offramp/providers`, `/v1/offramp/link`) — the merchant portal's "Cash out" now builds prefilled sell links (USDC-on-Base → the merchant's fiat, with amount, wallet and currency filled in) for MoonPay, Transak, Ramp, Banxa, Mercuryo, Kado and Unlimit. Partner keys live only in server env; the links are **signed server-side** where the partner requires it (MoonPay, Mercuryo), so secrets never reach the browser. A provider shows a **"Live"** badge once its key is set; until then its button hands off to the provider's public page. Non-custodial throughout — the partner runs KYC and pays the merchant's own wallet.
- **Site-wide "← Home" button** injected on every page (skips embedded iframes and the home page itself).

## 2.4.1 - 2026-07-13

**Currency picker.**

- **A currency selector** sits beside the language picker (checkout footer, merchant topbar) so viewers can override the auto-detected currency; the choice persists and every displayed equivalent re-renders instantly. Built as a self-mounting `[data-atomic-currency-select]`, so any page gets a picker by dropping in one element.
- Fix: `atomicFx` re-render on currency/language change (the annotator was being passed the rates object as its root).

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

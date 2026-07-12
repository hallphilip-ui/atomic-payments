# Atomic Pay — Business & Marketing Plan

**Date:** 2026-07-10 · **Status:** working draft v1
**Product:** atomicpay.cloud — non-custodial cross-chain crypto swaps with a wallet-less front door (email + passkey + sponsored gas)
**Entity context:** Cradle Capital Corp (LI.FI integration account); non-custodial MSB posture reviewed and cleared by principal.

---

## 1. Executive summary

Atomic Pay lets anyone swap crypto across chains **with just an email and Face ID — no seed phrase, no wallet app, no gas token**. Under the hood it is a non-custodial routing layer on LI.FI; the product is not the routing (a commodity) but the **removal of every onboarding step that stops mainstream users**: wallet installation, seed-phrase custody, gas acquisition, and chain selection.

Two revenue lines, both live as of 2026-07-10:

1. **Direct consumer swaps** at ~2.5% net platform spread (customer pays ~2.75% + route costs).
2. **Partner Swap API ("Swaps-as-a-Service")** — white-label quote/execute API where partners stack up to 50 bps markup and earn a 50 bps revenue share; we net a flat 200 bps on partner-originated volume.

The full stack is proven end-to-end: first real cross-chain swap (8 USDC Base→Ethereum, gas-station-sponsored) completed 2026-07-10. Remaining pre-broad-launch gate: **external security audit** of the passkey wallet.

The strategy: win the **crypto-curious mainstream** — people who hold coins on an exchange or received crypto once and find "real" DeFi terrifying — where convenience justifies a premium fee, rather than compete on price for degen flow we would lose to Jumper/Rango on day one.

---

## 2. Product & current state (what is actually live)

| Capability | Status |
|---|---|
| Cross-chain swap engine (LI.FI: EVM chains + BTC + SOL) | Live |
| Email + passkey wallet (WebAuthn PRF → EOA, per-tx Face ID) | Live (mainnet), hardened, pre-external-audit |
| Gas station (sponsors gas for token-only wallets, Base) | Live, funded, first sponsored swap complete |
| Funding path (receive address + QR) | Live |
| Recovery (encrypted keystore kit, MetaMask-compatible) | Live |
| Multi-wallet connect (EIP-6963, WalletConnect, BTC/SOL/Tron) | Live |
| Sanctions screening (OFAC list + Chainalysis on-chain oracle + geo-block) | Live |
| Partner API + self-serve partner portal (/partners) | Live |
| Ops: P&L email, PostHog analytics + error tracking, bug tracker, backups, CF-locked origin | Live |
| Fiat on-ramp (card → crypto) | **Not built** — biggest funnel gap |
| Mobile app (atomic-mobile, Expo) | Prototype, not shipped |

**Honest gaps that shape the plan:** no fiat on-ramp means every new user must already hold crypto somewhere; recovery only protects users who download the kit; no external audit yet; fee is premium-priced vs. aggregators.

---

## 3. Market & problem

- Self-custody onboarding is the single largest drop-off in crypto. The standard flow (install extension → write down 12 words → buy ETH for gas → bridge) loses the overwhelming majority of mainstream users before their first transaction.
- Exchange users (Coinbase/Kraken retail) can swap easily but only within listed pairs, with custody, KYC friction for withdrawals, and no cross-chain self-custody.
- Existing cross-chain aggregator UIs (Jumper, Rango, LI.FI's own) are built **for people who already have wallets**. They compete on route quality and price, not onboarding.

**The wedge:** nobody owns "crypto swaps for people without a wallet." Passkeys (Face ID/Touch ID) finally make non-custodial key management invisible; sponsored gas removes the "you need ETH to move your USDC" absurdity. Atomic has both live today.

## 4. Positioning

> **"Swap any crypto, any chain — with just your email and Face ID. No wallet app. No seed phrase. No gas."**

- **Category:** don't say "DEX aggregator" (invites price comparison). Say **"the easiest way to swap crypto"** / self-custody without the homework.
- **Against exchanges:** no account approval, no custody, funds go straight to any address you choose.
- **Against wallets+aggregators:** nothing to install, nothing to write down, works in any browser.
- **Trust language matters more than feature language** for this audience: non-custodial, keys derived on your device, sanctions-screened, recovery kit. Publish a plain-English security page; the audit (when done) becomes a marketing asset.

**What we deliberately do not claim:** cheapest fees, deepest liquidity, most chains. Premium convenience, honestly priced.

## 5. Target segments (in priority order)

1. **Crypto-curious mainstream / "exchange-only" holders** — have coins on Coinbase/Kraken or received crypto (payment, gift, airdrop), never used DeFi. Need: convert/move it without learning wallets. This is the hero persona for all consumer copy.
2. **Partner businesses (B2B, via the API)** — apps, communities, fintechs, telegram bots, portfolio trackers that want a swap feature without building routing, compliance, or wallet infra. Each partner is a distribution channel; this is the scalable growth line.
3. **Existing wallet users who hate the friction** (secondary) — the multi-wallet connect path serves them; they arrive via SEO ("swap BTC to USDC without exchange") but we don't spend to acquire them.

Non-targets: high-frequency degens (price-sensitive, churn to Jumper), institutions (needs a different compliance posture).

## 6. Competitive landscape

| Competitor | What they are | Our angle |
|---|---|---|
| Jumper / Rango / LI.FI UI | Aggregator UIs for wallet-havers, ~0–0.25% fees | They require a wallet; we don't. Don't fight on price. |
| Coinbase / Kraken retail conversion | Custodial convenience, ~0.5–2% spreads all-in | We're non-custodial, no signup/KYC gauntlet, any chain, any destination address. |
| MoonPay / Ramp / Transak | Fiat on-ramps, ~1–4.5% | Complementary, not competitive — future funding-path integration. |
| Privy / Dynamic / Openfort-powered apps | Embedded-wallet infra other apps build on | We're a finished consumer product **and** sell the API layer ourselves. |
| Telegram trading bots | Easy but custodial and sketchy | Same ease, non-custodial, sanctions-screened, real recovery. |

**Realistic threat:** an incumbent (Coinbase, MetaMask, or Jumper) ships passkey onboarding + gas sponsorship. Window is probably 12–24 months. Response: move fast on distribution (partners), own the "email swap" search/mindshare early.

## 7. Business model & unit economics

**Consumer swap:** customer pays 2.5% platform spread + 0.25% LI.FI + route/bridge/gas costs (~2.75% headline, ~3–3.5% all-in on exotic routes). We net **~250 bps** of volume (fee forwarding to our wallets, all rails configured and collecting).

**Partner swap:** customer pays 250 bps + partner markup (≤50 bps). Partner earns 50 bps share + markup; **we net a flat 200 bps.**

**Variable costs per swap:** gas sponsorship ~0.00004 ETH (~$0.10–0.15) where used; RPC/infra effectively fixed (~$60/mo VPS + Alchemy free tier + PostHog free tier). Contribution margin on fees is >95%.

**Illustrative monthly revenue at net 2.0–2.5% take** (mix-dependent):

| Monthly volume | Net revenue |
|---|---|
| $100k | $2,000–2,500 |
| $1M | $20,000–25,000 |
| $10M | $200,000–250,000 |

At an average consumer swap of ~$500, $1M/month ≈ 2,000 swaps ≈ 65/day — a distribution problem, not an infrastructure one (current stack comfortably handles it).

**Pricing risks to manage:**
- 2.75%+ is defensible **only while the convenience gap holds**; revisit when any competitor ships passkey swaps.
- Route costs on BTC-via-NEAR-style paths push all-in toward 3.5%+ — consider capping or flagging expensive routes in the UI to protect trust.
- Track *actual* net take per route in the LI.FI portal vs. the P&L email; the flat-25bps LI.FI assumption does not hold on all routes.

**Later monetization (not now):** fiat on-ramp rev-share, premium partner tiers (webhooks, SLAs), spread on stable-to-stable "transfer" flows.

## 8. Go-to-market plan

### Phase 0 — Launch readiness (now → ~2 weeks)
- **Commission the external security audit** of the passkey wallet + gas station (the one remaining hard gate). Budget expectation: $10–30k for a focused review of `passkey-wallet.js`, RPC proxy, and gas endpoints.
- Instrument the funnel in PostHog: visit → connect-modal open → email wallet created → funded → first quote → first executed swap. This funnel IS the business; every marketing decision reads off it.
- Seed 10–20 real swaps ourselves/friends-and-family across routes; fix what breaks; capture testimonials and screen recordings.
- Tighten the landing page around the wallet-less promise (hero: "Swap crypto with your email — 60 seconds, no wallet app") with a real demo video.

### Phase 1 — Beta with a story (weeks 2–8)
Goal: 100 organic wallet-creating users, first 3 API partners, learn the funnel.
- **Launch content:** Product Hunt launch; a build-in-public technical write-up ("How we built a seed-phrase-free non-custodial wallet with passkeys") for HN/r/ethereum/dev Twitter — the passkey-PRF architecture is genuinely novel content and earns trust with exactly the skeptics who'd otherwise dismiss it.
- **SEO foundations:** programmatic route pages ("Swap BTC to USDC on Base", "Convert USDT from Tron to Ethereum") — high-intent, low-competition long-tail; the transfers explorer and help/FAQ pages already support this.
- **Partner outreach (founder-led):** 20 hand-picked targets — telegram/community bots, portfolio trackers, small wallets without swap, crypto newsletters/creators with tooling. Pitch: "add cross-chain swaps in an afternoon, earn up to 100 bps, we handle routing + compliance." The self-serve portal at /partners already removes integration friction.
- **Trust page:** publish security architecture, sanctions/compliance posture, audit status, terms — mainstream users convert on trust signals.

### Phase 2 — Public launch (months 2–4)
Trigger: audit complete + funnel converting + zero-incident beta.
- Announce audit completion (turn the security cost into the marketing headline: "audited, non-custodial, no seed phrase").
- **Fiat on-ramp integration** (MoonPay/Ramp/Transak widget into the receive flow) — this is the single highest-leverage product investment for marketing, because it makes "I have $0 crypto" a servable user and unlocks paid acquisition to a cold audience.
- Paid experiments only after funnel proof: small budgets on Google (high-intent swap queries) and crypto-native sponsorships (newsletters like Milk Road-style, YouTube explainers targeting beginners). CAC must clear ~2 swaps' worth of net fee to scale.
- Referral mechanic: fee-free swap (or fee rebate) for referrer and referee — cheap because the cost is forgone margin, and it fits the "invite your normie friend" wedge perfectly.

### Phase 3 — Partner-led scale (months 4–12)
- Make the API the primary growth engine: webhooks, docs page (serve PARTNER_API.md properly), sandbox keys, revenue dashboards, monthly partner payout automation (currently manual — must be automated before >5 active partners).
- Vertical plays: creator/community tipping, cross-chain payroll/payouts, game economies — anywhere a business needs "user receives token X but wants token Y."
- Mobile: ship the Expo app (or a PWA wrapper — passkeys work great in Safari/Chrome) once web funnel is proven.

## 9. Marketing channels — summary of bets

| Channel | Why | Cost | Phase |
|---|---|---|---|
| Technical build-in-public content (passkey architecture) | Earns trust + reaches partner devs | Time | 1 |
| Product Hunt / HN launch | Free spike + backlinks | Time | 1 |
| Programmatic SEO route pages | Compounding high-intent traffic | Low | 1→ |
| Founder-led partner outreach | Each partner = permanent channel, 200 bps net | Time | 1→ |
| Referral (fee rebates) | Fits normie-invite motion, margin-funded | Forgone fees | 2 |
| Paid search + crypto sponsorships | Scale only after funnel proof + on-ramp | $2–5k/mo tests | 2–3 |
| X/Twitter presence + demo videos | Category education ("no seed phrase" demos are inherently viral-ish) | Time | 1→ |

## 10. Metrics that matter (PostHog project 501957)

- **North star: completed swap volume (weekly).**
- Funnel: visitor → wallet created → wallet funded → first swap (target ≥25% wallet→first-swap within 7 days; instrument before guessing).
- Net take per swap by route (reconcile vs. LI.FI portal — known variance on exotic routes).
- Partner metrics: partners activated, partner-originated volume %, time-to-first-partner-swap.
- Trust/health: swap failure rate, support tickets per 100 swaps (bug tracker + `bug_reported` events), gas-station spend per swap.
- Retention: % of swappers who swap again within 30 days.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Security incident in passkey wallet (existential — funds + brand) | External audit before broad launch; per-tx Face ID, SRI-pinned ethers, CSP already in place; bug bounty later. |
| Regulatory drift (non-custodial posture challenged; FinCEN/state MTL interpretations shift) | Stay strictly non-custodial; sanctions screening + geo-blocks live; periodic counsel check-ins; partner ToS pushes end-customer compliance duties appropriately. |
| Fee compression when competitors copy passkey UX | Build partner moat + brand now; be ready to drop consumer fee to ~1.5% and make it up on volume/on-ramp share. |
| Recovery failures (user loses passkey + never downloaded kit → funds stranded) | Push backup nudge harder; roadmap: server-side encrypted escrow or 4337 social recovery; measure kit-download rate as a KPI. |
| LI.FI dependency (single routing vendor) | Adapter layer already abstracts providers (Rango/THORChain adapters exist); acceptable for now, revisit at scale. |
| Solo-operator key-person/ops risk | Backups + off-site replication done; document runbooks (largely done); automate partner payouts before scaling that channel. |
| Route-cost surprises erode trust (all-in ~3.5% on some paths) | Show all-in cost transparently pre-swap; suppress or warn on egregious routes. |

## 12. 90-day action plan

**Weeks 1–2:** commission audit · PostHog funnel dashboards · landing-page rewrite around wallet-less hero + demo video · 10 seeded real swaps · trust/security page.
**Weeks 3–6:** technical blog post + HN/PH launch · first 10 partner conversations · programmatic route pages live · referral design.
**Weeks 7–12:** audit published · fiat on-ramp widget · first 3 partners live with real volume · paid-channel tests ($2–5k) · decide mobile (PWA vs Expo) based on funnel data.

**Success criteria at day 90:** audit clean and published; ≥100 wallets created; ≥$100k cumulative swap volume; ≥3 revenue-generating partners; wallet→first-swap conversion measured and ≥15%.

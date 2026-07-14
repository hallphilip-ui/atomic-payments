# Atomic Pay — Fund Flows Summary (for regulatory counsel)

**Prepared:** 2026-07-14 · **Version reviewed:** v2.5.5 · **Prepared by:** engineering

**Purpose.** A factual description of how value moves through Atomic Pay, so counsel can assess money-transmission / VASP / MiCA exposure. This document makes **no legal conclusions**. Terms like "non-custodial" are used here in their *technical* sense (we hold no private key that can move the asset); whether that maps to a legal conclusion is exactly what we are asking counsel to determine.

**The central factual question for each flow:** *does Atomic ever hold, control, or transmit a customer's asset?*

---

## 1. Summary matrix

| # | Flow | Does Atomic custody customer funds? | Does Atomic move value it controls? | Live today? |
|---|------|---|---|---|
| 1 | Merchant payment gateway (accept crypto) | **No** | No | **Yes** |
| 2 | Cross-chain swap (consumer) | **No** | No (fee collected by 3rd party — see §2) | **Yes** |
| 3 | Passkey wallet (email + Face ID) | **No** — key never leaves user device | No | **Yes** |
| 4 | Gas station | No | **Yes — our own ETH** (de minimis) | Operator to confirm |
| 5 | Partner commission payouts | No | **Yes — our own USDC treasury** | Operator to confirm |
| 6 | Fiat off-ramp ("cash out") | **No** — licensed partner is counterparty | No | Built; **no partner keys set** |
| 7 | Off-exchange settlement / FX engine | n/a | n/a | **Not live** (simulation) — operator to confirm |

**Where counsel should concentrate:** flows **4, 5 and 6**. Flows 1–3 are architecturally non-custodial; 4 and 5 are Atomic disbursing *its own* property; 6 is where our commercial positioning has recently moved (see §8).

---

## 2. Flow-by-flow

### Flow 1 — Merchant payment gateway (accepting crypto)

1. Merchant registers, and sets **their own wallet address** (`receiveAddress`) in the portal.
2. Merchant creates a charge (POS QR or emailed invoice). Atomic issues a `PaymentIntent` and displays a **deposit address that is the merchant's own address** — not an Atomic address.
3. The customer sends USDC / USDT / PYUSD **from their own wallet directly to the merchant's wallet**. The asset never passes through an Atomic-controlled address.
4. Atomic's "payment watcher" **observes the public blockchain** (`eth_getLogs`) to detect the incoming transfer, then marks the invoice paid, fires a webhook, and emails a receipt.

- **Custody:** none. Atomic holds no key on this path and cannot move the asset.
- **Atomic's role:** invoicing, address display, and *observation* of a public ledger.
- **Fee:** **Atomic currently takes no fee on merchant payments.** 100% of the payment goes to the merchant.
- **Supported assets:** EVM stablecoins only (USDC on Base; USDC/USDT/PYUSD on Ethereum).

> ⚠️ **Defect to disclose (see §7.1):** if a merchant has *not* set a `receiveAddress`, the code currently substitutes a hard-coded placeholder address that **no one controls**, and customer funds sent to it are permanently lost. This is a live code path. Engineering is remediating; flagged here because it is a consumer-harm issue counsel should know about.

### Flow 2 — Cross-chain swap (consumer)

1. User connects a wallet (or uses the passkey wallet, Flow 3).
2. Atomic requests a route/quote from **LI.FI**, a third-party cross-chain aggregator.
3. LI.FI returns an unsigned transaction. **The user signs and broadcasts it from their own wallet.**
4. Funds move: **user's wallet → LI.FI's router contract → user's chosen destination address.** No Atomic address is in the path.

- **Custody:** none. Atomic cannot sign; the user signs every transaction.
- **Atomic's revenue:** an **integrator fee of 2.5% (250 bps)** configured with LI.FI. **LI.FI collects it** and routes it to fee wallets registered by Atomic in the LI.FI portal. So Atomic *does receive value* — as a fee, collected and remitted by a third party, not by taking custody of the user's principal.
- **Controls in force:** sanctions screening (below), a **$1,000,000 max swap size** (hard refusal), and a price-impact halt.

### Flow 3 — Passkey wallet ("email + Face ID")

- The private key is **derived on the user's own device** from a WebAuthn passkey (PRF extension). It exists only transiently in browser memory at signing time and is discarded immediately after.
- Atomic's database stores **only** an email → credential-ID + public address mapping. **We never store, transmit, or have access to the private key**, and cannot reconstruct it.
- Atomic therefore **cannot move a user's funds, under any circumstance**, including under compulsion.
- **Custody:** none. This is the strongest factual basis for the non-custodial characterisation.

### Flow 4 — Gas station ⚠️ *Atomic moves its own funds*

- An **Atomic-operated hot wallet** dispenses a very small amount of **native ETH on Base** to a user who holds tokens but has no gas to transact.
- This is **Atomic disbursing its own property to a user, gratuitously.** It is *not* the transmission of a customer's funds.
- **Hard limits in code:** ~0.00004 ETH per drop (cents), a **0.01 ETH/day global cap**, a 6-hour per-address cooldown, and refusal if the wallet already holds gas.
- **Question for counsel:** does gratuitously disbursing our own de-minimis property constitute a regulated activity?

### Flow 5 — Partner commission payouts ⚠️ *Atomic moves its own funds*

- Business partners using the Partner Swap API earn a commission (a 50 bps revenue share out of our 250 bps, plus an optional markup they set).
- Atomic pays these commissions in **USDC on Base from an Atomic-controlled treasury wallet**.
- This is **Atomic paying its own commercial obligations (B2B commissions) from its own treasury** — not transmitting customer funds.
- **Controls:** operator-authenticated endpoint only; payouts are gated on **on-chain verification that the underlying swap actually settled** (via LI.FI's status API); idempotent (claim-before-send); and capped by a **$25,000 single-run circuit breaker**.

### Flow 6 — Fiat off-ramp / "cash out" ⚠️ *the key positioning question*

1. In the portal, the merchant clicks a provider under "Cash out".
2. **Atomic's server builds — and, where the provider requires it, cryptographically signs — a deep link** to a **licensed third-party off-ramp** (MoonPay, Transak, Ramp, Banxa, Mercuryo, Kado, Unlimit). The link pre-fills the merchant's own wallet address, the amount, and the payout currency.
3. The merchant is redirected to **the partner's own hosted widget**.
4. **The partner** then: performs KYC/AML on the merchant, receives the crypto **from the merchant's own wallet**, converts it, and pays **fiat into the merchant's own bank account or card.**

- **Custody:** Atomic never receives the crypto or the fiat, and is not a party to the conversion or the payout. The **partner is the counterparty of record** to the merchant.
- **Atomic's role:** routing/referral, plus pre-filling parameters.
- **Revenue:** referral fees *may* be earned from partners. **None are configured today** — no partner keys are set in production, so **no referral revenue currently flows** and buttons simply open the provider's public page.
- **This is the flow most likely to be contested.** See §8.

### Flow 7 — Off-exchange settlement / FX quote engine

A settlement/FX-quote module exists in the codebase but, to engineering's knowledge, **is not live for real funds** (simulation mode). *Operator to confirm before relying on this statement.*

---

## 3. Compliance controls currently implemented

### 3.1 Sanctions screening — mechanism

Two layers, **both always active** (neither requires a vendor contract or API key):

1. **Local OFAC SDN address list** — offline, deterministic, no network dependency.
2. **Chainalysis on-chain sanctions oracle** — a **public smart contract**, called **keylessly** (no registration, no API key, no vendor agreement). We call `isSanctioned(address)` via our own RPC node. It screens **US, EU and UN** designations and is maintained by Chainalysis.

Behaviour: a hit **blocks** the action (HTTP 403). If the oracle is unreachable, the system logs and falls back to the local OFAC list, which remains authoritative. The oracle covers **EVM addresses only**; non-EVM addresses (BTC, Solana, Tron) are screened against the local list only.

### 3.2 Sanctions screening — where it is applied

| Point of control | Screened | Effect on a hit |
|---|---|---|
| Swap quote (consumer) | source + destination address | Quote **BLOCKED** (403); compliance review recorded |
| Settlement withdrawal | destination address | **BLOCKED** |
| **Merchant payout wallet** (at signup **and** in Settings) | the wallet itself | **Rejected** — cannot be set (403 `SANCTIONS_BLOCKED`) |
| **Incoming merchant payment** (the payer) | payer's address, read from the on-chain `Transfer` event | Payment is **NOT confirmed**. It is parked in a **`REVIEW`** state; the merchant webhook and the customer receipt are **withheld** pending human review. |

*(The final two rows were added on 2026-07-14. Prior to that date the merchant payment gateway had no sanctions screening — see §7.3.)*
- **Jurisdiction blocking** by IP country (Cloudflare `CF-IPCountry`); default blocked set: CU, IR, KP, SY.
- **Large-transfer flag** at **≥ $10,000** — raises a risk score and sets a `large_transfer_threshold` flag. **This is a review signal, not a block.**
- **Maximum swap size: $1,000,000** — hard refusal with a user-facing reason.
- **Per-merchant transaction limits** (optional min/max per charge), enforced server-side.
- **Compliance review records** persisted per swap quote (risk score, tier, flags, vendor decision).
- Rate limiting; operator-plane authentication; audit logging.

## 4. Compliance gaps (stated plainly)

These remain **open** after the 2026-07-14 remediation.

1. **No merchant KYB / onboarding diligence.** Merchant signup is fully self-serve: business name + email only, neither verified. This was a deliberate deferral ("merchant contracts later"). A payment gateway with no merchant diligence is an AML weak point **irrespective of custody**, and is likely our single largest open exposure.
2. **No KYT / transaction-monitoring programme.** Sanctions screening is a list check; it is *not* behavioural monitoring, and it is *not* an AML programme.
3. **No designated compliance officer, written AML/CFT policy, or SAR/STR filing process** — *operator to confirm*.
4. **Travel Rule (FATF R.16): not implemented.**
5. **No jurisdiction restriction on merchant signup** (IP-based country blocking applies to swaps, not to merchant onboarding).
6. **No sanctions re-screening.** Addresses are screened at the point of use, not re-screened when OFAC designations change. A wallet designated *after* it was set as a merchant payout address would not be caught retroactively.
7. **`REVIEW` payments have no formal disposition workflow** — a held payment is visible in the portal, but there is no documented process (or record) for who reviews it, on what criteria, or how it is cleared or reported.

---

## 5. Entities, keys and addresses

| Item | Detail |
|---|---|
| Customer/merchant funds | Held **only** in wallets the customer/merchant controls |
| Atomic-controlled keys | (a) **gas-station** hot wallet (native ETH, Base); (b) **payout treasury** (USDC, Base). Both hold *Atomic's own* funds only. |
| Swap fee wallets | Registered by Atomic in the **LI.FI portal**; LI.FI remits the integrator fee to them |
| Third parties in the value path | **LI.FI** (swap routing), **off-ramp partners** (fiat conversion). Neither is an Atomic affiliate. |

---

## 6. Volume / activity

*To be completed by the operator — engineering cannot attest to this.* Counsel will need: transactions to date, total value routed, whether any real merchant payment has occurred, and the geographic distribution of users.

---

## 7. Defects identified — and remediation status

These were found during preparation of this document and are disclosed deliberately.

### 7.1 🔴 Placeholder deposit address (fund loss) — **FIXED 2026-07-14**

**What it was.** If a merchant had not set a `receiveAddress`, the code substituted a hard-coded public *example* address (`0xde0B29…697BAe`, taken from Ethereum documentation) as the invoice's deposit address. **Nobody controls that address.** A customer paying such an invoice would have sent real USDC to it, and the funds would be permanently unrecoverable. Equivalent placeholders existed on the Solana and Tron rails.

**Exposure — investigated and closed out; NO FUNDS WERE LOST.** The path was reachable in production. It has been verified on-chain and against our own records that **no customer funds were lost**:

- **Our records:** exactly **one** payment intent ever rendered the placeholder address — an internal **test invoice** created by engineering on 2026-07-13 for $1.00 (requiring `1.003201` USDC on Base). It was never paid. **Across the gateway's entire history there have been 3 payment intents and ZERO confirmed payments** — no real merchant or customer had transacted before the defect was fixed.
- **On-chain (BaseScan, USDC on Base):** the placeholder address has received exactly **three** USDC transfers in its entire history — 0.0001, 2.969999 and 0.1 USDC — which sum precisely to its current balance (3.070099), confirming the list is complete. All three are **81–345 days old**, i.e. they **predate this product entirely**, and **none matches the `1.003201` amount** of the only exposed invoice.
- The address's other balances (≈9,774 ETH, ≈1,021 USDC and ≈1,074 USDT on Ethereum) are unrelated third-party funds: it is a widely-published *example* address from Ethereum documentation and has accumulated mistaken sends from the public for years.

**Conclusion:** the defect was genuine and would have destroyed customer funds, but it was remediated before any customer was exposed to it.

**Fix.** A deposit address may now **only** be the merchant's own verified wallet. Specifically: (a) every placeholder address has been deleted from the codebase; (b) the payment-URI builder now *requires* a destination and has no fallback; (c) a charge **cannot be created** unless the merchant has set a valid receiving wallet; (d) `select_chain` refuses to render a payable address without one; and (e) rails that cannot be safely settled or confirmed (BTC/SOL/ETH/etc.) are now refused outright.

### 7.2 🟡 Misleading treasury address — outstanding

A public config endpoint reports a `platformTreasuryAddress` that is a well-known *example* address, not a real Atomic treasury. It is **not** a fund destination and no value routes to it, but it should not be published as though it were.

### 7.3 🔴 No sanctions screening on the payment gateway — **FIXED 2026-07-14**

**What it was.** Sanctions screening existed, but was invoked **only** on swap quotes and settlement withdrawals. **The merchant payment gateway — the live, revenue-facing product — performed no screening at all.** A sanctioned party could have registered as a merchant and set a designated address as their payout wallet; and payments *from* a sanctioned address were confirmed, webhooked and receipted with no check, even though the payer's address was already visible to the system in the on-chain `Transfer` event it reads.

**Fix.** Screening now runs at both points (see §3.2): the merchant payout wallet is screened at signup and whenever it is changed; and the payer is screened before a payment is confirmed, with a hit parking the payment in `REVIEW` and withholding the webhook and receipt.

**Counsel should note the historical window:** the gateway was live *without* this control prior to 2026-07-14.

---

## 8. Specific questions for counsel

1. Do Flows 1–3 (non-custodial gateway, user-signed swap routing, device-held key wallet) constitute **money transmission** (US: FinCEN MSB + state MTL) or a **crypto-asset service** (EU: MiCA CASP; UK: FCA cryptoasset registration) — notwithstanding that we never hold a key?
2. **Flow 6 is our biggest concern.** We (a) build and **sign** the link to the off-ramp, (b) pre-fill the transaction parameters, (c) may earn a **referral fee**, and (d) **now advertise "Take crypto. Get paid in cash." on our public landing page.** Does that combination convert Atomic from a *referrer* into a regulated *intermediary / arranger* — even though a licensed partner is the counterparty and executes the conversion? **Is our marketing now ahead of our regulatory posture?**
3. Does taking a **2.5% integrator fee** on swaps (collected and remitted by LI.FI) undermine a "neutral software provider" characterisation?
4. Do **Flow 4** (disbursing our own de-minimis ETH) or **Flow 5** (paying our own B2B commissions from our own treasury) create transmission exposure?
5. What **entity structure and licensing** is required for our target markets (US, EU, UK, and an intended APAC expansion)?
6. What **merchant KYB** is required before onboarding real merchants, and does our lack of it create liability today?
7. Do we need **written confirmation from each off-ramp partner** that they are the counterparty of record and Atomic is a mere referrer? (Engineering recommends obtaining this regardless.)

## 9. Items for the operator to confirm

- Legal entity, jurisdiction of incorporation, and current registrations.
- Whether the **gas station** and **payout treasury** keys are funded and live in production.
- Whether the **Chainalysis** sanctions oracle key is set in production (i.e. whether live screening is actually on).
- Whether the settlement/FX engine (Flow 7) is live for real funds.
- Transaction volume and value to date (§6).

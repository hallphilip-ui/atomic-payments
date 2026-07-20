# Atomic Earn — Aave Vaults scoping

**Status:** scoping only. Nothing built, no contract deployed, no funds moved.
**Date:** 2026-07-20
**Question asked:** can Aave Earn Vaults become a supply/earn surface in Atomic — the
"be our own lender/bank" idea — and what would it take?

---

## Verdict

**Architecturally: yes, and it fits our non-custodial posture better than expected.**
Aave Earn Vaults are ERC-4626 `ATokenVault` contracts. The user signs a deposit from
their own wallet and holds redeemable shares; Atomic never takes custody. A vault
manager can levy a performance fee **on yield only, never principal** — so there is a
native revenue model that does not require us to hold anything.

**Update 2026-07-20 — contract read complete (§6.1).** Depositor principal is protected
from the vault *owner* in the current implementation: withdrawals cannot be paused,
`withdrawFees` is capped at accrued fees, and `emergencyRescue` is explicitly barred
from the aToken. But two things must be disclosed to any depositor: the owner can raise
the performance fee to **100% of yield** instantly and without timelock, and can
redirect **all reward emissions** to itself. And the binding risk is **proxy admin** —
the vault is upgradeable behind a proxy whose admin is a different address from the
owner; whoever holds that key can replace the implementation and reach principal. That
must be verified per-deployment before integrating, and it is not answerable from source.

**Commercially: it is a retention play, not a revenue driver.** See the arithmetic
below — at plausible early TVL the fee income is negligible next to swap fees.

**The real blockers are not Aave.** They are (1) we have no authenticated user session,
and (2) we have no stateful position layer. Both are prerequisites, both are
substantial, and neither is Aave-specific.

**The gating question is regulatory, not technical**, and it needs counsel before any
build — not after.

---

## 1. What Aave Earn Vaults actually are

Sourced from Aave's docs (see Sources at the end).

| Property | Detail |
|---|---|
| Standard | ERC-4626 tokenized vault (`ATokenVault`) |
| Mechanism | Vault supplies deposits into the Aave v3 market, receives aTokens which accrue |
| User holds | Vault shares — a proportional claim on principal + accrued yield |
| Deposit / withdraw | Standard `deposit`/`mint`, `withdraw`/`redeem` |
| Fee | Performance fee on **yield only**; settable as low as 0%, no documented maximum |
| Fee split | **50% of the fee is automatically allocated to Aave Labs** |
| Manager controls | Fee parameters, fee recipient, explicit fee collection |
| Init params | `owner`, `initialFee`, `shareName`, `shareSymbol`, `initialLockDeposit` |

Flash loans, for the record, are the wrong primitive for a lending business and always
were: they are atomic and uncollateralised, so nothing persists past the transaction.
Vaults and credit delegation are the primitives that actually match the ambition.

---

## 1a. Alternative venue — Balancer v3 Boosted Pools

Folded in 2026-07-20 after evaluating Balancer alongside the flash-loan work. It is the
other credible venue for the same "put idle balances to work" goal, and it changes the
economics in one specific way worth recording.

**What it is.** Balancer v3's **100% Boosted Pools** route *all* underlying pool liquidity
into Aave lending markets (as aTokens) for yield, while keeping it available for swaps.
A depositor therefore earns **two stacked streams**: Aave supply yield **plus** the swap
fees the pool collects. Same non-custodial, ERC-4626-style share model as the Aave vault.

**Why it is interesting here, and where it isn't.**

| Dimension | Aave `ATokenVault` (§1) | Balancer Boosted Pool |
|---|---|---|
| Yield source | Aave supply APY only | Aave supply APY **+ swap fees** |
| Extra risk taken | none beyond Aave | **impermanent loss / LP exposure** on the pool's assets |
| Best fit | single-asset idle USDC | paired/correlated assets a user already holds |
| Fee to us | performance fee (half to Aave Labs) | Balancer LP dynamics; no clean per-vault fee handle |
| Protocol fee | — | v3 takes 10% of yield (down from v2's 50%) |
| New trust surface | vault owner + proxy admin (§6) | **+ Balancer Vault + the pool's hooks** |

**The honest read.** Boosted Pools are a genuinely better *yield* than the plain Aave
vault **for assets where LP exposure is acceptable** — a stablecoin-pair or
correlated-pair depositor gets swap fees on top of lending yield. But that extra return is
not free: it is compensation for **impermanent loss**, which the single-asset Aave vault
does not carry. So this is not a strict upgrade; it is a different risk/return point.

For Atomic specifically, two frictions: (1) there is no clean per-vault performance-fee
hook the way `ATokenVault` has, so the revenue story is even weaker than §4's already-weak
one; and (2) it adds the Balancer Vault **and** the pool's hooks as trust surfaces on top
of the Aave and proxy-admin surfaces §6 already flags — more code that must be sound
before user funds sit behind it.

**Recommendation:** treat Boosted Pools as a **Phase 2+ option for correlated-asset
deposits**, not the starting point. Launch, if Earn proceeds at all, on the plain Aave
vault (simpler, no IL, clean fee handle); offer a Boosted Pool later for users who
explicitly want swap-fee yield and understand the IL trade. Do **not** default anyone's
idle balance into an LP position — that silently converts a lender into a liquidity
provider, which is a different product with a different risk they did not choose.

---

## 2. Fit against our architecture

### What helps

- **We are strictly non-custodial and it is enforced, not merely claimed.** No user
  private key is generated or stored server-side anywhere in `src/`. The passkey wallet
  re-derives its key per signature behind a fresh Touch ID and discards it
  (`public/passkey-wallet.js:226-236`). `wallet-bridge.html` is an origin-locked signer
  iframe, not a custodian.
- **The swap flow is already quote → user-signs → verify → broadcast**, with the server
  only *verifying* signatures (`src/cryptoCore/authorizationSignature.ts`). A vault
  deposit is the same shape: build a transaction, user signs it, we observe the result.
- **Base is already the warm path.** The gas station covers Base
  (`src/routes/gas.ts:33`, default chain `8453`), and Base USDC is live-routable
  (`src/cryptoCore/tokens.ts:82-98`).
- **Sanctions screening already exists and fails safe** (`src/compliance/`), including
  OFAC address lists, an optional Chainalysis oracle, and jurisdiction blocking.

### What is missing — and these are the real cost

**A. No authenticated user session.** This is the single biggest blocker.
`src/routes/users.ts` has no token, cookie, or JWT — identity is "whoever POSTs an
address." Swaps get away with this because every action is ultimately gated by an
on-chain signature. A product that renders *"your position, your accrued interest, your
withdrawable balance"* has no safe way to authorize even a **read** today. Note the
file's own history (`src/routes/users.ts:20-25`): the previous unauthenticated user
endpoints were removed for IDOR. That pattern must not be reintroduced.

*Needed:* SIWE-style signed sessions, or per-action signature gating on every endpoint.

**B. No stateful position layer.** There is no `Balance`, `Position`, `Deposit`, or
`Vault` model in `prisma/schema.prisma`, and no yield/APY/accrual code anywhere in the
codebase — an exhaustive grep returned two incidental hits, both about fee revenue.
Swaps are stateless quote→sign→broadcast. Yield is inherently stateful over time
(principal, share price, accrual, harvest, withdrawal). This is a new data layer, not
an extension of `SwapQuote`.

**C. No user KYC of any kind.** Compliance today is sanctions + jurisdiction + address
format. There is no identity verification, no tiering, no document flow. See §5.

---

## 3. Proposed design — protocol-direct, non-custodial

The only design that preserves our custody posture:

```
User wallet ──signs deposit──> Aave ATokenVault (ERC-4626) ──supplies──> Aave v3 market
     ↑                                    │
     └────── holds vault shares ──────────┘
Atomic: builds the tx, renders the position, takes a performance fee on yield.
        Never holds assets, never holds shares, never signs.
```

**Explicitly rejected: any pooled design where Atomic aggregates user funds.** That
makes us a custodian, contradicts custody claims hardcoded across the product
(`src/seo/swapLandingPages.ts:181-185`, `src/routes/assistant.ts:27`,
`src/notify/merchantEmail.ts:19`), and changes the entire compliance posture. Not a
close call.

**Launch scope if it proceeds:** Base USDC only. One chain, one asset, one vault.
Base because the gas station already covers it and USDC because it is the deepest,
least volatile supply market.

**Integration points** (path of least resistance, mirroring `/defi-swap`):
- `earn.html` at repo root + `app.use('/earn', ...)` in `src/index.ts` alongside the
  swap page handler (`src/index.ts:307-315`) — with `X-Frame-Options: DENY` and
  `CSP_SWAP`, since it is a funds page.
- `src/routes/earn.ts`, registered next to `app.use(swapRoutes)` (`src/index.ts:127`).
- New Prisma models for positions.
- Exchange front-end: a `functions/api/earn.js` Pages proxy following the `fx.js`
  pattern — required, because `public/_headers:6` sets `connect-src 'self'`.

**Must use broadcast mode `live` only, never `live_with_fallback`** — that mode
silently fabricates a tx hash on failure (`src/cryptoCore/walletBroadcastAdapters.ts:141-143`).
Tolerable for a swap demo; for a deposit ledger it would record a position movement
that never happened on-chain.

---

## 4. Economics — the honest version

Performance fee applies to **yield**, and **half goes to Aave Labs**.

Assume USDC supply APY ≈ 4.5% and a 10% performance fee:

| TVL | Annual yield | Fee (10%) | **Atomic keeps (50%)** |
|---|---|---|---|
| $100k | $4,500 | $450 | **$225** |
| $1M | $45,000 | $4,500 | **$2,250** |
| $10M | $450,000 | $45,000 | **$22,500** |

For comparison, our swap integrator fee is 250 bps (`src/cryptoCore/swapConfig.ts:2`).
**A single $100k swap earns $2,500 — more than $1M of vault TVL earns in a year.**

That is not an argument against building it, but it disqualifies "new revenue line" as
the reason. The honest cases for Earn are: somewhere for idle post-swap balances to sit,
a reason to return between swaps, and a foundation for credit delegation later. If the
goal is revenue this quarter, this is the wrong project.

Raising the fee does not rescue it — high performance fees on a commodity USDC yield
just push users to Aave's own front-end, which is one click away and charges nothing.

**Boosted Pools (§1a) do not fix the revenue problem either.** They raise the *depositor's*
yield (Aave APY + swap fees) but not *our* cut — there is no clean per-vault fee handle,
and Balancer's protocol already takes 10% of the yield. So the extra return accrues to the
user (in exchange for IL risk), not to Atomic. Same conclusion: Earn is a retention and
foundation play, not a revenue line, and Boosted Pools reinforce rather than change that.

---

## 5. Regulatory — the gating question

**This needs counsel before a line of code, not after.** I am not qualified to clear it,
and this section is a flag, not advice.

Paying or advertising yield to retail is a materially different regulatory posture from
facilitating a swap. Custodial retail yield programs have been treated as unregistered
securities offerings in the US (BlockFi, Celsius, Gemini Earn). A **non-custodial,
protocol-direct** interface where the user signs and holds their own position is a
meaningfully different and much more defensible fact pattern — but "we merely provide
an interface" is a claim regulators test rather than accept, and the answer varies by
jurisdiction.

Specific things to put to counsel:
1. Does a non-custodial ERC-4626 interface where Atomic takes a performance fee
   constitute an investment contract / deposit-taking in our target jurisdictions?
2. Does taking a fee on yield undercut the "we are merely an interface" position?
3. What disclosure is required about the risks in §7?
4. Does this trigger user KYC obligations we currently have no scaffolding for?
5. Can it be geo-fenced with the jurisdiction machinery we already have
   (`CF-IPCountry`, `src/compliance/complianceProvider.ts:52-56`)?

---

## 6. Open questions requiring verification before any build

I did not verify these and would not proceed without doing so:

1. ~~**What powers does the vault `owner` actually hold?**~~ **ANSWERED 2026-07-20** by
   reading [ATokenVault.sol](https://github.com/aave/Aave-Vault/blob/main/src/ATokenVault.sol).
   There are exactly four `onlyOwner` functions: `setFee`, `withdrawFees`,
   `claimRewards`, `emergencyRescue`.
   - **Principal is protected in this implementation.** `withdrawFees` is bounded by
     `require(amount <= _s.accumulatedFees)`; `emergencyRescue` carries
     `require(token != address(ATOKEN), "CANNOT_RESCUE_ATOKEN")` — and since user
     principal is held as the aToken, that single `require` is what stops it being a
     rug function. No code path moves another account's shares.
   - **There is no pause.** No `Pausable`, no `whenNotPaused`; `deposit`/`withdraw`
     carry no access modifier. Depositors can always exit. (Aave *itself* pausing the
     reserve is a separate availability risk, and is governance's lever, not ours.)
   - **But the owner can take 100% of yield.** `setFee` is bounded only by
     `require(newFee <= SCALE)` where `SCALE = 1e18` — i.e. 100%. No cap, no timelock,
     no notice. It applies only to future yield (`_accrueYield()` runs first), and only
     to yield, never principal. The docs' "at least 10%" is a *minimum* platform policy,
     not a maximum, and offers depositors nothing.
   - **The owner also captures all reward emissions** via `claimRewards(address to)`.
     Depositors have no claim on Aave incentives. This is value extraction beyond the
     stated performance fee and would have to be disclosed.
   - **The decisive risk is the proxy admin, not the owner.** The contract is
     `ERC4626Upgradeable`/`OwnableUpgradeable` behind a proxy, and Aave's docs note it
     deliberately does not initialize `OwnableUpgradeable` "to avoid setting the proxy
     admin as the owner" — confirming proxy admin is a *separate* address. Whoever
     holds it can replace the implementation and reach principal regardless of
     everything above. **This is now the single most important open item**, and it
     cannot be answered from source: it requires reading the EIP-1967 admin slot on
     the specific proxy. If that admin is an EOA or a non-timelocked multisig, treat
     depositor principal as **not** safe.
2. ~~`initialLockDeposit`~~ **ANSWERED.** It is the **deployer's** capital, deposited at
   `initialize`, with shares minted to `address(this)` — the vault itself. There is no
   unlock function and no expiry: it is **permanent**, effectively a burn. It exists to
   block the ERC-4626 first-depositor inflation/donation attack, and must be sized
   non-trivially against the asset's decimals — passing 1 wei does not mitigate it.
3. ~~Is there a documented maximum performance fee?~~ **ANSWERED: no meaningful maximum**
   — see item 1, bounded only at 100%.
4. **V3 vs V4.** Aave's docs now list V4 as current with V3 as "previous version." The
   vault documentation sits under V3. Building on a superseded version needs a
   deliberate decision, and V4's liquidity model (hubs/spokes/reserves) is a different
   architecture, not a version bump.
5. Withdrawal liquidity: what happens when Aave utilisation is high and the market
   cannot service an immediate withdrawal? The vault docs are silent; this is the
   failure mode users will actually hit and must be surfaced in the UI honestly.
6. **Balancer Boosted Pools (§1a) — trust surfaces unverified.** If a Boosted Pool is
   ever offered, the Balancer Vault and the specific pool's **hooks** become additional
   trust surfaces beyond Aave and the proxy admin. Balancer v3's hooks framework is new
   code; any pool considered must have its hooks read and its audits confirmed before
   user funds sit behind it. Also unverified: the exact impermanent-loss profile per
   candidate pair, and whether withdrawals can be blocked by the underlying Aave market
   the pool is boosted into (the §5 risk, compounded by a second protocol).

---

## 7. Risks to disclose to users if this ships

- **Smart contract risk** — Aave v3 and the vault contract itself.
- **Withdrawal liquidity risk** — high utilisation can delay redemption (see §6.5).
- **Variable rate** — supply APY floats and can approach zero.
- **Depeg risk** on the underlying stablecoin.
- **No principal guarantee. Not a deposit. Not insured.**

The Aave vault docs themselves state no risks; that absence is not evidence of safety
and we should not inherit their silence.

---

## 8. Phased plan, if it proceeds

| Phase | Work | Gate |
|---|---|---|
| 0 | Counsel review (§5); contract read to answer §6.1 | **Do not skip** |
| 1 | Authenticated sessions (SIWE) — prerequisite, useful regardless | — |
| 2 | Position data layer + read-only "Earn" page showing live Aave APY, no deposits | Ships value, moves no funds |
| 3 | Deposit/withdraw against an **existing** Aave vault, user-signed, Base USDC only | Post-counsel |
| 4 | Deploy our own `ATokenVault` with a performance fee | Post-audit |
| 5 | Credit delegation | Far future |

Phase 2 is the natural stopping point for a first cut: it is genuinely useful, carries
no custody or regulatory exposure, and forces us to build the session and position
layers that everything else needs.

---

## Appendix — pre-existing bugs surfaced during this sweep

Unrelated to Earn, found while mapping the code:

1. **`assessTransferCompliance` compares raw `Number(input.amount)` against a 10000
   threshold with no decimals normalization** (`src/compliance/complianceEngine.ts:167`).
   `assessSwapCompliance` was explicitly fixed for exactly this (`:99-108`); the
   transfer path was not. The threshold is meaningless across tokens with differing
   decimals. Any earn withdrawal routed through transfer compliance would inherit it.

2. **`live_with_fallback` silently fabricates a tx hash when a real broadcast fails**
   (`src/cryptoCore/walletBroadcastAdapters.ts:141-143`). Acceptable for a demo,
   dangerous for any ledger-bearing flow.

3. **`blockedAddressFragments` is substring keyword matching** on strings like `'ofac'`
   and `'tornado'` (`src/compliance/complianceEngine.ts:14-21`). The real screening is
   layered above it in `complianceProvider.ts`, so this is not load-bearing — but it
   reads as a risk engine and is not one.

---

## Sources

- [Aave Earn (Vaults) overview](https://aave.com/docs/aave-v3/vaults/overview)
- [Aave docs index](https://aave.com/docs)
- [Aave v3 flash loans guide](https://aave.com/docs/aave-v3/guides/flash-loans) — for the
  contrast in §1
- [Deploy Earn Vault](https://aave.com/docs/developers/aave-v3/vaults/deploy)
- [Vaults smart contracts](https://aave.com/docs/developers/smart-contracts/vaults)
- [Balancer v3 + Aave Boosted Pools](https://www.theblock.co/post/330379/balancer-v3-launches-aave) — for §1a
- [Balancer Boosted Pools / Vault concepts](https://docs.balancer.fi/concepts/vault/flash-loans.html)

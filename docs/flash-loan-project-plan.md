# Flash-loan project plan

**Status:** plan only. No contract written or deployed.
**Date:** 2026-07-20
**Companion docs:** [`flash-loan-build-requirements.md`](./flash-loan-build-requirements.md)
(what must be built), this file (whether, when, and in what order).

---

## The shape of this plan

This is deliberately **gated, not sequential**. Each phase has an exit criterion that can
fail, and failing is a legitimate outcome that saves money. The most expensive mistake
available here is commissioning a $10–40k audited contract to capture an edge nobody has
demonstrated exists.

So Phase 0 is evidence, and it is already running.

---

## Phase 0 — Prove the edge exists · **IN PROGRESS, £0**

**Built 2026-07-20:** the would-have-cleared counter, live on the Flash Lab
(`GET /arb-desk/clearance-log`, `src/arb/clearanceLog.ts`).

**What it measures.** Every scanner row, tested against: net profit after *all* modelled
costs (flash fee, both swap legs, slippage, gas) ≥ **0.95%** of capital deployed **and**
≥ **$50** absolute, using the *competitive* net — what a searcher keeps after bidding for
the block, not what the winner made.

**The critical distinction it enforces — availability.** Surfaces are split:

| Surface | Counted? | Why |
|---|---|---|
| PancakeSwap cross-DEX arb | **Yes** | Reads live on-chain reserves — can genuinely answer "was there an opening just now" |
| Aave liquidations | No — retrospective | The feed is *completed* liquidations, already won by someone else |
| Venus liquidations | No — retrospective | Liquidatable status comes from lagging subgraph oracle prices, **and** the margin is constant by construction |

**The Venus lesson, worth keeping.** The first version of this counter reported "21
opportunities cleared" and looked like a green light. It was an artefact: Venus pays a
**fixed 10% liquidation incentive**, so every row nets exactly
`(10% × 15%) − 0.05% − 0.45% = 1.00%` regardless of size or how underwater the borrower
is. With the bar at 0.95% every row passed; at 1.05% none would. The test could not be
failed on merit, so it measured nothing. The code now carries `marginIsDegenerate()` to
detect that class of bug rather than rely on someone noticing again.

**Exit criterion — decide at 30 days (≈ 2026-08-19):**

- **Zero available opportunities cleared** → **stop.** Do not build. ~$10–40k saved.
- **Sporadic (1–3, non-repeating)** → extend 30 days. One outlier is noise.
- **Repeating (≥1/week, same surface, at real size)** → proceed to Phase 1 with evidence.

**Current reading:** 0 available cleared. 21 retrospective, flagged degenerate.

---

## Phase 1 — Design and cost the contract · 1 week, £0

Only if Phase 0 passes.

- Write the receiver spec from `flash-loan-build-requirements.md` §1 — interface, both
  mandatory guards, approve-not-transfer repayment, atomic profitability check, sweep-to-zero.
- Get **two** audit quotes against that spec. The $10–40k range in the cost estimate is
  market knowledge, not a quote, and it is the entire budget — nail it before committing.
- Decide the trigger architecture: keeper EOA, private mempool/Flashbots or public.
- **Exit:** a spec, two real quotes, a go/no-go on the actual number.

---

## Phase 2 — Build and fork-test · 2–4 weeks, contractor cost

- Solidity engineer implements the receiver (~300 lines; the care is in the guards and
  the profitability revert, not the line count).
- Mainnet-fork test suite: impersonate token holders, replay the specific opportunities
  Phase 0 logged, prove the contract would have captured them.
- **Exit criterion — this is the real one:** the contract must profitably capture
  **replayed historical opportunities from the Phase 0 ledger** on a fork. If it cannot
  capture an opportunity that demonstrably existed, it will not capture a live one.

---

## Phase 3 — Audit · 2–4 weeks, $10–40k

- External audit. Aave's own docs say receivers carry security concerns needing deep
  contract expertise.
- Remediate, re-review.
- **Exit:** clean report, no unresolved high/critical.

---

## Phase 4 — Testnet · 1 week, ~£0

- Deploy to Sepolia (Aave is deployed there with a faucet).
- Full trigger → execute → settle loop end to end.
- **Exit:** successful testnet executions and correct reverts on unprofitable input.

---

## Phase 5 — Mainnet, minimum size · ongoing

- Deploy (~$0.71 at current gas; ~$115 at 30 gwei).
- Fund the keeper minimally. Start at the smallest size that clears costs.
- Run **log-only alongside live** for two weeks: does realised P&L match what the
  simulator predicted? A divergence here invalidates the model, not the market.
- **Exit:** realised results track modelled results within tolerance.

**Hard stop conditions, agreed in advance:**
- Cumulative realised P&L negative after 30 days → stop, post-mortem.
- Any unexplained loss → stop immediately.
- Realised capture rate materially below the modelled 15% → re-model before continuing.

---

## Budget summary

| Phase | Cost | Elapsed |
|---|---|---|
| 0 — evidence | **£0** | 30 days (running) |
| 1 — design + quotes | £0 | 1 week |
| 2 — build + fork tests | contractor | 2–4 weeks |
| 3 — audit | **$10–40k** | 2–4 weeks |
| 4 — testnet | ~£0 | 1 week |
| 5 — mainnet minimum | gas + keeper float | ongoing |
| **Total to live** | **~$10–40k + contractor** | **~2–3 months** |

The audit dominates. Deployment gas is rounding error — **$0.71** at today's 0.186 gwei.

---

## What would make me argue against proceeding

Stated up front so it isn't rationalised away later:

1. **Phase 0 returns zero**, which is what current evidence predicts. Then this is a
   solved question and the money is saved.
2. **Only retrospective surfaces ever clear.** Prize-sizing is not availability. If the
   only profitable rows are ones already won by someone else, we are measuring other
   people's business.
3. **The edge is real but below capacity.** If opportunities clear only at $2k clips,
   the annual profit will not repay the audit.
4. **Realised capture undershoots the model.** Our 15% MEV-capture assumption is an
   estimate, never a measurement. If reality is 5%, the economics invert.

---

## Division of labour

**What I will do:** the research instrument, the economics, the contract *spec*, review
of any contract written by someone else against the Aave spec, fork-test design,
monitoring, and the honest reporting of whether it works.

**What I will not do:** write or deploy the receiver contract, or wire a key to sign
flash loans. That contract holds and moves borrowed funds; it needs a named human owner,
an audit, and your explicit sign-off. That is a boundary, not a scheduling matter — it
does not change if Phase 0 passes.

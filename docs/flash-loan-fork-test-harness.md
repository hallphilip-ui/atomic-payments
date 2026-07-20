# Fork-test harness — design

**Status:** design. No harness implemented.
**Date:** 2026-07-20
**Companion:** [`flash-loan-receiver-spec.md`](./flash-loan-receiver-spec.md) §8 ·
[`flash-loan-project-plan.md`](./flash-loan-project-plan.md) Phase 2

---

## 1. What this harness is really for

The obvious purpose is testing the contract. The **more valuable** purpose is testing
**our own simulator**.

Every number the Flash Lab reports — the 0.95% break-even, the 15% MEV capture, the
45 bps swap cost — is a *model*. None has ever been checked against reality. Replaying a
logged opportunity against a mainnet fork is the first time the model gets marked to
market:

> The simulator said this opportunity would net 1.2%. Fork execution at the observed
> block says it nets 0.3%. **The simulator is wrong**, and every conclusion drawn from
> it is suspect.

That finding would be worth more than the contract, and it is available **before** any
audit money is spent. So the harness should be built to run against a *stub* contract
first — you do not need the real receiver to falsify the model.

---

## 2. The data contract

Replay requires knowing *exactly what was true when we observed the opportunity*.

**This was a live defect, fixed 2026-07-20.** The clearance ledger recorded timestamps
but **no block numbers**, and the scanner snapshots carry none either. Without a block,
a fork cannot be positioned, and AMM reserves at the observed instant are unrecoverable —
they are overwritten by the next trade. Roughly six hours of Phase 0 data would have been
un-replayable anecdote. Ledger schema 3 now captures, per row:

| Field | Purpose |
|---|---|
| `observed_block` | Fork pin. **`null` means the row is not replayable** — surfaced, not hidden |
| `observed` | The raw scanner row, to diff model inputs against fork state |
| `net_usd` / `net_pct` | What the simulator *predicted* — the thing under test |
| `capital_usd` | Size the prediction assumed |

**Requirement D1:** any future surface added to the counter MUST capture a block number
at observation time, or its rows are excluded from replay.

---

## 3. Architecture

Foundry. Chosen over Hardhat for fork-test speed and because `vm.rollFork` /
`vm.createSelectFork` make per-row block pinning a one-liner.

```
test/
  fork/
    ReplayLedger.t.sol        // the main harness — one test per ledger row
    fixtures/ledger.json      // exported from prisma/clearance_log.json
    helpers/Impersonate.sol   // token acquisition
    helpers/StubReceiver.sol  // model-validation target (no real contract needed)
script/
  export-ledger.ts            // clearance_log.json -> test fixture
```

**Per-row flow:**

1. `vm.createSelectFork(RPC_URL, row.observed_block)` — pin to the exact observed state.
2. **Assert the observation reproduces.** Read the live pool reserves/prices at that
   block and compare against `row.observed`. If they disagree, the observation was
   already stale when logged — **fail loudly**; that is a scanner bug, not a contract bug.
3. Acquire the borrow asset by impersonating a known holder (`vm.prank` + `deal`).
4. Execute the route.
5. Assert realised net vs `row.net_usd`.

Step 2 is the one people skip, and it is the one that catches a broken scanner.

---

## 4. Two modes

### Mode A — model validation (no contract required)

Run the route directly against the fork with a stub. Answers: *was the simulator's
predicted net achievable at that block?* Requires no receiver, no audit, no spend.

**Run this first.** It can invalidate the entire premise before any money is committed.

### Mode B — contract validation (Phase 2)

The same rows, executed through the real receiver via `Pool.flashLoanSimple`. Answers:
*does our contract capture what the model said was there?* The delta between Mode A and
Mode B is the contract's own overhead and slippage.

---

## 5. Test matrix

### 5.1 Replay (the Phase 2 exit criterion)

| ID | Assertion |
|---|---|
| RP1 | Observation reproduces at `observed_block` (see §3.2) |
| RP2 | Route executes without revert |
| RP3 | Realised net ≥ 0 |
| RP4 | Realised net within tolerance of `row.net_usd` — **tolerance is a finding, not a setting** |
| RP5 | Rows with `observed_block == null` are SKIPPED and COUNTED, never silently dropped |

### 5.2 Security negatives (from spec §8 — these must fail correctly)

| ID | Assertion |
|---|---|
| T1 | Direct `executeOperation` from a non-Pool address reverts |
| T2 | Third-party-initiated loan naming our receiver reverts (the `initiator` guard) |
| T3 | Sub-threshold route reverts, leaving no approval behind |
| T4 | Griefing: seed a balance, third party flash-loans against it, balance survives |
| T5 | Swap below `minAmountOut` reverts |
| T6 | Non-owner entry-point and rescue calls revert |

**T2 and T4 are the ones that justify this harness existing.** They cannot be tested
without a fork and a real Pool, and they are precisely the failures that the third-party
repo we reviewed shipped.

---

## 6. Reporting

Emit a JSON summary per run, so results are comparable over time rather than read once
from console output:

```
{ rows_total, rows_replayed, rows_skipped_no_block,
  observation_reproduced, observation_diverged,
  predicted_net_usd_total, realised_net_usd_total,
  model_error_pct, security_tests_passed }
```

**`model_error_pct` is the headline.** If realised is persistently below predicted, the
Flash Lab has been overstating opportunity — the same class of error already found twice
in this project (the WBTC liquidation-bonus drift, and the Venus constant-margin artefact
that briefly reported "21 cleared").

---

## 7. Known limits — state these in any report

1. **A fork cannot model competition.** Replay executes in a private fork with no rival
   searchers. It proves the trade was *profitable*, never that it was *winnable*. The 15%
   MEV-capture assumption remains unvalidated by this harness, and is the largest
   remaining unknown in the economics.
2. **Replay is not prediction.** Capturing historical opportunities says nothing about
   future frequency.
3. **Fork RPC must be archive-capable.** Our current provider rejects `eth_getLogs` over
   large ranges; confirm archive access at the target blocks *before* building, or the
   harness cannot run at all.
4. **Small samples mislead.** With Phase 0 currently at zero cleared rows, there may be
   nothing to replay. That is itself the answer.

---

## 8. Build order

1. `export-ledger.ts` — trivial, do it now so the fixture format is fixed early.
2. Mode A on retrospective rows — there are already 21, enough to validate the model
   even though they are not build evidence.
3. Security negatives against a stub — T1/T2/T4 need no strategy logic.
4. Mode B — only after a contract exists.

**Steps 1–3 need no contract, no audit, and no spend, and step 2 can invalidate the
project on its own.** That is the cheapest useful work remaining.

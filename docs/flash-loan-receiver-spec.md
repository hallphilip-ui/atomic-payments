# Flash-loan receiver — contract specification

**Status:** specification. No implementation exists.
**Date:** 2026-07-20
**Audience:** the Solidity engineer who implements this, and the auditor who reviews it.
**Companion docs:** [`flash-loan-build-requirements.md`](./flash-loan-build-requirements.md)
· [`flash-loan-project-plan.md`](./flash-loan-project-plan.md)

This document says **what the contract must do and why**. It deliberately stops short of
the implementation: the body of `executeOperation` — the logic that routes borrowed funds
through trades — is the implementer's work, reviewed by an auditor, owned by a named
person. Everything an implementer needs to be unambiguous is here; nothing that would let
someone paste this into Remix and deploy it is.

---

## 1. Purpose and scope

**In scope.** A single-asset Aave v3 flash-loan receiver that borrows one reserve,
executes a pre-validated arbitrage route, repays principal plus premium, and reverts if
the operation would not clear a minimum profit.

**Out of scope, explicitly.** Multi-asset `flashLoan()`; opening debt positions
(`interestRateMode != 0`); any strategy or opportunity discovery (that lives off-chain);
holding user funds; any upgradeability.

**Target.** Aave v3. Not v4 — v4 has no flash-loan primitive; the full source contains
zero occurrences of `flash` (verified 2026-07-20, 460 files, with controls).

---

## 2. Interface

Implement `IFlashLoanSimpleReceiver` (Aave's published interface):

```solidity
function executeOperation(
    address asset,
    uint256 amount,
    uint256 premium,
    address initiator,
    bytes calldata params
) external returns (bool);

function ADDRESSES_PROVIDER() external view returns (IPoolAddressesProvider);
function POOL() external view returns (IPool);
```

`flashLoanSimple` is chosen over `flashLoan` deliberately: it is gas-cheaper, it is
single-reserve (which matches the strategy), and the `FLASH_BORROWER` fee waiver that
`flashLoan` offers is not available to us anyway — it requires an Aave governance
proposal and is worth 5 bps.

---

## 3. Immutables and state

| Name | Type | Notes |
|---|---|---|
| `ADDRESSES_PROVIDER` | `IPoolAddressesProvider` | Set in constructor. Immutable. |
| `owner` | `address` | Set in constructor. Consider a multisig. |

**`POOL()` must resolve through `ADDRESSES_PROVIDER.getPool()`, not a cached address.**
The Pool is a governance-upgradeable proxy; the *provider* is immutable per market. Get
the provider address from `@aave-dao/aave-address-book` (note the scope — the legacy
`@bgd-labs/` name is stale).

**The contract MUST NOT hold a persistent token balance between transactions.** See §6.

---

## 4. Behavioural requirements

### 4.1 Entry point

A keeper-facing function that initiates the loan. Requirements:

- **R1** — MUST be restricted to `owner` or an explicit keeper role. An unprotected entry
  point lets anyone make the contract originate loans and pay premiums.
- **R2** — MUST encode the intended route into `params` so `executeOperation` does not
  re-derive it. The off-chain caller has already validated the opportunity.
- **R3** — SHOULD accept a `minProfit` parameter so the profitability floor is set per
  call rather than compiled in.

### 4.2 `executeOperation`

In order:

- **R4** — MUST `require(msg.sender == address(POOL()))`.
- **R5** — MUST `require(initiator == address(this))`.
- **R6** — MUST execute the route described by `params`.
- **R7** — MUST `require(balanceAfter >= amount + premium + minProfit)` **before**
  approving repayment. This is the difference between a bad trade costing gas and a bad
  trade costing the premium.
- **R8** — MUST `approve(address(POOL()), amount + premium)`. It MUST NOT transfer the
  funds back — Aave pulls them via `transferFrom`.
- **R9** — MUST sweep any residual balance to `owner` before returning (see §6).
- **R10** — MUST `return true`. The Pool wraps the call in a `require`; returning false
  or nothing reverts the loan with `INVALID_FLASHLOAN_EXECUTOR_RETURN`.

### 4.3 Swap legs

- **R11** — Every swap MUST carry a `minAmountOut`. No exceptions.
- **R12** — Every swap MUST carry a deadline.
- **R13** — Router addresses MUST be constructor-injected or owner-settable, never
  hardcoded literals.

### 4.4 Rescue

- **R14** — An owner-only rescue function for tokens accidentally sent to the contract.
- **R15** — Rescue MUST NOT be callable mid-operation (no reentrancy into it).

---

## 5. The two guards — rationale

R4 and R5 are the requirements most often omitted, and omitting either is critical.
**`FlashLoanReceiverBase` provides neither** — it only stores `ADDRESSES_PROVIDER` and
`POOL` in its constructor. Inheriting it gives zero protection. An implementer who
assumes the base class handles this will ship an exploitable contract.

**Without R4** (`msg.sender == POOL`): `executeOperation` is `external`, so anyone can
call it directly with fabricated `asset`/`amount`/`params`. No funds arrive, but the
callback body still runs on attacker-chosen inputs — spending any balance or allowance
the contract holds.

**Without R5** (`initiator == address(this)`): an attacker calls
`Pool.flashLoan(ourContract, ...)` with arbitrary parameters. **R4 passes**, because the
Pool genuinely is the caller. The attacker now drives our logic with full control of the
inputs, using Aave as a laundering proxy. R4 alone is not sufficient — this is the
subtle one.

### 5.1 Reference implementations are uniformly unsafe — two data points

This is not a hypothetical risk that careful implementers avoid. The public tutorials and
repos people copy from **ship the pattern with the guards missing**, so an implementer who
starts from a "working example" inherits the vulnerability by default.

- **`github.com/lraunakl/AAVE-FLASHLOAN`** (reviewed 2026-07-20) — omits both guards,
  and additionally does not compile (`executeOperation` absent from the flagship
  contract, undefined `IDex`) and traps funds (`Dex.sol` has no constructor). 66 stars,
  18 forks. People are forking non-compiling, fund-trapping code believing it works.

- **Chainstack "Aave V3 flash loans with Hardhat" tutorial** (reviewed 2026-07-20,
  Avalanche Fuji). Cleaner — it compiles and the repayment leg is correct — but its
  `executeOperation` is a mock (`/** YOUR CUSTOM LOGIC HERE */`, borrow-and-repay only)
  and it **also omits both guards**:

  ```solidity
  function executeOperation(address asset, uint256 amount, uint256 premium,
      address initiator, bytes calldata params) external override returns (bool) {
      /** YOUR CUSTOM LOGIC HERE */
      uint256 amountOwed = amount + premium;
      IERC20(asset).approve(address(POOL), amountOwed);
      return true;
  }
  ```

  Note `initiator` is declared and never read — the exact R5 omission.

**Conclusion for the auditor and the implementer:** treat any starting skeleton as
guard-free until proven otherwise, and make R4 + R5 the first thing added and the first
thing verified. Two independent references, both unsafe, is the evidence that the audit
(project plan Phase 3) is not optional.

---

## 6. The residual-balance invariant

Aave's documentation states:

> "Never keep funds permanently on your FlashLoanReceiverBase contract as they could be
> exposed to a 'griefing' attack, where the stored funds are used by an attacker."

**The attack, concretely.** The contract holds leftover USDC and has a standing approval
to the Pool. An attacker calls `Pool.flashLoan(ourContract, [USDC], [X], ...)`. Aave
sends X, then pulls back X + premium. **Our leftover balance pays that premium.** Repeat
until drained; the attacker spends only gas.

**Invariant: at the end of every transaction, the contract's balance of every token is
zero.** R5 is the direct defence; R9 is the belt-and-braces one. Both are required —
neither alone is sufficient, because R5 depends on being implemented correctly and R9
bounds the damage if it isn't.

---

## 7. Invariants for the auditor

| # | Invariant |
|---|---|
| I1 | No token balance persists across transaction boundaries |
| I2 | `executeOperation` reverts unless caller is the Pool AND initiator is self |
| I3 | An unprofitable route reverts before any approval is granted |
| I4 | No path allows a non-owner to move tokens out |
| I5 | No path grants an allowance to an address not in the configured router set |
| I6 | Pool address is resolved live, never cached across calls |

---

## 8. Test requirements

Mainnet-fork tests are mandatory. Acquire tokens by impersonating a known holder.

**Must-pass negative tests** — these are the ones that matter:

- **T1** — Direct call to `executeOperation` from a non-Pool address **reverts**.
- **T2** — Third-party-initiated flash loan naming our contract as receiver **reverts**
  (the R5 case; T1 passing does not imply T2 passing).
- **T3** — A route yielding less than `amount + premium + minProfit` **reverts**, and no
  approval is left behind.
- **T4** — Griefing: seed the contract with a balance, have a third party flash-loan
  against it, assert the balance is not consumed.
- **T5** — Swap returning less than `minAmountOut` **reverts**.
- **T6** — Non-owner calls to the entry point and to rescue **revert**.

**Must-pass positive test:**

- **T7** — Replay real opportunities from the Phase 0 clearance ledger
  (`prisma/clearance_log.json`) against a fork at the recorded block and assert the
  contract captures them profitably. **This is the Phase 2 exit criterion.** A contract
  that cannot capture an opportunity that demonstrably existed will not capture a live
  one.

---

## 9. Threat model summary for the audit brief

| Threat | Mitigation |
|---|---|
| Arbitrary caller into the callback | R4 |
| Third party initiating loans against us | R5 |
| Griefing a resident balance | R5 + R9 + I1 |
| Unprofitable execution burning the premium | R7 |
| Sandwich / adverse price movement on swap legs | R11, R12 |
| Owner key compromise | Multisig owner; R14 is the blast radius |
| Pool proxy upgraded underneath us | I6 (resolve live) |

---

## 10. What this specification does not cover

- The body of the route logic — the implementer's work.
- Opportunity discovery — off-chain, already built (the scanners and the clearance counter).
- Keeper infrastructure and key management.
- Any decision about whether to build this at all. That is gated on Phase 0 of the
  project plan, which is currently reading **zero available opportunities cleared**.

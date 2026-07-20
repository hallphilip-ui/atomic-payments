# Audit brief — Aave v3 flash-loan receiver

**Purpose:** send this to audit firms to obtain comparable quotes.
**Status:** the contract is **not yet written.** Quote against the specification.
**Attach:** [`flash-loan-receiver-spec.md`](./flash-loan-receiver-spec.md)

---

## What we are building

A single Solidity contract: an Aave v3 `IFlashLoanSimpleReceiver` that borrows one
reserve, executes a pre-validated arbitrage route across DEX routers, repays principal
plus the 0.05% premium, and reverts if the operation would not clear a minimum profit.

**Size:** ~300 lines, one contract, no proxy, no upgradeability.
**Chain:** Ethereum mainnet. Possibly Base/Arbitrum later — please quote per-chain
marginal cost if it is not zero.
**Flash-loan source:** Aave v3 by default; **we may instead target Balancer v3 (0% fee)**,
whose callback (`receiveFlashLoan`) and caller guard differ from Aave's. We will name the
final source before code-freeze — please note whether your quote covers one source or both,
since the callback and its security checks are source-specific (spec §2.1).
**Custody:** the contract holds no user funds and no persistent balance. Only the
owner's own capital is ever at risk, and only via gas and premiums.

---

## Scope of review requested

1. **The two mandatory Aave guards.** `msg.sender == POOL` and
   `initiator == address(this)`. We are specifically concerned that
   `FlashLoanReceiverBase` provides neither, and that the `initiator` check is the one
   commonly omitted. Please confirm both are present and correctly ordered.
2. **Griefing resistance.** Aave warns that a resident balance plus a standing approval
   lets a third party drain the contract by repeatedly flash-loaning against it. We want
   the residual-balance invariant explicitly tested, not assumed.
3. **Profitability revert.** The contract must revert *before* granting repayment
   approval if the route did not clear `amount + premium + minProfit`.
4. **Approval hygiene.** No allowance may persist after a transaction; no allowance may
   be granted to an address outside the configured router set.
5. **Access control.** Entry point and rescue function owner-gated; no path lets a
   non-owner move tokens.
6. **Swap-leg safety.** `minAmountOut` and deadline on every leg.
7. **Pool resolution.** Confirmed live via `PoolAddressesProvider.getPool()` rather than
   a cached address, since the Pool is a governance-upgradeable proxy.
8. **Standard coverage.** Reentrancy, unchecked external calls, integer handling,
   `tx.origin`, delegatecall, gas griefing.

Full invariant list and negative-test requirements are in §7 and §8 of the spec.

---

## What we would like in the quote

- Price, in writing, against this scope.
- Turnaround from code-freeze to draft report.
- Whether a remediation re-review is included or charged separately.
- Whether you will run the fork-based negative tests yourself or review ours.
- Named lead auditor and relevant prior flash-loan / MEV engagements.

---

## Context you should have

**This may not proceed.** We are running a 30-day measurement (a "would-have-cleared"
counter) to establish whether a capturable edge exists before committing to a build. It
currently reads **zero available opportunities**. We are obtaining quotes so the decision
is fully costed, not because the build is committed. We would rather tell you that up
front than waste your time.

**We are not asking you to assess the strategy**, only the contract. We know the
economics are marginal: on a $100k loan the break-even is roughly 0.95% gross edge, and
gas is a rounding error next to swap fees and slippage.

**We will not deploy without a clean report.** No unresolved high or critical findings,
and remediation re-reviewed.

---

## Non-goals

Not in scope for the audit: opportunity discovery (off-chain), keeper infrastructure,
key management, or economic viability. Contract only.

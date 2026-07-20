# What it would take to write Aave flash loans

**Status:** requirements analysis. Nothing built, no contract written or deployed.
**Date:** 2026-07-20
**Method:** full sweep of all 91 pages of aave.com/docs, the aave-v3-origin source, and
direct on-chain reads against the live Ethereum Pool.

Each item is labelled **[PROTOCOL]** (Aave requires it — non-negotiable),
**[ENGINEERING]** (you will fail without it, but Aave doesn't enforce it), or
**[JUDGEMENT]** (your call).

---

## The short answer

**A flash loan cannot be done from a wallet, an API, or an SDK.** It is a *callback*:
Aave calls `executeOperation` on a contract **you have deployed**. An EOA has no code,
so there is nothing to call back into. No amount of API wiring changes this.

So the minimum viable thing to build is: **a deployed, audited Solidity contract, plus
everything needed to find opportunities, trigger it, and keep it safe.** Roughly:

| Layer | What |
|---|---|
| Contract | Receiver implementing `executeOperation`, with two mandatory guards |
| Strategy | The profitable-opportunity logic — Aave supplies *none* of this |
| Trigger | An EOA/keeper with gas, watching for opportunities |
| Safety | Profitability guard, slippage bounds, access control, fund sweep |
| Validation | Mainnet-fork tests, testnet run, external audit |

---

## 1. The contract [PROTOCOL]

### 1.1 Pick your entrypoint

| | `flashLoanSimple()` | `flashLoan()` |
|---|---|---|
| Reserves | Single | Multiple |
| Gas | Cheaper | Higher |
| Fee waiver | **Never** | Yes, for `FLASH_BORROWER` role |
| Can open debt | No | Yes (with collateral/credit delegation) |
| Interface | `IFlashLoanSimpleReceiver` | `IFlashLoanReceiver` |

For single-asset arbitrage, `flashLoanSimple` is the normal choice — and it **never**
waives the fee, regardless of any role you hold.

### 1.2 Implement the exact callback

```solidity
// IFlashLoanSimpleReceiver
function executeOperation(
    address asset,
    uint256 amount,
    uint256 premium,
    address initiator,
    bytes calldata params
) external returns (bool);

// IFlashLoanReceiver (multi-asset)
function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
) external returns (bool);
```

Both interfaces also require `ADDRESSES_PROVIDER()` and `POOL()` view functions.

**Must return `true`.** The Pool wraps the call in a `require`; returning false or
nothing reverts the whole loan:

```solidity
require(
  receiver.executeOperation(...),
  Errors.INVALID_FLASHLOAN_EXECUTOR_RETURN
);
```

### 1.3 The two guards that are not optional

**`FlashLoanReceiverBase` gives you neither of these.** It only stores
`ADDRESSES_PROVIDER` and `POOL` in its constructor. Inheriting it provides **zero**
security. This is the single most misunderstood point, and the third-party repo we
reviewed omitted both.

```solidity
require(msg.sender == address(POOL),      "caller must be Pool");
require(initiator == address(this),       "loan must be self-initiated");
```

- **Without the first:** `executeOperation` is `external`, so anyone can call it
  directly with fabricated amounts. No funds ever arrive, but your callback logic runs
  on attacker-chosen inputs — spending any balance or allowance the contract holds.
- **Without the second:** an attacker calls `Pool.flashLoan(yourContract, ...)` with
  arbitrary parameters. `msg.sender == POOL` *passes*, because the Pool genuinely is
  the caller. The attacker drives your logic through Aave as a proxy. **This is the
  check people most often miss.**

### 1.4 Repay by approval, not transfer

```solidity
IERC20(asset).approve(address(POOL), amount + premium);
```

From the docs: *"You **do not** need to transfer the owed amount back to the Pool. The
funds will be automatically pulled at the conclusion of your operation."* Internally
the Pool does `safeTransferFrom(receiver, aToken, amountPlusPremium)`.

### 1.5 Never leave funds on the contract [PROTOCOL — explicit warning]

> "Never keep funds permanently on your FlashLoanReceiverBase contract as they could be
> exposed to a 'griefing' attack, where the stored funds are used by an attacker."

Concretely: your contract holds leftover USDC and has a standing approval to the Pool.
An attacker calls `Pool.flashLoan(yourContract, ...)`. Aave sends funds, then pulls back
amount + premium — and **your idle balance pays the premium**. Repeat until drained. The
attacker spends only gas. The `initiator` check is the direct defence; sweeping to zero
at the end of every operation is the belt-and-braces one.

---

## 2. The fee [PROTOCOL]

**Verified on-chain, 2026-07-20**, against the live Ethereum Pool
`0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2`:

```
FLASHLOAN_PREMIUM_TOTAL()        = 5      (bps = 0.05%)
FLASHLOAN_PREMIUM_TO_PROTOCOL()  = 10000
```

**Read it at runtime; do not hardcode it.** It is governance-adjustable via
`PoolConfigurator.updateFlashloanPremiumTotal()` and can differ per chain/market.

**On the `FLASH_BORROWER` role — not worth pursuing.** It waives the premium *only* on
multi-asset `flashLoan()`, never on `flashLoanSimple()`. It grants no extra capacity —
anyone can already call both functions without any role. And it is assigned by
`ACL_ADMIN`, which on live markets is Aave governance, so obtaining it means passing a
governance proposal. Waiving 5 bps does not change the economics (see §6).

---

## 3. Everything else that must exist

**3.1 Resolve the Pool address correctly [ENGINEERING]**
The Pool is a governance-upgradeable proxy. Aave explicitly recommends fetching it at
call time from `PoolAddressesProvider.getPool()`. The *provider* is immutable per market
— get that address from `@aave-dao/aave-address-book` (note: renamed from the legacy
`@bgd-labs/` scope).

**3.2 Access control on your own entrypoint [ENGINEERING]**
Whatever function triggers the loan must be `onlyOwner`/keeper-gated. An unprotected
`requestFlashLoan()` lets anyone make your contract originate loans and eat premiums.

**3.3 Atomic profitability guard [ENGINEERING — the one that saves money]**
Revert unless the post-trade balance covers `amount + premium + minProfit`. Without it,
an unprofitable loan still completes and you simply pay the premium and gas for nothing.

**3.4 Slippage bounds and deadlines on every swap leg [ENGINEERING]**
`minAmountOut` on each hop. Pricing off anything other than live quotes is not
arbitrage. (The repo we reviewed priced off a hardcoded constant.)

**3.5 Check the reserve is actually flash-loanable [PROTOCOL]**
Only reserves with borrowing enabled can be flash-borrowed, and flash loans are
separately toggleable per reserve (`setReserveFlashLoaning`). Read `flashLoanEnabled`
from `UiPoolDataProvider`. **Your maximum size is the reserve's available liquidity** —
there is no separate flash-loan cap.

**3.6 A trigger [ENGINEERING]**
An EOA or keeper holding ETH for gas, watching for opportunities and calling your
contract. This is the only place a private key is involved.

**3.7 Monitoring and a kill switch [ENGINEERING]**

---

## 4. Validation before mainnet

**4.1 Mainnet-fork tests [ENGINEERING]** — Foundry, Hardhat, or Tenderly against real
Aave state. Acquire tokens by impersonating a known holder. This is also how you'd test
a `FLASH_BORROWER`-gated path without governance.

**4.2 Sepolia testnet run [ENGINEERING]** — Aave is deployed there with a faucet.

**4.3 External audit [JUDGEMENT — but strongly indicated]** — Aave's own docs say flash
loan receivers carry security concerns requiring deep contract expertise. This contract
will hold and move borrowed funds.

**4.4 Key management [JUDGEMENT]** — the trigger key, and whether the owner is an EOA or
a multisig.

---

## 5. What Aave does *not* give you

This is the part that most often surprises people:

- **No bot.** No hosted execution, no runner, no scheduler.
- **No strategy.** Aave lends the money for one transaction. Finding a trade that clears
  costs is entirely your problem.
- **No opportunity feed.** No endpoint tells you when an arb exists.
- **No SDK path.** AaveKit's complete write surface is supply, borrow, repay, withdraw,
  liquidate, collateral toggles, rewards and swaps. **There is no flash-loan action,
  hook, or GraphQL operation** — verified across the entire hooks reference.

The protocol is a liquidity primitive. Everything that makes it *profitable* is yours to
build.

---

## 6. The economics, which is the actual blocker

Building all of the above is a few weeks of work plus an audit. It does not create edge.
From the Flash Lab's own live numbers, on a **$100,000** loan:

| Cost | Amount | Scales with size? |
|---|---|---|
| Gas | ~$0.06 | **No** — same at any size |
| Aave flash fee (0.05%) | $50 | Yes |
| DEX swap fees (0.30% × 2 legs) | $600 | Yes |
| Slippage (0.15% × 2 legs) | $300 | Yes |
| **Total** | **~$950** | → **~0.95% gross edge needed to break even** |

And that is *before* MEV competition, which on contested opportunities takes most of
what remains — our liquidation model assumes a searcher keeps only 15% of the bonus.

Winning the `FLASH_BORROWER` waiver removes $50 of that $950, moving break-even from
0.95% to 0.90%. The binding cost is **swap fees plus slippage**, which no role or
optimisation touches.

Across five surfaces — CEX arb, grid, flash-loan simulation, PancakeSwap cross-DEX, and
Venus/Aave liquidations — this research programme has not found a capturable edge at
that threshold. **A deployed contract would not create one. It would let us pay these
costs faster.**

---

## 7. v3 vs v4

**Build against v3.** The flash-loan guide, interfaces and reference implementations are
all v3, and v3 is deployed on 15+ chains.

**v4 has a flash-loan mechanism but no documented public entrypoint.** Its docs mention
a 0.05% flash-loan fee and a per-reserve enable flag, and its swap engine uses flash
loans internally. But across all 28 v4 pages there are **zero** occurrences of
`executeOperation`, `IFlashLoanReceiver`, `flashLoan()` or `flashLoanSimple`. Whether
`ISpoke`/`IHub` exposes a callable flash-loan function is **unverified** — it would need
reading the `aave/aave-v4` source. Do not assume the v3 receiver pattern carries over.

**v4 is also an API break.** There is no single Pool: you call **Spokes** (3 hubs, 10+
spokes on Ethereum), reserves are `uint256 reserveId` rather than asset addresses, and
ERC-20 approvals go to the *hub* while calls go to the *spoke*. v3 integration code will
not port.

**One v4 pattern the docs do bless:** bring your own flash loan from elsewhere and route
position operations through the Giver/Taker position managers. `positions/managers.md`
shows working Solidity for exactly this, referring to *"your own flash loan contract"* —
which confirms the contract is yours to build either way.

---

## Sources

- [Flash Loans guide (v3)](https://aave.com/docs/aave-v3/guides/flash-loans)
- [Pool](https://aave.com/docs/aave-v3/smart-contracts/pool) ·
  [ACL Manager](https://aave.com/docs/aave-v3/smart-contracts/acl-manager) ·
  [PoolAddressesProvider](https://aave.com/docs/aave-v3/smart-contracts/pool-addresses-provider)
- [Testing and Debugging](https://aave.com/docs/aave-v3/smart-contracts/testing-and-debugging)
- [IFlashLoanReceiver / FlashLoanReceiverBase (aave-v3-origin)](https://github.com/aave-dao/aave-v3-origin)
- [Aave Address Book](https://github.com/bgd-labs/aave-address-book) (npm: `@aave-dao/aave-address-book`)
- [v4 swaps — flash loan fee](https://aave.com/docs/aave-v4/tools/swaps) ·
  [v4 position managers](https://aave.com/docs/aave-v4/positions/managers)
- On-chain reads against Pool `0x87870bca…a4e2`, 2026-07-20

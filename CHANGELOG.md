# Changelog

## 2.30.0 - 2026-07-20

**MEV-capture probe — measured the 15% assumption against real liquidations, and the finding is that it can't be measured from public data.**

- **`scripts/mev-capture-probe.js`** reads settled Aave V3 Ethereum liquidations (subgraph → tx hash → receipt + block) and computes what each winner surrendered as priority fee versus the gross bonus. This measures what searchers KEEP, which is what the 15% assumption is about — a mempool watcher would only show what they BID.
- **Finding on 25 liquidations: 22/25 winners paid ~0 visible priority fee.** That is the signature of private orderflow (Flashbots) — the bid is a direct builder payment invisible in the receipt without transaction tracing. The probe honestly reports this rather than pretending the resulting "100% capture" is real.
- **The 3 public ones are roughly consistent with the model:** two WBTC liquidations paid 72–73% of the bonus in priority fee (~27% capture before swap/flash costs, which drag toward 15%). Nothing refutes the 15%; it simply can't be broadly confirmed from receipts.
- **Concrete conclusion:** validating the 15% requires a trace-capable RPC (`debug_traceTransaction`), which our Alchemy access lacks. This is the one place in the project where a paid/trace endpoint would earn its cost — a real answer to the "does more infra help" question. Recorded in the fork-test harness doc §0.
- Built the probe honestly: it prints its own limits (implied capture ignores swap + flash cost, so it's an upper bound), skips dust and unpriceable tokens (a Pendle PT token) rather than distorting, and states plainly when it is NOT measuring the target number.

**Process note:** three self-inflicted bugs were found and fixed mid-build — a silently-swallowed price error, `https.get(url, opts, cb)` dropping the key from the path, and an env-var placement mistake in my own diagnostics that produced a false "Alchemy blocks Node clients" conclusion. The last was reverted once `fetch` was confirmed working (HTTP 200) rather than shipping the wrong explanation and an unnecessary curl workaround.

## 2.29.0 - 2026-07-20

**Continuous instrument validation — the Mode A checks now run hourly instead of when someone remembers.**

- **`src/arb/validation.ts`**, `GET /arb-desk/validation`, and a card at the top of the Flash Lab. Runs the three Mode A checks on a schedule: Venus phantom-rate, PancakeSwap reserve recompute + off-chain price cross-check, and Aave arithmetic + live-parameter drift.
- **Why it exists:** the Venus surface was 100% phantom for an unknown length of time and nothing surfaced it until a manual check. Manual validation only catches what someone thinks to look for. A regression now shows as a number.
- **First live run — `warn`:**
  - `venus` **ok** — 25 candidates → 0 confirmed, 25 rejected as phantom. A *high* phantom rate is healthy here: it is the on-chain gate doing its job. The regression to watch for is the opposite — candidates arriving and everything being confirmed, meaning the gate stopped gating.
  - `pancake` **ok** — 5 reconcile, 0 diverge, 5/5 within 5% of external references.
  - `aave` **warn** — 14/14 rows reconcile, 2 using a stale liquidation bonus.
- Cached by default with `?fresh=1` to force a run: a fresh pass hits several RPCs plus an external price API, and a stale-but-honest number beats hammering upstreams on every page load. The card shows the report's age.
- Placed **above** the would-have-cleared counter deliberately — if a surface is broken, the count below it means nothing.
- Deliberately **not** wired to alerting. It is an instrument, not a pager.

**Item 4 from the plan (extend drift checks beyond Ethereum) was dropped, not built.** I had said the scanner "models other chains on assumptions nobody has checked" — it does not. The liquidation feed is Ethereum-only (`AAVE_V3_SUBGRAPH  # Aave V3 Ethereum`), so checking Base or Arbitrum parameters would validate values we never use. The real version of that concern was the Ethereum coverage gap fixed in 2.28.0.

## 2.28.0 - 2026-07-20

**Mode A for the Aave surface — and it caught a coverage gap in today's own drift check.**

- **`scripts/replay-mode-a-aave.js`** validates two things per liquidation row: internal arithmetic recomputed from the row's own inputs, and each row's `bonus_pct` against the **live** Aave liquidation bonus.
- **Internal arithmetic: 14 of 14 consistent.** Borrow derivation, gross bonus, flash fee, swap cost and both nets all reconcile to the cent. The simulator's maths is sound.
- **Parameter drift: 2 rows used a stale bonus.** WBTC at 6.25% vs a live 5.00% **overstated** that row's competitive net by **$2.58**; USDe at 4.50% vs a live 8.50% understated it by $1.40. Neither flipped `would_clear`, so no conclusion changes — but the direction of the WBTC error is the one that flatters.
- **The USDe row exposed a real gap in the drift card shipped earlier today.** It filtered reserves to `canBeCollateral: true`, examining only 19 of 67 — so USDe sat outside its scope while a live liquidation row was actively using the stale value. A checker that reports "all modelled assets match" must examine all modelled assets; otherwise it claims coverage it does not have, which is worse than not checking at all. **Fixed:** all 67 reserves are now examined, collateral status is reported per row rather than used as a filter, and **drift count rises from 4 to 6** — DAI and USDe were both being missed.
- **Stated limit:** Aave rows carry no tx hash or account, so unlike the Venus check this **cannot confirm the liquidations occurred** — only that the model applied to them is sound. Adding a tx hash to the scanner feed would close that gap; recommended, not done.

## 2.27.1 - 2026-07-20

**Purged 21 proven-false rows from the clearance ledger.**

- Every retrospective row in the ledger was a Venus phantom recorded *before* this evening's on-chain confirmation fix. Mode A proved all 21 had **zero** real shortfall, with claims up to $1.4M against an actual $0. Leaving proven-false data in a research instrument is worse than deleting it — it would have polluted Monday's scheduled report and any replay run.
- **`scripts/purge-phantom-rows.js`** — auditable and repeatable rather than a one-off shell command. Dry-run by default, requires `--apply`, writes a timestamped backup first, records the purge in `ledger.purged[]` with its reason, and **never touches `cleared`** (the build evidence).
- Targets rows by an **exact** legacy surface label, not a substring, so it cannot match post-fix rows.
- **The Venus surface label was corrected too**, from `Venus (stale-oracle, fixed margin)` to `Venus (on-chain confirmed, fixed margin)` — "stale-oracle" stopped being true when the scanner started confirming against the Comptroller. The label change is what makes the purge unambiguous: anything still carrying the old string is known-false by construction.
- Verified post-deploy: retrospective 0, cleared 0, and the counter does not re-add phantoms because the fixed scanner now reports zero confirmed liquidatable positions.

## 2.27.0 - 2026-07-20

**External price cross-check — the last unvalidated class of error in the Pancake surface is now closed.**

- Recomputing from `getReserves` catches stale data, wrong pairs and dead pools, but it shares the scanner's price **formula** — so an inverted ratio, wrong decimals or swapped base/quote would make checker and scanner agree while both were wrong. Only an off-chain reference catches that.
- **Two independent sources, because one can be unavailable.** Binance is geo-restricted from some locations (it refused from the dev machine, worked from the VPS); CoinGecko is keyless everywhere. Neither is perfectly independent — CoinGecko aggregates exchanges, some of them DEXes — but both are independent of *our arithmetic*, which is the thing under test.
- **Result: 5 OK, 0 warn, 0 fail.** Every on-chain mid sits within **0.29%** of both references. Best agreement was ETH/USDT at **0.006%** from CoinGecko. The price formula is corroborated.
- Classification is deliberately coarse: **>5% is FAIL**, because that is not DEX/CEX basis — it is an order-of-magnitude or inversion bug. 1–5% warns. Small divergence is expected and normal: DEX-vs-CEX basis, and BTCB/ETH on BSC are pegged wrappers that trade slightly off spot.
- If neither source is reachable the run says **"formula UNVERIFIED"** rather than passing silently — an absent check must not read as a passed one.

**Validation status of the Phase 0 instruments is now complete:** Venus was 100% phantom and has been fixed to confirm on-chain; PancakeSwap reconciles against both chain state and off-chain references. The headline is unchanged at **0 available cleared** — but it now rests on instruments that have been tested rather than trusted.

## 2.26.0 - 2026-07-20

**Mode A run against the PancakeSwap surface — it reconciles, unlike Venus.**

- **`scripts/replay-mode-a-pancake.js`** — reads every DEX pair's reserves directly from chain, independently recomputes price and spread, and compares against the scanner's snapshot. Factory and token addresses are declared **separately from the scanner** on purpose, so a wrong address there cannot silently agree with itself here.
- **Result: 5 agree, 0 diverge, 0 unresolved.** The prices reconcile to 8 significant figures on the stable pairs. This matters because PancakeSwap arb is the **only** surface counted as build evidence — had it been mis-measuring like Venus, Phase 0 would have been measuring noise and the 0.95% bar would have meant nothing.
- **The more useful finding is how fast the spreads decay.** In the ~90s between snapshot and verification: BTCB moved **2,713% relative** (0.0038% → 0.1069%), WBNB moved 77%, and **ETH inverted its sign entirely** (0.0596% → −0.0283%) — the arb direction reversed. Absolute moves stayed small, so none approach the 0.95% bar, but this is direct evidence that spreads at this scale are noise moving faster than a 180s poll interval. Relative move and direction-flip are now reported alongside the absolute delta.
- **Two bugs in my own verification script, found and fixed before reporting.** (1) The quote-side reserve is denominated in the quote *token*, not dollars — printing a WBNB-quoted pool with a `$` understated depth ~570x and made CAKE/WBNB look like a dead `$46` pool when it holds **$26,558**. The scanner's own liquidity filter was right; the checker was wrong. (2) The pass/fail tolerance used an absolute floor only, which hid large relative moves behind an "AGREE".
- **Stated limit:** this recomputes from the same primitives the scanner uses, so it catches stale data, wrong pairs, dead pools and arithmetic drift — but not a shared conceptual error in the price formula itself.

## 2.25.1 - 2026-07-20

**Counter comment corrected after the scanner fix.**

- `clearanceLog.ts` justified classifying Venus as retrospective partly on "liquidatable status derives from lagging subgraph prices". That is no longer true — arb-scanner v1.1.0 confirms every position against the Venus Comptroller on-chain before reporting it.
- Venus **stays retrospective**, but for the reasons that still hold: its margin is constant by construction (fixed 10% incentive), and a confirmed position is still contested by MEV bots in-block, so "genuinely liquidatable" never meant "ours to take". Correcting the stated reason rather than leaving a comment that would mislead the next reader into thinking the phantom problem is still live.
- No behaviour change; the classification and the headline count are unchanged.

## 2.25.0 - 2026-07-20

**Mode A built and run — and its first execution found an entire scanner surface reporting opportunities that do not exist.**

- **`scripts/export-ledger.js`** — clearance ledger to fork-test fixture. Rows without an `observed_block` go to a `skipped` list with a reason rather than being dropped, so a harness cannot pass over a subset and call it a full pass.
- **`scripts/replay-mode-a.js`** — model validation, no contract required. Asks Venus's own Comptroller, at each row's observed block, whether the flagged position was actually liquidatable (`getAccountLiquidity` → `shortfall > 0`).
- **Result: 0 confirmed, 21 phantom.** Not one Venus position the scanner flagged had any shortfall on-chain. Claimed shortfalls ran as high as **$1,437,894** against an on-chain shortfall of **$0**. One account showed $9,707 of *excess* liquidity while the scanner claimed it was $67,873 underwater.
- **The test was validated before the result was accepted.** Twenty rows returned liquidity and shortfall both exactly zero — also the signature of querying the wrong pool. Three checks ruled that out: the scanner reads Venus *Core* and `0xfD36E2…8384` is the Core Comptroller; one account returned a non-zero reading, proving call, decode and archive access all work; and `getAssetsIn()` shows **5 entered markets** for every account sampled, so these are real Core participants.
- **Cause:** Venus health is derived from subgraph oracle prices that update only on interaction. The scanner is reading stale state and inferring distress the live oracle does not see. Its own note anticipated this — the scale did not.
- **No impact on the build decision, which is the point.** Venus was already classified retrospective and excluded from the evidence count, so the headline is still 0 cleared. What this validates is the *method*: Mode A found a fictitious surface on its first run, at zero cost, with no contract and no audit spend.
- **Follow-up outstanding:** the Venus scanner should read `getAccountLiquidity` on-chain, or its list must be labelled unverified in the UI. Until then every Venus figure on the Flash Lab is unproven.

## 2.24.0 - 2026-07-20

**Fork-test harness design — and a live defect it exposed before it could cost us the evidence.**

- **Ledger schema 3: replay data.** Designing the harness surfaced that the clearance ledger recorded timestamps but **no block numbers**, and the scanner snapshots carry none either. Without a block a fork cannot be positioned, and AMM reserves at the observed instant are unrecoverable — overwritten by the next trade. Phase 2's exit criterion ("replay real opportunities and assert capture") was therefore **unexecutable**, and every hour of Phase 0 was accumulating un-replayable anecdote. Rows now capture `observed_block` and the raw `observed` scanner row. Verified live: block captured, 0 rows non-replayable.
- A `null` block marks a row **not replayable** and is surfaced rather than hidden — the harness must skip and count those, never silently drop them.
- **`docs/flash-loan-fork-test-harness.md`** — Foundry-based design with two modes. **Mode A validates our simulator and needs no contract at all**: replay a logged opportunity at its observed block and check whether the predicted net was actually achievable. If the model says 1.2% and the fork says 0.3%, every conclusion drawn from the Flash Lab is suspect — and that is findable *before* spending audit money.
- Includes the step most replay harnesses omit: **assert the observation reproduces at the pinned block** before executing. If live reserves disagree with what was logged, the observation was already stale — a scanner bug, and it must fail loudly rather than be absorbed into a "contract underperformed" result.
- Records honest limits: a fork has no rival searchers, so replay proves a trade was *profitable*, never that it was *winnable*. The 15% MEV-capture assumption stays unvalidated and remains the largest unknown in the economics.
- Build order puts the three no-contract, no-spend steps first, since Mode A can invalidate the project on its own.

## 2.23.0 - 2026-07-20

**Phase 1 deliverables: flash-loan receiver specification and audit brief.**

- **`docs/flash-loan-receiver-spec.md`** — implementation-ready specification: exact interface, 15 numbered requirements, 6 auditor invariants, and 7 must-pass tests. Written so a Solidity engineer can implement unambiguously and an auditor can quote against it, while deliberately stopping short of the route logic itself.
- Spells out *why* the two mandatory guards exist, including the subtle one: `initiator == address(this)`. Without it an attacker calls `Pool.flashLoan(ourContract, …)` with arbitrary parameters and the `msg.sender == POOL` check **passes**, because the Pool genuinely is the caller. Records that `FlashLoanReceiverBase` provides neither guard — inheriting it gives zero protection.
- Documents the residual-balance invariant and the griefing attack it prevents, with the concrete mechanism (leftover balance pays an attacker-initiated premium, repeatedly).
- **The Phase 2 exit criterion is a test**: replay real opportunities from the Phase 0 clearance ledger against a mainnet fork and assert capture. A contract that cannot capture an opportunity that demonstrably existed will not capture a live one.
- **`docs/flash-loan-audit-brief.md`** — sendable brief for obtaining two comparable quotes: scope, threat model, and what to ask for. States plainly to prospective auditors that the build may not proceed, since the counter currently reads zero — better to say so up front than waste their time.
- Both documents note the build remains gated on Phase 0. No contract has been written.

## 2.22.0 - 2026-07-20

**Would-have-cleared counter + flash-loan project plan.**

- **New counter** (`src/arb/clearanceLog.ts`, `GET /arb-desk/clearance-log`, card on the Flash Lab). Polls the scanner snapshots every 5 minutes and records every row whose net profit — after flash fee, both swap legs, slippage and gas — clears **0.95% of capital** and **$50 absolute**, using the *competitive* net throughout. Purpose: make the ~$10-40k build/no-build decision a number rather than a judgement call.
- **Surfaces are split by availability, and this is the whole point.** Only PancakeSwap cross-DEX arb counts toward the headline, because it reads live on-chain reserves and can genuinely answer "was there an opening just now". Aave rows are *completed* liquidations already won by someone else; Venus rows derive from lagging subgraph oracle prices. Both are recorded as **retrospective — explicitly not evidence**.
- **A bug caught before it became a green light.** The first cut reported "21 opportunities cleared". It was an artefact: Venus pays a **fixed 10% liquidation incentive**, so every row nets exactly `(10% x 15%) - 0.05% - 0.45% = 1.00%` regardless of size. At a 0.95% bar every row passes; at 1.05% none do. The test could not be failed on merit, so it measured nothing. Added `marginIsDegenerate()` to detect that class of defect rather than depend on someone noticing.
- Ledger carries a schema version so rows judged under different rules can never be mixed into one count.
- **Current reading: 0 available opportunities cleared** (64 rows evaluated), 21 retrospective, degeneracy flag firing.
- **New project plan** (`docs/flash-loan-project-plan.md`): six gated phases with falsifiable exit criteria, a budget table (audit dominates; deployment gas is $0.71 at today's 0.186 gwei), pre-agreed hard-stop conditions, and an up-front list of what would make the case *against* proceeding.

## 2.21.1 - 2026-07-20

**Aave v4 flash-loan question settled against the source — the answer is no.**

- Downloaded the full public `aave/aave-v4` source (460 Solidity files) and grepped it. **Zero** occurrences of `flash`, `executeOperation`, or `flashLoan` — case-insensitive, across every file. Controls in the same search: `borrow` 132 files, `supply` 140, `liquidationCall` 15, proving the search works. `ISpoke`/`IHub`/`IHubBase` were also read function-by-function: no flash-loan entrypoint.
- **Aave v4 has no flash-loan capability at all.** This supersedes the earlier "mechanism exists but no documented entrypoint" reading, which was inferred from the docs.
- Reconciles the v4 docs' mention of a 0.05% flash-loan fee on Position Swaps: v4 core has no swap engine either (the only `swap` hits are OpenZeppelin helpers). Swaps run off-core via an intent model with CoW Protocol, so the flash loan behind them is sourced **outside** Aave v4 and the fee is passed through — not a primitive v4 exposes.
- Records that providing collateral does not change the answer. Collateral is what flash loans exist to avoid; the collateral-backed variant (`flashLoan()` with `interestRateMode != 0`) is a **v3** feature and still requires the v3 receiver contract.

## 2.21.0 - 2026-07-20

**Flash-loan build requirements documented** (`docs/flash-loan-build-requirements.md`).

- Full sweep of all 91 pages of aave.com/docs plus the aave-v3-origin source, turned into a labelled build checklist: **[PROTOCOL]** (Aave requires it), **[ENGINEERING]** (you fail without it), **[JUDGEMENT]** (your call).
- **The headline: a flash loan cannot be done from a wallet, an API, or an SDK.** It is a callback into a contract you deployed. AaveKit's entire write surface (supply/borrow/repay/withdraw/liquidate/swap) contains no flash-loan action — verified across the whole hooks reference.
- Documents the two mandatory security guards (`msg.sender == POOL`, `initiator == address(this)`), what each prevents, and the fact that **`FlashLoanReceiverBase` provides neither** — the most misunderstood point, and the one the third-party repo we reviewed got wrong.
- **Premium verified on-chain**, not from docs: `FLASHLOAN_PREMIUM_TOTAL()` returns `5` (bps) on the live Ethereum Pool. Documents reading it at runtime rather than hardcoding, since governance can change it per market.
- Concludes `FLASH_BORROWER` is not worth pursuing: waives the fee only on `flashLoan()` (never `flashLoanSimple`), grants no extra capacity, and requires an Aave governance proposal — worth $50 of a ~$950 cost base.
- **Correction recorded:** an earlier claim in this session that "Aave v4 does not support flash loans" was wrong. v4 documents a 0.05% flash-loan fee and a per-reserve enable flag, and its swap engine uses them internally. What is true is narrower: v4 documents no public developer entrypoint (zero occurrences of `executeOperation`/`IFlashLoanReceiver`/`flashLoan()` across its 28 pages). The on-chain probe that prompted the error tested a v3-era getter name, whose absence proves nothing about v4.
- Notes v4 is an API break regardless: no single Pool, calls go to Spokes, reserves are `uint256 reserveId`, approvals go to the hub.

## 2.20.0 - 2026-07-20

**Live Aave protocol data on the Flash Lab — and it caught four stale assumptions in our own model.**

- **New read-only integration with Aave's keyless GraphQL API** (`api.v3.aave.com`), gated behind the desk auth, 10-minute cache, serves stale-with-a-warning if Aave is unreachable, and fails to a hidden card rather than breaking the desk. **Strictly read-only** — no transaction can originate here, and an Aave flash loan requires a deployed receiver contract we do not have and are not building.
- **Assumption-drift check — the reason this was worth building.** `flashsim.py` carries a hardcoded liquidation-bonus table. Those are *governance parameters* that change by vote, and a stale one silently mis-states modelled profit. Diffing ours against the live protocol found **4 of 9 modelled assets have drifted**, and **three of the four overstate the bonus** — i.e. our liquidation model has been flattering itself:

  | Asset | We assume | Protocol | Effect |
  |---|---|---|---|
  | WBTC | 6.25% | **5.00%** | overstates by 25% |
  | wstETH | 7.00% | **6.00%** | overstates by 17% |
  | weETH | 7.50% | **7.00%** | overstates |
  | cbBTC | 6.00% | **7.50%** | understates |

- Drifted rows are highlighted and sorted first, with a banner naming each. Assets we don't model show `—` rather than being falsely flagged as a mismatch.
- Also surfaces live supply/borrow APY, max LTV, liquidation threshold and frozen/paused status for all 19 collateral-eligible reserves on Aave v3 Ethereum, with the same hover-help treatment as the other tables.
- **`v3`, not `v4`, deliberately.** v4's API is live but covers only Ethereum and Avalanche, and our liquidation feed is v3 — mixing v4 parameters into a v3 model would be wrong. The v3 API covers 15+ chains including Base and Arbitrum.
- **Note:** the drift is *reported*, not auto-corrected. Changing `flashsim.py`'s table alters scanner semantics and is left as a deliberate decision.

**Earn/Vaults scoping doc — the blocking open question is now answered** (`docs/earn-vaults-scope.md`). Read of `ATokenVault.sol`: depositor principal *is* protected from the vault owner (no pause, `withdrawFees` capped at accrued fees, `emergencyRescue` barred from the aToken). But the owner can raise the performance fee to **100% of yield** instantly with no timelock, and can redirect **all reward emissions** to itself — both need disclosing. The binding risk is **proxy admin**: the vault is upgradeable behind a proxy whose admin is a separate address from the owner, and whoever holds that key can reach principal. That is not answerable from source and must be verified per-deployment.

## 2.19.0 - 2026-07-20

**Flash Lab: the same hover help extended to all five tables — and two mislabelled columns fixed.**

- **Two real labelling bugs found while writing the tooltips**, both of which overstated results:
  - The BSC arb table's **`Net %` column was rendering dollars, not a percentage** — it shows `net_usd_on_clip`. Renamed to **`Net $ (on clip)`**. Sitting between `Slippage %` and `Min pool $`, a reader had every reason to take `-140.51` as a percentage.
  - The Venus table's **`Net (competitive) $` does not deduct the flash fee, swap cost or gas** — unlike the identically-named column in the Aave table, it is only `gross bonus × 15%`. Renamed to **`Kept bonus (15%) $`**, and its tooltip now says in terms that it is a ceiling, not a net profit.
- **Hover help on all 34 column headings** across the gas table, cost breakdown, Aave liquidations, PancakeSwap arb, and Venus liquidations.
- **Per-row arithmetic on every derived figure** — each gas cell shows `units × gas price × ETH price`; each cost line shows the bps applied to your loan size; each BSC arb net shows the full `spread − fees − slippage − gas` subtraction and the conversion to dollars; each Venus row shows the close-factor and incentive maths.
- **A visible `?` hint above every table** so the help is discoverable rather than something you must guess at.
- **Verified against real data:** rendered the actual file against real flash-loan and BSC snapshots (14 Aave rows, 5 arb rows, 25 Venus rows) and confirmed every tooltip figure reconciles with the cell beside it.

## 2.18.0 - 2026-07-20

**Flash Lab: the liquidations table now explains itself.**

- **Hover help on all 12 column headings.** Each states what the figure is and how it is derived — including the ones that mislead at a glance: `Seized $` is position size, not profit; `Bonus %` is the entire source of edge; `Clears?` means "would have been profitable if you had won it", not "was available to you".
- **Per-row arithmetic on every figure.** Hovering a net value shows that row's actual sum laid out line by line (`gross − flash fee − swap − gas = net`), with real numbers rather than a generic formula. `Seized $` shows the borrow derivation, `Flash fee` shows the 0.05% applied to the borrowed amount, `Swap` shows the 0.45% applied to the seized amount.
- **A "How these numbers are calculated" panel** under the table: the trade explained in prose, the five formulas, and why the two net columns diverge (the competitive column keeps 15% of the bonus, the rest bid away in priority fees).
- **Makes the counter-intuitive point visible:** gas is trivial and size-independent, while the swap cost dominates and scales. "Flash loans are expensive because of gas" is backwards, and the per-row numbers now show it.
- **Verified, not assumed:** the tooltip formulas were re-computed against 14 real snapshot rows and reconcile with every displayed value (net, competitive, and borrow) to within a cent. Rendering was confirmed against the real file and real data.
- Native `title` tooltips used deliberately — a CSS bubble would be clipped by the table's `overflow-x` scroll container. Headers get `cursor:help` and a dotted underline so the help is discoverable.
- Restates plainly that every row was already won by an MEV bot, and that the 15% capture rate is an estimate rather than a measurement.

## 2.17.1 - 2026-07-20

**Document the arb-desk Access variables in `.env.example`.**

- `.env.example` documented the operator key but **neither** Cloudflare Access variable (`ARB_ACCESS_TEAM_DOMAIN`, `ARB_ACCESS_AUD`) nor the new `ARB_DESK_ADMIN_EMAILS`. A box rebuilt from the example would come up with a desk nobody can administer from the browser and no hint as to why — the failure is safe (fails closed) but silent, which is the worst kind to debug.
- The `ARB_DESK_ADMIN_EMAILS` entry states the fail-closed behaviour, that the operator admin key prevents lockout, that a 403 on desk writes is the symptom, and that the value must match the email **Cloudflare Access asserts** — shown in the desk as the signed-in `viewer` — because a Google alias won't match the address you'd type.
- Docs only; no code change. `ARB_DESK_ADMIN_EMAILS=hall.philip@gmail.com` was set on the production box under 2.17.0 and verified live (no startup warning across two restarts).

## 2.17.0 - 2026-07-20

**Security: an Access login no longer confers arb-desk admin.**

- **The hole.** `deskAdmin()` returned any verified Cloudflare Access email *regardless of whether the caller needed admin* — the `requireAdmin` argument was ignored on the Access path. The Access allow-list was being treated as the admin list. That was safe while the allow-list held exactly one person and stopped being safe the moment a second was added: anyone granted desk visibility could rewrite live scanner thresholds via `POST /arb-desk/config` and repoint the ntfy alert topic via `POST /arb-desk/test-alert` — i.e. silently redirect the alert stream somewhere the owner can't see.
- **The split.** `deskAdmin(req, bool)` is replaced by `deskAuth(req)` returning `{ who, admin }`. Identity and authority are now separate answers. Read routes accept any authenticated caller; write routes require `.admin` and return **403** (with the signed-in identity) rather than a misleading 401. There is no boolean argument left to forget at a call site.
- **New `ARB_DESK_ADMIN_EMAILS`** (comma-separated, case-insensitive) controls who may change desk settings via an Access login. Rules live in `src/security/deskAdminRules.ts` alongside `operatorRules`, so they're unit-testable without an Express app.
- **Fails closed.** An unset or blank list grants admin to **nobody** via Access — a missing config must never read as "allow everyone". The operator ADMIN key is unaffected, so this cannot lock an owner out. A startup warning names the variable when Access is on and the list is empty.
- **New contract test** `npm run test:desk-auth`, covering fail-closed behaviour, case-insensitivity, and near-miss addresses (`owner@example.com.evil.com`, `notowner@example.com`). **Verified it fails** when the original bug is reintroduced — a regression test that never fails proves nothing.
- **Migration:** browser admin is OFF until `ARB_DESK_ADMIN_EMAILS` is set on the box. Use the operator admin key until then.

## 2.16.1 - 2026-07-20

**Fix: `/assets/ga.js` 404'd on every page.**

- `public/ga.js` was **untracked in git** and absent from the production box, while the site-wide script injector emitted `<script src="/assets/ga.js">` on every page and a route to serve it already existed. Every page load therefore fired a request that 404'd. Now committed and deployed.
- **No analytics behaviour changes.** `MEASUREMENT_ID` is still the `G-XXXXXXXXXX` placeholder, so the script returns on line 18 and loads nothing — no GA property, no cookies, no collection. The impact of the bug was a console 404, not lost data, and the fix does not start tracking. Paste a real measurement ID to enable it; consent gating (`AtomicConsent`, opt-in in EU/EEA/UK/CH) is already wired.
- **Edge cache caveat:** Cloudflare cached the 404 with `max-age=14400`, so the bare URL keeps serving it for up to 4h after this deploy. Verified fixed at origin via a cache-busted request (200, `application/javascript`, 3247 bytes). Purge `/assets/ga.js` to clear it immediately.
- **Untracked-file lesson:** because the file was never committed, nothing flagged that production lacked it. The deploy rsync had it queued the whole time.

## 2.16.0 - 2026-07-20

**Spam flagging: renamed to what it actually claims, and taught to catch plain-ASCII scam tokens.**

- **`spoofed` → `suspected spam`.** The badge now matches the API field it renders (`suspected_spam`) and stops asserting more certainty than the check earns. Each badge carries a **tooltip with the specific reason** it fired, so a flag is auditable rather than an opaque verdict.
- **New signal: no price feed.** Symbol-pattern matching only catches bait that *looks* fake — it silently missed plain-ASCII scam tokens (`DDYS`, `TVRa`, `AML` all sat unflagged next to a caught `tre.pw`). Transfers on the displayed rows are now checked for a real market: Alchemy Prices per chain on EVM, CoinGecko's tron contract endpoint on Tron.
- **Best catch: fake native-asset tokens.** On vitalik.eth this flags an ERC-20 *literally named "ETH"* — it has a contract address, so it's distinguishable from real native ETH transfers, which stay unflagged. Previously the two were identical in the list.
- **Corrected a false positive before shipping.** The first Tron implementation used "absent from our curated 8-token map" as a proxy for "no price feed" and libelled **USDV**, a real stablecoin, as spam. Replaced with an actual price lookup; TUSD — also outside the curated map — now correctly passes.
- **Fails to unflagged, never to spam.** A price lookup that errors or rate-limits returns *unknown*, and unknown tokens are left unmarked. A dead upstream must not manufacture accusations against a wallet.
- **Honest reason strings.** `unrecognised token — no price feed` states the evidence, not a conclusion. A legitimate token with no CoinGecko market will trip it; the wording is chosen so that reading the flag tells you exactly what was and wasn't established.

## 2.15.0 - 2026-07-20

**Flash Lab: a live "what a flash loan actually costs" reference.**

- New card on the Flash-Loan Lab making the point that trips most people up: **gas does not scale with loan size**. Borrowing $100k and borrowing $10M burn the same gas, because it's the same computation — only the fee legs scale. A live gas table (250k / 400k / 600k gas units × current and historical gas prices, with the live row highlighted) sits next to a size-dependent breakdown driven by an editable loan-size input.
- The breakdown separates **fixed** cost (gas) from **size-scaling** costs (flash fee, DEX swap fees ×2 legs, slippage ×2 legs) and computes the **break-even gross edge** required — stating plainly that this is *before* MEV competition, which takes most of what's left on contested opportunities.
- Concretely at today's numbers (0.079 gwei, ETH ~$1,887): a $100k flash loan costs **~$0.06 in gas** but **$50** in Aave flash fee and **$100–600** in swap fees — so ~0.15%+ of gross edge is needed just to break even, and gas is rounding error. At 100 gwei that same tx is only ~$75 of gas, still dwarfed by the fee legs. This is the arithmetic behind the Lab's standing verdict that no capturable flash-loan edge exists on these venues.

## 2.14.0 - 2026-07-20

**Tron gets transfer history, counterparties and net flow — enough to tell a treasury from an exchange.**

- **TRC-20 transfer history and counterparties** on the Tron path (previously EVM-only). Tron reported holdings but no activity, so a treasury wallet and an exchange hot wallet looked identical. Now: the last 15 transfers with direction/asset/amount/counterparty, plus the top 8 counterparties with a sent-to / received-from split.
- **Net flow for the dominant held token**, which is the figure that actually characterises a wallet — and doubles as an **integrity check**: `in − out` is reconciled against the on-chain balance and reported as `reconciles: true/false`. If the visible history doesn't explain the balance, you know funds arrived outside the window.
- **Behavioural labels derived from flow**: `accumulation pattern (inflow ≫ outflow)` and `low transaction count for size — treasury/custody profile, not an exchange hot wallet`. On a real $122M USDT wallet this correctly reclassified it: 20 transfers in ~8 months with lumpy inbound deposits and near-zero spend is custody, **not** the exchange hot wallet an eyeballed balance suggests.
- **Tron spam/poisoning detection** — flags non-ASCII symbols and domain-style token names (e.g. `tre.pw`) that scammers airdrop onto high-value wallets, so real flow isn't buried.
- **Stated limitation:** Tron counterparties are **unlabelled** — the ~33k address-label corpus is EVM-only. An unnamed Tron address means *"no label available"*, not *"unknown/suspicious"*.

## 2.13.0 - 2026-07-20

**Wallet Intelligence: a self-refreshing address-label corpus — hex becomes meaning, and scam exposure becomes a risk verdict.**

- **~33,000 labelled addresses**, refreshed daily from free public corpora with no key, no signup and no vendor — the same architecture as the OFAC refresher (disk cache, restored at boot, min-size guard so a bad download can never shrink the corpus). Sources: **Etherscan nametags** (~30k: exchange hot wallets, protocols, routers, pools, bridges, `mev-bot`/`airdrop-hunter` tags), **ScamSniffer blacklist** (~2.5k drainers) and the **MyEtherWallet darklist** (~700 phishing addresses with comments). Live count on first load: **32,953 entries, 3,182 scam/phishing**.
- **Scam exposure is now a risk verdict, not a footnote.** If the subject address is blacklisted → **critical** ("This address is on a public scam/phishing blacklist"). If it has *interacted with* blacklisted addresses → **high**, flagged as possible drainer exposure or a compromised wallet. Screened across every counterparty seen, not just the eight displayed. Verified end-to-end: a corpus scam address returns critical and renders as `FAKE_Coindash_3`.
- **Counterparties, transactions, funding provenance and the subject address itself** are all resolved through the corpus, so exchange hot wallets and protocols now show names instead of hex (e.g. a Binance hot wallet self-labels as "Binance", tagged `binance`).
- **Stated limitation, in the API response and on the page:** these corpora contain exchange **hot** wallets, not the per-user **deposit** addresses exchanges generate — that requires clustering (Arkham/Nansen/Chainalysis) and isn't available from free data. So an unlabelled counterparty means *"not in the corpus"*, never *"not an exchange"*. Confirmed in practice: a Binance hot wallet's own counterparties come back unlabelled, because they're deposit addresses.

## 2.12.0 - 2026-07-19

**Wallet Intelligence: activity is now multi-chain, and contract/NFT activity is no longer invisible.**

- **Transactions and counterparties span every EVM chain**, not just Ethereum. Holdings were already multi-chain, but activity wasn't — so a wallet that lives on Base looked inactive. Transfers are now gathered across Ethereum, Base, Arbitrum, Optimism, Polygon and Avalanche, merged, sorted by time, and each row is tagged with the chain it happened on. Verified on a live wallet: 15 transactions spanning Ethereum, Base and Arbitrum.
- **`internal` and NFT transfers are now included** (`internal`, `erc721`, `erc1155` alongside `external`/`erc20`). Previously a wallet transacting through contracts could look quiet when it wasn't. `internal` isn't supported on every chain, so the call falls back to the narrow category set per chain rather than failing.
- **Wallet age and funding provenance are computed across all chains** — the earliest inbound transfer on *any* chain, rather than assuming Ethereum. Funding provenance now reports which chain the first deposit landed on.
- Counterparty and transaction labels now use the full label set (known contracts + spenders + exchange hot wallets), not just the contracts map.

## 2.11.0 - 2026-07-19

**Wallet Intelligence: outstanding token approvals + funding provenance.**

- **Token approvals** — the wallet's top held tokens are checked against a curated set of well-known spenders (Uniswap V2/V3/Universal, Permit2, 1inch v5/v6, 0x, Seaport, CoW), and any live allowance is reported with **unlimited** flagged. An unlimited allowance lets that contract move the token at any time, indefinitely — it's a real and under-watched risk surface.
  - **Honest scope, stated in the response.** Discovering approvals to *arbitrary* spenders needs an Approval-event log scan, and `eth_getLogs` is unavailable on our RPC access (the paid upstream rejects it; the public fallback refuses archive queries — verified at 9k, 40k, 45k and 50k block spans). What does work is `allowance(owner, spender)`, which returns **current** state — so coverage for every spender we can name is complete and all-time, while approvals to unlisted contracts are **not** detected. The report says exactly that rather than implying a clean bill of health. An earlier draft claimed "spenders seen in the last ~50k blocks" — that discovery was silently failing, and the claim was removed rather than left to mislead.
  - Unlimited approvals to mainstream routers are reported as **informational, not a risk verdict** — that's ordinary DeFi hygiene-debt, not evidence of compromise.
- **Funding provenance** — who sent the **first inbound transfer**, with date, asset and amount, labelled against known exchange hot wallets (Binance/Coinbase/Kraken/OKX/Bitfinex). A wallet first funded from a regulated exchange reads very differently from one funded by an unknown contract. Labels are best-effort and the raw address is always shown so it can be verified independently.

## 2.10.0 - 2026-07-19

**Wallet Intelligence goes multi-chain — portfolio across every EVM chain, transaction history, counterparties, and ENS.**

- **Multi-chain EVM.** One `0x` address is now scanned across **Ethereum, Base, Arbitrum, Optimism, Polygon and Avalanche** in parallel, with a per-chain breakdown (native + value-ranked tokens) and a **combined `portfolio_total_usd`**. Previously the report was Ethereum-only and materially understated any modern wallet — vitalik.eth reads $19,399 across 6 chains vs $12,394 on Ethereum alone.
- **Recent transaction history.** The last 15 transfers (both directions), each with date, direction, asset, amount and counterparty. We were already fetching these and discarding everything but the timestamps.
- **Address-poisoning / spoof detection.** Scam tokens impersonate real ones with non-ASCII homoglyphs (e.g. `ĖTḨ` for `ETH`) and dust a wallet to plant a lookalike in its history. Those transfers are now flagged `suspected_spam` and dimmed, so genuine activity isn't buried.
- **Top counterparties.** The eight most-frequent addresses, with sent-to / received-from split and known-contract labels (routers, tokens). Previously collected only for the sanctions screen and reduced to a boolean.
- **ENS primary name** resolved for EVM addresses (identity signal only, never a trust signal).
- Token pricing now runs per-chain through Alchemy's Prices API; metadata is fetched only for tokens that have a price, so a spam-flooded wallet can't bury its real holdings behind a metadata cap.

## 2.9.3 - 2026-07-18

**Wallet Intelligence: Bitcoin + Solana support, and the report now opens in its own full-page tab.**

- **Two more chains — Bitcoin and Solana** — alongside Ethereum and Tron; the address type is auto-detected. Bitcoin (`bc1…`/`1…`/`3…`) uses the keyless mempool.space API for balance + tx count + last activity; Solana uses the public RPC for SOL balance, SPL-token-account count, and last activity. Both screen against the OFAC snapshot (which includes **526 Bitcoin** and Solana addresses) — so the tool now covers essentially the entire OFAC crypto address space (BTC + TRON + EVM + SOL).
- **The report opens in a dedicated new tab** (`/wallet`) instead of expanding inside the dashboard card — the inline report was overflowing the box. The dashboard now shows a compact search that launches the full-page report; the report page auto-runs from `?address=` and lets you look up another address inline.

## 2.9.2 - 2026-07-18

**Wallet Intelligence: Tron support + a real token filter (value-ranked, spam hidden) + more report detail.**

- **Tron addresses now supported** (`T…` base58, alongside `0x…` EVM). Sanctions screen runs against the OFAC snapshot (which includes 267 Tron addresses); account balance, TRC-20 holdings, and first/last activity come from the keyless TronGrid API; a curated TRC-20 map (USDT/USDC/USDD/JST/BTT/WIN/SUN/WBTC) is priced via CoinGecko. Same report shape and risk verdict as the EVM path.
- **Token holdings are now value-ranked and spam-filtered.** The list was surfacing airdrop-spam by raw amount; now every held token is **priced** (EVM via the Alchemy Prices API, Tron via CoinGecko), tokens worth ≥ $1 are shown sorted by USD value, and everything unpriced or sub-$1 (i.e. spam/dust) is hidden with an honest count. To avoid missing real tokens buried under spam, we scan a wide balance set and **price first, then fetch metadata only for priced tokens** (also cuts RPC calls). Falls back to amount-ranked display only if the price service is unavailable — never silently hides real holdings.
- **More detail in the report:** a sanctions-screen status line (OFAC snapshot / live-oracle state), a "last active" field (now derived from inbound *and* outbound activity), and the native symbol/chain rendered correctly per chain.
- Exchange "Wallet Intel" panel: accepts both address types, cleaner input/button styling, USD value column.

## 2.9.1 - 2026-07-18

**Wallet Intelligence — paste an Ethereum address, get read-only diligence (sanctions, type, holdings, activity). Independently code-reviewed and hardened before ship.**

- New public `GET /v1/wallet-intel/:address` (Ethereum mainnet): screens the address **and its recent counterparties** against the OFAC snapshot + the live on-chain sanctions oracle; classifies EOA / contract / **EIP-7702 delegated EOA**; reports native + token holdings, an activity window (first/last seen, age, dormant), heuristic labels, and a **clean / caution / high / critical** risk verdict. Reuses the Alchemy-backed RPC and the OFAC screen from 2.9.0 — a route plus a card, not a new service. Surfaced on Atomic Exchange as a "Wallet Intel" panel (edge-proxied via a Pages Function, per-client rate-limited). Read-only: no copy-trading, no execution.
- **Review fixes** (from an independent correctness + security review; zero XSS/SSRF/injection found):
  - **Rate limit is now per-client, not one global bucket.** The exchange's edge proxy hid the real client behind Cloudflare's egress IP, collapsing every visitor into a single 20/min bucket — a trivial self-DoS. The proxy now forwards the real client IP (`X-Client-IP`, set from `cf-connecting-ip`, never client input) and the origin keys the limiter per user (30/min).
  - **The verdict no longer over-claims "clean" when the live oracle is unreachable.** A new `screenAddressOracleChecked` reports whether the live layer actually ran; the response carries a `screen` status (`ofac_snapshot` / `live_oracle`: clear | hit | unavailable) and marks a snapshot-only result provisional.
  - **`last_seen` now reflects inbound *and* outbound** — a receive-only wallet was wrongly reported as never-active.
  - Counterparty screen bounded to 15 addresses (caps RPC fan-out); internal error strings no longer leak to clients.

## 2.9.0 - 2026-07-17

**Operator research surfaces — Grid Lab and the Flash-Loan Lab (with a BSC surface) — plus keyless OFAC screening and Prisma 6. Everything here is LOG-ONLY: no trade keys live server-side, nothing auto-executes.**

- **Grid Lab** (on the operator-gated `/arb-desk`) — a LOG-ONLY paper spot-grid + micro-scalp forward test. Four strategies (BTC/ETH/SOL 1% grids + a BTC 0.4% micro-scalp) run $1,000 paper each against real Kraken 1-minute candles, with honest fills (a rung fills only when price trades *through* it), real maker fees, and per-cycle benchmarking **against buy-and-hold and hold-USD** — a grid that trails the trend shows it. Reads a `grid_snapshot.json` written by the scanner box; the desk hides the card when the service is off.
- **Flash-Loan Lab** — a **private** page at `/arb-desk/flash`, under the same Cloudflare Access gate as the desk. A LOG-ONLY simulator that asks, for each on-chain opportunity the scanner already sees, whether a flash-loan tx would clear its costs (flash fee + live gas + DEX swap + slippage + the MEV bid war). Aave liquidations are modeled honestly and flagged **already-executed** (the net is what the winner made, not what's capturable); cross-chain spreads are flagged **not flash-loanable** (a bridge hop can't sit in one atomic tx). New gated `/arb-desk/flash-data` feed; page routed under the `/arb-desk` prefix so it inherits the Access login.
- **BSC surface on the Flash Lab** — PancakeSwap cross-DEX arb from on-chain reserves (V2 vs Biswap vs ApeSwap, depth-aware) plus Venus liquidations health-scanned from the Venus subgraph, both modeled through the flash-loan lens.
- **Keyless daily OFAC sanctions auto-refresh** — the sanctions screen now re-pulls the official U.S. Treasury SDN every 24h and replaces the in-memory list in place (905 addresses across BTC/TRON/EVM/LTC), with a min-size guard and a restart-surviving cache. No vendor, no signup, no API key — Chainalysis remains optional, not required.
- **Prisma 5.22 → 6.19.3** (drop-in; no schema/preview-feature changes).
- **Atomic Exchange cross-links** from the landing nav/footer and the swap console; the swap console's top bar links back to the Exchange.
- Operator alert delivery (scanner side) gained **Telegram** and **one-tap venue deep-links** — navigation only; alerts never place an order.

## 2.8.2 - 2026-07-14

**Security release — stored XSS on the wallet origin, and an unauthenticated off-ramp link builder.**

- **🔴 Stored XSS (confirmed exploitable, now fixed).** A merchant's invoice `description`/`reference` were interpolated into `innerHTML` unescaped on the hosted **checkout receipt** and in the merchant portal. Since merchant signup is self-serve and unverified, anyone could register, put `<img onerror=…>` in an invoice, send the checkout link, and execute arbitrary JavaScript **in the paying customer's browser on `atomicpay.cloud` — the same origin as the passkey wallet**. All user-supplied values are now HTML-escaped at every `innerHTML` site in `checkout.html` and `merchant.html` (emails were already escaped).
- **🔴 `/v1/offramp/link` was unauthenticated.** Anyone could mint off-ramp links **signed with our MoonPay/Mercuryo partner credentials** for any address. The endpoint now requires merchant authentication, refuses flagged accounts, and takes the destination from the **authenticated merchant's own receiving wallet** — a client-supplied address is ignored entirely.

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

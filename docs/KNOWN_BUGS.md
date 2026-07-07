# Atomic — Known Bugs & Limitations

Living register of known issues. Severity: 🔴 blocker · 🟠 major · 🟡 minor · 🔵 tracked/by-design.
Last updated: 2026-07-06.

## 🔴 Open bugs (fix before public launch)
| # | Area | Issue | Notes |
|---|---|---|---|
| B1 | Wallet connect | **Safari: "Connect Wallet" does nothing** (works in Chrome). | Hardened 2026-07-07: global error net (visible msg + PostHog `client_error` w/ stack), wrapped connect handler, Safari-specific WalletConnect errors, `-webkit-backdrop-filter`. Root cause pending the captured Safari stack. |
| B2 | Wallet connect | **WalletConnect QR** — reported "no QR shows"; switched to rendering our own QR from the `display_uri` event. | Verify the in-modal QR renders + a real mobile scan connects end-to-end. |
| B3 | Execution | **End-to-end live swap never completed with real funds.** | The $10 EVM test (Base USDC → ETH USDC) is the Phase-0 gate; approval→send→settle→fee is built but unproven in prod. |

## 🟠 Untested paths (built, not validated)
| # | Area | Issue |
|---|---|---|
| B4 | BTC execution | `executeBtcSwap` (Unisat `sendBitcoin` / Xverse-Leather `sendTransfer` to LI.FI deposit address) — never run with a real BTC wallet. |
| B5 | SOL execution | `executeSolSwap` (@solana/web3.js deserialize + `signAndSendTransaction`) — never run with a real Solana wallet. |

## 🟡 Minor / UX
| # | Area | Issue |
|---|---|---|
| B6 | Quotes | **Simulation fallback** (when LI.FI is unreachable) shows a plausible-looking "Estimated Received" that isn't executable. Guarded for wallet/source mismatch; pure network fallback still shows a sim number. |
| B7 | UI | `admin-compliance.html` still uses the **dark theme**; all other pages are light. |
| B8 | Email | **Daily P&L lands in spam** — DKIM not enabled in IONOS (SPF + DMARC are done). |
| B9 | UX | 30-second quote lock expires quickly; user must re-quote. |

## 🔵 By-design constraints / tracked work
| # | Area | Note |
|---|---|---|
| L1 | BTC/SOL source | A BTC swap needs a **Bitcoin-native wallet** (Xverse/Unisat/Leather); EVM wallets can't source BTC. Now guarded with a clear message. BTC-from-browser is inherently niche. |
| L2 | Fee | Customer all-in ≈ **2.75%** (our 2.5% + LI.FI 0.25% + gas). Higher than sub-1% competitors — monitor conversion. |
| L3 | Assets | Only **15 assets** certified for live LI.FI routing; long-tail L1s (XRP/DOGE/ADA/LTC/DOT/ATOM/NEAR/APT/TRON) fail-closed until mapped. |
| L4 | Embedded wallet | Self-hosted Openfort (**opensigner**) email→wallet not deployed — blocked on the new IONOS server. See `opensigner-selfhost-plan.md`. |
| L5 | Margin | Direct-rail routing (Jupiter/Uniswap/THORChain) to skip LI.FI's 0.25% — queued, not built. |
| L6 | Infra | Live provider quotes only work from the VPS (external egress), not the local dev sandbox — expected. |

## Recently fixed (for reference)
- **Site-wide 429** — app ran behind Cloudflare→nginx with no `trust proxy`, so all traffic keyed as `127.0.0.1` and shared one 100-req/15min bucket. Fixed: key on `CF-Connecting-IP`, skip static/pages, 1000/15min per real IP.
- Multi-wallet connect silent failure → **EIP-6963** discovery + connecting spinner + 45s timeout.
- Atomic-units amount input → **human amounts** (type "10", not "10000000").
- EVM wallet + BTC source silently faked a quote → now **blocked with a clear message**.
- Fee over-gross-up (net 2.75%) → corrected to **net exactly 2.5%** (LI.FI's fee is additive).
- Cloudflare 525 (wrong origin A-record) → resolved; site live over HTTPS.

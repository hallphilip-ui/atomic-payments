# Chrome Web Store listing — Atomic Pay (Swap & Wallet)

## Name (max 45 chars)
Atomic Pay — Swap & Wallet

## Summary / short description (max 132 chars)
Swap any crypto across chains on any site — with just your email and Face ID. Non-custodial, no seed phrase, no gas token.

## Category
Tools  *(no dedicated Finance/Crypto category exists; "Tools" is the closest fit — MetaMask-style wallets list here.)*

## Language
English

---

## Detailed description

**Swap crypto on any website with just your email and Face ID — no seed phrase, no wallet app, no gas token.**

Atomic Pay is a non-custodial crypto wallet and cross-chain swap that lives in your browser. Create a real self-custody wallet in seconds with your email and Face ID / Touch ID — there's no seed phrase to write down, lose, or get phished for. Then swap any coin to any coin, across chains, right from the toolbar.

**What you can do**
• Create a wallet with email + Face ID — a real self-custody key, derived on your device
• Swap across chains — Bitcoin, Ethereum, Solana, Base, Arbitrum, Optimism, Polygon, BNB, Avalanche and more
• Connect to dapps — Atomic Pay appears alongside other wallets (EIP-6963) so any site can use it
• Quick-swap from the toolbar popup, without leaving the page you're on
• Skip the gas dance — gas is sponsored, so you don't need to hold a native token just to move

**Non-custodial by design**
Your keys are derived on your own device and never touch our servers. Every signature requires a fresh Face ID / Touch ID confirmation, and you can export a standard encrypted keystore to import into MetaMask or any wallet at any time. If Atomic Pay disappeared tomorrow, your funds would still be yours.

**No token, no catch**
There's no token, no ICO, and nothing to buy. Atomic Pay earns a small spread on swaps, shown in your quote before you confirm.

Swap now: https://atomicpay.cloud/defi-swap
Learn more: https://atomicpay.cloud
Help & FAQ: https://atomicpay.cloud/help

---

## Single-purpose statement (required)
Atomic Pay is a non-custodial crypto wallet and cross-chain swap tool. It lets the user create and use an email + passkey (Face ID/Touch ID) wallet and execute token swaps, by injecting a standard EIP-6963 wallet provider into web pages and offering a quick-swap popup. All signing is escorted to the user's passkey on atomicpay.cloud; the extension holds no private keys.

## Permission justifications
- **storage** — Stores only the user's wallet metadata (wallet address, email label) and the pending signing-request queue locally, so the popup and the injected provider can coordinate. No private keys are ever stored; keys are derived on-device from the user's passkey.
- **host permission: https://atomicpay.cloud/\*** — Every signature is escorted to the atomicpay.cloud signer page (the correct WebAuthn/passkey origin), and read-only blockchain calls go through atomicpay.cloud's RPC proxy. Access is limited to our own domain.
- **content script on all sites (`<all_urls>`)** — Injects the EIP-6963 wallet provider so any dapp the user visits can discover and connect to the Atomic Pay wallet, exactly like other wallet extensions. The content script only relays wallet requests between the page and the extension; it does not read or collect page content.

## Data-use disclosures (Privacy practices tab)
- **Data handled:** wallet address and an email label (authentication/identity for the wallet). No browsing history, no page content, no keystrokes collected.
- **Not sold / not transferred** to third parties for unrelated purposes.
- **Used only** to provide the wallet + swap functionality the user requests.
- **Privacy policy URL:** https://atomicpay.cloud/privacy
- Certify compliance with the Chrome Web Store Developer Program Policies. No remote code is executed — all logic ships in the package; the atomicpay.cloud iframes are the app's own pages, not remote code injected into the extension.

## Store graphics checklist
- Store icon: 128×128 (in package: `icons/icon-128.png`)
- Screenshots: 1280×800 (1–5). Provided in this folder: `screenshot-1..3.png`
- Small promo tile: 440×280 — `promo-small.png`
- Marquee 1400×560 (optional) — not generated

---

# Microsoft Edge Add-ons listing

Edge is Chromium — **upload the exact same `atomic-pay-chrome-v0.1.0.zip`**. Reuse the Chrome copy verbatim:
- **Name / Summary / Description / Single-purpose / Permission justifications / Privacy** — identical to the Chrome sections above.
- **Category:** Productivity (Edge has no Finance/Crypto category either).
- **Store:** free to publish (no registration fee). Review is typically faster than Chrome's.

---

# Safari (App Store) listing

Safari needs a native wrapper, not a raw zip:
1. `xcrun safari-web-extension-converter /Users/philiphall/atomic-payments/extension` → generates an Xcode project.
2. In Xcode: set bundle id `cloud.atomicpay.extension`, select your signing team, run once to test in Safari (enable it in Safari → Settings → Extensions).
3. Archive → upload to **App Store Connect**.

**App Store listing fields:**
- **App name:** Atomic Pay
- **Subtitle (30 chars):** Crypto swaps & Face ID wallet
- **Category:** Finance (secondary: Utilities)
- **Description:** reuse the "Detailed description" above (drop the browser-specific "toolbar" phrasing; say "from Safari").
- **Keywords:** crypto wallet, swap, defi, non-custodial, ethereum, bitcoin, passkey, cross-chain
- **Support URL:** https://atomicpay.cloud/help · **Marketing URL:** https://atomicpay.cloud · **Privacy Policy:** https://atomicpay.cloud/privacy
- **Privacy nutrition label:** Data used to provide the app only — "Identifiers" (wallet address) + "Contact Info" (email label); not linked to identity for tracking; not used for tracking.
- **Requires:** Apple Developer Program ($99/yr). Expect crypto-wallet review scrutiny; the non-custodial / no-remote-code points above are the answers reviewers look for.

---

# Submission steps

| Store | Where | Fee | Upload |
|---|---|---|---|
| **Chrome Web Store** | `chrome.google.com/webstore/devconsole` | $5 one-time | `atomic-pay-chrome-v0.1.0.zip` |
| **Edge Add-ons** | `partner.microsoft.com/dashboard/microsoftedge` | free | same zip |
| **Safari / App Store** | Xcode → App Store Connect | $99/yr | converted `.app` |

For each: new item → upload → paste the listing fields from this file → add screenshots (`screenshot-1..3.png`, must be **1280×800**) + promo tile (`promo-small.png`, 440×280) → submit for review (Chrome/Edge ~1–3 days).

## ⚠️ Extension-ID note (don't skip)
The manifest keeps a pinned `key`, so **Chrome & Edge will publish under ID `dkdfkdgccgoodochmglkkhfpckfckhhm`** — the same ID already in the server's `ATOMIC_EXTENSION_ORIGINS`, so the `/wallet-bridge` signer trusts it out of the gate. **Safari assigns its own ID** — after converting, read the Safari extension's identifier and **add `safari-web-extension://<that-id>` to `ATOMIC_EXTENSION_ORIGINS` in `.env` and redeploy**, or Safari users can't sign. Same fix if you ever remove the `key` and a store assigns a fresh Chrome/Edge ID.

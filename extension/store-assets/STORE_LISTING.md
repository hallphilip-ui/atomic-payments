# Atomic Pay — Store Listings

Upload package: `atomic-pay-extension-v0.1.0.zip` (this folder). MV3; same package
serves **Chrome Web Store** and **Edge Add-ons**. Safari ships as a wrapped app (see
bottom). Fill the fields below into each store's dashboard.

Shared links:
- Website / marketing: `https://atomicpay.cloud`
- Privacy policy: `https://atomicpay.cloud/privacy`
- Support email: `support@atomicpay.cloud`

---

## Chrome Web Store

**Name** (≤75): `Atomic Pay — Swap & Wallet`

**Summary** (≤132): `Swap any crypto across chains and use your email + Face ID wallet on any dapp. Non-custodial — no seed phrase, no gas token.`

**Category:** Productivity (Tools)   ·   **Language:** English

**Description:**
```
Atomic Pay is a non-custodial crypto wallet and cross-chain swap tool — right in your browser.

• One wallet, any site. Atomic Pay appears as a wallet option on any dapp (EIP-6963), alongside MetaMask and the rest. Pick it, connect, and go.
• No seed phrase. Your wallet is secured by your email and Face ID / Touch ID (passkeys). There's nothing to write down or lose.
• Swap any coin to any coin. Bridge and swap across Bitcoin, Ethereum, Solana, Base, Arbitrum, Optimism, Polygon, BNB Chain and Avalanche from the toolbar popup.
• No gas token needed. Swap tokens without first buying the chain's native gas coin.
• You keep your keys. Every signature is approved by you with Face ID — Atomic never holds your funds or your keys.

How it works: the extension adds Atomic Pay to the wallet picker on the sites you visit and opens a quick-swap popup from the toolbar. When something needs signing, it's confirmed with Face ID on atomicpay.cloud — the extension itself never touches your keys.

Non-custodial. Open by design. Your crypto, your control.
```

**Single-purpose description** (review field):
`Atomic Pay is a non-custodial crypto wallet and cross-chain swap tool: it lets a user connect "Atomic Pay" as their wallet on any decentralized app and swap assets, approving every signature with Face ID.`

**Permission justifications** (review field — be specific, crypto listings get scrutiny):
- `storage` — Stores only local session state (pending signing requests handed off to the approval view, and UI preferences). No personal data.
- host `https://atomicpay.cloud/*` — The extension communicates ONLY with Atomic Pay's own backend: read-only JSON-RPC (balances/quotes) and the atomicpay.cloud signing page. No other remote hosts.
- content script on `<all_urls>` + web-accessible `src/inpage.js` — Required to function as a wallet: it injects a standard EIP-6963 / EIP-1193 provider so dapps can offer "Atomic Pay" as a wallet (the same mechanism MetaMask uses). It does NOT read or modify page content; it announces the wallet and relays only the dapp's explicit, user-approved wallet requests.

**Data usage disclosures:**
- Does NOT collect or transmit private keys — the wallet key is derived on-device from a passkey and never leaves the device.
- Does NOT sell or share user data. No analytics or tracking in the extension.
- Handles: wallet email + public wallet address (to operate the wallet), processed by atomicpay.cloud only to provide the service. No location, browsing history, or page content.

**Screenshots** (1280×800 PNG, 3–5): capture these on `atomicpay.cloud`/a testnet dapp:
1. Toolbar popup — Swap tab (the quick-swap console).
2. A dapp's wallet chooser showing **Atomic Pay** listed (EIP-6963).
3. The Face ID / Touch ID confirm sheet during a signature.
4. The Requests/approval view mid-sign.
5. (optional) "Continue with email — no seed phrase" onboarding.

**Small promo tile:** 440×280 PNG using the Atomic mark on the brand purple (#6d5cf5).

---

## Microsoft Edge Add-ons

Same `.zip`, same name/summary/description/screenshots. Edge fields:
- **Category:** Productivity
- Note: Atomic Pay also installs from the Chrome Web Store in Edge, but a native Edge listing improves discovery.
- Reuse the Chrome permission justifications verbatim.

---

## Safari (App Store)

Safari ships the same MV3 core wrapped as a macOS/iOS app:
```
xcrun safari-web-extension-converter /Users/philiphall/atomic-payments/extension
```
Open the generated Xcode project → set bundle id `cloud.atomicpay.extension` → sign with
your Apple Developer team → archive → submit via App Store Connect.

**App Store Connect metadata:**
- **App name:** Atomic Pay
- **Subtitle** (≤30): `Swap crypto · email wallet`
- **Promotional text** (≤170): `Use Atomic Pay as your wallet on any site and swap any coin to any coin — secured by Face ID, no seed phrase, non-custodial.`
- **Keywords** (≤100): `crypto,wallet,swap,defi,ethereum,bitcoin,usdc,web3,non-custodial,passkey,cross-chain,base`
- **Description:** reuse the Chrome description.
- **Category:** Finance (secondary: Utilities)
- **Privacy (nutrition labels):** Data Not Collected for tracking. "Financial Info" (wallet address) and "Contact Info" (email) used only for App Functionality, not linked to identity for tracking, not sold.
- **Support URL:** https://atomicpay.cloud  ·  **Privacy Policy URL:** https://atomicpay.cloud/privacy

⚠️ **Apple crypto review:** wallet/crypto apps get extra scrutiny — Apple may ask for company/entity details and confirmation that the app is non-custodial and does not facilitate ICOs/mining. Answer plainly: non-custodial wallet + swap interface; keys never leave the device; Atomic takes no custody. Budget for a review round or two.

---

## Pre-submission checklist
- [ ] Confirm the pinned extension ID matches production (`chrome-extension://dkdfkdgccgoodochmglkkhfpckfckhhm`) and that `ATOMIC_EXTENSION_ORIGINS` on the server includes it (already set).
- [ ] Capture the 3–5 screenshots + promo tile.
- [ ] Bump `version` in manifest.json for each resubmission.
- [ ] Register/confirm developer accounts: Chrome Web Store ($5 one-time), Edge (free), Apple Developer ($99/yr).
```

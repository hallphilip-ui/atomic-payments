# Atomic Pay — Browser Extension (MV3)

Hybrid extension: a **quick-swap popup** + an **injected EIP-6963 wallet** so Atomic
works as a wallet on any dapp. Non-custodial — no seed phrase; signing uses the same
email/Face ID passkey wallet as the web app.

## Architecture

```
 dapp page ──window.postMessage──► content.js ──chrome.runtime──► background.js (service worker)
   ▲   │ (MAIN world: inpage.js,                (isolated world)         │
   │   │  EIP-6963 provider)                                             ├─ READ  → POST atomicpay.cloud/v1/rpc/:chainId
   └───┘                                                                 └─ SIGN  → popup.html ──iframe──► atomicpay.cloud/wallet-bridge
                                                                                     (approval UI)          (passkey / Face ID, correct rpId)
```

- **`src/inpage.js`** — the EIP-1193 provider injected into every page; announces
  itself via **EIP-6963** (`rdns: cloud.atomicpay`) so dapps list "Atomic Pay"
  alongside MetaMask. Holds no keys.
- **`src/content.js`** — injects the provider and relays messages page ↔ background.
- **`src/background.js`** — routes **reads** to the existing RPC proxy (real, works
  today) and **signs** to the popup for approval.
- **`popup.html` / `src/popup.js`** — quick-swap iframe + the approval queue.

### Why the signer is an atomicpay.cloud iframe (key design decision)
WebAuthn passkeys are bound to a domain (`rpId`). The wallet's passkeys are
registered to `atomicpay.cloud`, so a popup at `chrome-extension://…` **cannot** use
them. The extension therefore escorts every signature to an **`atomicpay.cloud`
iframe** — one wallet identity works across web + extension, and the extension never
touches key material.

## Status
- ✅ Loads in Chrome/Edge; EIP-6963 discovery; `window.ethereum` fallback.
- ✅ **Reads work** — `eth_call`, `eth_getBalance`, `eth_chainId`, etc. via
  `atomicpay.cloud/v1/rpc/:chainId` (chains: 1, 8453, 42161, 43114 + testnets).
- ✅ **Signing bridge built** — `/wallet-bridge` on the web app runs the passkey
  (Face ID) signature in the correct rpId and replies to the popup. Connect + sign +
  send route end-to-end once the extension origin is allowlisted (below).

## Configure signing (one-time)
The bridge is a signing oracle, so it obeys **only** origins you allowlist — it
fails closed (`frame-ancestors 'none'`) until then. To enable your extension:
1. Load unpacked (below) and copy your extension ID from `chrome://extensions`.
   (For a **stable** ID across machines/publish, add a `key` to `manifest.json`.)
2. On the server, set `ATOMIC_EXTENSION_ORIGINS` in `.env` (comma-separated), e.g.
   `ATOMIC_EXTENSION_ORIGINS=chrome-extension://<id>,safari-web-extension://<id>`
3. Redeploy. The bridge now frames + accepts messages from exactly those origins.

## Load it (Chrome / Edge)
1. `chrome://extensions` (or `edge://extensions`) → enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Pin it, open any dapp, choose **Atomic Pay** in the wallet picker.

## Safari
Same MV3 core, wrapped as a native app:
```
xcrun safari-web-extension-converter /Users/philiphall/atomic-payments/extension
```
Open the generated Xcode project, run, enable in Safari → Settings → Extensions.
Requires an Apple Developer account ($99/yr) for App Store distribution; expect
crypto-wallet review scrutiny.

## Security notes
- No key material in the extension; signatures happen in the atomicpay.cloud origin.
- `host_permissions` limited to `https://atomicpay.cloud/*`.
- Service worker is ephemeral (MV3) — session state in `chrome.storage.session`.
- Per-transaction Face ID confirm is enforced by the wallet (unchanged from web).

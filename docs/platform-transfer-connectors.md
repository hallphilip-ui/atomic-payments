# Platform Transfer Connector Plan

Atomic Payments can connect to broker and exchange APIs for deposits, withdrawals, account status, balances, and transfer monitoring. These connectors must not be used for order placement, exchange execution, derivatives trading, or routing customer trades.

## Product Scope

- Intended use: deposits and transfers only.
- Trading: disabled for every connector.
- Execution venue use: out of scope.
- Live mode: not connected until official API documentation, credentials, permissions, and compliance gates are verified.
- Required controls: scoped API keys, withdrawal allowlists, operator approvals, rate limits, audit logs, KYT/sanctions screening, and reconciliation.

## Launch Connector Candidates

| Platform | Region | Asset class | API surface | Allowed scope |
| --- | --- | --- | --- | --- |
| Coinbase Advanced | US / Global | Cryptocurrency | REST, WebSocket | Deposits, withdrawals, balances, account status |
| Binance | Global excluding restricted regions | Crypto and derivatives | REST, WebSocket | Funding transfers only |
| Kraken | Global | Cryptocurrency | REST, WebSocket | Deposits, withdrawals, balances, account status |
| OKX | Global | Crypto and derivatives | REST, WebSocket | Funding transfers only |
| Bybit | Global | Crypto derivatives | REST, WebSocket | Funding transfers only |
| Zerodha Kite | India | Indian equities and F&O | Kite Connect REST | Account/funds visibility only |
| Upstox | India | Indian equities and F&O | Upstox Developer API | Account/funds visibility only |
| Angel One | India | Indian equities and F&O | SmartAPI | Account/funds visibility only |
| Groww | India | Indian equities | Groww Developer API | Account/funds visibility only |
| Lemon Markets | Europe | European stocks and ETFs | API-first infrastructure | Cash/account transfer workflows only |
| Upvest | Europe | Investment infrastructure | API-first infrastructure | Custody/account transfer workflows only |
| Tiger Brokers | Singapore / Asia | Global equities and F&O | TigerOpen API | Account/funds visibility only |
| Futu / Moomoo | Asia / US | Global equities and options | Futu Open API | Account/funds visibility only |
| Bitfinex | Global | Cryptocurrency | REST, WebSocket | Deposits, withdrawals, balances, account status |
| Gemini | US / Global | Cryptocurrency | REST, WebSocket | Deposits, withdrawals, balances, account status |

## Adapter Boundary

Each connector should implement the same transfer-only contract:

- `getAccountStatus`
- `listBalances`
- `getDepositInstructions`
- `getDepositStatus`
- `requestWithdrawal`
- `getWithdrawalStatus`
- `listTransferEvents`

No connector should expose a generic `placeOrder`, `trade`, `swap`, `margin`, `derivatives`, or `marketOrder` method.

The current codebase includes a simulated transfer adapter factory for these connectors. It is intentionally limited to account status, balances, deposit instructions, deposit status, withdrawal requests, withdrawal status, and transfer events. `npm run test:platform-connectors` fails if a connector or adapter drifts into trading/order scope.

The simulated adapter is exposed through operator-protected settlement routes:

- `GET /v1/settlement/platform-connectors/:connectorId/account`
- `GET /v1/settlement/platform-connectors/:connectorId/balances`
- `GET /v1/settlement/platform-connectors/:connectorId/deposit-instructions`
- `GET /v1/settlement/platform-connectors/:connectorId/deposits/:transferId`
- `POST /v1/settlement/platform-connectors/:connectorId/withdrawals`
- `GET /v1/settlement/platform-connectors/:connectorId/withdrawals/:transferId`
- `GET /v1/settlement/platform-connectors/:connectorId/events`

## Before Live Connection

1. Verify official API docs and regional availability.
2. Confirm that API credentials can be scoped to transfer-only or read/funding permissions.
3. Confirm withdrawal allowlists and dual-control approvals.
4. Add sensitive-field filtering for logs and evidence exports.
5. Add compliance screening before outgoing transfers.
6. Add reconciliation between platform events and Atomic treasury ledger entries.
7. Add sandbox/paper tests before any production funds are touched.

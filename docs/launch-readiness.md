# Launch Readiness

Current software build completion: `94%`

The launch-readiness contract is exposed at:

```bash
curl http://127.0.0.1:3005/v1/project/launch-readiness
```

When `ATOMIC_OPERATOR_API_KEY` is configured, include `x-atomic-operator-key`.

## Remaining Blockers

- Hosted Postgres migration and hosted smoke proof.
- Live Rango/THORChain provider certification.
- Live wallet broadcast proof for EVM and Solana transactions.
- Production KYT/sanctions vendor bridge.
- Immutable evidence archive writes.
- Live reconciliation ingestion from provider/platform transfer events.
- Production observability URLs for log shipping, dashboards, alerts, and incident runbooks.

## Requires External Proof

- Hosted database and deployment target.
- Provider credentials and live/sandbox payloads.
- EVM and Solana RPC credentials plus live transaction receipts.
- Compliance vendor credentials and case references.
- Evidence archive destination.
- Live transfer provider events.
- Production log drain, dashboard, alert policy, and incident runbook URLs.

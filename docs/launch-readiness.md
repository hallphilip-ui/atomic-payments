# Launch Readiness

Current software build completion: `92%`

The launch-readiness contract is exposed at:

```bash
curl http://127.0.0.1:3005/v1/project/launch-readiness
```

When `ATOMIC_OPERATOR_API_KEY` is configured, include `x-atomic-operator-key`.

## Remaining Blockers

- Hosted Postgres migration and hosted smoke proof.
- Live Rango/THORChain provider certification.
- Production wallet broadcast for EVM and Solana transactions.
- Production KYT/sanctions vendor bridge.
- Immutable evidence archive writes.
- Live reconciliation ingestion from provider/platform transfer events.
- Production observability with log shipping, dashboards, alerts, and incident runbooks.

## Can Finish Locally

- Production wallet broadcast adapters can be implemented against guarded provider interfaces, then switched on with live credentials.
- Production observability contracts and runbook links can be added before hosted platform wiring.

## Requires External Proof

- Hosted database and deployment target.
- Provider credentials and live/sandbox payloads.
- Compliance vendor credentials and case references.
- Evidence archive destination.
- Live transfer provider events.

# Atomic Payments Test Accounts

These accounts are deterministic local/demo records. They are not production credentials.

## Create Or Refresh

```bash
npm run seed:test-accounts
npm run test:test-accounts
```

The seed is idempotent: it upserts the known demo records and does not wipe the database.

## Merchant API Keys

- Atomic Demo Coffee: `at_test_demo_coffee_0000000000000001`
- Atomic Demo Market: `at_test_demo_market_0000000000000002`
- Atomic Treasury Sandbox: `at_test_treasury_sandbox_0000000003`

Use one of these values as the `x-atomic-key` header when creating local payment intents.

## Demo Users

- `demo_alice` / `demo.alice@atomicpay.test`
- `demo_bob` / `demo.bob@atomicpay.test`
- `demo_ops` / `demo.ops@atomicpay.test`

`demo_alice` and `demo_bob` include EVM and Solana wallet records and are linked to each other for peer-directory testing.

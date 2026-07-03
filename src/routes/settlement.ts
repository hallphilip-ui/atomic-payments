import { Router } from 'express';
import { assessTransferCompliance } from '../compliance/complianceEngine';
import { recordOperatorAudit } from '../security/operatorAudit';
import { findSettlementRoutes, listEnabledCurrencies, launchSettlementRoutes } from '../settlement/currencyBasket';
import { createSimulatedTransferAdapter } from '../settlement/platformTransferAdapters';
import { listPlatformTransferConnectors } from '../settlement/platformTransferConnectors';
import {
  acceptStoredQuote,
  createStoredQuote,
  getTreasuryLedger,
  getTreasuryPositions,
  listSettlementInstructions,
  listStoredQuotes
} from '../settlement/settlementStore';

const router = Router();

async function withTransferAdapter(req: any, res: any, handler: (adapter: ReturnType<typeof createSimulatedTransferAdapter>) => Promise<any>) {
  try {
    const adapter = createSimulatedTransferAdapter(String(req.params.connectorId));
    return res.json(await handler(adapter));
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
}

router.get('/v1/settlement/currencies', (_req, res) => {
  return res.json({
    policy: {
      model: 'dynamic_top_20_launch_basket',
      purpose: 'Off-exchange settlement and market-making eligibility',
      refreshCadence: 'daily_reference_rates_weekly_basket_review',
      note: 'This launch basket is a controlled operating list, not a permanent ranking.'
    },
    currencies: listEnabledCurrencies()
  });
});

router.get('/v1/settlement/routes', (req, res) => {
  const sourceCurrency = String(req.query.sourceCurrency ?? '').toUpperCase();
  const targetCurrency = String(req.query.targetCurrency ?? '').toUpperCase();

  if (sourceCurrency && targetCurrency) {
    return res.json({ routes: findSettlementRoutes(sourceCurrency, targetCurrency) });
  }

  return res.json({ routes: launchSettlementRoutes.filter((route) => route.enabled) });
});

router.get('/v1/settlement/platform-connectors', (_req, res) => {
  const connectors = listPlatformTransferConnectors();
  return res.json({
    policy: {
      intendedUse: 'deposits_and_transfers_only',
      exchangeTrading: 'disabled',
      liveMode: 'not_connected',
      note: 'These platform connectors are onboarding candidates for deposits, withdrawals, transfers, balances, and account status only.'
    },
    connectors,
    connectorCount: connectors.length,
    tradingEnabledCount: connectors.filter((connector) => connector.tradingEnabled).length
  });
});

router.get('/v1/settlement/platform-connectors/:connectorId/account', (req, res) => {
  return withTransferAdapter(req, res, async (adapter) => ({
    account: await adapter.getAccountStatus()
  }));
});

router.get('/v1/settlement/platform-connectors/:connectorId/balances', (req, res) => {
  return withTransferAdapter(req, res, async (adapter) => ({
    balances: await adapter.listBalances()
  }));
});

router.get('/v1/settlement/platform-connectors/:connectorId/deposit-instructions', (req, res) => {
  const asset = String(req.query.asset ?? 'USDC');
  const network = req.query.network ? String(req.query.network) : undefined;

  return withTransferAdapter(req, res, async (adapter) => ({
    instructions: await adapter.getDepositInstructions(asset, network)
  }));
});

router.get('/v1/settlement/platform-connectors/:connectorId/deposits/:transferId', (req, res) => {
  return withTransferAdapter(req, res, async (adapter) => ({
    transfer: await adapter.getDepositStatus(String(req.params.transferId))
  }));
});

function buildWithdrawalRequest(req: any) {
  return {
    asset: String(req.body.asset ?? 'USDC'),
    amount: String(req.body.amount ?? '0.00'),
    destinationAddress: String(req.body.destinationAddress ?? ''),
    network: req.body.network ? String(req.body.network) : undefined,
    memo: req.body.memo ? String(req.body.memo) : undefined
  };
}

function assessWithdrawalRequest(req: any) {
  const withdrawalRequest = buildWithdrawalRequest(req);
  const compliance = assessTransferCompliance({
    connectorId: String(req.params.connectorId),
    asset: withdrawalRequest.asset,
    amount: withdrawalRequest.amount,
    destinationAddress: withdrawalRequest.destinationAddress,
    network: withdrawalRequest.network
  });

  return { withdrawalRequest, compliance };
}

router.post('/v1/settlement/platform-connectors/:connectorId/withdrawals/preview', (req, res) => {
  const { withdrawalRequest, compliance } = assessWithdrawalRequest(req);
  return res.json({
    preview: {
      connectorId: String(req.params.connectorId),
      request: withdrawalRequest,
      releaseDecision: compliance.status === 'AUTO_CLEARED' ? 'ready' : 'hold'
    },
    compliance
  });
});

router.post('/v1/settlement/platform-connectors/:connectorId/withdrawals', async (req, res) => {
  const { withdrawalRequest, compliance } = assessWithdrawalRequest(req);

  if (compliance.status !== 'AUTO_CLEARED') {
    await recordOperatorAudit({
      action: 'platform_withdrawal_request',
      subjectType: 'platform_connector',
      subjectId: String(req.params.connectorId),
      operatorRole: res.locals.operatorRole,
      requestId: res.locals.requestId,
      method: req.method || 'POST',
      path: req.originalUrl || `/v1/settlement/platform-connectors/${req.params.connectorId}/withdrawals`,
      outcome: compliance.status,
      metadata: {
        asset: withdrawalRequest.asset,
        amount: withdrawalRequest.amount,
        network: withdrawalRequest.network || '',
        releaseDecision: 'hold'
      }
    });
    return res.status(compliance.status === 'BLOCKED' ? 403 : 409).json({
      error: 'Withdrawal release blocked by compliance gate.',
      compliance
    });
  }

  return withTransferAdapter(req, res, async (adapter) => {
    const transfer = await adapter.requestWithdrawal(withdrawalRequest);
    await recordOperatorAudit({
      action: 'platform_withdrawal_request',
      subjectType: 'platform_connector',
      subjectId: String(req.params.connectorId),
      operatorRole: res.locals.operatorRole,
      requestId: res.locals.requestId,
      method: req.method || 'POST',
      path: req.originalUrl || `/v1/settlement/platform-connectors/${req.params.connectorId}/withdrawals`,
      outcome: compliance.status,
      metadata: {
        asset: withdrawalRequest.asset,
        amount: withdrawalRequest.amount,
        network: withdrawalRequest.network || '',
        transferId: transfer.transferId,
        releaseDecision: 'ready'
      }
    });

    return { transfer, compliance };
  });
});

router.get('/v1/settlement/platform-connectors/:connectorId/withdrawals/:transferId', (req, res) => {
  return withTransferAdapter(req, res, async (adapter) => ({
    transfer: await adapter.getWithdrawalStatus(String(req.params.transferId))
  }));
});

router.get('/v1/settlement/platform-connectors/:connectorId/events', (req, res) => {
  return withTransferAdapter(req, res, async (adapter) => ({
    events: await adapter.listTransferEvents()
  }));
});

router.post('/v1/settlement/quotes', async (req, res) => {
  try {
    const quote = await createStoredQuote(req.body);
    return res.status(201).json({
      quote,
      nextStep: 'Client may accept before expiresAt; treasury reserves inventory after acceptance.'
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/v1/settlement/quotes/:id/accept', async (req, res) => {
  try {
    return res.json(await acceptStoredQuote(req.params.id));
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/v1/settlement/quotes', async (_req, res) => {
  return res.json({ quotes: await listStoredQuotes() });
});

router.get('/v1/settlement/instructions', async (_req, res) => {
  return res.json({ instructions: await listSettlementInstructions() });
});

router.get('/v1/settlement/treasury', async (_req, res) => {
  return res.json({
    mode: 'simulation',
    controls: {
      inventoryBands: 'per_currency_min_mid_max_required_before_live',
      rebalanceTriggers: ['inventory_band_breach', 'route_fee_spike', 'quote_rejection_rate_spike'],
      releaseGates: ['sanctions_screen', 'client_limit_check', 'route_health_check', 'settlement_instruction_match']
    },
    positions: await getTreasuryPositions()
  });
});

router.get('/v1/settlement/treasury/ledger', async (_req, res) => {
  return res.json({ entries: await getTreasuryLedger() });
});

export default router;

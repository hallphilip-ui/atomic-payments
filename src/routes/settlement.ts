import { Router } from 'express';
import { findSettlementRoutes, listEnabledCurrencies, launchSettlementRoutes } from '../settlement/currencyBasket';
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

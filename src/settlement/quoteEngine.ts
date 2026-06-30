import {
  BasketCurrency,
  SettlementRoute,
  findSettlementRoutes,
  getEnabledCurrency
} from './currencyBasket';

export type QuoteSide = 'buy' | 'sell';
export type QuoteStatus = 'QUOTED' | 'ACCEPTED' | 'EXPIRED' | 'REJECTED';

export type FxQuote = {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  notional: number;
  side: QuoteSide;
  referenceRate: number;
  allInRate: number;
  spreadBps: number;
  feeBps: number;
  quoteTtlSeconds: number;
  expiresAt: string;
  estimatedSettlementMinutes: number;
  route: SettlementRoute;
  sourceAmount: number;
  targetAmount: number;
  status: QuoteStatus;
  riskChecks: string[];
  createdAt: string;
};

type QuoteRequest = {
  sourceCurrency: string;
  targetCurrency: string;
  notional: number;
  side?: QuoteSide;
};

const referenceRatesToUsd: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  JPY: 0.0064,
  GBP: 1.27,
  CHF: 1.12,
  CAD: 0.73,
  AUD: 0.66,
  SGD: 0.74,
  HKD: 0.128,
  NZD: 0.60,
  SEK: 0.095,
  NOK: 0.094,
  DKK: 0.145,
  MXN: 0.055,
  PLN: 0.25,
  CNH: 0.138,
  USDC: 1,
  USDT: 1,
  PYUSD: 1,
  EURC: 1.08
};

function requireCurrency(code: string): BasketCurrency {
  const currency = getEnabledCurrency(code);
  if (!currency) {
    throw new Error(`Currency ${code.toUpperCase()} is not enabled for Atomic settlement.`);
  }

  return currency;
}

function getReferenceRate(sourceCurrency: string, targetCurrency: string): number {
  const sourceUsd = referenceRatesToUsd[sourceCurrency];
  const targetUsd = referenceRatesToUsd[targetCurrency];

  if (!sourceUsd || !targetUsd) {
    throw new Error(`Missing reference rate for ${sourceCurrency}/${targetCurrency}.`);
  }

  return sourceUsd / targetUsd;
}

function calculateSpreadBps(source: BasketCurrency, target: BasketCurrency, route: SettlementRoute): number {
  const liquidityPenalty = Math.max(0, 100 - Math.min(source.liquidityScore, target.liquidityScore)) * 0.35;
  const stabilityPenalty = Math.max(0, 100 - Math.min(source.stabilityScore, target.stabilityScore)) * 0.2;
  const routePenalty = route.settlementWindowMinutes > 180 ? 8 : 3;
  const stablecoinCompression = source.kind === 'stablecoin' && target.kind === 'stablecoin' ? -6 : 0;

  return Math.max(10, Math.round(14 + liquidityPenalty + stabilityPenalty + routePenalty + stablecoinCompression));
}

function buildRiskChecks(source: BasketCurrency, target: BasketCurrency, notionalUsd: number, route: SettlementRoute): string[] {
  const checks = [
    'currency_enabled',
    'route_enabled',
    'quote_ttl_required',
    'manual_sanctions_screen_required_before_release'
  ];

  if (notionalUsd <= Math.min(source.maxQuoteUsd, target.maxQuoteUsd)) {
    checks.push('within_currency_notional_limit');
  } else {
    checks.push('above_currency_notional_limit_requires_treasury_approval');
  }

  if (route.rail === 'stablecoin') {
    checks.push('stablecoin_wallet_attestation_required');
  }

  return checks;
}

export function buildQuote(request: QuoteRequest): FxQuote {
  const sourceCurrency = request.sourceCurrency.toUpperCase();
  const targetCurrency = request.targetCurrency.toUpperCase();
  const side = request.side ?? 'sell';
  const notional = Number(request.notional);

  if (!Number.isFinite(notional) || notional <= 0) {
    throw new Error('Notional must be a positive number.');
  }

  if (sourceCurrency === targetCurrency) {
    throw new Error('Source and target currency must be different.');
  }

  const source = requireCurrency(sourceCurrency);
  const target = requireCurrency(targetCurrency);
  const routes = findSettlementRoutes(sourceCurrency, targetCurrency);

  if (routes.length === 0) {
    throw new Error(`No off-exchange settlement route is enabled for ${sourceCurrency}/${targetCurrency}.`);
  }

  const route = routes[0];
  const referenceRate = getReferenceRate(sourceCurrency, targetCurrency);
  const notionalUsd = notional * referenceRatesToUsd[sourceCurrency];
  const spreadBps = calculateSpreadBps(source, target, route);
  const feeBps = route.feeBps;
  const allInRate = referenceRate * (1 - (spreadBps + feeBps) / 10000);
  const targetAmount = Number((notional * allInRate).toFixed(6));
  const quoteTtlSeconds = Math.max(30, Math.min(180, 90 - Math.floor((spreadBps + feeBps) / 4)));
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + quoteTtlSeconds * 1000);

  const quote: FxQuote = {
    id: '',
    sourceCurrency,
    targetCurrency,
    notional,
    side,
    referenceRate: Number(referenceRate.toFixed(8)),
    allInRate: Number(allInRate.toFixed(8)),
    spreadBps,
    feeBps,
    quoteTtlSeconds,
    expiresAt: expiresAt.toISOString(),
    estimatedSettlementMinutes: route.settlementWindowMinutes,
    route,
    sourceAmount: notional,
    targetAmount,
    status: 'QUOTED',
    riskChecks: buildRiskChecks(source, target, notionalUsd, route),
    createdAt: createdAt.toISOString()
  };

  return quote;
}

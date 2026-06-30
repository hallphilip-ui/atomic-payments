export type CurrencyRail = 'bank' | 'stablecoin' | 'custodian' | 'otc';

export type BasketCurrency = {
  code: string;
  name: string;
  kind: 'fiat' | 'stablecoin';
  settlementRails: CurrencyRail[];
  liquidityScore: number;
  stabilityScore: number;
  settlementPriority: number;
  maxQuoteUsd: number;
  enabled: boolean;
};

export type SettlementRoute = {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  rail: CurrencyRail;
  provider: string;
  settlementWindowMinutes: number;
  feeBps: number;
  enabled: boolean;
};

export const launchCurrencyBasket: BasketCurrency[] = [
  { code: 'USD', name: 'US Dollar', kind: 'fiat', settlementRails: ['bank', 'stablecoin', 'custodian', 'otc'], liquidityScore: 100, stabilityScore: 100, settlementPriority: 1, maxQuoteUsd: 2500000, enabled: true },
  { code: 'EUR', name: 'Euro', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 98, stabilityScore: 98, settlementPriority: 2, maxQuoteUsd: 2000000, enabled: true },
  { code: 'JPY', name: 'Japanese Yen', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 96, stabilityScore: 97, settlementPriority: 3, maxQuoteUsd: 1500000, enabled: true },
  { code: 'GBP', name: 'British Pound', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 95, stabilityScore: 96, settlementPriority: 4, maxQuoteUsd: 1500000, enabled: true },
  { code: 'CHF', name: 'Swiss Franc', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 92, stabilityScore: 99, settlementPriority: 5, maxQuoteUsd: 1000000, enabled: true },
  { code: 'CAD', name: 'Canadian Dollar', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 91, stabilityScore: 97, settlementPriority: 6, maxQuoteUsd: 1000000, enabled: true },
  { code: 'AUD', name: 'Australian Dollar', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 90, stabilityScore: 96, settlementPriority: 7, maxQuoteUsd: 900000, enabled: true },
  { code: 'SGD', name: 'Singapore Dollar', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 87, stabilityScore: 98, settlementPriority: 8, maxQuoteUsd: 750000, enabled: true },
  { code: 'HKD', name: 'Hong Kong Dollar', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 86, stabilityScore: 97, settlementPriority: 9, maxQuoteUsd: 650000, enabled: true },
  { code: 'NZD', name: 'New Zealand Dollar', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 82, stabilityScore: 95, settlementPriority: 10, maxQuoteUsd: 500000, enabled: true },
  { code: 'SEK', name: 'Swedish Krona', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 81, stabilityScore: 96, settlementPriority: 11, maxQuoteUsd: 450000, enabled: true },
  { code: 'NOK', name: 'Norwegian Krone', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 79, stabilityScore: 96, settlementPriority: 12, maxQuoteUsd: 400000, enabled: true },
  { code: 'DKK', name: 'Danish Krone', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 78, stabilityScore: 97, settlementPriority: 13, maxQuoteUsd: 400000, enabled: true },
  { code: 'MXN', name: 'Mexican Peso', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 77, stabilityScore: 87, settlementPriority: 14, maxQuoteUsd: 350000, enabled: true },
  { code: 'PLN', name: 'Polish Zloty', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 74, stabilityScore: 89, settlementPriority: 15, maxQuoteUsd: 275000, enabled: true },
  { code: 'CNH', name: 'Offshore Chinese Yuan', kind: 'fiat', settlementRails: ['bank', 'custodian', 'otc'], liquidityScore: 72, stabilityScore: 86, settlementPriority: 16, maxQuoteUsd: 250000, enabled: true },
  { code: 'USDC', name: 'USD Coin', kind: 'stablecoin', settlementRails: ['stablecoin', 'custodian', 'otc'], liquidityScore: 88, stabilityScore: 93, settlementPriority: 17, maxQuoteUsd: 1000000, enabled: true },
  { code: 'USDT', name: 'Tether USD', kind: 'stablecoin', settlementRails: ['stablecoin', 'custodian', 'otc'], liquidityScore: 89, stabilityScore: 89, settlementPriority: 18, maxQuoteUsd: 750000, enabled: true },
  { code: 'PYUSD', name: 'PayPal USD', kind: 'stablecoin', settlementRails: ['stablecoin', 'custodian'], liquidityScore: 62, stabilityScore: 91, settlementPriority: 19, maxQuoteUsd: 150000, enabled: true },
  { code: 'EURC', name: 'Euro Coin', kind: 'stablecoin', settlementRails: ['stablecoin', 'custodian'], liquidityScore: 58, stabilityScore: 90, settlementPriority: 20, maxQuoteUsd: 125000, enabled: true }
];

export const launchSettlementRoutes: SettlementRoute[] = [
  { id: 'usd-usdc-stablecoin', sourceCurrency: 'USD', targetCurrency: 'USDC', rail: 'stablecoin', provider: 'atomic-internal-usdc', settlementWindowMinutes: 5, feeBps: 8, enabled: true },
  { id: 'usdc-usd-custodian', sourceCurrency: 'USDC', targetCurrency: 'USD', rail: 'custodian', provider: 'atomic-custody-sim', settlementWindowMinutes: 30, feeBps: 12, enabled: true },
  { id: 'usd-eur-bank', sourceCurrency: 'USD', targetCurrency: 'EUR', rail: 'bank', provider: 'atomic-bank-sim', settlementWindowMinutes: 240, feeBps: 18, enabled: true },
  { id: 'eur-usd-bank', sourceCurrency: 'EUR', targetCurrency: 'USD', rail: 'bank', provider: 'atomic-bank-sim', settlementWindowMinutes: 240, feeBps: 18, enabled: true },
  { id: 'usd-gbp-bank', sourceCurrency: 'USD', targetCurrency: 'GBP', rail: 'bank', provider: 'atomic-bank-sim', settlementWindowMinutes: 240, feeBps: 20, enabled: true },
  { id: 'gbp-usd-bank', sourceCurrency: 'GBP', targetCurrency: 'USD', rail: 'bank', provider: 'atomic-bank-sim', settlementWindowMinutes: 240, feeBps: 20, enabled: true },
  { id: 'usd-jpy-otc', sourceCurrency: 'USD', targetCurrency: 'JPY', rail: 'otc', provider: 'atomic-otc-sim', settlementWindowMinutes: 180, feeBps: 16, enabled: true },
  { id: 'jpy-usd-otc', sourceCurrency: 'JPY', targetCurrency: 'USD', rail: 'otc', provider: 'atomic-otc-sim', settlementWindowMinutes: 180, feeBps: 16, enabled: true }
];

export function getEnabledCurrency(code: string): BasketCurrency | undefined {
  return launchCurrencyBasket.find((currency) => currency.enabled && currency.code === code.toUpperCase());
}

export function listEnabledCurrencies(): BasketCurrency[] {
  return [...launchCurrencyBasket]
    .filter((currency) => currency.enabled)
    .sort((a, b) => a.settlementPriority - b.settlementPriority);
}

export function findSettlementRoutes(sourceCurrency: string, targetCurrency: string): SettlementRoute[] {
  const source = sourceCurrency.toUpperCase();
  const target = targetCurrency.toUpperCase();

  return launchSettlementRoutes
    .filter((route) => route.enabled && route.sourceCurrency === source && route.targetCurrency === target)
    .sort((a, b) => a.feeBps - b.feeBps || a.settlementWindowMinutes - b.settlementWindowMinutes);
}

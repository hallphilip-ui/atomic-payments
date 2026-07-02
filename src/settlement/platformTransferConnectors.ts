export type PlatformRegion = 'US' | 'Global' | 'Europe' | 'India' | 'Asia' | 'Singapore' | 'US_Global';

export type PlatformAssetClass =
  | 'cryptocurrency'
  | 'crypto_derivatives'
  | 'indian_equities_fno'
  | 'indian_equities'
  | 'european_stocks_etfs'
  | 'investment_infrastructure'
  | 'global_equities_fno'
  | 'global_equities_options';

export type TransferCapability =
  | 'deposit_address'
  | 'deposit_status'
  | 'withdrawal_request'
  | 'withdrawal_status'
  | 'internal_transfer'
  | 'balance_read'
  | 'account_status'
  | 'webhook_or_stream';

export type PlatformTransferConnector = {
  id: string;
  name: string;
  category: 'crypto_exchange' | 'broker' | 'investment_infrastructure';
  region: PlatformRegion[];
  assetClass: PlatformAssetClass;
  apiSurface: string[];
  intendedUse: 'deposits_and_transfers_only';
  tradingEnabled: false;
  transferCapabilities: TransferCapability[];
  liveMode: 'not_connected';
  onboardingStatus: 'candidate';
  verificationRequired: string[];
  notes: string;
};

const cryptoTransferCapabilities: TransferCapability[] = [
  'deposit_address',
  'deposit_status',
  'withdrawal_request',
  'withdrawal_status',
  'balance_read',
  'account_status',
  'webhook_or_stream'
];

const brokerTransferCapabilities: TransferCapability[] = [
  'deposit_status',
  'withdrawal_status',
  'balance_read',
  'account_status'
];

export const platformTransferConnectors: PlatformTransferConnector[] = [
  {
    id: 'coinbase-advanced',
    name: 'Coinbase Advanced',
    category: 'crypto_exchange',
    region: ['US_Global'],
    assetClass: 'cryptocurrency',
    apiSurface: ['REST', 'WebSocket'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: cryptoTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['official_transfer_endpoint_review', 'oauth_or_api_key_scope_review', 'withdrawal_allowlist_controls'],
    notes: 'Use for wallet funding, withdrawal, balance, and deposit monitoring only; no exchange order routing.'
  },
  {
    id: 'binance-global',
    name: 'Binance',
    category: 'crypto_exchange',
    region: ['Global'],
    assetClass: 'crypto_derivatives',
    apiSurface: ['REST', 'WebSocket'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: cryptoTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['jurisdiction_exclusion_review', 'sub_account_transfer_scope_review', 'withdrawal_allowlist_controls'],
    notes: 'Global connector candidate excluding restricted jurisdictions; trading and derivatives execution stay disabled.'
  },
  {
    id: 'kraken',
    name: 'Kraken',
    category: 'crypto_exchange',
    region: ['Global'],
    assetClass: 'cryptocurrency',
    apiSurface: ['REST', 'WebSocket'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: cryptoTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['funding_endpoint_review', 'api_key_scope_review', 'travel_rule_flow_review'],
    notes: 'Candidate for crypto deposit/withdrawal status and balances only.'
  },
  {
    id: 'okx',
    name: 'OKX',
    category: 'crypto_exchange',
    region: ['Global'],
    assetClass: 'crypto_derivatives',
    apiSurface: ['REST', 'WebSocket'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: cryptoTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['funding_account_transfer_scope_review', 'jurisdiction_review', 'withdrawal_allowlist_controls'],
    notes: 'Use funding account transfer and withdrawal monitoring surfaces only; no derivatives execution.'
  },
  {
    id: 'bybit',
    name: 'Bybit',
    category: 'crypto_exchange',
    region: ['Global'],
    assetClass: 'crypto_derivatives',
    apiSurface: ['REST', 'WebSocket'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: cryptoTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['funding_transfer_endpoint_review', 'jurisdiction_review', 'withdrawal_allowlist_controls'],
    notes: 'Funding connector candidate only; derivatives trading is explicitly out of scope.'
  },
  {
    id: 'zerodha-kite',
    name: 'Zerodha Kite',
    category: 'broker',
    region: ['India'],
    assetClass: 'indian_equities_fno',
    apiSurface: ['Kite Connect REST'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: brokerTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['broker_funds_api_review', 'india_regulatory_scope_review', 'no_order_scope_enforcement'],
    notes: 'Use only if account, balance, and funds movement surfaces are available for permitted business workflows.'
  },
  {
    id: 'upstox',
    name: 'Upstox',
    category: 'broker',
    region: ['India'],
    assetClass: 'indian_equities_fno',
    apiSurface: ['Upstox Developer API'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: brokerTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['funds_api_review', 'india_regulatory_scope_review', 'no_order_scope_enforcement'],
    notes: 'Candidate for account and balance visibility; trade APIs remain disabled.'
  },
  {
    id: 'angel-one-smartapi',
    name: 'Angel One',
    category: 'broker',
    region: ['India'],
    assetClass: 'indian_equities_fno',
    apiSurface: ['SmartAPI'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: brokerTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['funds_api_review', 'india_regulatory_scope_review', 'no_order_scope_enforcement'],
    notes: 'Candidate only for funds/balance visibility if supported by permitted scopes.'
  },
  {
    id: 'groww',
    name: 'Groww',
    category: 'broker',
    region: ['India'],
    assetClass: 'indian_equities',
    apiSurface: ['Groww Developer API'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: brokerTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['developer_api_availability_review', 'funds_scope_review', 'no_order_scope_enforcement'],
    notes: 'Candidate pending official API availability and funds-transfer scope confirmation.'
  },
  {
    id: 'lemon-markets',
    name: 'Lemon Markets',
    category: 'investment_infrastructure',
    region: ['Europe'],
    assetClass: 'european_stocks_etfs',
    apiSurface: ['API-first Infrastructure'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: brokerTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['custody_cash_movement_scope_review', 'europe_regulatory_scope_review', 'no_order_scope_enforcement'],
    notes: 'Infrastructure candidate for cash/account operations only.'
  },
  {
    id: 'upvest',
    name: 'Upvest',
    category: 'investment_infrastructure',
    region: ['Europe'],
    assetClass: 'investment_infrastructure',
    apiSurface: ['API-first Infrastructure'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: brokerTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['custody_cash_movement_scope_review', 'europe_regulatory_scope_review', 'no_order_scope_enforcement'],
    notes: 'Infrastructure candidate for account, custody, and transfer workflows only.'
  },
  {
    id: 'tiger-brokers',
    name: 'Tiger Brokers',
    category: 'broker',
    region: ['Singapore', 'Asia'],
    assetClass: 'global_equities_fno',
    apiSurface: ['TigerOpen API'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: brokerTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['funds_api_review', 'regional_regulatory_scope_review', 'no_order_scope_enforcement'],
    notes: 'Use only account/funds surfaces; equities and options orders remain disabled.'
  },
  {
    id: 'futu-moomoo',
    name: 'Futu / Moomoo',
    category: 'broker',
    region: ['Asia', 'US'],
    assetClass: 'global_equities_options',
    apiSurface: ['Futu Open API'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: brokerTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['funds_api_review', 'regional_regulatory_scope_review', 'no_order_scope_enforcement'],
    notes: 'Candidate for read-only account/funds workflows only; no order placement.'
  },
  {
    id: 'bitfinex',
    name: 'Bitfinex',
    category: 'crypto_exchange',
    region: ['Global'],
    assetClass: 'cryptocurrency',
    apiSurface: ['REST', 'WebSocket'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: cryptoTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['funding_endpoint_review', 'jurisdiction_review', 'withdrawal_allowlist_controls'],
    notes: 'Candidate for crypto funding and transfer monitoring only.'
  },
  {
    id: 'gemini',
    name: 'Gemini',
    category: 'crypto_exchange',
    region: ['US_Global'],
    assetClass: 'cryptocurrency',
    apiSurface: ['REST', 'WebSocket'],
    intendedUse: 'deposits_and_transfers_only',
    tradingEnabled: false,
    transferCapabilities: cryptoTransferCapabilities,
    liveMode: 'not_connected',
    onboardingStatus: 'candidate',
    verificationRequired: ['funding_endpoint_review', 'api_key_scope_review', 'withdrawal_allowlist_controls'],
    notes: 'Candidate for US/global crypto deposit and withdrawal workflows only.'
  }
];

export function listPlatformTransferConnectors(): PlatformTransferConnector[] {
  return platformTransferConnectors.map((connector) => ({
    ...connector,
    apiSurface: [...connector.apiSurface],
    region: [...connector.region],
    transferCapabilities: [...connector.transferCapabilities],
    verificationRequired: [...connector.verificationRequired]
  }));
}

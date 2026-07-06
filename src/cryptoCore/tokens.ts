export type ChainFamily = 'evm' | 'svm' | 'tron' | 'native_l1';

export type TokenRegistryEntry = {
  assetId: string;
  symbol: string;
  name: string;
  chain: string;
  chainFamily: ChainFamily;
  decimals: number;
  enabled: boolean;
  routingPreference: 'rango' | 'thorchain';
  priceImpactLimitPct: number;
  // Live-provider routing identifiers. Left undefined until certified against
  // each provider's official asset list (THORChain pools / Rango meta) — these
  // are financial routing IDs and must NOT be guessed. Until set, live mode
  // fails closed for the asset (see buildProviderPayload).
  thorAsset?: string;
  rangoAsset?: string;
};

export const targetAssetRegistry: TokenRegistryEntry[] = [
  { assetId: 'BITCOIN.BTC', symbol: 'BTC', name: 'Bitcoin', chain: 'BITCOIN', chainFamily: 'native_l1', decimals: 8, enabled: true, routingPreference: 'thorchain', priceImpactLimitPct: 1.5 },
  { assetId: 'ETH.ETH', symbol: 'ETH', name: 'Ethereum', chain: 'ETH', chainFamily: 'evm', decimals: 18, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'SOLANA.SOL', symbol: 'SOL', name: 'Solana', chain: 'SOLANA', chainFamily: 'svm', decimals: 9, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'TRON.TRX', symbol: 'TRX', name: 'TRON', chain: 'TRON', chainFamily: 'tron', decimals: 6, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'ETH.USDC', symbol: 'USDC', name: 'USD Coin', chain: 'ETH', chainFamily: 'evm', decimals: 6, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'ETH.USDT', symbol: 'USDT', name: 'Tether USD', chain: 'ETH', chainFamily: 'evm', decimals: 6, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'BNB.BNB', symbol: 'BNB', name: 'BNB', chain: 'BNB', chainFamily: 'evm', decimals: 18, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'XRP.XRP', symbol: 'XRP', name: 'XRP', chain: 'XRP', chainFamily: 'native_l1', decimals: 6, enabled: true, routingPreference: 'thorchain', priceImpactLimitPct: 1.5 },
  { assetId: 'DOGE.DOGE', symbol: 'DOGE', name: 'Dogecoin', chain: 'DOGE', chainFamily: 'native_l1', decimals: 8, enabled: true, routingPreference: 'thorchain', priceImpactLimitPct: 1.5 },
  { assetId: 'CARDANO.ADA', symbol: 'ADA', name: 'Cardano', chain: 'CARDANO', chainFamily: 'native_l1', decimals: 6, enabled: true, routingPreference: 'thorchain', priceImpactLimitPct: 1.5 },
  { assetId: 'AVAX.AVAX', symbol: 'AVAX', name: 'Avalanche', chain: 'AVAX', chainFamily: 'evm', decimals: 18, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'BASE.USDC', symbol: 'USDC', name: 'USD Coin on Base', chain: 'BASE', chainFamily: 'evm', decimals: 6, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'POLYGON.POL', symbol: 'POL', name: 'Polygon', chain: 'POLYGON', chainFamily: 'evm', decimals: 18, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'ARBITRUM.ARB', symbol: 'ARB', name: 'Arbitrum', chain: 'ARBITRUM', chainFamily: 'evm', decimals: 18, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'OPTIMISM.OP', symbol: 'OP', name: 'Optimism', chain: 'OPTIMISM', chainFamily: 'evm', decimals: 18, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'CHAINLINK.LINK', symbol: 'LINK', name: 'Chainlink', chain: 'ETH', chainFamily: 'evm', decimals: 18, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'LITECOIN.LTC', symbol: 'LTC', name: 'Litecoin', chain: 'LITECOIN', chainFamily: 'native_l1', decimals: 8, enabled: true, routingPreference: 'thorchain', priceImpactLimitPct: 1.5 },
  { assetId: 'POLKADOT.DOT', symbol: 'DOT', name: 'Polkadot', chain: 'POLKADOT', chainFamily: 'native_l1', decimals: 10, enabled: true, routingPreference: 'thorchain', priceImpactLimitPct: 1.5 },
  { assetId: 'ATOM.ATOM', symbol: 'ATOM', name: 'Cosmos Hub', chain: 'ATOM', chainFamily: 'native_l1', decimals: 6, enabled: true, routingPreference: 'thorchain', priceImpactLimitPct: 1.5 },
  { assetId: 'NEAR.NEAR', symbol: 'NEAR', name: 'NEAR Protocol', chain: 'NEAR', chainFamily: 'native_l1', decimals: 24, enabled: true, routingPreference: 'thorchain', priceImpactLimitPct: 1.5 },
  { assetId: 'SUI.SUI', symbol: 'SUI', name: 'Sui', chain: 'SUI', chainFamily: 'native_l1', decimals: 9, enabled: true, routingPreference: 'thorchain', priceImpactLimitPct: 1.5 },
  { assetId: 'APTOS.APT', symbol: 'APT', name: 'Aptos', chain: 'APTOS', chainFamily: 'native_l1', decimals: 8, enabled: true, routingPreference: 'thorchain', priceImpactLimitPct: 1.5 },
  { assetId: 'ETH.WBTC', symbol: 'WBTC', name: 'Wrapped Bitcoin', chain: 'ETH', chainFamily: 'evm', decimals: 8, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'ETH.DAI', symbol: 'DAI', name: 'Dai', chain: 'ETH', chainFamily: 'evm', decimals: 18, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 },
  { assetId: 'ETH.UNI', symbol: 'UNI', name: 'Uniswap', chain: 'ETH', chainFamily: 'evm', decimals: 18, enabled: true, routingPreference: 'rango', priceImpactLimitPct: 1.5 }
];

export function listSwapAssets(): TokenRegistryEntry[] {
  return [...targetAssetRegistry].filter((asset) => asset.enabled);
}

export function getSwapAsset(assetId: string): TokenRegistryEntry | undefined {
  const normalizedAssetId = assetId.toUpperCase();
  return targetAssetRegistry.find((asset) => asset.enabled && asset.assetId === normalizedAssetId);
}

export function isNativeL1Asset(assetId: string): boolean {
  const asset = getSwapAsset(assetId);
  return asset?.chainFamily === 'native_l1';
}

// Translate an internal asset ID (e.g. BITCOIN.BTC) into the live-provider
// routing identifier for the given provider, or undefined if the asset has not
// been certified for that provider yet. Callers must fail closed on undefined
// in live mode rather than sending the internal ID to a real provider.
export function getProviderAssetId(
  assetId: string,
  provider: 'THORCHAIN' | 'RANGO'
): string | undefined {
  const asset = getSwapAsset(assetId);
  if (!asset) return undefined;
  return provider === 'THORCHAIN' ? asset.thorAsset : asset.rangoAsset;
}

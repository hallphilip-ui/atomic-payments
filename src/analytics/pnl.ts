import { PrismaClient } from '@prisma/client';
import { getSwapAsset } from '../cryptoCore/tokens';

const prisma = new PrismaClient();

// Revenue is realized when a conversion COMPLETES; the platform fee is taken in
// the input (from) asset's units. Quotes that never complete earn nothing.
const REALIZED_STATUS = 'COMPLETE';

// USD-pegged assets we can value at parity with confidence.
const STABLE_USD: Record<string, number> = { USDC: 1, USDT: 1, PYUSD: 1, DAI: 1 };

// Indicative reference prices for volatile assets so the USD total is non-zero
// and directionally useful. THESE ARE NOT A LIVE FEED — wire the price oracle
// (ATOMIC_PNL_PRICE_SOURCE) before treating the USD total as accounting-grade.
// Overridable via ATOMIC_PNL_PRICE_OVERRIDES (JSON: {"BTC":68000,...}).
const REFERENCE_USD: Record<string, number> = {
  BTC: 68000, WBTC: 68000, ETH: 3500, SOL: 165, BNB: 600, XRP: 0.6, DOGE: 0.15,
  ADA: 0.45, AVAX: 35, POL: 0.55, ARB: 0.9, OP: 1.8, LINK: 16, LTC: 85, DOT: 6,
  ATOM: 8, NEAR: 5, SUI: 1.1, APT: 9, UNI: 9, TRX: 0.12
};

export type PnlPeriodAsset = {
  assetId: string;
  symbol: string;
  feeNative: string;
  feeUsd: number;
  priced: boolean;
  priceBasis: 'peg' | 'reference' | 'unpriced';
};

export type PnlPeriod = {
  label: string;
  since: string;
  conversions: number;
  realizedUsd: number;
  usdEstimated: boolean;
  byAsset: PnlPeriodAsset[];
};

function priceOverrides(): Record<string, number> {
  try {
    const raw = process.env.ATOMIC_PNL_PRICE_OVERRIDES;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function resolveUsdPrice(symbol: string): { price: number; basis: 'peg' | 'reference' | 'unpriced' } {
  const overrides = priceOverrides();
  if (symbol in overrides) return { price: overrides[symbol], basis: 'reference' };
  if (symbol in STABLE_USD) return { price: STABLE_USD[symbol], basis: 'peg' };
  if (symbol in REFERENCE_USD) return { price: REFERENCE_USD[symbol], basis: 'reference' };
  return { price: 0, basis: 'unpriced' };
}

// ---- Timezone-aware period boundaries (no external deps) ----

function tzOffsetMs(tz: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = Number(p.value);
    return acc;
  }, {} as Record<string, number>);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedLocalParts(tz: string, date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday
  };
}

// UTC instant corresponding to local midnight of the given Y/M/D in tz.
function zonedMidnight(tz: string, year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = tzOffsetMs(tz, new Date(guess));
  return new Date(guess - offset);
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function periodStarts(tz: string, now: Date) {
  const { year, month, day, weekday } = zonedLocalParts(tz, now);
  const startOfToday = zonedMidnight(tz, year, month, day);
  const daysSinceMonday = WEEKDAY_INDEX[weekday] ?? 0;
  const startOfWeek = new Date(startOfToday.getTime() - daysSinceMonday * 86_400_000);
  const startOfMonth = zonedMidnight(tz, year, month, 1);
  const startOfYear = zonedMidnight(tz, year, 1, 1); // Jan 1 → calendar YTD
  return { startOfToday, startOfWeek, startOfMonth, startOfYear };
}

function formatNative(atomic: bigint, decimals: number): string {
  const negative = atomic < 0n;
  const abs = negative ? -atomic : atomic;
  const s = abs.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals) || '0';
  const fraction = (decimals > 0 ? s.slice(s.length - decimals) : '').replace(/0+$/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative ? '-' : '') + (fraction ? `${grouped}.${fraction}` : grouped);
}

function summarize(label: string, since: Date, rows: Array<{ fromAsset: string; platformFeeAmount: string; createdAt: Date }>): PnlPeriod {
  const inWindow = rows.filter((r) => r.createdAt >= since);
  const byAssetMap = new Map<string, bigint>();
  for (const r of inWindow) {
    let fee: bigint;
    try { fee = BigInt(r.platformFeeAmount || '0'); } catch { fee = 0n; }
    byAssetMap.set(r.fromAsset, (byAssetMap.get(r.fromAsset) ?? 0n) + fee);
  }

  let realizedUsd = 0;
  let usdEstimated = false;
  const byAsset: PnlPeriodAsset[] = [];
  for (const [assetId, feeAtomic] of byAssetMap) {
    const asset = getSwapAsset(assetId);
    const symbol = asset?.symbol ?? assetId;
    const decimals = asset?.decimals ?? 0;
    const human = Number(feeAtomic) / Math.pow(10, decimals);
    const { price, basis } = resolveUsdPrice(symbol);
    const feeUsd = human * price;
    if (basis === 'reference') usdEstimated = true;
    realizedUsd += feeUsd;
    byAsset.push({
      assetId,
      symbol,
      feeNative: formatNative(feeAtomic, decimals),
      feeUsd: Number(feeUsd.toFixed(2)),
      priced: basis !== 'unpriced',
      priceBasis: basis
    });
  }
  byAsset.sort((a, b) => b.feeUsd - a.feeUsd);

  return {
    label,
    since: since.toISOString(),
    conversions: inWindow.length,
    realizedUsd: Number(realizedUsd.toFixed(2)),
    usdEstimated,
    byAsset
  };
}

export async function getPnlReport(options: { timezone?: string; now?: Date } = {}) {
  const timezone = options.timezone || process.env.ATOMIC_PNL_TIMEZONE || 'America/New_York';
  const now = options.now ?? new Date();
  const { startOfToday, startOfWeek, startOfMonth, startOfYear } = periodStarts(timezone, now);

  const rows = await prisma.swapQuote.findMany({
    where: { status: REALIZED_STATUS, createdAt: { gte: startOfYear } },
    select: { fromAsset: true, platformFeeAmount: true, createdAt: true }
  });

  const periods = {
    today: summarize('Today', startOfToday, rows),
    week: summarize('This week', startOfWeek, rows),
    month: summarize('This month', startOfMonth, rows),
    ytd: summarize('Year to date', startOfYear, rows)
  };

  const anyEstimated = Object.values(periods).some((p) => p.usdEstimated);

  return {
    service: 'atomic-payments',
    report: 'daily_pnl',
    generatedAt: now.toISOString(),
    timezone,
    revenueDefinition: 'Platform fees earned on COMPLETED conversions (swap spread). Operating costs are not yet tracked.',
    weekStartsOn: 'Monday',
    periods,
    usdDisclaimer: anyEstimated
      ? 'USD totals for volatile assets use indicative reference prices, not a live feed. Stablecoin fees are valued at parity. Wire the price oracle before relying on USD figures for accounting.'
      : 'USD totals reflect stablecoin fees valued at parity; no volatile-asset fees in range.'
  };
}

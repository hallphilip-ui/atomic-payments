// Cross-sectional relative-strength screen for crypto — LOG-ONLY / SIGNAL-ONLY.
//
// WHAT THIS IS: the one momentum approach that actually validated in the AutoTraderX
// research — CROSS-SECTIONAL relative strength (rank names against each other), not
// absolute momentum (which lost to buy-and-hold). Applied here to a crypto universe.
//
// WHAT THIS IS NOT: it is not backtested on crypto, not investment advice, and it places
// no order and touches no wallet. The equity edge does NOT automatically transfer to
// crypto (24/7, higher vol, different microstructure). This surface exists to FORWARD-
// TEST whether any edge survives here before a single wallet is touched — the same
// prove-then-build discipline as the arb clearance counter.
//
// TWO honesty features baked in, because a naive long-only RS screen has a known trap:
//   1. REGIME AWARENESS. In a broad downtrend, "relative strength" just picks the
//      least-bad faller. The research's core finding was that ABSOLUTE momentum matters —
//      so we surface each name's absolute return alongside its relative rank, and flag
//      when the top-ranked names are still absolutely negative (a bear-market trap).
//   2. RANK-BASED, not return-based. Composite uses cross-sectional PERCENTILE ranks per
//      window, so one 5000% outlier can't dominate the blend.

const CG_MARKETS = 'https://api.coingecko.com/api/v3/coins/markets';

// Excluded: stablecoins (no momentum — they'd pollute the ranking) and the obvious
// pegged wrappers that just echo another asset already in the universe.
const EXCLUDE = new Set([
  'tether', 'usd-coin', 'dai', 'first-digital-usd', 'true-usd', 'usdd', 'frax',
  'paypal-usd', 'ethena-usde', 'binance-usd', 'gemini-dollar', 'liquity-usd',
  'magic-internet-money', 'usdb', 'usual-usd', 'paxos-standard', 'ethena-staked-usde',
  'susds', 'sky-dollar', 'wrapped-steth', 'wrapped-eeth', 'coinbase-wrapped-btc',
  'staked-ether', 'wrapped-bitcoin', 'weth', 'lombard-staked-btc', 'binance-staked-sol',
]);

// Momentum windows and their weight in the composite. Shorter windows are noisier, so
// the 30-day rank carries the most weight. Stated openly so the method is auditable.
const WINDOWS: Array<{ key: string; field: string; weight: number; label: string }> = [
  { key: 'w7', field: 'price_change_percentage_7d_in_currency', weight: 0.25, label: '7d' },
  { key: 'w14', field: 'price_change_percentage_14d_in_currency', weight: 0.35, label: '14d' },
  { key: 'w30', field: 'price_change_percentage_30d_in_currency', weight: 0.40, label: '30d' },
];

export type ScreenRow = {
  rank: number;
  symbol: string;
  name: string;
  price_usd: number;
  market_cap: number;
  ret: Record<string, number | null>;    // raw % return per window
  rs_score: number;                       // composite cross-sectional RS, 0-100
  abs_positive: boolean;                   // is 30d absolute return > 0?
  signal: 'strong' | 'neutral' | 'weak';
};

export type CryptoScreen = {
  as_of: string;
  universe_size: number;
  windows: Array<{ label: string; weight: number }>;
  regime: { median_30d_pct: number | null; state: 'risk-on' | 'risk-off' | 'mixed'; note: string };
  leaders: ScreenRow[];                    // top by composite RS
  laggards: ScreenRow[];                   // bottom by composite RS
  read_only: true;
  disclaimer: string;
};

let cache: { at: number; data: CryptoScreen } | null = null;
const TTL_MS = 15 * 60 * 1000; // CoinGecko free tier is rate-limited; 15m is plenty for a screen

function pctRank(values: number[]): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  return (v: number) => {
    // fraction of the universe strictly below v → 0..1
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    return sorted.length > 1 ? lo / (sorted.length - 1) : 0.5;
  };
}

export async function getCryptoMomentumScreen(topN = 15): Promise<CryptoScreen> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const url = `${CG_MARKETS}?vs_currency=usd&order=market_cap_desc&per_page=100&page=1` +
    `&price_change_percentage=${WINDOWS.map((w) => w.label).join(',')}&sparkline=false`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`CoinGecko markets HTTP ${r.status}`);
  const raw = (await r.json()) as any[];

  // Keep only names with a full momentum vector (drop stables, wrappers, newly-listed).
  const coins = raw.filter((c) =>
    c && !EXCLUDE.has(c.id) &&
    WINDOWS.every((w) => Number.isFinite(Number(c[w.field]))));

  if (coins.length < 10) throw new Error('too few priceable names to rank');

  // Cross-sectional percentile rank per window, then weighted composite.
  const rankers: Record<string, (v: number) => number> = {};
  for (const w of WINDOWS) rankers[w.key] = pctRank(coins.map((c) => Number(c[w.field])));

  const scored: ScreenRow[] = coins.map((c): ScreenRow => {
    const ret: Record<string, number | null> = {};
    let composite = 0;
    for (const w of WINDOWS) {
      const v = Number(c[w.field]);
      ret[w.label] = Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
      composite += rankers[w.key](v) * w.weight;
    }
    const rs = Math.round(composite * 1000) / 10; // 0..100
    const abs30 = Number(c.price_change_percentage_30d_in_currency);
    return {
      rank: 0,
      symbol: String(c.symbol || '').toUpperCase(),
      name: c.name,
      price_usd: Number(c.current_price),
      market_cap: Number(c.market_cap),
      ret,
      rs_score: rs,
      abs_positive: Number.isFinite(abs30) ? abs30 > 0 : false,
      signal: (rs >= 80 ? 'strong' : rs <= 20 ? 'weak' : 'neutral') as ScreenRow['signal'],
    };
  }).sort((a, b) => b.rs_score - a.rs_score);
  scored.forEach((s, i) => { s.rank = i + 1; });

  // Regime: the median 30d return of the universe. RS in a risk-off tape just picks the
  // least-bad faller — the screen must say so, because that is the documented trap.
  const rets30 = coins.map((c) => Number(c.price_change_percentage_30d_in_currency)).sort((a, b) => a - b);
  const med = rets30.length ? rets30[rets30.length >> 1] : null;
  const state: CryptoScreen['regime']['state'] = med == null ? 'mixed' : med > 3 ? 'risk-on' : med < -3 ? 'risk-off' : 'mixed';
  const leaders = scored.slice(0, topN);
  const leadersAbsPos = leaders.filter((l) => l.abs_positive).length;

  const screen: CryptoScreen = {
    as_of: new Date().toISOString(),
    universe_size: coins.length,
    windows: WINDOWS.map((w) => ({ label: w.label, weight: w.weight })),
    regime: {
      median_30d_pct: med == null ? null : Math.round(med * 100) / 100,
      state,
      note: state === 'risk-off'
        ? `Universe median 30d is ${med?.toFixed(1)}% — a DOWNTREND. Relative strength here ranks the least-bad fallers; ${leadersAbsPos}/${leaders.length} leaders are absolutely positive. A long-only RS screen in a risk-off tape is the known trap the equity research flagged.`
        : state === 'risk-on'
          ? `Universe median 30d is +${med?.toFixed(1)}% — broad uptrend. Relative strength and absolute momentum agree for ${leadersAbsPos}/${leaders.length} leaders.`
          : `Universe median 30d is ${med?.toFixed(1)}% — mixed. Weight the absolute-return column, not just the rank.`,
    },
    leaders,
    laggards: scored.slice(-topN).reverse(),
    read_only: true,
    disclaimer:
      'Cross-sectional relative-strength SIGNAL, log-only. Not backtested on crypto, not ' +
      'investment advice, and it executes nothing. The approach validated on equities; ' +
      'whether it holds on crypto is unproven — this surface exists to forward-test that ' +
      'before any capital or wallet is involved. Ranks are relative: a high rank in a ' +
      'falling market still means "less bad", not "good" — read the absolute-return column.',
  };
  cache = { at: Date.now(), data: screen };
  return screen;
}

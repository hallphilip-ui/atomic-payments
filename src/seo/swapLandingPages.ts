import { getSwapAsset } from '../cryptoCore/tokens';

// Programmatic long-tail SEO landing pages: one page per high-intent swap pair
// (e.g. "swap BTC to USDC"). CURATED, not combinatorial — Google penalises mass
// doorway pages, so we ship a hand-picked set of routable, high-search-volume pairs
// with genuinely useful, differentiated content (steps, fees, timing, FAQ, links).
//
// Pairs are keyed by assetId (unambiguous — USDC resolves to Ethereum USDC here),
// and each page deep-links into /defi-swap with the pair preselected.

type Pair = { from: string; to: string };

// Only certified/live-routable assets (BTC, ETH, SOL, major stables + majors).
export const SWAP_PAIRS: Pair[] = [
  { from: 'BITCOIN.BTC', to: 'ETH.ETH' },
  { from: 'ETH.ETH', to: 'BITCOIN.BTC' },
  { from: 'BITCOIN.BTC', to: 'ETH.USDC' },
  { from: 'BITCOIN.BTC', to: 'ETH.USDT' },
  { from: 'BITCOIN.BTC', to: 'SOLANA.SOL' },
  { from: 'ETH.ETH', to: 'ETH.USDC' },
  { from: 'ETH.ETH', to: 'ETH.USDT' },
  { from: 'ETH.ETH', to: 'SOLANA.SOL' },
  { from: 'ETH.ETH', to: 'BNB.BNB' },
  { from: 'ETH.ETH', to: 'ETH.DAI' },
  { from: 'ETH.USDC', to: 'ETH.ETH' },
  { from: 'ETH.USDC', to: 'BITCOIN.BTC' },
  { from: 'ETH.USDC', to: 'SOLANA.SOL' },
  { from: 'ETH.USDT', to: 'ETH.ETH' },
  { from: 'ETH.USDC', to: 'ETH.USDT' },
  { from: 'ETH.USDT', to: 'ETH.USDC' },
  { from: 'SOLANA.SOL', to: 'ETH.ETH' },
  { from: 'SOLANA.SOL', to: 'ETH.USDC' },
  { from: 'BNB.BNB', to: 'ETH.ETH' },
  { from: 'ETH.WBTC', to: 'ETH.ETH' },
  { from: 'AVAX.AVAX', to: 'ETH.USDC' },
  { from: 'ARBITRUM.ARB', to: 'ETH.ETH' },
  // Long-tail expansion — high-intent "swap X to Y" queries among routable majors.
  { from: 'SOLANA.SOL', to: 'ETH.USDT' },
  { from: 'ETH.USDT', to: 'SOLANA.SOL' },
  { from: 'SOLANA.SOL', to: 'BITCOIN.BTC' },
  { from: 'ETH.USDT', to: 'BITCOIN.BTC' },
  { from: 'BNB.BNB', to: 'ETH.USDT' },
  { from: 'ETH.USDT', to: 'BNB.BNB' },
  { from: 'BNB.BNB', to: 'ETH.USDC' },
  { from: 'AVAX.AVAX', to: 'ETH.ETH' },
  { from: 'ETH.ETH', to: 'AVAX.AVAX' },
  { from: 'ETH.ETH', to: 'ARBITRUM.ARB' },
  { from: 'ETH.ETH', to: 'OPTIMISM.OP' },
  { from: 'OPTIMISM.OP', to: 'ETH.ETH' },
  { from: 'ETH.ETH', to: 'POLYGON.POL' },
  { from: 'POLYGON.POL', to: 'ETH.ETH' },
  { from: 'ETH.ETH', to: 'CHAINLINK.LINK' },
  { from: 'CHAINLINK.LINK', to: 'ETH.ETH' },
  { from: 'ETH.ETH', to: 'ETH.UNI' },
  { from: 'ETH.ETH', to: 'ETH.WBTC' },
  { from: 'BITCOIN.BTC', to: 'BNB.BNB' },
  { from: 'ETH.USDC', to: 'ETH.DAI' }
];

const CHAIN_NAMES: Record<string, string> = {
  BITCOIN: 'Bitcoin', ETH: 'Ethereum', SOLANA: 'Solana', BASE: 'Base', BNB: 'BNB Chain',
  ARBITRUM: 'Arbitrum', OPTIMISM: 'Optimism', POLYGON: 'Polygon', AVAX: 'Avalanche', TRON: 'Tron'
};

type AssetInfo = { assetId: string; symbol: string; name: string; chain: string; chainLabel: string };

function assetInfo(assetId: string): AssetInfo | null {
  const a = getSwapAsset(assetId);
  if (!a) return null;
  return { assetId: a.assetId, symbol: a.symbol, name: a.name, chain: a.chain, chainLabel: CHAIN_NAMES[a.chain] || a.chain };
}

function slugFor(pair: Pair): string {
  const f = getSwapAsset(pair.from), t = getSwapAsset(pair.to);
  return `${(f?.symbol || '').toLowerCase()}-to-${(t?.symbol || '').toLowerCase()}`;
}

export function swapPairSlugs(): string[] {
  return SWAP_PAIRS.map(slugFor);
}

export function resolvePairSlug(slug: string): { from: AssetInfo; to: AssetInfo } | null {
  const clean = (slug || '').toLowerCase();
  for (const pair of SWAP_PAIRS) {
    if (slugFor(pair) === clean) {
      const from = assetInfo(pair.from), to = assetInfo(pair.to);
      if (from && to) return { from, to };
    }
  }
  return null;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// Shared page chrome (matches the site's light/violet theme).
function shell(opts: { title: string; description: string; canonical: string; jsonld: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}">
  <link rel="canonical" href="${esc(opts.canonical)}">
  <meta name="theme-color" content="#6d5cf5">
  <meta property="og:site_name" content="Atomic Pay">
  <meta property="og:title" content="${esc(opts.title)}">
  <meta property="og:description" content="${esc(opts.description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${esc(opts.canonical)}">
  <meta property="og:image" content="https://atomicpay.cloud/assets/atomic-og.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(opts.title)}">
  <meta name="twitter:description" content="${esc(opts.description)}">
  <meta name="twitter:image" content="https://atomicpay.cloud/assets/atomic-og.png">
  <link rel="icon" href="/assets/atomic-mark.png">
  <script type="application/ld+json">${opts.jsonld}</script>
  <style>
    :root { --ink:#14161c; --muted:#667085; --line:#e8e9f0; --paper:#fbfbfd; --panel:#fff; --accent:#6d5cf5; --green:#16b364; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      background:radial-gradient(820px 440px at 85% -10%, rgba(109,92,245,0.08), transparent 60%), var(--paper);
      min-height:100vh; -webkit-font-smoothing:antialiased; line-height:1.6; }
    a { color:inherit; text-decoration:none; }
    .topbar { height:72px; display:flex; align-items:center; justify-content:space-between; padding:0 clamp(18px,4vw,40px);
      border-bottom:1px solid var(--line); background:rgba(255,255,255,0.82); position:sticky; top:0; z-index:10; backdrop-filter:blur(14px); }
    .brand { display:flex; align-items:center; gap:10px; font-weight:800; font-size:17px; }
    .brand img { width:40px; height:32px; object-fit:contain; }
    .nav { display:flex; gap:6px; flex-wrap:wrap; }
    .nav a { min-height:34px; display:inline-flex; align-items:center; padding:0 14px; border:1px solid var(--line); border-radius:10px; font-size:13px; color:var(--muted); font-weight:500; background:#fff; }
    .wrap { max-width:820px; margin:0 auto; padding:clamp(24px,4vw,48px) clamp(16px,4vw,28px) 72px; }
    .crumbs { font-size:13px; color:var(--muted); margin-bottom:14px; }
    .crumbs a:hover { color:var(--accent); }
    h1 { font-size:clamp(30px,5vw,46px); letter-spacing:-0.03em; margin:0 0 14px; line-height:1.08; }
    h1 .accent { color:var(--accent); }
    .lede { font-size:clamp(16px,2vw,19px); color:#344054; margin:0 0 26px; max-width:640px; }
    .cta-row { display:flex; gap:12px; flex-wrap:wrap; margin:0 0 8px; }
    .btn { display:inline-flex; align-items:center; gap:8px; height:52px; padding:0 26px; border-radius:13px; font-weight:700; font-size:16px; }
    .btn.primary { background:var(--accent); color:#fff; box-shadow:0 8px 24px rgba(109,92,245,0.28); }
    .btn.ghost { background:#fff; border:1px solid var(--line); color:var(--ink); }
    .note { font-size:13px; color:var(--muted); margin:10px 0 0; }
    h2 { font-size:22px; letter-spacing:-0.01em; margin:40px 0 12px; }
    ol.steps { margin:0; padding:0; list-style:none; counter-reset:step; }
    ol.steps li { position:relative; padding:0 0 16px 46px; counter-increment:step; }
    ol.steps li::before { content:counter(step); position:absolute; left:0; top:0; width:30px; height:30px; border-radius:9px; background:rgba(109,92,245,0.12); color:var(--accent); font-weight:700; font-size:14px; display:flex; align-items:center; justify-content:center; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:18px 20px; margin:0 0 12px; }
    .faq h3 { font-size:16px; margin:16px 0 4px; }
    .faq p { margin:0 0 6px; color:#344054; font-size:14.5px; }
    .related { display:flex; flex-wrap:wrap; gap:8px; }
    .related a { display:inline-flex; align-items:center; padding:8px 14px; border:1px solid var(--line); border-radius:999px; font-size:13.5px; font-weight:600; color:#344054; background:#fff; }
    .related a:hover { border-color:var(--accent); color:var(--accent); }
    p { color:#344054; }
    footer { border-top:1px solid var(--line); margin-top:48px; padding:24px clamp(16px,4vw,32px); color:var(--muted); font-size:13px; display:flex; gap:16px; flex-wrap:wrap; justify-content:center; }
    footer a:hover { color:var(--accent); }
  </style>
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/"><img src="/assets/atomic-mark.png" alt="" onerror="this.style.display='none'">Atomic Pay</a>
    <nav class="nav">
      <a href="/defi-swap">Swap</a>
      <a href="/swap">All pairs</a>
      <a href="/partners">Partners</a>
      <a href="/help">Help</a>
    </nav>
  </header>
  <main class="wrap">${opts.body}</main>
  <footer>
    <a href="/">Home</a><a href="/defi-swap">Swap</a><a href="/swap">All pairs</a><a href="/help">Help</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a>
  </footer>
</body>
</html>`;
}

// Hand-written intros for the highest-intent pairs — stronger + more differentiated
// than the auto-generated lede. Keyed by slug; any pair not listed falls back to the
// templated intro. Plain text (run through esc at render time).
const PAIR_INTROS: Record<string, string> = {
  'btc-to-usdc': 'Want to lock in your Bitcoin gains without opening an exchange account? Atomic Pay swaps native BTC straight to USDC — a dollar-pegged stablecoin — in a single step, no seed phrase and no gas token required. It’s a cross-chain move (Bitcoin → Ethereum) that normally means a CEX or a bridge; here you just enter an amount, confirm with Face ID, and the USDC settles to your wallet. Non-custodial the whole way: your keys never leave your device.',
  'eth-to-usdc': 'When the market turns, moving ETH into a stablecoin shouldn’t mean wiring funds to an exchange. Atomic Pay converts ETH to USDC right from your own wallet — sign up with just an email and Face ID, no seed phrase to write down. You’ll see the exact USDC amount you’ll receive before you confirm, and we sponsor the gas so you don’t need spare ETH just to move. You keep custody from start to finish.',
  'usdt-to-usdc': 'Rotating between the two largest dollar stablecoins is one of the most common moves in crypto — and one of the most annoying to do without a centralized exchange. Atomic Pay swaps USDT to USDC directly, non-custodially, with just your email and Face ID. No seed phrase, no wallet app, no gas token: enter the amount, see your exact USDC out, and confirm. Your dollars stay yours the entire time.',
  'eth-to-sol': 'Moving from Ethereum into the Solana ecosystem usually means juggling a bridge, a second wallet, and gas on both sides. Atomic Pay collapses all of that: swap ETH straight to native SOL in one step, with just an email and Face ID and no seed phrase. It’s a cross-chain swap — we handle the bridging so you never touch a bridge UI — and we sponsor the gas. Non-custodial, settled straight to your Solana address.',
  'btc-to-eth': 'Swapping native Bitcoin for native Ethereum normally forces you onto an exchange or into wrapped-token workarounds. Atomic Pay does it directly — real BTC to real ETH, cross-chain, in a single confirmation. Sign up with just an email and Face ID (no seed phrase), see your exact ETH amount up front, and let us cover the gas. You sign the swap yourself and keep custody throughout.'
};

export function renderSwapLandingPage(from: AssetInfo, to: AssetInfo): string {
  const F = from.symbol, T = to.symbol;
  const slug = `${F.toLowerCase()}-to-${T.toLowerCase()}`;
  const canonical = `https://atomicpay.cloud/swap/${slug}`;
  const crossChain = from.chain !== to.chain;
  const title = `Swap ${F} to ${T} — No Wallet, No Seed Phrase | Atomic Pay`;
  const description = `Swap ${from.name} (${F}) to ${to.name} (${T}) with just your email and Face ID — non-custodial, no seed phrase, no gas token. ${crossChain ? `Atomic Pay handles the ${from.chainLabel} → ${to.chainLabel} bridging` : 'Best-rate routing'}, settled straight to your wallet.`;

  const deepLink = `/defi-swap?from=${encodeURIComponent(from.assetId)}&to=${encodeURIComponent(to.assetId)}`;

  // Related pairs: other curated pairs that share an asset with this one.
  const related = SWAP_PAIRS
    .filter((p) => (p.from === from.assetId || p.to === to.assetId || p.from === to.assetId || p.to === from.assetId))
    .map((p) => ({ slug: slugFor(p), from: getSwapAsset(p.from)?.symbol, to: getSwapAsset(p.to)?.symbol }))
    .filter((r) => r.slug !== slug && r.from && r.to)
    .slice(0, 6);

  const faqs = [
    {
      q: `Is it safe to swap ${F} to ${T} on Atomic Pay?`,
      a: `Yes — Atomic Pay is non-custodial. Your keys are derived on your own device and funds never touch our servers; you sign every swap yourself. Addresses are screened against sanctions lists before a quote is issued.`
    },
    {
      q: `What does it cost to swap ${F} to ${T}?`,
      a: `Atomic Pay charges a platform spread of about 2.5%, shown in your quote before you confirm, plus the underlying network and routing costs for the ${F}→${T} route. The quote always shows your exact ${T} receive amount, with no hidden fees.`
    },
    {
      q: `How long does a ${F} to ${T} swap take?`,
      a: crossChain
        ? `Most ${F}→${T} swaps complete within a few minutes. Because this is a cross-chain route (${from.chainLabel} to ${to.chainLabel}), timing depends on network confirmations and the bridge — Atomic Pay tracks it end to end.`
        : `Most ${F}→${T} swaps on ${from.chainLabel} complete within a couple of minutes, depending on network confirmation times.`
    }
  ];

  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://atomicpay.cloud/' },
          { '@type': 'ListItem', position: 2, name: 'Swap pairs', item: 'https://atomicpay.cloud/swap' },
          { '@type': 'ListItem', position: 3, name: `${F} to ${T}`, item: canonical }
        ]
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
      }
    ]
  });

  const defaultLede = `Convert ${esc(from.name)} (${esc(F)}) to ${esc(to.name)} (${esc(T)}) with just your email and Face ID — no seed phrase, no wallet app, no gas token. ${crossChain ? `This is a cross-chain swap (${esc(from.chainLabel)} → ${esc(to.chainLabel)}); Atomic Pay handles the bridging so you never touch a bridge UI.` : `Routed on ${esc(from.chainLabel)} at the best available rate.`} Non-custodial — you keep your keys.`;
  const lede = PAIR_INTROS[slug] ? esc(PAIR_INTROS[slug]) : defaultLede;

  const body = `
    <div class="crumbs"><a href="/">Home</a> › <a href="/swap">Swap pairs</a> › ${esc(F)} to ${esc(T)}</div>
    <h1>Swap <span class="accent">${esc(F)}</span> to <span class="accent">${esc(T)}</span></h1>
    <p class="lede">${lede}</p>
    <div class="cta-row">
      <a class="btn primary" href="${esc(deepLink)}">Swap ${esc(F)} → ${esc(T)} now →</a>
      <a class="btn ghost" href="/defi-swap">Open the swap app</a>
    </div>
    <p class="note">Live on mainnet · Non-custodial · Sanctions-screened</p>

    <h2>How to swap ${esc(F)} to ${esc(T)}</h2>
    <ol class="steps">
      <li><strong>Create or connect a wallet.</strong> Sign up with your email and Face ID for an instant self-custody wallet (no seed phrase), or connect an existing wallet like MetaMask.</li>
      <li><strong>Choose ${esc(F)} → ${esc(T)} and enter an amount.</strong> The pair is pre-selected when you arrive from this page.</li>
      <li><strong>Get your quote.</strong> You'll see the exact amount of ${esc(T)} you'll receive, net of fees, before you commit.</li>
      <li><strong>Confirm with Face ID.</strong> Atomic Pay sponsors the gas, routes the swap${crossChain ? ` across ${esc(from.chainLabel)} → ${esc(to.chainLabel)}` : ''}, and settles ${esc(T)} to your wallet.</li>
    </ol>

    <h2>${esc(F)} to ${esc(T)}: fees & timing</h2>
    <div class="card">
      <p style="margin:0 0 8px"><strong>Fee:</strong> ~2.5% platform spread, shown in the quote before you confirm, plus network/routing costs. No hidden fees — the quote shows your exact ${esc(T)} receive amount.</p>
      <p style="margin:0"><strong>Speed:</strong> ${crossChain ? `Typically a few minutes; cross-chain routes (${esc(from.chainLabel)} → ${esc(to.chainLabel)}) depend on confirmations and bridging.` : `Typically a couple of minutes on ${esc(from.chainLabel)}.`}</p>
    </div>

    <h2>FAQ</h2>
    <div class="faq">
      ${faqs.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}
    </div>

    ${related.length ? `<h2>Related swaps</h2>
    <div class="related">
      ${related.map((r) => `<a href="/swap/${esc(r.slug)}">${esc(r.from as string)} → ${esc(r.to as string)}</a>`).join('')}
      <a href="/swap">All pairs →</a>
    </div>` : ''}
  `;

  return shell({ title, description, canonical, jsonld, body });
}

export function renderSwapHub(): string {
  const title = 'Swap Crypto Across Chains — All Pairs | Atomic Pay';
  const description = 'Swap any coin to any coin with just email and Face ID — no seed phrase, no gas token. Browse popular cross-chain swap pairs: BTC to USDC, ETH to SOL, USDT to ETH and more.';
  const canonical = 'https://atomicpay.cloud/swap';
  const rows = SWAP_PAIRS.map((p) => {
    const f = getSwapAsset(p.from), t = getSwapAsset(p.to);
    return f && t ? { slug: slugFor(p), f, t } : null;
  }).filter(Boolean) as { slug: string; f: any; t: any }[];

  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://atomicpay.cloud/' },
      { '@type': 'ListItem', position: 2, name: 'Swap pairs', item: canonical }
    ]
  });

  const body = `
    <div class="crumbs"><a href="/">Home</a> › Swap pairs</div>
    <h1>Swap crypto <span class="accent">across chains</span></h1>
    <p class="lede">Pick a pair to get started. Every swap is non-custodial and needs just your email and Face ID — no seed phrase, no wallet app, no gas token.</p>
    <div class="cta-row"><a class="btn primary" href="/defi-swap">Open the swap app →</a></div>
    <h2>Popular swap pairs</h2>
    <div class="related">
      ${rows.map((r) => `<a href="/swap/${esc(r.slug)}">${esc(r.f.symbol)} → ${esc(r.t.symbol)}</a>`).join('')}
    </div>
  `;
  return shell({ title, description, canonical, jsonld, body });
}

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createStoredSwapQuote } from '../cryptoCore/swapStore';
import { listSwapAssets, getSwapAsset, getLifiAsset } from '../cryptoCore/tokens';
import { probeRouteMinimum } from '../cryptoCore/providerAdapters';
import { screenAddress } from '../compliance/sanctions';
import { LIFI_API_KEY } from '../cryptoCore/swapConfig';

// Atomic Pay AI assistant. A PLANNER over the existing swap engine — it can look
// things up and PREPARE swaps for the user, but it has no signing tool and never
// touches keys. Every fund movement it prepares must be reviewed and signed by the
// user on their own device (Face ID / their wallet). Calls the Claude Messages API
// via raw fetch (no SDK dependency); ANTHROPIC_API_KEY stays server-side.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-8';
const MAX_TOOL_ITERATIONS = 6;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const router = Router();

// This endpoint spends money (Claude tokens) and is public — meter it tightly.
const assistantLimiter = rateLimit({
  windowMs: 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => { const cf = req.headers['cf-connecting-ip']; return typeof cf === 'string' && cf.length ? cf : req.ip || 'unknown'; }
});

const SYSTEM_PROMPT = `You are the Atomic Pay assistant. Atomic Pay is a non-custodial crypto product: cross-chain swaps, an email + Face ID wallet, and a merchant payment gateway that lets any business accept crypto. You help users swap crypto, make crypto payments, accept crypto for their business, and understand their options — all through the tools provided.

HARD SECURITY RULES (never violate):
- You CANNOT and MUST NOT move funds, send transactions, sign anything, or access private keys. You have no such tool and never will.
- Everything you "prepare" (a swap or payment) is only a proposal. The user must review it and approve it themselves on their own device (Face ID or their wallet). Say so.
- Never ask for, accept, or repeat a private key, seed phrase, or password. If a user provides one, refuse, warn them it is unsafe, and tell them to move funds to a new wallet.
- Never invent addresses, amounts, quotes, prices, or fees. Only state values that came from a tool result.

HOW TO HELP:
- Meet people where they are. Most users are NOT crypto experts and will open with something vague like "I need to swap crypto, how do I do it?" or "can you help me trade some bitcoin?". Welcome them, and in one plain sentence say what Atomic does — swap almost any coin to almost any coin, with just an email and Face ID (no seed phrase, non-custodial, you keep your keys) — then ask ONE friendly question to move forward, e.g. "What have you got, and what would you like instead?" Never demand a precisely-formatted command and never dump a form.
- A swap needs four things: the source asset, the destination asset, the amount, and where it lands. Gather them ONE natural question at a time as the conversation flows — don't ask for all four at once. If the user's wallet address is in context, quietly default the destination to it for a swap-to-self and don't ask for it.
- Map plain words to assets with list_supported_assets ("bitcoin"->BITCOIN.BTC, "usdc on base"->BASE.USDC). If they give a dollar amount, use get_price to convert to asset units. When you have enough, call prepare_swap, then present it plainly: what they send, the estimated amount they receive, the fee, and the expiry — and tell them to review and confirm to sign it themselves.
- If a prepared quote comes back BLOCKED (compliance/sanctions) or HALTED (price impact too high), explain plainly and do not try to work around it. If prepare_swap returns an error that the swap is over the maximum size, tell the user the cap and suggest a smaller amount (or splitting it) — don't retry the same size. Use check_address when a user wants to know if a destination is safe to send to.
- If someone wants to ACCEPT crypto — "take payments for my business", "how do I get paid in crypto", "send my customer an invoice", "a crypto POS/checkout" — tell them about the Atomic Pay merchant gateway: free self-serve signup at /merchant, a point-of-sale that turns any amount into a QR code, emailed invoices with a hosted checkout link, USDC/USDT/PYUSD stablecoin rails (USDC on Base has the lowest fees), reports/receipts, and signed webhooks for developers. Payments are non-custodial — funds settle straight to the merchant's own wallet, which they set in the portal. You cannot create invoices yourself; point them to /merchant to do it. Do NOT recommend actually sending funds before a real receiving wallet is set.
- Only discuss Atomic Pay and crypto swapping/payments/acceptance. Decline unrelated requests briefly and steer back.

STYLE: Warm, plain-language, and concise — like a helpful person, not a form. One question at a time. No jargon unless the user uses it first; briefly explain a term the first time it matters. Give a recommendation, not an exhaustive survey. Don't restate the whole plan or show your reasoning — just answer and keep things moving.`;

const TOOLS = [
  {
    name: 'list_supported_assets',
    description: 'List the crypto assets certified for live swapping (with symbol, chain, and decimals). Call this when you need to know what can be swapped or to resolve a symbol to an assetId.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_price',
    description: 'Get the current USD price of an asset, to convert a USD amount into asset units before preparing a swap.',
    input_schema: { type: 'object', properties: { assetId: { type: 'string', description: 'The assetId, e.g. ETH.ETH or BASE.USDC' } }, required: ['assetId'], additionalProperties: false }
  },
  {
    name: 'prepare_swap',
    description: 'Prepare (quote) a swap or payment. Returns a signable quote the USER must review and approve — this does NOT move any funds. Amount is in the FROM asset\'s units (e.g. "0.05" ETH), as a decimal string.',
    input_schema: {
      type: 'object',
      properties: {
        fromAsset: { type: 'string', description: 'Source assetId, e.g. ETH.ETH' },
        toAsset: { type: 'string', description: 'Destination assetId, e.g. BASE.USDC' },
        amount: { type: 'string', description: 'Amount of the FROM asset as a decimal string, e.g. "0.05"' },
        toAddress: { type: 'string', description: 'Where funds land — the recipient for a payment, or the user\'s own address for a swap-to-self' },
        fromAddress: { type: 'string', description: 'Optional source address (the wallet that will sign)' }
      },
      required: ['fromAsset', 'toAsset', 'amount', 'toAddress'], additionalProperties: false
    }
  },
  {
    name: 'check_address',
    description: 'Screen a destination address against sanctions lists before sending to it. Returns whether it is flagged.',
    input_schema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'], additionalProperties: false }
  },
  {
    name: 'smallest_amount',
    description: 'Find the smallest amount that can be routed for a given pair (there is a per-route minimum).',
    input_schema: {
      type: 'object',
      properties: { fromAsset: { type: 'string' }, toAsset: { type: 'string' }, toAddress: { type: 'string' } },
      required: ['fromAsset', 'toAsset', 'toAddress'], additionalProperties: false
    }
  }
];

// Human decimal string -> atomic integer string, using the asset's decimals.
function toAtomic(human: string, decimals: number): string {
  const s = String(human).trim();
  if (!/^[0-9]*\.?[0-9]*$/.test(s) || s === '' || s === '.') throw new Error('Amount must be a positive number.');
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const atomic = ((whole || '0') + fracPadded).replace(/^0+/, '') || '0';
  if (atomic === '0') throw new Error('Amount must be greater than zero.');
  return atomic;
}

type PreparedSwap = { quoteId: string; status: string; fromAsset: string; toAsset: string; amount: string; toAddress: string; fromAddress?: string; feeBps: number; expiresAt: string };

async function runTool(name: string, input: any, ctx: { country?: string }, out: { prepared?: PreparedSwap }): Promise<unknown> {
  switch (name) {
    case 'list_supported_assets':
      return {
        assets: listSwapAssets().filter((a) => getLifiAsset(a.assetId))
          .map((a) => ({ assetId: a.assetId, symbol: a.symbol, name: a.name, chain: a.chain, decimals: a.decimals }))
      };

    case 'get_price': {
      const m = getLifiAsset(String(input.assetId));
      if (!m) return { error: 'Unknown or unsupported assetId.' };
      const headers: Record<string, string> = { accept: 'application/json' };
      if (LIFI_API_KEY) headers['x-lifi-api-key'] = LIFI_API_KEY;
      try {
        const r = await fetch(`https://li.quest/v1/token?chain=${encodeURIComponent(m.chain)}&token=${encodeURIComponent(m.token)}`, { headers, signal: AbortSignal.timeout(8000) });
        if (!r.ok) return { error: 'Price unavailable right now.' };
        const d: any = await r.json();
        const price = Number(d.priceUSD);
        return Number.isFinite(price) && price > 0 ? { assetId: input.assetId, priceUsd: price } : { error: 'No live price for this asset.' };
      } catch { return { error: 'Price lookup failed.' }; }
    }

    case 'check_address': {
      const addr = String(input.address || '').trim();
      if (!addr) return { error: 'No address provided.' };
      try {
        const hit = await screenAddress(addr);
        return hit ? { address: addr, flagged: true, reason: hit.category || 'sanctions', source: hit.source }
                   : { address: addr, flagged: false };
      } catch { return { address: addr, flagged: false, note: 'Screening unavailable; proceed with caution.' }; }
    }

    case 'smallest_amount': {
      const from = getSwapAsset(String(input.fromAsset)), to = getSwapAsset(String(input.toAsset));
      if (!from || !to) return { error: 'Unknown asset.' };
      try {
        const res = await probeRouteMinimum({ fromAsset: from.assetId, toAsset: to.assetId, amount: '0', userAddress: String(input.toAddress || '') });
        return res.supported ? { minAmount: (Number(res.minBaseUnits) / 10 ** res.decimals).toString(), minUsd: res.minUsd, symbol: res.symbol }
                             : { error: res.reason };
      } catch { return { error: 'Could not determine a routable minimum right now.' }; }
    }

    case 'prepare_swap': {
      const from = getSwapAsset(String(input.fromAsset)), to = getSwapAsset(String(input.toAsset));
      if (!from) return { error: `Unknown source asset ${input.fromAsset}. Use list_supported_assets.` };
      if (!to) return { error: `Unknown destination asset ${input.toAsset}. Use list_supported_assets.` };
      const toAddress = String(input.toAddress || '').trim();
      if (!toAddress) return { error: 'A destination address is required.' };
      let atomic: string;
      try { atomic = toAtomic(String(input.amount), from.decimals); } catch (e: any) { return { error: e.message }; }
      try {
        const { quote } = await createStoredSwapQuote(
          { fromAsset: from.assetId, toAsset: to.assetId, amount: atomic, userAddress: toAddress, fromAddress: input.fromAddress ? String(input.fromAddress) : undefined },
          { countryCode: ctx.country }
        );
        const summary: PreparedSwap = {
          quoteId: quote.id, status: quote.status, fromAsset: from.assetId, toAsset: to.assetId,
          amount: String(input.amount), toAddress, fromAddress: input.fromAddress ? String(input.fromAddress) : undefined,
          feeBps: quote.platformFeeBps, expiresAt: quote.expiresAt
        };
        if (quote.status === 'QUOTED') out.prepared = summary; // surface to the UI for a Review & swap card
        // NB: signable calldata is deliberately NOT returned to the model — the UI uses quoteId.
        return {
          quoteId: quote.id, status: quote.status,
          message: quote.status === 'QUOTED' ? 'Prepared. The user must review and approve this to sign — you cannot execute it.'
            : quote.status === 'BLOCKED' ? 'Compliance blocked this swap. Do not retry.'
            : quote.status === 'HALTED' ? 'Price impact too high — suggest a smaller amount.'
            : `Status: ${quote.status}.`,
          feeBps: quote.platformFeeBps, expiresAt: quote.expiresAt
        };
      } catch (e: any) { return { error: e?.message || 'Could not prepare this swap.' }; }
    }

    default:
      return { error: `Unknown tool ${name}.` };
  }
}

async function callClaude(body: unknown, apiKey: string): Promise<any> {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60000)
  });
  if (!r.ok) {
    let detail = ''; try { const b: any = await r.json(); detail = b?.error?.message || ''; } catch {}
    const err: any = new Error(`Claude API ${r.status}${detail ? ': ' + detail : ''}`); err.status = r.status; throw err;
  }
  return r.json();
}

// Pick the LLM backend. Explicit ATOMIC_ASSISTANT_PROVIDER wins if its key is set;
// otherwise auto-detect (Anthropic preferred, then OpenAI). Same tools + safety
// prompt drive either provider — only the wire format differs.
function selectProvider(): { provider: 'anthropic' | 'openai'; apiKey: string } | null {
  const anth = (process.env.ANTHROPIC_API_KEY || '').trim();
  const oai = (process.env.OPENAI_API_KEY || '').trim();
  const pref = (process.env.ATOMIC_ASSISTANT_PROVIDER || '').trim().toLowerCase();
  if (pref === 'openai' && oai) return { provider: 'openai', apiKey: oai };
  if (pref === 'anthropic' && anth) return { provider: 'anthropic', apiKey: anth };
  if (anth) return { provider: 'anthropic', apiKey: anth };
  if (oai) return { provider: 'openai', apiKey: oai };
  return null;
}

type Msg = { role: string; content: string };
type RunResult = { reply: string; prepared?: PreparedSwap };

// ---- Anthropic (Claude) backend ----
async function runAnthropic(system: string, messages: Msg[], ctx: { country?: string }, apiKey: string): Promise<RunResult> {
  const convo: any[] = messages.slice();
  const out: { prepared?: PreparedSwap } = {};
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callClaude({ model: MODEL, max_tokens: 2048, system, tools: TOOLS, thinking: { type: 'disabled' }, messages: convo }, apiKey);
    if (response.stop_reason !== 'tool_use') {
      const text = (response.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
      return { reply: text || 'Sorry, I did not catch that.', prepared: out.prepared };
    }
    convo.push({ role: 'assistant', content: response.content });
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      let result: unknown;
      try { result = await runTool(block.name, block.input || {}, ctx, out); } catch (e: any) { result = { error: e?.message || 'Tool failed.' }; }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    convo.push({ role: 'user', content: toolResults });
  }
  return { reply: 'That request needed too many steps — please rephrase or try a simpler ask.', prepared: out.prepared };
}

// ---- OpenAI (ChatGPT / GPT) backend ----
// Same 5 tools, mapped to OpenAI's function-calling shape (input_schema === parameters).
function openaiTools() {
  return TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
}
async function callOpenAI(body: unknown, apiKey: string): Promise<any> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60000)
  });
  if (!r.ok) {
    let detail = ''; try { const b: any = await r.json(); detail = b?.error?.message || ''; } catch {}
    const err: any = new Error(`OpenAI API ${r.status}${detail ? ': ' + detail : ''}`); err.status = r.status; throw err;
  }
  return r.json();
}
async function runOpenAI(system: string, messages: Msg[], ctx: { country?: string }, apiKey: string): Promise<RunResult> {
  // Model is env-configurable so the current GPT model can be set without a code change.
  const model = (process.env.ATOMIC_OPENAI_MODEL || 'gpt-4o').trim();
  const msgs: any[] = [{ role: 'system', content: system }, ...messages];
  const tools = openaiTools();
  const out: { prepared?: PreparedSwap } = {};
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await callOpenAI({ model, messages: msgs, tools, tool_choice: 'auto' }, apiKey);
    const m = resp?.choices?.[0]?.message;
    if (!m) throw new Error('Empty response from OpenAI.');
    if (m.tool_calls && m.tool_calls.length) {
      msgs.push(m); // assistant turn carrying the tool_calls
      for (const tc of m.tool_calls) {
        let args: any = {}; try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
        let result: unknown;
        try { result = await runTool(tc.function?.name, args, ctx, out); } catch (e: any) { result = { error: e?.message || 'Tool failed.' }; }
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }
    return { reply: (m.content || '').trim() || 'Sorry, I did not catch that.', prepared: out.prepared };
  }
  return { reply: 'That request needed too many steps — please rephrase or try a simpler ask.', prepared: out.prepared };
}

router.post('/v1/assistant/chat', assistantLimiter, async (req, res) => {
  const sel = selectProvider();
  if (!sel) return res.status(503).json({ error: 'Assistant is not configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY).' });

  // Validate + sanitize the incoming conversation. Cap size (token cost + abuse).
  const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = raw
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-30)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  if (!messages.length || messages[0].role !== 'user') return res.status(400).json({ error: 'Start the conversation with a user message.' });
  const totalChars = messages.reduce((n: number, m: any) => n + m.content.length, 0);
  if (totalChars > 16000) return res.status(400).json({ error: 'Conversation too long — start a new one.' });

  const cfCountry = req.headers['cf-ipcountry'];
  const ctx = { country: typeof cfCountry === 'string' ? cfCountry : undefined };
  const userAddress = typeof req.body?.userAddress === 'string' && EVM_ADDRESS.test(req.body.userAddress.trim()) ? req.body.userAddress.trim() : undefined;
  const system = SYSTEM_PROMPT + (userAddress ? `\n\nContext: the user's connected wallet address is ${userAddress} — use it as the default destination for a swap-to-self.` : '');

  try {
    const { reply, prepared } = sel.provider === 'openai'
      ? await runOpenAI(system, messages, ctx, sel.apiKey)
      : await runAnthropic(system, messages, ctx, sel.apiKey);
    return res.json({ reply, preparedSwap: prepared ?? null });
  } catch (e: any) {
    return res.status(502).json({ error: 'Assistant error: ' + (e?.message || 'unknown') });
  }
});

// Lightweight availability check so the chat widget only mounts when the assistant
// is actually configured (avoids showing a dead chat when no provider key is set).
router.get('/v1/assistant/status', (_req, res) => {
  const sel = selectProvider();
  res.header('Cache-Control', 'no-store');
  return res.json({ enabled: !!sel, provider: sel?.provider ?? null });
});

export default router;

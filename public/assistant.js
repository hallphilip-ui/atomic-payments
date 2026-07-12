// Atomic Pay chat assistant widget. A floating launcher + chat panel that talks to
// POST /v1/assistant/chat. The assistant PREPARES swaps; it never signs. When it
// returns a prepared swap, the widget prefills the existing swap console form so the
// user reviews and signs there — the widget itself never touches keys or calldata.
(function () {
  'use strict';
  if (window.__atomicAssistant) return;
  window.__atomicAssistant = true;

  var history = [];   // [{role:'user'|'assistant', content:string}]
  var busy = false;

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }
  function el(id) { return document.getElementById(id); }
  function userAddr() { var e = el('sendAddress'); var v = e && e.value ? e.value.trim() : ''; return /^0x[0-9a-fA-F]{40}$/.test(v) ? v : undefined; }

  var CSS = '' +
    '#axa-btn{position:fixed;right:20px;bottom:20px;z-index:2147482000;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:#6d5cf5;color:#fff;box-shadow:0 8px 24px rgba(109,92,245,.4);display:flex;align-items:center;justify-content:center;}' +
    '#axa-btn:hover{background:#5b4be0;}' +
    '#axa-panel{position:fixed;right:20px;bottom:88px;z-index:2147482000;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 130px));background:#fff;border:1px solid #e8e9f0;border-radius:18px;box-shadow:0 18px 50px rgba(20,22,28,.22);display:none;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,-apple-system,sans-serif;color:#14161c;}' +
    '#axa-panel.open{display:flex;}' +
    '.axa-head{display:flex;align-items:center;gap:9px;padding:13px 15px;border-bottom:1px solid #eef0f6;}' +
    '.axa-head .dot{width:8px;height:8px;border-radius:50%;background:#0a7d33;}' +
    '.axa-head strong{font-size:14px;} .axa-head .sub{font-size:11px;color:#98a2b3;}' +
    '.axa-x{margin-left:auto;background:none;border:none;color:#98a2b3;font-size:18px;cursor:pointer;line-height:1;}' +
    '.axa-msgs{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f7f8fc;}' +
    '.axa-m{max-width:85%;font-size:13.5px;line-height:1.5;padding:9px 12px;border-radius:13px;white-space:pre-wrap;word-wrap:break-word;}' +
    '.axa-m.you{align-self:flex-end;background:#6d5cf5;color:#fff;border-bottom-right-radius:4px;}' +
    '.axa-m.bot{align-self:flex-start;background:#fff;border:1px solid #e8e9f0;border-bottom-left-radius:4px;}' +
    '.axa-chip{align-self:flex-start;font-size:12.5px;color:#6d5cf5;background:#fff;border:1px solid #d9d4fb;border-radius:999px;padding:7px 13px;cursor:pointer;}' +
    '.axa-card{align-self:flex-start;max-width:92%;background:#fff;border:1px solid #d9d4fb;border-radius:13px;padding:12px 13px;font-size:13px;}' +
    '.axa-card .r{display:flex;justify-content:space-between;gap:12px;padding:2px 0;color:#667085;} .axa-card .r b{color:#14161c;}' +
    '.axa-card button{width:100%;margin-top:9px;background:#6d5cf5;color:#fff;border:none;border-radius:9px;padding:9px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;}' +
    '.axa-card .warn{background:#fdecec;color:#b3261e;border:1px solid #f3c0bc;border-radius:8px;padding:7px 9px;font-size:12px;}' +
    '.axa-typing{align-self:flex-start;color:#98a2b3;font-size:13px;padding:6px 12px;}' +
    '.axa-foot{display:flex;gap:8px;padding:11px;border-top:1px solid #eef0f6;}' +
    '.axa-foot input{flex:1;border:1px solid #e8e9f0;border-radius:10px;padding:9px 12px;font-size:13.5px;font-family:inherit;outline:none;}' +
    '.axa-foot input:focus{border-color:#6d5cf5;}' +
    '.axa-foot button{background:#6d5cf5;color:#fff;border:none;border-radius:10px;padding:0 15px;font-weight:700;cursor:pointer;font-family:inherit;}' +
    '.axa-note{font-size:10.5px;color:#98a2b3;text-align:center;padding:0 11px 9px;}' +
    '@media (prefers-color-scheme:dark){#axa-panel{background:#12141b;border-color:#262a36;color:#e7e9f0;}.axa-head{border-color:#242836;}.axa-msgs{background:#0e0f15;}.axa-m.bot{background:#171922;border-color:#262a36;}.axa-card{background:#171922;border-color:#3a2f7a;}.axa-foot{border-color:#242836;}.axa-foot input{background:#1b1e27;border-color:#2a2f3c;color:#e7e9f0;}}';

  function injectCss() { if (!el('axa-css')) { var s = document.createElement('style'); s.id = 'axa-css'; s.textContent = CSS; document.head.appendChild(s); } }

  var msgsEl;
  function scrollDown() { if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight; }

  function addMsg(role, text) {
    var d = document.createElement('div'); d.className = 'axa-m ' + (role === 'user' ? 'you' : 'bot'); d.textContent = text;
    msgsEl.appendChild(d); scrollDown();
  }

  function addReviewCard(sw) {
    var wrap = document.createElement('div'); wrap.className = 'axa-card';
    if (sw.status !== 'QUOTED') {
      wrap.innerHTML = '<div class="warn">' + (sw.status === 'BLOCKED' ? 'This swap was blocked by compliance.' : sw.status === 'HALTED' ? 'Price impact is too high — try a smaller amount.' : 'This swap can’t proceed right now.') + '</div>';
      msgsEl.appendChild(wrap); scrollDown(); return;
    }
    var sym = function (a) { return String(a).split('.').pop(); };
    wrap.innerHTML =
      '<div class="r"><span>You send</span><b>' + esc(sw.amount) + ' ' + esc(sym(sw.fromAsset)) + '</b></div>' +
      '<div class="r"><span>You get</span><b>' + esc(sym(sw.toAsset)) + '</b></div>' +
      '<div class="r"><span>Fee</span><b>' + (sw.feeBps / 100) + '%</b></div>' +
      '<button type="button">Review &amp; swap →</button>';
    wrap.querySelector('button').addEventListener('click', function () { handoff(sw); });
    msgsEl.appendChild(wrap); scrollDown();
  }

  // Prefill the real swap console and hand the user over to sign there.
  function handoff(sw) {
    function setSel(id, v) { var s = el(id); if (s && v && [].some.call(s.options, function (o) { return o.value === v; })) { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); } }
    function setVal(id, v) { var e = el(id); if (e && v != null && v !== '') { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } }
    setSel('fromAsset', sw.fromAsset);
    setSel('toAsset', sw.toAsset);
    setVal('destination', sw.toAddress);
    if (sw.fromAddress) setVal('sendAddress', sw.fromAddress);
    setVal('amount', sw.amount); // last, so the console's auto-quote fires with everything set
    toggle(false);
    var target = el('amount');
    if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function typing(on) {
    var t = el('axa-typing');
    if (on && !t) { var d = document.createElement('div'); d.id = 'axa-typing'; d.className = 'axa-typing'; d.textContent = 'Atomic is typing…'; msgsEl.appendChild(d); scrollDown(); }
    else if (!on && t) t.remove();
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true;
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    var input = el('axa-input'); if (input) input.value = '';
    typing(true);
    try {
      var r = await fetch('/v1/assistant/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, userAddress: userAddr() })
      });
      typing(false);
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) { addMsg('bot', d.error === undefined ? 'Something went wrong — please try again.' : (r.status === 429 ? 'One moment — too many messages. Try again shortly.' : 'Sorry, I hit a snag. Please try again.')); busy = false; return; }
      var reply = d.reply || 'Sorry, I didn’t catch that.';
      addMsg('bot', reply);
      history.push({ role: 'assistant', content: reply });
      if (d.preparedSwap) addReviewCard(d.preparedSwap);
    } catch (e) { typing(false); addMsg('bot', 'I couldn’t reach the network — check your connection and try again.'); }
    busy = false;
  }

  function seed() {
    if (msgsEl.childElementCount) return;
    addMsg('bot', "Hi! I'm the Atomic assistant. I can help you swap almost any coin to any coin — just tell me what you're trying to do.");
    var chip = document.createElement('div'); chip.className = 'axa-chip'; chip.textContent = 'I need to swap crypto — how do I start?';
    chip.addEventListener('click', function () { send(chip.textContent); });
    msgsEl.appendChild(chip); scrollDown();
  }

  function toggle(open) {
    var p = el('axa-panel'); if (!p) return;
    var show = open == null ? !p.classList.contains('open') : open;
    p.classList.toggle('open', show);
    if (show) { seed(); var i = el('axa-input'); if (i) i.focus(); }
  }

  function mount() {
    injectCss();
    var btn = document.createElement('button');
    btn.id = 'axa-btn'; btn.setAttribute('aria-label', 'Open Atomic assistant');
    btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    btn.addEventListener('click', function () { toggle(); });
    document.body.appendChild(btn);

    var panel = document.createElement('div'); panel.id = 'axa-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Atomic assistant');
    panel.innerHTML =
      '<div class="axa-head"><span class="dot"></span><div><strong>Atomic assistant</strong><div class="sub">prepares your swap — you sign</div></div><button class="axa-x" aria-label="Close">&#10005;</button></div>' +
      '<div class="axa-msgs" id="axa-msgs"></div>' +
      '<div class="axa-foot"><input id="axa-input" type="text" placeholder="Ask anything about swapping…" autocomplete="off"><button id="axa-send">Send</button></div>' +
      '<div class="axa-note">The assistant never moves funds — you approve every swap yourself.</div>';
    document.body.appendChild(panel);
    msgsEl = el('axa-msgs');
    panel.querySelector('.axa-x').addEventListener('click', function () { toggle(false); });
    el('axa-send').addEventListener('click', function () { send(el('axa-input').value); });
    el('axa-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(el('axa-input').value); } });
  }

  // Only mount when the assistant is actually configured (key set).
  fetch('/v1/assistant/status').then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.enabled) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount(); }
  }).catch(function () { /* status unavailable → don't mount */ });
})();

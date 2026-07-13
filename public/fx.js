// Local-currency equivalents for displayed amounts. Fetches indicative USD→fiat
// rates from /v1/fx/rates (cached server-side) and formats "≈ €920,000" in the
// viewer's currency + locale. Display only — never used for settlement/enforcement.
// Usage: atomicFx.ready.then(() => el.textContent = atomicFx.equiv(1000000));
//        or add data-fx-usd="1000000" to an element and call atomicFx.annotate().
(function () {
  var RATES = null, LOADED = null, CURRENCY = null;

  // ISO region → ISO-4217 currency (covers the currencies our rate source returns).
  var REGION_CCY = {
    US:'USD', GB:'GBP', CA:'CAD', AU:'AUD', NZ:'NZD', JP:'JPY', KR:'KRW', CN:'CNY',
    TW:'TWD', HK:'HKD', SG:'SGD', IN:'INR', ID:'IDR', PH:'PHP', TH:'THB', VN:'VND',
    MY:'MYR', PK:'PKR', BD:'BDT', AE:'AED', SA:'SAR', TR:'TRY', RU:'RUB', ZA:'ZAR',
    NG:'NGN', KE:'KES', BR:'BRL', MX:'MXN', AR:'ARS', CO:'COP', CL:'CLP', CH:'CHF',
    SE:'SEK', NO:'NOK', DK:'DKK', PL:'PLN', CZ:'CZK', HU:'HUF', IL:'ILS', EG:'EGP',
    AT:'EUR', BE:'EUR', HR:'EUR', CY:'EUR', EE:'EUR', FI:'EUR', FR:'EUR', DE:'EUR',
    GR:'EUR', IE:'EUR', IT:'EUR', LV:'EUR', LT:'EUR', LU:'EUR', MT:'EUR', NL:'EUR',
    PT:'EUR', SK:'EUR', SI:'EUR', ES:'EUR'
  };
  // i18n locale → default currency when the region is unknown.
  var LOCALE_CCY = { en:'USD', zh:'CNY', hi:'INR', es:'EUR', fr:'EUR', ar:'AED', bn:'BDT', pt:'BRL', ru:'RUB', ur:'PKR', id:'IDR', de:'EUR', ja:'JPY', sw:'KES', pa:'INR' };

  function locale() { return (window.atomicI18n && window.atomicI18n.locale) || (navigator.language || 'en'); }

  function detectCurrency() {
    try { var o = localStorage.getItem('atomic.currency'); if (o) return o; } catch (e) {}
    var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < langs.length; i++) {
      var m = /[-_]([A-Za-z]{2})$/.exec(langs[i] || '');
      if (m) { var cc = m[1].toUpperCase(); if (REGION_CCY[cc]) return REGION_CCY[cc]; }
    }
    var loc = (window.atomicI18n && window.atomicI18n.locale) || (navigator.language || 'en').slice(0, 2);
    return LOCALE_CCY[loc] || 'USD';
  }
  function userCurrency() { if (!CURRENCY) CURRENCY = detectCurrency(); return CURRENCY; }
  function setCurrency(c) {
    CURRENCY = c;
    try { localStorage.setItem('atomic.currency', c); } catch (e) {}
    document.querySelectorAll('[data-atomic-currency-select]').forEach(function (s) { s.value = c; });
    load().then(function () { annotate(); });
    window.dispatchEvent(new CustomEvent('atomic-fx-change', { detail: { currency: c } }));
  }

  // Currencies offered in the picker (all returned by the rate source).
  var CURRENCIES = ['USD','EUR','GBP','JPY','CNY','INR','CAD','AUD','CHF','SGD','HKD','KRW','BRL','MXN','AED','SAR','NGN','ZAR','KES','TRY','RUB','PKR','BDT','IDR','PHP','THB','VND','MYR','PLN','SEK','NOK','DKK','NZD','ARS','COP'];
  function currencyLabel(code) {
    try { var n = new Intl.DisplayNames([locale()], { type: 'currency' }).of(code); if (n && n !== code) return code + ' — ' + n; } catch (e) {}
    return code;
  }
  function mountCurrencySelect(select) {
    select.innerHTML = CURRENCIES.map(function (c) { return '<option value="' + c + '">' + currencyLabel(c) + '</option>'; }).join('');
    select.value = userCurrency();
    select.addEventListener('change', function () { setCurrency(select.value); });
  }
  function init() {
    document.querySelectorAll('[data-atomic-currency-select]').forEach(mountCurrencySelect);
    load().then(function () { annotate(); });
  }

  function load() {
    if (LOADED) return LOADED;
    LOADED = fetch('/v1/fx/rates').then(function (r) { return r.json(); })
      .then(function (d) { RATES = (d && d.rates) || null; return RATES; })
      .catch(function () { RATES = null; return null; });
    return LOADED;
  }
  function rate(ccy) { return ccy === 'USD' ? 1 : (RATES && typeof RATES[ccy] === 'number' ? RATES[ccy] : null); }

  // Convert `amount` in `from` currency to `to` currency via the USD-based rates.
  function convert(amount, from, to) {
    var rf = rate(from || 'USD'), rt = rate(to || userCurrency());
    if (!rf || !rt) return null;
    return amount * (rt / rf);
  }
  function fmt(amount, ccy) {
    try { return new Intl.NumberFormat(locale(), { style: 'currency', currency: ccy, maximumFractionDigits: Math.abs(amount) >= 100 ? 0 : 2 }).format(amount); }
    catch (e) { return ccy + ' ' + amount.toLocaleString(locale()); }
  }

  // "≈ €920,000" — the local-currency equivalent of `amount` (default from USD).
  // Empty string when the target currency equals the source or a rate is missing.
  function equiv(amount, opts) {
    opts = opts || {};
    var from = opts.from || 'USD', to = opts.currency || userCurrency();
    var n = Number(amount);
    if (!isFinite(n) || to === from) return '';
    var v = convert(n, from, to);
    if (v == null) return '';
    return '≈ ' + fmt(v, to);
  }

  // Fill every [data-fx-usd] (amount is USD; add data-fx-from to change the source
  // currency; data-fx-target=id to write elsewhere). Safe to call before rates load.
  function annotate(root) {
    (root || document).querySelectorAll('[data-fx-usd]').forEach(function (el) {
      var s = equiv(el.getAttribute('data-fx-usd'), { from: el.getAttribute('data-fx-from') || 'USD' });
      var tgt = el.getAttribute('data-fx-target');
      var out = tgt ? document.getElementById(tgt) : el;
      if (out) out.textContent = s;
    });
  }

  window.atomicFx = { load: load, equiv: equiv, convert: convert, rate: rate, userCurrency: userCurrency, setCurrency: setCurrency, annotate: annotate, init: init, ready: load() };

  // Self-mount the currency picker + annotate once the DOM is ready.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // If the user hasn't explicitly picked a currency, the language's default may
  // shift it — re-derive + re-render on a language change (but keep an explicit pick).
  window.addEventListener('atomic-i18n-change', function () {
    var explicit; try { explicit = localStorage.getItem('atomic.currency'); } catch (e) {}
    if (!explicit) { CURRENCY = null; document.querySelectorAll('[data-atomic-currency-select]').forEach(function (s) { s.value = userCurrency(); }); }
    load().then(function () { annotate(); });
  });
})();

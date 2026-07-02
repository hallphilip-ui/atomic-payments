(function() {
  const widgetDiv = document.getElementById('atomic-pay-widget');
  if (!widgetDiv) return;
  const amount = widgetDiv.getAttribute('data-amount');
  const currency = widgetDiv.getAttribute('data-currency') || 'USD';
  const intentId = widgetDiv.getAttribute('data-intent-id');
  const script = document.currentScript;
  const scriptOrigin = script && script.src ? new URL(script.src).origin : window.location.origin;
  const checkoutUrl = new URL('/checkout', scriptOrigin);
  if (intentId) {
    checkoutUrl.searchParams.set('intentId', intentId);
  } else {
    checkoutUrl.searchParams.set('amount', amount || '');
    checkoutUrl.searchParams.set('currency', currency);
  }
  const button = document.createElement('button');
  button.id = 'atomic-btn';
  button.type = 'button';
  button.style.cssText = 'padding: 10px; background: #000; color: #fff;';
  button.textContent = 'Pay ' + currency + ' ' + (amount || '');
  widgetDiv.replaceChildren(button);
  button.onclick = () => {
    window.open(checkoutUrl.toString(), '_blank');
  };
})();

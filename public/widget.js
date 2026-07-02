(function() {
  const widgetDiv = document.getElementById('atomic-pay-widget');
  if (!widgetDiv) return;
  const amount = widgetDiv.getAttribute('data-amount');
  const script = document.currentScript;
  const scriptOrigin = script && script.src ? new URL(script.src).origin : window.location.origin;
  const checkoutUrl = new URL('/checkout', scriptOrigin);
  checkoutUrl.searchParams.set('amount', amount || '');
  widgetDiv.innerHTML = '<button id="atomic-btn" style="padding: 10px; background: #000; color: #fff;">Pay $' + amount + '</button>';
  document.getElementById('atomic-btn').onclick = () => {
    window.open(checkoutUrl.toString(), '_blank');
  };
})();

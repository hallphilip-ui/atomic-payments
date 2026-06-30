(function() {
  const widgetDiv = document.getElementById('atomic-pay-widget');
  if (!widgetDiv) return;
  const amount = widgetDiv.getAttribute('data-amount');
  widgetDiv.innerHTML = '<button id="atomic-btn" style="padding: 10px; background: #000; color: #fff;">Pay $' + amount + '</button>';
  document.getElementById('atomic-btn').onclick = () => {
    window.open('https://your-app-domain.com/checkout?amount=' + amount, '_blank');
  };
})();

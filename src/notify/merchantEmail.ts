// Merchant → customer emails: an invoice (with a pay link) when an invoice is
// created, and a receipt when the payment confirms. Reuses the ATOMIC_SMTP_* config
// (nodemailer, same as the bug-report + partner mailers). Best-effort: never throws,
// never blocks the request/watcher. Reply-To is the merchant so replies reach them.
const ORIGIN = (process.env.ATOMIC_PUBLIC_ORIGIN ?? 'https://atomicpay.cloud').replace(/\/$/, '');
const SYM: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };

function money(a: number, c: string): string {
  return (SYM[c] || '') + Number(a).toFixed(2) + (SYM[c] ? '' : ' ' + c);
}
function esc(s: string): string {
  return String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));
}
function row(k: string, v: string): string {
  return `<tr><td style="padding:5px 0;color:#98a2b3">${k}</td><td style="padding:5px 0;text-align:right">${v}</td></tr>`;
}
function shell(inner: string): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;color:#14161c">${inner}` +
    `<p style="color:#98a2b3;font-size:11px;margin-top:24px">Powered by Atomic Pay · non-custodial crypto payments</p></div>`;
}

async function send(opts: { to: string; replyTo?: string | null; subject: string; text: string; html: string }): Promise<{ sent: boolean }> {
  const host = process.env.ATOMIC_SMTP_HOST;
  if (!host || !opts.to) return { sent: false };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.ATOMIC_SMTP_PORT ?? 587),
      secure: String(process.env.ATOMIC_SMTP_SECURE ?? 'false') === 'true',
      auth: process.env.ATOMIC_SMTP_USER ? { user: process.env.ATOMIC_SMTP_USER, pass: process.env.ATOMIC_SMTP_PASS } : undefined
    });
    await transport.sendMail({
      from: process.env.ATOMIC_REPORT_FROM ?? process.env.ATOMIC_SMTP_USER ?? opts.to,
      to: opts.to,
      replyTo: opts.replyTo || undefined,
      subject: opts.subject, text: opts.text, html: opts.html
    });
    return { sent: true };
  } catch { return { sent: false }; }
}

export async function sendInvoiceEmail(p: {
  to: string; businessName: string; replyTo?: string | null;
  amount: number; currency: string; description?: string | null; reference?: string | null; intentId: string;
}): Promise<{ sent: boolean }> {
  const payUrl = `${ORIGIN}/checkout?intentId=${p.intentId}`;
  const amt = money(p.amount, p.currency);
  const subject = `Invoice from ${p.businessName}${p.reference ? ' · ' + p.reference : ''} — ${amt}`;
  const text = [
    `${p.businessName} sent you an invoice.`, '',
    `Amount: ${amt}`, p.reference ? `Reference: ${p.reference}` : '', p.description ? `For: ${p.description}` : '',
    '', `Pay with crypto: ${payUrl}`
  ].filter(Boolean).join('\n');
  const html = shell(
    `<h2 style="margin:0 0 4px">Invoice from ${esc(p.businessName)}</h2>` +
    `<p style="color:#667085;font-size:14px;margin:0 0 14px">${p.reference ? 'Reference ' + esc(p.reference) : 'Payment request'}</p>` +
    `<div style="font-size:30px;font-weight:800;margin:6px 0">${amt}</div>` +
    (p.description ? `<p style="font-size:14px;color:#475467">${esc(p.description)}</p>` : '') +
    `<p style="margin:22px 0"><a href="${payUrl}" style="background:#6d5cf5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">Pay with crypto</a></p>` +
    `<p style="color:#98a2b3;font-size:12px">Or open this link:<br>${payUrl}</p>`
  );
  return send({ to: p.to, replyTo: p.replyTo, subject, text, html });
}

export async function sendReceiptEmail(p: {
  to: string; businessName: string; replyTo?: string | null;
  amount: number; currency: string; description?: string | null; reference?: string | null;
  asset?: string | null; txHash?: string | null; intentId: string;
}): Promise<{ sent: boolean }> {
  const amt = money(p.amount, p.currency);
  const subject = `Receipt from ${p.businessName} — ${amt} paid`;
  const text = [
    `Payment received — thank you.`, '', p.businessName, `Amount: ${amt} (paid)`,
    p.reference ? `Reference: ${p.reference}` : '', p.description ? `For: ${p.description}` : '',
    p.asset ? `Paid in: ${p.asset}` : '', p.txHash ? `Transaction: ${p.txHash}` : ''
  ].filter(Boolean).join('\n');
  const html = shell(
    `<h2 style="margin:0 0 4px">✅ Payment received</h2>` +
    `<p style="color:#667085;font-size:14px;margin:0 0 14px">Receipt from ${esc(p.businessName)}</p>` +
    `<div style="font-size:30px;font-weight:800;margin:6px 0">${amt} <span style="font-size:12px;color:#0a7d33;font-weight:700;vertical-align:middle">PAID</span></div>` +
    (p.description ? `<p style="font-size:14px;color:#475467">${esc(p.description)}</p>` : '') +
    `<table style="width:100%;font-size:13px;color:#475467;margin-top:12px;border-collapse:collapse">` +
    (p.reference ? row('Reference', esc(p.reference)) : '') +
    (p.asset ? row('Paid in', esc(p.asset)) : '') +
    (p.txHash ? row('Transaction', esc(p.txHash.slice(0, 12) + '…' + p.txHash.slice(-8))) : '') +
    `</table>`
  );
  return send({ to: p.to, replyTo: p.replyTo, subject, text, html });
}

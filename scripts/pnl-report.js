#!/usr/bin/env node
'use strict';

// Daily P&L report generator.
//   node scripts/pnl-report.js            -> print text + JSON to stdout
//   node scripts/pnl-report.js --html     -> also print the HTML email body
// Sending is wired via SMTP once ATOMIC_SMTP_* env vars are configured (see
// sendEmail below); until then this prints the formatted report so a cron job
// can capture it and email delivery is a drop-in.

let getPnlReport;
try {
  ({ getPnlReport } = require('../dist/src/analytics/pnl'));
} catch (e) {
  console.error('Build the project first (npm run build): ' + e.message);
  process.exit(1);
}

function money(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function periodLine(p) {
  const assets = p.byAsset.length
    ? p.byAsset.map((a) => `${a.feeNative} ${a.symbol}${a.priceBasis === 'reference' ? '*' : ''}`).join(', ')
    : '—';
  return `${p.label.padEnd(13)} ${money(p.realizedUsd).padStart(14)}   (${p.conversions} conversions)  ${assets}`;
}

function toText(r) {
  const d = new Date(r.generatedAt);
  return [
    `Atomic Payments — Daily P&L`,
    `${d.toUTCString()}  (periods in ${r.timezone})`,
    ``,
    `Revenue = ${r.revenueDefinition}`,
    ``,
    periodLine(r.periods.today),
    periodLine(r.periods.week),
    periodLine(r.periods.month),
    periodLine(r.periods.ytd),
    ``,
    r.usdDisclaimer ? `* indicative price — ${r.usdDisclaimer}` : '',
    r.usdDisclaimer ? '' : ''
  ].join('\n');
}

function toHtml(r) {
  const row = (p) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #1c2c3a;color:#8fa8bc;">${p.label}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #1c2c3a;color:#edf7ff;font-weight:600;text-align:right;font-variant-numeric:tabular-nums;">${money(p.realizedUsd)}${p.usdEstimated ? ' <span style="color:#f0a54a;">*</span>' : ''}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #1c2c3a;color:#8fa8bc;text-align:right;">${p.conversions}</td>
    </tr>`;
  return `
  <div style="font-family:Inter,Segoe UI,sans-serif;background:#07111b;padding:24px;color:#edf7ff;">
    <h2 style="margin:0 0 4px;">Atomic Payments — Daily P&amp;L</h2>
    <p style="margin:0 0 18px;color:#8fa8bc;font-size:13px;">${new Date(r.generatedAt).toUTCString()} · periods in ${r.timezone}</p>
    <table style="width:100%;max-width:520px;border-collapse:collapse;background:#0b1824;border:1px solid #1c2c3a;border-radius:12px;overflow:hidden;">
      <thead><tr>
        <th style="text-align:left;padding:10px 14px;color:#8fa8bc;font-size:11px;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #1c2c3a;">Period</th>
        <th style="text-align:right;padding:10px 14px;color:#8fa8bc;font-size:11px;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #1c2c3a;">Revenue</th>
        <th style="text-align:right;padding:10px 14px;color:#8fa8bc;font-size:11px;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #1c2c3a;">Conversions</th>
      </tr></thead>
      <tbody>${row(r.periods.today)}${row(r.periods.week)}${row(r.periods.month)}${row(r.periods.ytd)}</tbody>
    </table>
    <p style="margin:16px 0 0;color:#607890;font-size:12px;">Revenue = ${r.revenueDefinition}</p>
    ${r.usdDisclaimer ? `<p style="margin:6px 0 0;color:#f0a54a;font-size:12px;">* ${r.usdDisclaimer}</p>` : ''}
  </div>`;
}

async function main() {
  const report = await getPnlReport();
  const subject = `Atomic Daily P&L — ${money(report.periods.today.realizedUsd)} today · ${money(report.periods.ytd.realizedUsd)} YTD`;
  const text = toText(report);

  if (process.env.ATOMIC_SMTP_HOST && process.env.ATOMIC_SMTP_PASS && process.env.ATOMIC_REPORT_TO) {
    await sendEmail({ subject, text, html: toHtml(report) });
    console.log('P&L email sent to ' + process.env.ATOMIC_REPORT_TO);
  } else {
    console.log('SUBJECT: ' + subject);
    console.log(text);
    if (process.argv.includes('--html')) console.log('\n--- HTML ---\n' + toHtml(report));
    console.log('\n[email transport not configured — set ATOMIC_SMTP_* + ATOMIC_REPORT_TO to enable send]');
  }
  process.exit(0);
}

// Enabled once an SMTP transport is chosen. nodemailer is added at that point.
async function sendEmail({ subject, text, html }) {
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: process.env.ATOMIC_SMTP_HOST,
    port: Number(process.env.ATOMIC_SMTP_PORT || 587),
    secure: String(process.env.ATOMIC_SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.ATOMIC_SMTP_USER, pass: process.env.ATOMIC_SMTP_PASS }
  });
  await transport.sendMail({
    from: process.env.ATOMIC_REPORT_FROM || process.env.ATOMIC_SMTP_USER,
    to: process.env.ATOMIC_REPORT_TO,
    subject, text, html
  });
}

main().catch((e) => { console.error('P&L report failed: ' + e.message); process.exit(1); });

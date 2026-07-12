// Partner verification email. Reuses the same SMTP config the bug-report mailer
// uses (ATOMIC_SMTP_*). Returns whether an email was actually sent so the caller
// can decide NOT to lock a partner out when no mailer is configured.
export async function sendPartnerVerificationEmail(to: string, link: string): Promise<{ sent: boolean }> {
  const host = process.env.ATOMIC_SMTP_HOST;
  if (!host || !to) return { sent: false };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.ATOMIC_SMTP_PORT ?? 587),
      secure: String(process.env.ATOMIC_SMTP_SECURE ?? 'false') === 'true',
      auth: process.env.ATOMIC_SMTP_USER
        ? { user: process.env.ATOMIC_SMTP_USER, pass: process.env.ATOMIC_SMTP_PASS }
        : undefined
    });
    await transport.sendMail({
      from: process.env.ATOMIC_REPORT_FROM ?? process.env.ATOMIC_SMTP_USER ?? to,
      to,
      subject: 'Verify your Atomic partner account',
      text: [
        'Welcome to the Atomic Partner API.',
        '',
        'Confirm this email to activate your API access:',
        link,
        '',
        'This link expires in 24 hours. If you did not request a partner account, ignore this email.'
      ].join('\n'),
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#14161c">
  <h2 style="margin:0 0 8px">Verify your Atomic partner account</h2>
  <p style="color:#667085;font-size:14px">Confirm this email to activate your API access.</p>
  <p style="margin:22px 0"><a href="${link}" style="background:#6d5cf5;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600;display:inline-block">Verify email</a></p>
  <p style="color:#98a2b3;font-size:12px">Or paste this link: <br>${link}</p>
  <p style="color:#98a2b3;font-size:12px">This link expires in 24 hours. If you did not request a partner account, ignore this email.</p>
</div>`
    });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}

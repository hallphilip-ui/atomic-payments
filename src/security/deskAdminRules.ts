// Who may perform ADMIN actions on the arb desk when authenticated by Cloudflare Access.
//
// The Cloudflare Access allow-list answers "who can SEE the desk". It does NOT answer
// "who can CHANGE it". Those were the same question until this module existed: the desk
// treated any verified Access email as an admin, so everyone granted visibility could
// also retune live scanner thresholds and repoint the alert topic. That was tolerable
// while the allow-list held one person and became a real hole the moment it held two.
//
// Lives in src/security (not the router) so the rules are unit-testable without standing
// up an Express app — same pattern as operatorRules.
//
// FAIL CLOSED: an unset/empty list grants admin to NOBODY via Access. A missing config
// must never be read as "allow everyone". The operator ADMIN key is unaffected, so this
// cannot lock an owner out of their own box.

export function parseDeskAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

// Read from the environment on each call rather than caching at import time, so the
// value is testable and a config change takes effect on restart without import-order
// surprises.
export function isDeskAdminEmail(
  email: string | null | undefined,
  raw: string | undefined = process.env.ARB_DESK_ADMIN_EMAILS
): boolean {
  if (!email) return false;
  return parseDeskAdminEmails(raw).has(email.trim().toLowerCase());
}

export function deskAdminListConfigured(
  raw: string | undefined = process.env.ARB_DESK_ADMIN_EMAILS
): boolean {
  return parseDeskAdminEmails(raw).size > 0;
}

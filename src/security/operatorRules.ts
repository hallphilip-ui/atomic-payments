import crypto from 'crypto';

export function configuredOperatorKey(): string {
  return process.env.ATOMIC_OPERATOR_API_KEY?.trim() ?? '';
}

export function configuredOperatorReadOnlyKey(): string {
  return process.env.ATOMIC_OPERATOR_READONLY_API_KEY?.trim() ?? '';
}

export type OperatorRole = 'admin' | 'readonly';

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isOperatorAuthEnabled(): boolean {
  return configuredOperatorKey().length > 0 || configuredOperatorReadOnlyKey().length > 0;
}

export function requiresOperatorAuth(path: string): boolean {
  const cleanPath = path.split('?')[0];

  return (
    cleanPath.startsWith('/v1/admin') ||
    cleanPath === '/v1/metrics' ||
    cleanPath.startsWith('/v1/observability') ||
    cleanPath.startsWith('/v1/project/') ||
    cleanPath.startsWith('/v1/settlement/platform-connectors') ||
    // startsWith (not exact) so treasury-affecting sub-routes are ALSO gated — e.g.
    // POST /v1/settlement/quotes/:id/accept reserves inventory and must not be public.
    cleanPath.startsWith('/v1/settlement/quotes') ||
    cleanPath.startsWith('/v1/settlement/instructions') ||
    cleanPath.startsWith('/v1/settlement/reconciliation') ||
    cleanPath.startsWith('/v1/settlement/treasury') ||
    // Enumerable quote list dumps every user's full address + amounts — operator
    // only. The exact match keeps the client's own /v1/swaps/quotes/:id/* calls
    // (authorize, advance, events, stream) public.
    cleanPath === '/v1/swaps/quotes' ||
    // Marking a payment intent CONFIRMED is a settlement action, never something
    // an anonymous caller should do — gate the simulation/confirm endpoint.
    (cleanPath.startsWith('/v1/payment_intents/') && cleanPath.endsWith('/simulate_payment'))
  );
}

// Routes that MOVE REAL FUNDS on the operator plane. These must never fall through
// open in the "no credential configured" dev path — executing a partner payout
// signs a USDC transfer, so it requires a real credential in every environment.
export function isProtectedFundsRoute(path: string, method: string): boolean {
  const cleanPath = path.split('?')[0];
  return method.toUpperCase() === 'POST' && /^\/v1\/admin\/partners\/[^/]+\/payout$/.test(cleanPath);
}

export function validateOperatorApiKey(candidate: string | undefined): boolean {
  return validateOperatorCredential(candidate) !== null;
}

export function validateOperatorCredential(candidate: string | undefined): OperatorRole | null {
  const expected = configuredOperatorKey();
  const readOnlyExpected = configuredOperatorReadOnlyKey();

  if (!expected && !readOnlyExpected) {
    return 'admin';
  }

  if (!candidate) {
    return null;
  }

  if (expected && safeEquals(candidate, expected)) {
    return 'admin';
  }

  if (readOnlyExpected && safeEquals(candidate, readOnlyExpected)) {
    return 'readonly';
  }

  return null;
}

export function requiresOperatorWriteAccess(path: string, method: string): boolean {
  const cleanPath = path.split('?')[0];
  const normalizedMethod = method.toUpperCase();

  if (['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)) {
    return false;
  }

  if (
    normalizedMethod === 'POST' &&
    cleanPath.startsWith('/v1/settlement/platform-connectors/') &&
    cleanPath.endsWith('/withdrawals/preview')
  ) {
    return false;
  }

  return requiresOperatorAuth(path);
}

import crypto from 'crypto';

export function configuredOperatorKey(): string {
  return process.env.ATOMIC_OPERATOR_API_KEY?.trim() ?? '';
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isOperatorAuthEnabled(): boolean {
  return configuredOperatorKey().length > 0;
}

export function requiresOperatorAuth(path: string): boolean {
  const cleanPath = path.split('?')[0];

  return (
    cleanPath.startsWith('/v1/admin') ||
    cleanPath === '/v1/metrics' ||
    cleanPath === '/v1/project/progress' ||
    cleanPath === '/v1/settlement/quotes' ||
    cleanPath === '/v1/settlement/instructions' ||
    cleanPath.startsWith('/v1/settlement/treasury')
  );
}

export function validateOperatorApiKey(candidate: string | undefined): boolean {
  const expected = configuredOperatorKey();

  if (!expected) {
    return true;
  }

  if (!candidate) {
    return false;
  }

  return safeEquals(candidate, expected);
}

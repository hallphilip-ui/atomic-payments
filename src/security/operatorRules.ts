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
    cleanPath === '/v1/project/progress' ||
    cleanPath.startsWith('/v1/settlement/platform-connectors') ||
    cleanPath === '/v1/settlement/quotes' ||
    cleanPath === '/v1/settlement/instructions' ||
    cleanPath.startsWith('/v1/settlement/treasury')
  );
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

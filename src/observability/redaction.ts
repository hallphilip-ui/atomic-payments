const SENSITIVE_QUERY_KEYS = new Set([
  'api_key',
  'apikey',
  'authorization',
  'client_secret',
  'code',
  'key',
  'password',
  'secret',
  'signature',
  'token',
  'webhook_secret'
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-\s]/g, '_');
  return SENSITIVE_QUERY_KEYS.has(normalized) || normalized.endsWith('_token') || normalized.endsWith('_secret');
}

export function sanitizeRequestPath(rawPath: string): string {
  if (!rawPath) return '';

  try {
    const url = new URL(rawPath, 'http://atomic.local');

    if (!url.search) {
      return url.pathname;
    }

    const sanitizedParams = new URLSearchParams();
    url.searchParams.forEach((value, key) => {
      sanitizedParams.append(key, isSensitiveKey(key) ? '[REDACTED]' : value);
    });

    const query = sanitizedParams.toString();
    return query ? `${url.pathname}?${query}` : url.pathname;
  } catch (_error) {
    return rawPath.split('?')[0];
  }
}

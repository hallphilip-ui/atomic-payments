import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();
  const requestId = headerValue(req.headers['x-atomic-request-id']) || crypto.randomUUID();

  res.locals.requestId = requestId;
  res.setHeader('x-atomic-request-id', requestId);

  res.on('finish', () => {
    const log = {
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      event: 'http_request',
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      userAgent: headerValue(req.headers['user-agent']),
      remoteAddress: req.ip
    };

    console.log(JSON.stringify(log));
  });

  next();
}

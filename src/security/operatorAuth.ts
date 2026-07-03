import type { Request, Response, NextFunction } from 'express';
import { isOperatorAuthEnabled, requiresOperatorAuth, requiresOperatorWriteAccess, validateOperatorCredential } from './operatorRules';

const OPERATOR_HEADER = 'x-atomic-operator-key';

export function operatorAuth(req: Request, res: Response, next: NextFunction) {
  if (!requiresOperatorAuth(req.originalUrl || '') || !isOperatorAuthEnabled()) {
    return next();
  }

  const header = req.headers[OPERATOR_HEADER];
  const candidate = Array.isArray(header) ? header[0] : header;

  const role = validateOperatorCredential(candidate);

  if (!role) {
    return res.status(401).json({
      error: 'Operator authorization required.',
      requiredHeader: OPERATOR_HEADER
    });
  }

  if (role === 'readonly' && requiresOperatorWriteAccess(req.originalUrl || '', req.method || 'GET')) {
    return res.status(403).json({
      error: 'Operator write access required.',
      requiredRole: 'admin'
    });
  }

  res.locals.operatorRole = role;
  return next();
}

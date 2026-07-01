import type { Request, Response, NextFunction } from 'express';
import { isOperatorAuthEnabled, requiresOperatorAuth, validateOperatorApiKey } from './operatorRules';

const OPERATOR_HEADER = 'x-atomic-operator-key';

export function operatorAuth(req: Request, res: Response, next: NextFunction) {
  if (!requiresOperatorAuth(req.originalUrl || '') || !isOperatorAuthEnabled()) {
    return next();
  }

  const header = req.headers[OPERATOR_HEADER];
  const candidate = Array.isArray(header) ? header[0] : header;

  if (!validateOperatorApiKey(candidate)) {
    return res.status(401).json({
      error: 'Operator authorization required.',
      requiredHeader: OPERATOR_HEADER
    });
  }

  return next();
}

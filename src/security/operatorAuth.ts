import type { Request, Response, NextFunction } from 'express';
import { isOperatorAuthEnabled, isProtectedFundsRoute, requiresOperatorAuth, requiresOperatorWriteAccess, validateOperatorCredential } from './operatorRules';
import { extractBearer, isKeycloakEnabled, verifyKeycloakOperator } from './keycloakVerifier';

const OPERATOR_HEADER = 'x-atomic-operator-key';

// The operator/admin plane accepts a Keycloak OIDC access token (preferred) OR the
// legacy static operator key (fallback during migration). The end-user swap/wallet
// flow is unaffected — it stays wallet-native and never hits this middleware's
// protected prefixes. If NEITHER mechanism is configured, protected routes fall
// through open (dev only) — configure at least one in any real deployment.
export async function operatorAuth(req: Request, res: Response, next: NextFunction) {
  try {
    if (!requiresOperatorAuth(req.originalUrl || '')) {
      return next();
    }
    if (!isOperatorAuthEnabled() && !isKeycloakEnabled()) {
      // Dev convenience: unprotected routes fall open when NO auth is configured —
      // but a funds-moving route (payout) must never be reachable without a real
      // credential, even by misconfiguration. Fail closed instead of open.
      if (isProtectedFundsRoute(req.originalUrl || '', req.method || 'GET')) {
        return res.status(503).json({ error: 'Operator authentication must be configured before executing payouts.' });
      }
      // In production the WHOLE operator plane fails closed — a missing/typo'd
      // operator key must not silently expose admin/treasury/settlement. Local dev
      // keeps the fall-open convenience (ATOMIC_DEPLOY_ENV unset).
      if (process.env.ATOMIC_DEPLOY_ENV === 'production') {
        return res.status(503).json({ error: 'Operator authentication is not configured on this deployment.' });
      }
      return next();
    }

    let role = null as Awaited<ReturnType<typeof verifyKeycloakOperator>>;

    // 1. Keycloak bearer token (once the realm/client/roles are wired up).
    const bearer = extractBearer(req.headers.authorization);
    if (bearer && isKeycloakEnabled()) {
      role = await verifyKeycloakOperator(bearer);
    }

    // 2. Fall back to the static operator key.
    if (!role && isOperatorAuthEnabled()) {
      const header = req.headers[OPERATOR_HEADER];
      const candidate = Array.isArray(header) ? header[0] : header;
      role = validateOperatorCredential(candidate);
    }

    if (!role) {
      return res.status(401).json({
        error: 'Operator authorization required.',
        accepts: ['Authorization: Bearer <keycloak-access-token>', `${OPERATOR_HEADER}: <key>`]
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
  } catch {
    return res.status(500).json({ error: 'Operator authorization error.' });
  }
}

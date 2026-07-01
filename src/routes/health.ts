import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { getProviderModeLabel } from '../cryptoCore/providerAdapters';

const prisma = new PrismaClient();
const router = Router();

function complianceProviderMode(): string {
  const mode = process.env.ATOMIC_COMPLIANCE_PROVIDER_MODE;
  if (mode === 'live' || mode === 'live_with_fallback') return mode;
  return 'simulation';
}

router.get('/v1/health', async (_req, res) => {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({
      status: 'ok',
      service: 'atomic-payments',
      requestId: res.locals.requestId,
      database: 'ready',
      providerMode: getProviderModeLabel(),
      complianceProviderMode: complianceProviderMode(),
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - startedAt
    });
  } catch (error: any) {
    return res.status(503).json({
      status: 'degraded',
      service: 'atomic-payments',
      requestId: res.locals.requestId,
      database: 'unavailable',
      providerMode: getProviderModeLabel(),
      complianceProviderMode: complianceProviderMode(),
      error: error.message,
      latencyMs: Date.now() - startedAt
    });
  }
});

export default router;

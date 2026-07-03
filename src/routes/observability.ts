import { Router } from 'express';
import { getProductionObservabilityReadiness } from '../observability/productionObservability';

const router = Router();

router.get('/v1/observability/readiness', (_req, res) => {
  return res.json(getProductionObservabilityReadiness());
});

export default router;

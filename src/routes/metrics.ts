import { Router } from 'express';
import { getMetricsSnapshot } from '../observability/metricsStore';

const router = Router();

router.get('/v1/metrics', (_req, res) => {
  return res.json(getMetricsSnapshot());
});

export default router;

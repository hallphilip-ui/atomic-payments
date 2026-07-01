import { Router } from 'express';
import { getProjectProgress } from '../project/progress';

const router = Router();

router.get('/v1/project/progress', (_req, res) => {
  return res.json(getProjectProgress());
});

export default router;

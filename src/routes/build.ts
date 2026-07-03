import { Router } from 'express';
import { getBuildInfo } from '../project/buildInfo';

const router = Router();

router.get('/v1/build', (_req, res) => {
  return res.json({ build: getBuildInfo() });
});

export default router;

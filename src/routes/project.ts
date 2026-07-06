import { Router } from 'express';
import { getLaunchEvidenceBundle } from '../project/launchEvidence';
import { getLaunchReadiness } from '../project/launchReadiness';
import { getProjectProgress } from '../project/progress';

const router = Router();

router.get('/v1/project/progress', (_req, res) => {
  return res.json(getProjectProgress());
});

router.get('/v1/project/launch-readiness', (_req, res) => {
  return res.json(getLaunchReadiness());
});

router.get('/v1/project/launch-evidence', (_req, res) => {
  return res.json(getLaunchEvidenceBundle());
});

export default router;

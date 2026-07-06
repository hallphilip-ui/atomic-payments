import { Router } from 'express';
import { getPnlReport } from '../analytics/pnl';

const router = Router();

// Operator-protected (path under /v1/admin is gated by operatorAuth when configured).
router.get('/v1/admin/pnl', async (req, res) => {
  try {
    const timezone = req.query.timezone ? String(req.query.timezone) : undefined;
    return res.json(await getPnlReport({ timezone }));
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

export default router;

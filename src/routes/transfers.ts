import { Router } from 'express';
import { listTransfers } from '../cryptoCore/swapStore';

const router = Router();

// Public transfers/conversions explorer feed (Across-style). Read-only.
router.get('/v1/transfers', async (req, res) => {
  try {
    const status = String(req.query.status ?? 'all');
    const page = Number.parseInt(String(req.query.page ?? '0'), 10);
    const pageSize = Number.parseInt(String(req.query.pageSize ?? '20'), 10);

    return res.json(
      await listTransfers({
        statusGroup: status,
        page: Number.isFinite(page) ? page : 0,
        pageSize: Number.isFinite(pageSize) ? pageSize : 20
      })
    );
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

export default router;

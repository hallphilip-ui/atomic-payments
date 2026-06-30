import express from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import intentRoutes from './routes/intents';
import userRoutes from './routes/users';
import adminRoutes from './routes/admin';
import settlementRoutes from './routes/settlement';
import swapRoutes from './routes/swaps';

const app = express();
app.use(express.json());

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.use((req: Request, res: Response, next?: () => void) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-atomic-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  return next?.();
});

app.use(intentRoutes);
app.use(userRoutes);
app.use(adminRoutes);
app.use(settlementRoutes);
app.use(swapRoutes);

app.listen(3005, () => console.log('🚀 Atomic Admin Engine Live'));

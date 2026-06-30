import express from 'express';
import rateLimit from 'express-rate-limit';
import intentRoutes from './routes/intents';
import userRoutes from './routes/users';
import adminRoutes from './routes/admin';
import settlementRoutes from './routes/settlement';
import swapRoutes from './routes/swaps';

const app = express();
app.use(express.json());

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.use(intentRoutes);
app.use(userRoutes);
app.use(adminRoutes);
app.use(settlementRoutes);
app.use(swapRoutes);

app.listen(3005, () => console.log('🚀 Atomic Admin Engine Live'));

import express from 'express';
import dotenv from 'dotenv';
import intentRoutes from './routes/intents';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'Atomic Payments API is active' });
});

app.use(intentRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Atomic Payments engine running on http://localhost:${PORT}`);
});

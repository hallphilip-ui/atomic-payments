import express from 'express';
import intentRoutes from './routes/intents';
import userRoutes from './routes/users';

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-atomic-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(intentRoutes);
app.use(userRoutes);

const PORT = 3005;
app.listen(PORT, () => {
  console.log(`🚀 Atomic Engine running smoothly on http://localhost:3005`);
});

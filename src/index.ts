import express from 'express';
import intentRoutes from './routes/intents';

const app = express();
app.use(express.json());

// 🛡️ Native CORS Middleware to allow browser interface connections
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-atomic-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(intentRoutes);

const PORT = 3005;
app.listen(PORT, () => {
  console.log(`🚀 Atomic Payments engine running on http://localhost:3005`);
});

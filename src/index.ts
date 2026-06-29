import express from 'express';
import rateLimit from 'express-rate-limit';
import intentRoutes from './routes/intents';
import userRoutes from './routes/users';

const app = express();
app.use(express.json());

// DDoS Prevention Limiter: Max 100 requests every 15 minutes per unique IP
const securityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: { error: "Too many service requests from this IP. Gateway backoff active." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(securityLimiter);

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
  console.log(`🚀 Atomic Production-Hardened Engine active on port 3005`);
});

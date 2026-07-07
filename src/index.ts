import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import intentRoutes from './routes/intents';
import userRoutes from './routes/users';
import adminRoutes from './routes/admin';
import settlementRoutes from './routes/settlement';
import swapRoutes from './routes/swaps';
import transferRoutes from './routes/transfers';
import analyticsRoutes from './routes/analytics';
import healthRoutes from './routes/health';
import metricsRoutes from './routes/metrics';
import projectRoutes from './routes/project';
import buildRoutes from './routes/build';
import observabilityRoutes from './routes/observability';
import { requestLogger } from './observability/requestLogger';
import { operatorAuth } from './security/operatorAuth';

const app = express();
const port = Number(process.env.PORT ?? 3005);
app.use(express.json());
app.use(requestLogger);

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.use((req: Request, res: Response, next?: () => void) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-atomic-key, x-atomic-request-id, x-atomic-operator-key');
  res.header('Access-Control-Expose-Headers', 'x-atomic-request-id');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  return next?.();
});

app.use(operatorAuth);

app.use(intentRoutes);
app.use(userRoutes);
app.use(adminRoutes);
app.use(settlementRoutes);
app.use(swapRoutes);
app.use(transferRoutes);
app.use(analyticsRoutes);
app.use(healthRoutes);
app.use(metricsRoutes);
app.use(projectRoutes);
app.use(buildRoutes);
app.use(observabilityRoutes);

app.get('/', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/defi-swap', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'defi-swap.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/checkout', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'checkout.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/admin-compliance', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'admin-compliance.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/transfers', (_req: Request, res: Response) => {
  const html = readFileSync(join(process.cwd(), 'transfers.html'), 'utf8');
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.header('Cache-Control', 'no-cache, must-revalidate');
  return res.send(html);
});

app.use('/assets/atomic-logo.png', (_req: Request, res: Response) => {
  const logo = readFileSync(join(process.cwd(), 'public', 'atomic-logo.png'));
  res.header('Content-Type', 'image/png');
  return res.send(logo);
});

app.use('/assets/atomic-mark.png', (_req: Request, res: Response) => {
  const logo = readFileSync(join(process.cwd(), 'public', 'atomic-mark.png'));
  res.header('Content-Type', 'image/png');
  return res.send(logo);
});

app.use('/favicon.ico', (_req: Request, res: Response) => {
  const logo = readFileSync(join(process.cwd(), 'public', 'atomic-mark.png'));
  res.header('Content-Type', 'image/png');
  return res.send(logo);
});

app.use('/assets/i18n.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'i18n.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  return res.send(script);
});

app.use('/assets/widget.js', (_req: Request, res: Response) => {
  const script = readFileSync(join(process.cwd(), 'public', 'widget.js'), 'utf8');
  res.header('Content-Type', 'application/javascript; charset=utf-8');
  return res.send(script);
});

app.listen(port, () => console.log(`🚀 Atomic Admin Engine Live on ${port}`));

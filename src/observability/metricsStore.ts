export type HttpRequestMetric = {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
};

type RouteMetric = {
  count: number;
  errorCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

const startedAt = new Date();
const routeMetrics = new Map<string, RouteMetric>();
let requestCount = 0;
let errorCount = 0;
let totalDurationMs = 0;
let maxDurationMs = 0;

function routeKey(metric: HttpRequestMetric): string {
  return `${metric.method} ${metric.path.split('?')[0]}`;
}

export function recordHttpRequest(metric: HttpRequestMetric) {
  requestCount += 1;
  totalDurationMs += metric.durationMs;
  maxDurationMs = Math.max(maxDurationMs, metric.durationMs);
  if (metric.statusCode >= 500) errorCount += 1;

  const key = routeKey(metric);
  const existing = routeMetrics.get(key) ?? {
    count: 0,
    errorCount: 0,
    totalDurationMs: 0,
    maxDurationMs: 0
  };

  existing.count += 1;
  existing.totalDurationMs += metric.durationMs;
  existing.maxDurationMs = Math.max(existing.maxDurationMs, metric.durationMs);
  if (metric.statusCode >= 500) existing.errorCount += 1;
  routeMetrics.set(key, existing);
}

export function getMetricsSnapshot() {
  const routes = Array.from(routeMetrics.entries())
    .map(([route, metric]) => ({
      route,
      count: metric.count,
      errorCount: metric.errorCount,
      avgDurationMs: metric.count ? Number((metric.totalDurationMs / metric.count).toFixed(2)) : 0,
      maxDurationMs: metric.maxDurationMs
    }))
    .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route));

  return {
    service: 'atomic-payments',
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    requestCount,
    errorCount,
    avgDurationMs: requestCount ? Number((totalDurationMs / requestCount).toFixed(2)) : 0,
    maxDurationMs,
    routes
  };
}

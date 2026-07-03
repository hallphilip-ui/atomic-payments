export type ObservabilityLinkStatus = 'configured' | 'missing';

export type ObservabilityLink = {
  id: string;
  label: string;
  envVar: string;
  value: string | null;
  status: ObservabilityLinkStatus;
};

function configuredLink(id: string, label: string, envVar: string): ObservabilityLink {
  const value = process.env[envVar]?.trim() || null;
  return {
    id,
    label,
    envVar,
    value,
    status: value ? 'configured' : 'missing'
  };
}

export function getProductionObservabilityReadiness() {
  const links = [
    configuredLink('log-drain', 'Structured log drain', 'ATOMIC_LOG_DRAIN_URL'),
    configuredLink('metrics-dashboard', 'Metrics dashboard', 'ATOMIC_METRICS_DASHBOARD_URL'),
    configuredLink('alert-policy', 'Alert policy', 'ATOMIC_ALERT_POLICY_URL'),
    configuredLink('incident-runbook', 'Incident runbook', 'ATOMIC_INCIDENT_RUNBOOK_URL')
  ];
  const missing = links.filter((link) => link.status === 'missing');

  return {
    service: 'atomic-payments',
    status: missing.length === 0 ? 'ready' : 'blocked',
    configuredCount: links.length - missing.length,
    missingCount: missing.length,
    links,
    requiredSignals: [
      'http_request_count',
      'http_5xx_error_count',
      'route_latency_p95',
      'provider_fallback_count',
      'compliance_manual_review_count',
      'wallet_broadcast_failure_count'
    ],
    alertTriggers: [
      'health_check_degraded',
      'five_xx_error_rate_spike',
      'provider_fallback_rate_spike',
      'compliance_block_rate_spike',
      'wallet_broadcast_failure',
      'settlement_reconciliation_break'
    ]
  };
}

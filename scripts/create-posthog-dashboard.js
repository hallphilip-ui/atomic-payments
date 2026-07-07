#!/usr/bin/env node
/**
 * Creates a "Bugs & Support" dashboard in PostHog from user-reported bug events.
 * Reads the personal API key from POSTHOG_PERSONAL_API_KEY (env only — never a CLI arg).
 * Usage: set -a; . ~/.atomic-posthog.env; set +a; node scripts/create-posthog-dashboard.js
 */
const HOST = (process.env.POSTHOG_HOST || 'https://us.posthog.com').replace(/\/$/, '');
const KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const PROJECT_NAME = process.env.POSTHOG_PROJECT_NAME || 'atomic pay';

if (!KEY) {
  console.error('Missing POSTHOG_PERSONAL_API_KEY in the environment.');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(HOST + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json.detail || json.error || json.raw || text || `HTTP ${res.status}`;
    throw new Error(`${method} ${path} -> ${res.status}: ${msg}`);
  }
  return json;
}

// Trends insight (line chart or bold number) for a single event.
function trends({ name, event, breakdown, display }) {
  const source = {
    kind: 'TrendsQuery',
    series: [{ kind: 'EventsNode', event, name: event, math: 'total' }],
    interval: 'day',
    dateRange: { date_from: '-30d' },
    trendsFilter: { display: display || 'ActionsLineGraph' }
  };
  if (breakdown) source.breakdownFilter = { breakdowns: [{ property: breakdown, type: 'event' }] };
  return { name, query: { kind: 'InsightVizNode', source } };
}

// A table of the most recent report events with their key properties.
function recentTable() {
  return {
    name: 'Recent bug reports',
    query: {
      kind: 'DataTableNode',
      source: {
        kind: 'EventsQuery',
        select: [
          'timestamp',
          "properties.reference -- Ref",
          "properties.category -- Type",
          "properties.title -- Summary",
          "properties.page -- Page",
          'person'
        ],
        event: 'bug_reported',
        after: '-30d',
        orderBy: ['timestamp DESC']
      },
      showExport: true
    }
  };
}

(async () => {
  console.log(`Host: ${HOST}`);

  // 1. Discover the project.
  console.log('Discovering project…');
  const projects = await api('GET', '/api/projects/');
  const list = projects.results || [];
  if (!list.length) throw new Error('No projects visible to this key (check scope).');
  const project =
    list.find((p) => (p.name || '').toLowerCase() === PROJECT_NAME.toLowerCase()) || list[0];
  console.log(`Using project: "${project.name}" (id ${project.id})` +
    (project.name.toLowerCase() === PROJECT_NAME.toLowerCase() ? '' : `  [!] "${PROJECT_NAME}" not found, using first`));
  const pid = project.id;

  // 2. Create the dashboard.
  console.log('Creating dashboard…');
  const dashboard = await api('POST', `/api/projects/${pid}/dashboards/`, {
    name: 'Bugs & Support',
    description: 'User-reported bugs and support activity from atomicpay.cloud (event: bug_reported / support_opened).'
  });
  console.log(`Dashboard created (id ${dashboard.id}).`);

  // 3. Create insights attached to the dashboard.
  const insights = [
    trends({ name: 'Bug reports over time — by type', event: 'bug_reported', breakdown: 'category' }),
    trends({ name: 'Total bug reports (30d)', event: 'bug_reported', display: 'BoldNumber' }),
    trends({ name: 'Support link opens over time', event: 'support_opened' }),
    recentTable()
  ];

  for (const ins of insights) {
    try {
      await api('POST', `/api/projects/${pid}/insights/`, { ...ins, dashboards: [dashboard.id] });
      console.log(`  + ${ins.name}`);
    } catch (e) {
      console.log(`  ! skipped "${ins.name}": ${e.message}`);
    }
  }

  const url = `${HOST}/project/${pid}/dashboard/${dashboard.id}`;
  console.log('\nDone. Open your dashboard:\n' + url);
})().catch((e) => {
  console.error('\nFailed: ' + e.message);
  if (/401|403|permission|scope|authenticat/i.test(e.message)) {
    console.error('The key looks unauthorized or missing write scope. In PostHog: ' +
      'Settings → Personal API keys → ensure Insight + Dashboard write scopes (or use an all-access key).');
  }
  process.exit(1);
});

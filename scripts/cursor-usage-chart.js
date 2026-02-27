#!/usr/bin/env node
/**
 * Reads Cursor team usage CSV and generates a self-contained HTML chart.
 * Usage: node scripts/cursor-usage-chart.js <path-to-csv>
 * Output: <same-dir-as-csv>/cursor-usage-dashboard.html
 */

const fs = require('fs');
const path = require('path');

const csvPath =
  process.argv[2] ||
  path.join(process.env.HOME || '', 'Downloads/team-usage-events-11857157-2026-02-27.csv');
const csv = fs.readFileSync(csvPath, 'utf8');
const outPath = path.join(path.dirname(csvPath), 'cursor-usage-dashboard.html');

function parseCSV(text) {
  const rows = [];
  let current = [];
  let inQuotes = false;
  let field = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) {
      field += c;
      continue;
    }
    if (c === ',' || c === '\n') {
      current.push(field.trim());
      field = '';
      if (c === '\n') {
        if (current.some(cell => cell.length > 0)) rows.push(current);
        current = [];
      }
      continue;
    }
    field += c;
  }
  if (field.length > 0 || current.length > 0) {
    current.push(field.trim());
    if (current.some(cell => cell.length > 0)) rows.push(current);
  }
  return rows;
}

const raw = parseCSV(csv);
const header = raw[0];
const rows = raw.slice(1);
const col = name => header.indexOf(name);
const dateCol = col('Date');
const userCol = col('User');
const kindCol = col('Kind');
const totalCol = col('Total Tokens');
const reqCol = col('Requests');

const parseNum = v => {
  if (v === '' || v === '-' || v == null) return 0;
  const n = parseInt(v.replace(/,/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
};

const toDay = dateStr => dateStr.slice(0, 10);

// By day: requests, total tokens (only charged rows)
const byDay = {};
const byUser = {};
const byKind = {};

for (const row of rows) {
  const dateStr = row[dateCol] || '';
  const day = toDay(dateStr);
  const user = row[userCol] || 'Unknown';
  const kind = row[kindCol] || '';
  const total = parseNum(row[totalCol]);
  const req = parseNum(row[reqCol]) || (total >= 0 ? 1 : 0);

  if (!byDay[day]) byDay[day] = { requests: 0, tokens: 0 };
  byDay[day].requests += req;
  if (total > 0) byDay[day].tokens += total;

  if (!byUser[user]) byUser[user] = { requests: 0, tokens: 0 };
  byUser[user].requests += req;
  if (total > 0) byUser[user].tokens += total;

  if (!byKind[kind]) byKind[kind] = 0;
  byKind[kind] += req || 1;
}

const days = Object.keys(byDay).sort();
const requestsByDay = days.map(d => byDay[d].requests);
const tokensByDay = days.map(d => byDay[d].tokens);

const users = Object.keys(byUser).sort((a, b) => byUser[b].requests - byUser[a].requests);
const userLabels = users.map(u => u.replace(/@.*/, '@…'));
const requestsByUser = users.map(u => byUser[u].requests);
const tokensByUser = users.map(u => byUser[u].tokens);

const kindLabels = Object.keys(byKind);
const kindCounts = kindLabels.map(k => byKind[k]);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cursor Team Usage Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #0f1419;
      --card: #1a2332;
      --text: #e6edf3;
      --muted: #8b949e;
      --accent: #58a6ff;
      --accent2: #3fb950;
      --accent3: #d29922;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 24px;
      min-height: 100vh;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin: 0 0 8px 0;
      color: var(--text);
    }
    .sub {
      color: var(--muted);
      font-size: 0.875rem;
      margin-bottom: 24px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
      gap: 24px;
      max-width: 1400px;
    }
    .card {
      background: var(--card);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .card h2 {
      font-size: 0.9375rem;
      font-weight: 600;
      margin: 0 0 16px 0;
      color: var(--muted);
    }
    .chart-wrap { position: relative; height: 280px; }
    .summary {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
      margin-bottom: 24px;
    }
    .summary .stat {
      background: var(--card);
      border-radius: 10px;
      padding: 16px 20px;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .summary .stat .value { font-size: 1.5rem; font-weight: 700; color: var(--accent); }
    .summary .stat .label { font-size: 0.8125rem; color: var(--muted); margin-top: 4px; }
  </style>
</head>
<body>
  <h1>Cursor Team Usage</h1>
  <p class="sub">${days[0] || '—'} to ${days[days.length - 1] || '—'} · ${rows.length} events</p>
  <div class="summary">
    <div class="stat">
      <div class="value">${days.reduce((s, d) => s + byDay[d].requests, 0).toLocaleString()}</div>
      <div class="label">Total requests</div>
    </div>
    <div class="stat">
      <div class="value">${(days.reduce((s, d) => s + byDay[d].tokens, 0) / 1_000_000).toFixed(2)}M</div>
      <div class="label">Total tokens</div>
    </div>
    <div class="stat">
      <div class="value">${users.length}</div>
      <div class="label">Users</div>
    </div>
  </div>
  <div class="grid">
    <div class="card">
      <h2>Requests by day</h2>
      <div class="chart-wrap"><canvas id="chartDay"></canvas></div>
    </div>
    <div class="card">
      <h2>Tokens by day</h2>
      <div class="chart-wrap"><canvas id="chartTokens"></canvas></div>
    </div>
    <div class="card">
      <h2>Requests by user</h2>
      <div class="chart-wrap"><canvas id="chartUser"></canvas></div>
    </div>
    <div class="card">
      <h2>By kind</h2>
      <div class="chart-wrap"><canvas id="chartKind"></canvas></div>
    </div>
  </div>
  <script>
    const font = { family: '-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif', size: 11 };
    Chart.defaults.color = '#8b949e';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
    Chart.defaults.font = font;

    new Chart(document.getElementById('chartDay'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(days)},
        datasets: [{ label: 'Requests', data: ${JSON.stringify(requestsByDay)}, backgroundColor: 'rgba(88, 166, 255, 0.6)', borderColor: '#58a6ff', borderWidth: 1 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });

    new Chart(document.getElementById('chartTokens'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(days)},
        datasets: [{ label: 'Total tokens', data: ${JSON.stringify(tokensByDay)}, borderColor: '#3fb950', backgroundColor: 'rgba(63, 185, 80, 0.1)', fill: true, tension: 0.2 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });

    new Chart(document.getElementById('chartUser'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(userLabels)},
        datasets: [{ label: 'Requests', data: ${JSON.stringify(requestsByUser)}, backgroundColor: 'rgba(210, 153, 34, 0.6)', borderColor: '#d29922', borderWidth: 1 }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } }
      }
    });

    new Chart(document.getElementById('chartKind'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(kindLabels)},
        datasets: [{ data: ${JSON.stringify(kindCounts)}, backgroundColor: ['#3fb950', '#58a6ff', '#d29922', '#a371f7'], borderWidth: 0 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right' } }
      }
    });
  </script>
</body>
</html>
`;

fs.writeFileSync(outPath, html, 'utf8');
console.log('Wrote:', outPath);

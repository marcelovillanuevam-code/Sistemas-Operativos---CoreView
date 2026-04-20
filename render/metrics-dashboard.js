// metrics-dashboard.js — DOM renderer for dual metrics tables: Thread Metrics + Process Metrics (join-barrier).
// Accepts an array of SchedulingTrace; renders the first trace's metrics for the scheduling screen.

/**
 * @param {HTMLElement} container
 * @param {import('../types.js').SchedulingTrace[]} traces
 */
export function renderMetricsDashboard(container, traces) {
  container.innerHTML = '';
  if (!traces || traces.length === 0) return;

  const trace = traces[0];
  const { threadMetrics, processMetrics, aggregateMetrics, algorithm } = trace;

  const labelMap = _buildLabelMap(threadMetrics);

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const aggEl = document.createElement('div');
  aggEl.className = 'metrics-agg';
  const agg = aggregateMetrics;
  const aggItems = [
    ['CPU Utilization', `${agg.cpuUtilization.toFixed(1)}%`],
    ['Context Switches', String(agg.totalContextSwitches)],
    ['Throughput', `${agg.throughput.toFixed(3)} /tick`],
    ['Avg TAT',    `${agg.avgTurnaroundTime.toFixed(2)}`],
    ['Avg WT',     `${agg.avgWaitingTime.toFixed(2)}`],
    ['Avg RT',     `${agg.avgResponseTime.toFixed(2)}`],
  ];
  for (const [label, val] of aggItems) {
    const item = document.createElement('div');
    item.className = 'metrics-agg-item';
    item.innerHTML = `<span class="metrics-agg-label">${label}</span><span class="metrics-agg-value">${val}</span>`;
    aggEl.appendChild(item);
  }
  container.appendChild(aggEl);

  // ── Thread Metrics table ──────────────────────────────────────────────────
  const threadTitle = document.createElement('div');
  threadTitle.className = 'metrics-table-title';
  threadTitle.textContent = 'Thread Metrics';
  container.appendChild(threadTitle);

  const tHeaders = ['Label', 'TID', 'PID', 'CT', 'TAT', 'WT', 'RT'];
  const tRows = threadMetrics.map(m => [
    labelMap.get(m.tid) || `T${m.tid}`,
    String(m.tid),
    String(m.pid),
    _f(m.completionTime),
    _f(m.turnaroundTime),
    _f(m.waitingTime),
    _f(m.responseTime),
  ]);
  // Averages row
  const n = threadMetrics.length;
  tRows.push(['Average', '—', '—',
    _f(agg.avgCompletionTime),
    _f(agg.avgTurnaroundTime),
    _f(agg.avgWaitingTime),
    _f(agg.avgResponseTime),
  ]);
  container.appendChild(_makeTable(tHeaders, tRows, tRows.length - 1));

  // ── Process Metrics table (join-barrier) ──────────────────────────────────
  const procTitle = document.createElement('div');
  procTitle.className = 'metrics-table-title';
  procTitle.textContent = 'Process Metrics (join-barrier)';
  container.appendChild(procTitle);

  const pHeaders = ['PID', 'CT', 'TAT', 'WT', 'RT'];
  const pRows = processMetrics.map(m => [
    `P${m.pid}`,
    _f(m.completionTime),
    _f(m.turnaroundTime),
    _f(m.waitingTime),
    _f(m.responseTime),
  ]);

  const pm = processMetrics;
  const pn = pm.length;
  pRows.push(['Average',
    _f(pm.reduce((s, m) => s + m.completionTime, 0) / pn),
    _f(pm.reduce((s, m) => s + m.turnaroundTime, 0) / pn),
    _f(pm.reduce((s, m) => s + m.waitingTime,    0) / pn),
    _f(pm.reduce((s, m) => s + m.responseTime,   0) / pn),
  ]);
  container.appendChild(_makeTable(pHeaders, pRows, pRows.length - 1));
}

function _buildLabelMap(threadMetrics) {
  const byPid = new Map();
  for (const m of threadMetrics) {
    if (!byPid.has(m.pid)) byPid.set(m.pid, []);
    byPid.get(m.pid).push(m.tid);
  }
  for (const tids of byPid.values()) tids.sort((a, b) => a - b);

  const map = new Map();
  for (const [pid, tids] of byPid) {
    if (tids.length === 1) {
      map.set(tids[0], `P${pid}`);
    } else {
      tids.forEach((tid, i) => map.set(tid, `P${pid}-T${i + 1}`));
    }
  }
  return map;
}

function _f(n) {
  return typeof n === 'number' ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : '—';
}

function _makeTable(headers, rows, avgRowIndex) {
  const table = document.createElement('table');
  table.className = 'metrics-tbl';

  const thead = table.createTHead();
  const hr = thead.insertRow();
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  }

  const tbody = table.createTBody();
  rows.forEach((row, i) => {
    const tr = tbody.insertRow();
    if (i === avgRowIndex) tr.className = 'metrics-avg-row';
    for (const cell of row) {
      const td = tr.insertCell();
      td.textContent = cell;
    }
  });

  return table;
}

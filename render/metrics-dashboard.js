// metrics-dashboard.js — DOM renderer for dual metrics tables: Thread Metrics + Process Metrics (join-barrier).

/**
 * @param {HTMLElement} container
 * @param {import('../types.js').SchedulingTrace[]} traces
 */
export function renderMetricsDashboard(container, traces) {
  container.innerHTML = '';
  if (!traces || traces.length === 0) return;

  const trace = traces[0];
  const { threadMetrics, processMetrics, aggregateMetrics } = trace;
  const labelMap = _buildLabelMap(threadMetrics);
  const agg = aggregateMetrics;

  // ── Aggregate metric cards (label, value, unit, hint) ────────────────────
  const aggEl = document.createElement('div');
  aggEl.className = 'metrics-agg';

  const aggItems = [
    { label: 'Utilización CPU',     val: agg.cpuUtilization.toFixed(1),   unit: '%',     hint: 'Porcentaje del tiempo en que la CPU estuvo ocupada (no inactiva).' },
    { label: 'Cambios de contexto', val: String(agg.totalContextSwitches), unit: '',      hint: 'Número total de veces que la CPU pasó de un thread a otro.' },
    { label: 'Throughput',          val: agg.throughput.toFixed(3),        unit: '/tick', hint: 'Threads completados por unidad de tiempo.' },
    { label: 'TAT promedio',        val: agg.avgTurnaroundTime.toFixed(2), unit: 'ticks', hint: 'Turnaround Time promedio: tiempo en el sistema (CT − Arrival).' },
    { label: 'WT promedio',         val: agg.avgWaitingTime.toFixed(2),    unit: 'ticks', hint: 'Waiting Time promedio: tiempo en cola de listos (TAT − Burst).' },
    { label: 'RT promedio',         val: agg.avgResponseTime.toFixed(2),   unit: 'ticks', hint: 'Response Time promedio: tiempo hasta primera CPU (FirstRun − Arrival).' },
  ];

  for (const { label, val, unit, hint } of aggItems) {
    const item = document.createElement('div');
    item.className = 'metrics-agg-item';
    item.title = hint;
    item.innerHTML =
      `<span class="metrics-agg-label">${label}</span>` +
      `<span class="metrics-agg-value">${val}` +
      (unit ? `<span class="metrics-agg-unit"> ${unit}</span>` : '') +
      `</span>`;
    aggEl.appendChild(item);
  }
  container.appendChild(aggEl);

  // ── Thread Metrics table ──────────────────────────────────────────────────
  const threadTitle = document.createElement('div');
  threadTitle.className = 'metrics-table-title';
  threadTitle.textContent = 'Métricas por thread';
  container.appendChild(threadTitle);

  const tHeaders = [
    { key: 'Etiqueta', hint: 'Identificador visible (P{pid} o P{pid}-T{n}).' },
    { key: 'TID',      hint: 'Thread ID global (único en toda la simulación).' },
    { key: 'PID',      hint: 'Process ID al que pertenece el thread.' },
    { key: 'CT',       hint: 'Completion Time — instante de finalización.' },
    { key: 'TAT',      hint: 'Turnaround Time = CT − Arrival.' },
    { key: 'WT',       hint: 'Waiting Time = TAT − Burst.' },
    { key: 'RT',       hint: 'Response Time = FirstRun − Arrival.' },
  ];
  const tRows = threadMetrics.map(m => [
    labelMap.get(m.tid) || `T${m.tid}`,
    String(m.tid),
    String(m.pid),
    _f(m.completionTime),
    _f(m.turnaroundTime),
    _f(m.waitingTime),
    _f(m.responseTime),
  ]);
  tRows.push(['Promedio', '—', '—',
    _f(agg.avgCompletionTime),
    _f(agg.avgTurnaroundTime),
    _f(agg.avgWaitingTime),
    _f(agg.avgResponseTime),
  ]);
  container.appendChild(_makeTable(tHeaders, tRows, tRows.length - 1));

  // ── Process Metrics table (join-barrier) ──────────────────────────────────
  const procTitle = document.createElement('div');
  procTitle.className = 'metrics-table-title';
  procTitle.textContent = 'Métricas por proceso (join-barrier)';
  procTitle.title = 'El proceso termina cuando termina su último thread.';
  container.appendChild(procTitle);

  const pHeaders = [
    { key: 'PID', hint: 'Process ID.' },
    { key: 'CT',  hint: 'Tiempo de finalización (último thread del proceso).' },
    { key: 'TAT', hint: 'CT − Arrival del proceso.' },
    { key: 'WT',  hint: 'TAT − suma de bursts de los threads.' },
    { key: 'RT',  hint: 'Min(thread.firstRunTime) − arrival del proceso.' },
  ];
  const pRows = processMetrics.map(m => [
    `P${m.pid}`,
    _f(m.completionTime),
    _f(m.turnaroundTime),
    _f(m.waitingTime),
    _f(m.responseTime),
  ]);
  const pn = processMetrics.length || 1;
  pRows.push(['Promedio',
    _f(processMetrics.reduce((s, m) => s + m.completionTime, 0) / pn),
    _f(processMetrics.reduce((s, m) => s + m.turnaroundTime, 0) / pn),
    _f(processMetrics.reduce((s, m) => s + m.waitingTime,    0) / pn),
    _f(processMetrics.reduce((s, m) => s + m.responseTime,   0) / pn),
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
    if (typeof h === 'string') {
      th.textContent = h;
    } else {
      th.textContent = h.key;
      if (h.hint) th.title = h.hint;
    }
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

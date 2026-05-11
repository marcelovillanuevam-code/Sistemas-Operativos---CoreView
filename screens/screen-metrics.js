// screen-metrics.js — Metrics screen glue. Dual metrics tables + Canvas bar charts + page faults.

import { AppState }             from '../app.js';
import { renderMetricsDashboard } from '../render/metrics-dashboard.js';
import { navigateTo }            from '../render/ui-feedback.js';

const BAR_COLORS = { TAT: '#5b9cf6', WT: '#f07b5e', RT: '#6abf85' };

export function initMetricsScreen() {
  document.querySelector('[data-tab="metrics"]')?.addEventListener('click', _render);
}

function _render() {
  const noData  = document.getElementById('metrics-no-data');
  const content = document.getElementById('metrics-content');

  if (!AppState.schedulingTrace) {
    noData.style.display  = '';
    content.style.display = 'none';
    // Make the link inside no-data clickable
    if (!noData.dataset.linked) {
      noData.dataset.linked = '1';
      noData.querySelector('strong')?.addEventListener('click', () => navigateTo('scheduling'));
      noData.querySelector('strong')?.style?.setProperty('cursor', 'pointer');
    }
    return;
  }

  noData.style.display  = 'none';
  content.style.display = '';

  _renderRunSummary(AppState.schedulingTrace);

  const dashContainer = document.getElementById('metrics-dashboard');
  renderMetricsDashboard(dashContainer, [AppState.schedulingTrace]);

  _renderBarCharts(AppState.schedulingTrace);
  _renderThreadChartInsight(AppState.schedulingTrace);
  _renderPageFaults();
}

function _renderRunSummary(trace) {
  const el = document.getElementById('metrics-run-summary');
  if (!el) return;

  const metrics = trace?.aggregateMetrics;
  const processCount = trace?.processMetrics?.length || 0;
  const threadCount = trace?.threadMetrics?.length || 0;

  el.innerHTML =
    `<div class="metrics-run-main">` +
      `<span class="metrics-run-kicker">Scheduling run</span>` +
      `<span class="metrics-run-algorithm">${_algorithmLabel(trace)}</span>` +
    `</div>` +
    `<div class="metrics-run-meta">` +
      `<span>${processCount} procesos</span>` +
      `<span>${threadCount} threads</span>` +
      `<span>CPU ${metrics ? metrics.cpuUtilization.toFixed(1) : '0.0'}%</span>` +
    `</div>`;
}

function _algorithmLabel(trace) {
  const algorithm = trace?.algorithm || trace?.config?.algorithm || AppState.currentAlgorithm || 'Unknown';
  const labels = {
    FCFS: 'FCFS',
    SJF: 'SJF',
    HRRN: 'HRRN',
    RR: 'Round Robin',
    SRTF: 'SRTF',
    PRIORITY_PREEMPTIVE: 'Priority Preemptive',
    MLQ: 'Multilevel Queue',
    MLFQ: 'Multilevel Feedback Queue',
  };

  const base = labels[algorithm] || algorithm;
  const quantum = trace?.config?.quantum;
  return algorithm === 'RR' && Number.isFinite(quantum)
    ? `${base} (q=${quantum})`
    : base;
}

function _renderBarCharts(trace) {
  const canvas = document.getElementById('metrics-bar-chart');
  if (!canvas) return;

  const metrics = trace.threadMetrics;
  if (!metrics || metrics.length === 0) return;

  const byPid = new Map();
  for (const m of metrics) {
    if (!byPid.has(m.pid)) byPid.set(m.pid, []);
    byPid.get(m.pid).push(m.tid);
  }
  for (const tids of byPid.values()) tids.sort((a, b) => a - b);
  const labelMap = new Map();
  for (const [pid, tids] of byPid) {
    if (tids.length === 1) {
      labelMap.set(tids[0], `P${pid}`);
    } else {
      tids.forEach((tid, i) => labelMap.set(tid, `P${pid}-T${i + 1}`));
    }
  }

  const labels = metrics.map(m => labelMap.get(m.tid) || `T${m.tid}`);
  const tats   = metrics.map(m => m.turnaroundTime);
  const wts    = metrics.map(m => m.waitingTime);
  const rts    = metrics.map(m => m.responseTime);

  const W = canvas.width = canvas.parentElement.clientWidth || 680;
  const H = canvas.height = 240;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, W, H);

  const ML = 56, MR = 16, MT = 26, MB = 52;
  const cW = W - ML - MR;
  const cH = H - MT - MB;

  const n = labels.length;
  const groupW = cW / n;
  const barW   = (groupW * 0.72 - 4) / 3;
  const barGap = 2;

  const maxVal = Math.max(...tats, ...wts, ...rts, 1) * 1.1;

  ctx.save();
  ctx.strokeStyle = '#21262d';
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v  = (maxVal * i) / 4;
    const y  = MT + cH - (cH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(ML, y);
    ctx.lineTo(ML + cW, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(v < 1 ? 1 : 0), ML - 6, y + 3);
  }
  ctx.restore();

  const series = [
    { values: tats, color: BAR_COLORS.TAT, label: 'TAT' },
    { values: wts,  color: BAR_COLORS.WT,  label: 'WT' },
    { values: rts,  color: BAR_COLORS.RT,  label: 'RT' },
  ];

  for (let gi = 0; gi < n; gi++) {
    const gCenterX = ML + gi * groupW + groupW / 2;
    const barsStartX = gCenterX - (3 * barW + 2 * barGap) / 2;

    for (let si = 0; si < series.length; si++) {
      const v   = series[si].values[gi];
      const bH  = (v / maxVal) * cH;
      const bx  = barsStartX + si * (barW + barGap);
      const by  = MT + cH - bH;

      ctx.fillStyle = series[si].color;
      ctx.fillRect(bx, by, barW, bH);
    }

    ctx.save();
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[gi], gCenterX, MT + cH + 16);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ML, MT);
  ctx.lineTo(ML, MT + cH);
  ctx.lineTo(ML + cW, MT + cH);
  ctx.stroke();
  ctx.restore();

  const legendItems = [
    { label: 'TAT (Turnaround)', color: BAR_COLORS.TAT },
    { label: 'WT (Waiting)',     color: BAR_COLORS.WT  },
    { label: 'RT (Response)',    color: BAR_COLORS.RT  },
  ];
  let lx = ML;
  ctx.font = '10px system-ui, sans-serif';
  for (const item of legendItems) {
    ctx.fillStyle = item.color;
    ctx.fillRect(lx, 8, 10, 10);
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, lx + 14, 17);
    lx += 130;
  }
}

function _renderThreadChartInsight(trace) {
  const el = document.getElementById('metrics-bar-insight');
  if (!el) return;

  const metrics = trace?.threadMetrics || [];
  if (!metrics.length) {
    el.textContent = '';
    return;
  }

  const labelMap = _buildThreadLabelMap(metrics);
  const highestTat = _maxMetric(metrics, 'turnaroundTime');
  const highestWt = _maxMetric(metrics, 'waitingTime');
  const highestRt = _maxMetric(metrics, 'responseTime');
  const avgTat = _avg(metrics, 'turnaroundTime');
  const avgWt = _avg(metrics, 'waitingTime');
  const avgRt = _avg(metrics, 'responseTime');

  const parts = [
    `Promedios: TAT ${avgTat.toFixed(2)}, WT ${avgWt.toFixed(2)}, RT ${avgRt.toFixed(2)} ticks.`,
    `${labelMap.get(highestTat.tid) || `T${highestTat.tid}`} tiene el TAT más alto (${_fmt(highestTat.turnaroundTime)}).`,
  ];

  if (highestWt.waitingTime > 0) {
    parts.push(`${labelMap.get(highestWt.tid) || `T${highestWt.tid}`} esperó más tiempo en ready queue (${_fmt(highestWt.waitingTime)}).`);
  } else {
    parts.push('WT es 0 para todos: ningún thread esperó en ready queue.');
  }

  if (highestRt.responseTime > 0) {
    parts.push(`${labelMap.get(highestRt.tid) || `T${highestRt.tid}`} tardó más en recibir CPU por primera vez (${_fmt(highestRt.responseTime)}).`);
  }

  el.textContent = parts.join(' ');
}

function _renderPageFaults() {
  const el = document.getElementById('metrics-paging-info');
  if (!el) return;
  el.innerHTML = '';

  const pt = AppState.pageReplacementTrace;
  if (!pt) {
    el.textContent = 'Ejecuta un algoritmo de page replacement para ver page faults.';
    el.style.color = '#6e7681';
    el.style.fontStyle = 'italic';
    return;
  }

  el.style.color = '';
  el.style.fontStyle = '';

  const stats = [
    ['Algoritmo', pt.algorithm],
    ['Page faults', String(pt.totalFaults)],
    ['Hits', String(pt.totalHits)],
    ['Hit rate', `${(pt.hitRate * 100).toFixed(1)}%`],
    ['Reference string length', String(pt.referenceString.length)],
  ];

  const guide = document.createElement('div');
  guide.className = 'metrics-paging-guide chart-guide';
  guide.innerHTML =
    `<span class="chart-guide-item">Page fault = la page no estaba cargada</span>` +
    `<span class="chart-guide-item">Hit = la page ya estaba en un frame</span>` +
    `<span class="chart-guide-item chart-guide-item--note">Menos faults y más hit rate son mejores para esta reference string.</span>`;
  el.appendChild(guide);

  const insight = document.createElement('div');
  insight.className = 'chart-insight metrics-paging-insight';
  insight.textContent = _pageReplacementInsight(pt);
  el.appendChild(insight);

  const list = document.createElement('div');
  list.className = 'metrics-paging-stats';
  for (const [k, v] of stats) {
    const row = document.createElement('div');
    row.className = 'metrics-paging-stat-row';
    row.innerHTML = `<span class="metrics-paging-stat-key">${k}</span><span class="metrics-paging-stat-val">${v}</span>`;
    list.appendChild(row);
  }
  el.appendChild(list);
}

function _pageReplacementInsight(trace) {
  const total = trace.referenceString.length || 1;
  const faultRate = trace.totalFaults / total;
  if (trace.totalHits === 0) {
    return `La corrida tuvo 0 hits: cada referencia provocó page fault o no hubo reutilización útil dentro de los frames disponibles.`;
  }
  if (faultRate <= 0.25) {
    return `Buen comportamiento: la mayoría de referencias fueron hits, así que las pages se reutilizaron bien en memoria.`;
  }
  if (faultRate >= 0.75) {
    return `Alta presión de memoria: muchas referencias terminaron en page fault, revisa frames o reference string.`;
  }
  return `Resultado intermedio: hubo reutilización de pages, pero todavía una parte importante de referencias causó page fault.`;
}

function _buildThreadLabelMap(metrics) {
  const byPid = new Map();
  for (const m of metrics) {
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

function _maxMetric(metrics, key) {
  return metrics.reduce((best, item) => (item[key] > best[key] ? item : best), metrics[0]);
}

function _avg(metrics, key) {
  return metrics.reduce((sum, item) => sum + (item[key] || 0), 0) / metrics.length;
}

function _fmt(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

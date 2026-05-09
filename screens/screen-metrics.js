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

  const dashContainer = document.getElementById('metrics-dashboard');
  renderMetricsDashboard(dashContainer, [AppState.schedulingTrace]);

  _renderBarCharts(AppState.schedulingTrace);
  _renderPageFaults();
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

function _renderPageFaults() {
  const el = document.getElementById('metrics-paging-info');
  if (!el) return;
  el.innerHTML = '';

  const pt = AppState.pageReplacementTrace;
  if (!pt) {
    el.textContent = 'Ejecuta un algoritmo de reemplazo en la pestaña Paginación para ver fallos de página.';
    el.style.color = '#6e7681';
    el.style.fontStyle = 'italic';
    return;
  }

  el.style.color = '';
  el.style.fontStyle = '';

  const stats = [
    ['Algoritmo', pt.algorithm],
    ['Total de fallos', String(pt.totalFaults)],
    ['Total de aciertos', String(pt.totalHits)],
    ['Tasa de aciertos', `${(pt.hitRate * 100).toFixed(1)}%`],
    ['Longitud de la cadena', String(pt.referenceString.length)],
  ];

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

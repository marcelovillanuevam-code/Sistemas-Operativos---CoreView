// comparison-chart.js — Canvas 2D grouped bar chart for algorithm comparison.

import { token } from './color-utils.js';

const ALGO_LABELS = {
  FCFS: 'FCFS', SJF: 'SJF', HRRN: 'HRRN', RR: 'RR(q=2)',
  SRTF: 'SRTF', PRIORITY_PREEMPTIVE: 'PRIO', MLQ: 'MLQ', MLFQ: 'MLFQ',
};

const PAGE_ALGO_LABELS = {
  FIFO: 'FIFO', LRU: 'LRU', OPTIMAL: 'OPT', CLOCK: 'CLOCK', SECOND_CHANCE: '2nd',
};

// Metric colors: analogous hues shifted from accent (#3B82F6 = hsl(217, 91%, 60%))
// TAT: accent, WT: accent+60°, RT: accent+120°
function _metricColors() {
  return [
    token('--accent'),                // TAT: blue
    'hsl(277, 65%, 55%)',             // WT: violet
    'hsl(157, 65%, 55%)',             // RT: teal-green
  ];
}

const METRIC_NAMES = ['Avg TAT', 'Avg WT', 'Avg RT'];
const METRIC_KEYS  = ['avgTurnaroundTime', 'avgWaitingTime', 'avgResponseTime'];

// Page algo bar colors: same hue-spread approach
function _pageColors(n) {
  return Array.from({ length: n }, (_, i) => `hsl(${(217 + i * 67) % 360}, 65%, 55%)`);
}

const MARGIN = { top: 36, right: 20, bottom: 76, left: 56 };

function _clear(ctx) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = token('--bg-surface');
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function _yAxis(ctx, maxVal, chartX, chartY, chartH, chartW) {
  const ticks = 5;
  const cSubtle  = token('--border-subtle');
  const cTertiary = token('--text-tertiary');
  const fontMono  = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`;

  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = `400 11px ${fontMono}`;
  ctx.textAlign = 'right';
  for (let i = 0; i <= ticks; i++) {
    const v = (maxVal * i) / ticks;
    const y = chartY + chartH - (chartH * i) / ticks;

    // Dotted gridline
    ctx.strokeStyle = cSubtle;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(chartX, y);
    ctx.lineTo(chartX + chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = cTertiary;
    ctx.fillText(v.toFixed(v < 1 ? 1 : 0), chartX - 6, y + 4);
  }
  ctx.restore();
}

function _xLabel(ctx, label, cx, bottomY, rotated) {
  const cTertiary = token('--text-tertiary');
  const fontMono  = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`;
  ctx.save();
  ctx.fillStyle = cTertiary;
  ctx.font = `400 11px ${fontMono}`;
  ctx.textAlign = 'center';
  if (rotated) {
    ctx.translate(cx, bottomY + 6);
    ctx.rotate(-Math.PI / 5);
    ctx.fillText(label, 0, 0);
  } else {
    ctx.fillText(label, cx, bottomY + 14);
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} comparisons
 */
export function renderSchedulingComparisonChart(ctx, comparisons) {
  _clear(ctx);

  const cTertiary = token('--text-tertiary');
  const cBorder   = token('--border-default');
  const cReady    = token('--state-ready');
  const fontMono  = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`;
  const METRIC_COLORS = _metricColors();

  if (!comparisons || comparisons.length === 0) {
    ctx.fillStyle = cTertiary;
    ctx.font = `400 14px ${fontMono}`;
    ctx.textAlign = 'center';
    ctx.fillText('No data', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const cX = MARGIN.left, cY = MARGIN.top;
  const cW = W - MARGIN.left - MARGIN.right;
  const cH = H - MARGIN.top - MARGIN.bottom;

  const best = METRIC_KEYS.map(k => Math.min(...comparisons.map(c => c.metrics[k] ?? Infinity)));
  let maxVal = 0;
  for (const c of comparisons) {
    for (const k of METRIC_KEYS) {
      if ((c.metrics[k] ?? 0) > maxVal) maxVal = c.metrics[k];
    }
  }
  if (maxVal === 0) maxVal = 1;
  maxVal *= 1.1;

  _yAxis(ctx, maxVal, cX, cY, cH, cW);

  const n = comparisons.length;
  const groupW = cW / n;
  const nBars = 3;
  const barGap = groupW * 0.04;
  const barW = (groupW * 0.78 - barGap * (nBars - 1)) / nBars;

  for (let gi = 0; gi < n; gi++) {
    const c = comparisons[gi];
    const groupCenterX = cX + gi * groupW + groupW / 2;
    const barsStartX = groupCenterX - (nBars * barW + (nBars - 1) * barGap) / 2;

    for (let bi = 0; bi < nBars; bi++) {
      const v = c.metrics[METRIC_KEYS[bi]] ?? 0;
      const barH = (v / maxVal) * cH;
      const bx = barsStartX + bi * (barW + barGap);
      const by = cY + cH - barH;
      const isBest = v === best[bi] && v > 0;

      ctx.fillStyle = METRIC_COLORS[bi];
      ctx.fillRect(bx, by, barW, barH);

      if (isBest) {
        ctx.fillStyle = cReady;
        ctx.font = `600 11px ${fontMono}`;
        ctx.textAlign = 'center';
        ctx.fillText('★', bx + barW / 2, by - 3);
      }

      if (barH > 18) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.font = `400 9px ${fontMono}`;
        ctx.textAlign = 'center';
        ctx.fillText(v.toFixed(1), bx + barW / 2, by + barH - 4);
        ctx.restore();
      }
    }

    _xLabel(ctx, ALGO_LABELS[c.algorithm] || c.algorithm, groupCenterX, cY + cH, n > 6);
  }

  // Axis lines
  ctx.save();
  ctx.strokeStyle = cBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cX, cY);
  ctx.lineTo(cX, cY + cH);
  ctx.lineTo(cX + cW, cY + cH);
  ctx.stroke();
  ctx.restore();

  _drawLegend(ctx, METRIC_NAMES, METRIC_COLORS, W, H, fontMono);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} comparisons
 */
export function renderPageReplacementComparisonChart(ctx, comparisons) {
  _clear(ctx);

  const cTertiary = token('--text-tertiary');
  const cBorder   = token('--border-default');
  const cReady    = token('--state-ready');
  const fontMono  = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`;

  if (!comparisons || comparisons.length === 0) {
    ctx.fillStyle = cTertiary;
    ctx.font = `400 14px ${fontMono}`;
    ctx.textAlign = 'center';
    ctx.fillText('No data', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  const PAGE_COLORS = _pageColors(comparisons.length);
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const cX = MARGIN.left, cY = MARGIN.top;
  const cW = W - MARGIN.left - MARGIN.right;
  const cH = H - MARGIN.top - MARGIN.bottom;

  let maxFaults = Math.max(...comparisons.map(c => c.totalFaults), 1);
  maxFaults = Math.ceil(maxFaults * 1.15);
  const minFaults = Math.min(...comparisons.map(c => c.totalFaults));

  _yAxis(ctx, maxFaults, cX, cY, cH, cW);

  const n = comparisons.length;
  const groupW = cW / n;
  const barW = groupW * 0.55;

  for (let i = 0; i < n; i++) {
    const c = comparisons[i];
    const barcx = cX + i * groupW + groupW / 2;
    const bx = barcx - barW / 2;
    const barH = (c.totalFaults / maxFaults) * cH;
    const by = cY + cH - barH;
    const isBest = c.totalFaults === minFaults;

    ctx.fillStyle = PAGE_COLORS[i % PAGE_COLORS.length];
    ctx.fillRect(bx, by, barW, barH);

    if (isBest) {
      ctx.fillStyle = cReady;
      ctx.font = `600 11px ${fontMono}`;
      ctx.textAlign = 'center';
      ctx.fillText('★', barcx, by - 3);
    }

    if (barH > 18) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.font = `500 12px ${fontMono}`;
      ctx.textAlign = 'center';
      ctx.fillText(c.totalFaults, barcx, by + barH - 5);
    }

    _xLabel(ctx, PAGE_ALGO_LABELS[c.algorithm] || c.algorithm, barcx, cY + cH, false);

    ctx.save();
    ctx.fillStyle = cTertiary;
    ctx.font = `400 10px ${fontMono}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${(c.hitRate * 100).toFixed(0)}% hit`, barcx, cY + cH + 30);
    ctx.restore();
  }

  // Axis lines
  ctx.save();
  ctx.strokeStyle = cBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cX, cY);
  ctx.lineTo(cX, cY + cH);
  ctx.lineTo(cX + cW, cY + cH);
  ctx.stroke();
  ctx.restore();

  // Y axis label
  ctx.save();
  ctx.fillStyle = cTertiary;
  ctx.font = `400 11px ${fontMono}`;
  ctx.textAlign = 'center';
  ctx.translate(14, cY + cH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Total Faults', 0, 0);
  ctx.restore();
}

function _drawLegend(ctx, names, colors, W, H, fontMono) {
  const legendY = H - 18;
  const itemW   = 100;
  const totalW  = names.length * itemW;
  let lx = (W - totalW) / 2;
  const cTertiary = token('--text-tertiary');

  ctx.save();
  ctx.font = `400 11px ${fontMono}`;
  for (let i = 0; i < names.length; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(lx, legendY - 8, 10, 10);
    ctx.fillStyle = cTertiary;
    ctx.textAlign = 'left';
    ctx.fillText(names[i], lx + 14, legendY);
    lx += itemW;
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../types.js').ComparisonResult} comparison
 * @param {string} metric  'scheduling' | 'paging'
 */
export function renderComparisonChart(ctx, comparison, metric) {
  if (metric === 'paging') {
    renderPageReplacementComparisonChart(ctx, comparison.pageReplacementComparisons);
  } else {
    renderSchedulingComparisonChart(ctx, comparison.schedulingComparisons);
  }
}

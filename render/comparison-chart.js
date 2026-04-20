// comparison-chart.js — Canvas 2D grouped bar chart for algorithm comparison. Static (no animation).
// Labels use 'Avg Thread TAT' convention per Risk 7.

const ALGO_LABELS = {
  FCFS: 'FCFS', SJF: 'SJF', HRRN: 'HRRN', RR: 'RR(q=2)',
  SRTF: 'SRTF', PRIORITY_PREEMPTIVE: 'PRIO', MLQ: 'MLQ', MLFQ: 'MLFQ',
};

const PAGE_ALGO_LABELS = {
  FIFO: 'FIFO', LRU: 'LRU', OPTIMAL: 'OPT', CLOCK: 'CLOCK', SECOND_CHANCE: '2nd Chance',
};

// TAT = blue, WT = coral, RT = green
const METRIC_COLORS = ['#5b9cf6', '#f07b5e', '#6abf85'];
const METRIC_NAMES  = ['Avg Thread TAT', 'Avg Thread WT', 'Avg Thread RT'];
const METRIC_KEYS   = ['avgTurnaroundTime', 'avgWaitingTime', 'avgResponseTime'];

const PAGE_COLORS = ['#5b9cf6', '#f07b5e', '#6abf85', '#f5c842', '#a78bf5'];

const MARGIN = { top: 36, right: 20, bottom: 76, left: 56 };

function _clear(ctx) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function _yAxis(ctx, maxVal, chartX, chartY, chartH, chartW) {
  const ticks = 5;
  ctx.save();
  ctx.strokeStyle = '#21262d';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#8b949e';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= ticks; i++) {
    const v = (maxVal * i) / ticks;
    const y = chartY + chartH - (chartH * i) / ticks;
    ctx.beginPath();
    ctx.moveTo(chartX, y);
    ctx.lineTo(chartX + chartW, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(v < 1 ? 1 : 0), chartX - 6, y + 4);
  }
  ctx.restore();
}

function _xLabel(ctx, label, cx, bottomY, rotated) {
  ctx.save();
  ctx.fillStyle = '#8b949e';
  ctx.font = '11px system-ui, sans-serif';
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
 * Draws the scheduling grouped bar chart (3 bars per algorithm group).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} comparisons  schedulingComparisons array
 */
export function renderSchedulingComparisonChart(ctx, comparisons) {
  _clear(ctx);
  if (!comparisons || comparisons.length === 0) {
    ctx.fillStyle = '#8b949e';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const cX = MARGIN.left;
  const cY = MARGIN.top;
  const cW = W - MARGIN.left - MARGIN.right;
  const cH = H - MARGIN.top - MARGIN.bottom;

  // Find best (min) per metric
  const best = METRIC_KEYS.map(k => Math.min(...comparisons.map(c => c.metrics[k] ?? Infinity)));

  // Compute max value across all metrics for consistent Y scale
  let maxVal = 0;
  for (const c of comparisons) {
    for (const k of METRIC_KEYS) {
      if ((c.metrics[k] ?? 0) > maxVal) maxVal = c.metrics[k];
    }
  }
  if (maxVal === 0) maxVal = 1;
  // Add 10% headroom
  maxVal *= 1.1;

  _yAxis(ctx, maxVal, cX, cY, cH, cW);

  const n = comparisons.length;
  const groupW = cW / n;
  const nBars = 3;
  const barGap = groupW * 0.04;
  const barW = (groupW * 0.8 - barGap * (nBars - 1)) / nBars;

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
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx - 1, by - 1, barW + 2, barH + 2);
        ctx.restore();
        // Star marker above bar
        ctx.fillStyle = '#e3b341';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('★', bx + barW / 2, by - 3);
      }

      // Value label inside bar (only if tall enough)
      if (barH > 18) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(v.toFixed(1), bx + barW / 2, by + barH - 4);
        ctx.restore();
      }
    }

    _xLabel(ctx, ALGO_LABELS[c.algorithm] || c.algorithm, groupCenterX, cY + cH, n > 6);
  }

  // Axis lines
  ctx.save();
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cX, cY);
  ctx.lineTo(cX, cY + cH);
  ctx.lineTo(cX + cW, cY + cH);
  ctx.stroke();
  ctx.restore();

  // Legend
  _drawLegend(ctx, METRIC_NAMES, METRIC_COLORS, W, H);
}

/**
 * Draws the page replacement bar chart (1 bar per algorithm).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} comparisons  pageReplacementComparisons array
 */
export function renderPageReplacementComparisonChart(ctx, comparisons) {
  _clear(ctx);
  if (!comparisons || comparisons.length === 0) {
    ctx.fillStyle = '#8b949e';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const cX = MARGIN.left;
  const cY = MARGIN.top;
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
    const cx = cX + i * groupW + groupW / 2;
    const bx = cx - barW / 2;
    const barH = (c.totalFaults / maxFaults) * cH;
    const by = cY + cH - barH;
    const isBest = c.totalFaults === minFaults;

    ctx.fillStyle = PAGE_COLORS[i % PAGE_COLORS.length];
    ctx.fillRect(bx, by, barW, barH);

    if (isBest) {
      ctx.save();
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx - 1, by - 1, barW + 2, barH + 2);
      ctx.restore();
      ctx.fillStyle = '#222';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★', cx, by - 3);
    }

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    if (barH > 18) ctx.fillText(c.totalFaults, cx, by + barH - 5);

    _xLabel(ctx, PAGE_ALGO_LABELS[c.algorithm] || c.algorithm, cx, cY + cH, false);

    // Hit rate below label
    ctx.save();
    ctx.fillStyle = '#888';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${(c.hitRate * 100).toFixed(0)}% hit`, cx, cY + cH + 28);
    ctx.restore();
  }

  // Axis
  ctx.save();
  ctx.strokeStyle = '#bbb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cX, cY);
  ctx.lineTo(cX, cY + cH);
  ctx.lineTo(cX + cW, cY + cH);
  ctx.stroke();
  ctx.restore();

  // Y axis label
  ctx.save();
  ctx.fillStyle = '#8b949e';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.translate(14, cY + cH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Total Faults', 0, 0);
  ctx.restore();
}

function _drawLegend(ctx, names, colors, W, H) {
  const legendY = H - 18;
  const itemW = 110;
  const totalW = names.length * itemW;
  let lx = (W - totalW) / 2;

  ctx.save();
  ctx.font = '11px system-ui, sans-serif';
  for (let i = 0; i < names.length; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(lx, legendY - 8, 12, 10);
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'left';
    ctx.fillText(names[i], lx + 16, legendY);
    lx += itemW;
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../types.js').ComparisonResult} comparison
 * @param {string} metric  'scheduling' | 'paging'
 * @param {'bar'|'grouped'} chartType
 */
export function renderComparisonChart(ctx, comparison, metric, chartType) {
  if (metric === 'paging') {
    renderPageReplacementComparisonChart(ctx, comparison.pageReplacementComparisons);
  } else {
    renderSchedulingComparisonChart(ctx, comparison.schedulingComparisons);
  }
}

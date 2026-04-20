// gantt.js — Canvas 2D Gantt chart renderer. Consumes SchedulingTrace, renders progressively by step.
// Shows SchedulableEntity labels, context switch lines, time markers, current-time indicator.

const COLOR_PALETTE = [
  '#5b9cf6', // blue
  '#f07b5e', // coral
  '#6abf85', // green
  '#f5c842', // yellow
  '#a78bf5', // purple
  '#ef5d52', // red
  '#4db8c8', // teal
  '#e8879b', // pink
];

const MARGIN = { top: 36, right: 24, bottom: 36, left: 48 };

/**
 * Build a tid → label map by inferring single vs multi-threaded per pid.
 */
function buildLabelMap(trace) {
  const byPid = new Map();
  for (const tm of trace.threadMetrics) {
    if (!byPid.has(tm.pid)) byPid.set(tm.pid, []);
    byPid.get(tm.pid).push(tm.tid);
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

/**
 * Stable tid → palette color (sorted tids → palette index modulo length).
 */
function buildColorMap(trace) {
  const tids = trace.threadMetrics.map(t => t.tid).sort((a, b) => a - b);
  const map = new Map();
  tids.forEach((tid, i) => map.set(tid, COLOR_PALETTE[i % COLOR_PALETTE.length]));
  return map;
}

/**
 * Collapse consecutive same-tid timeline entries into [start, end) blocks.
 */
function buildBlocks(timeline) {
  const blocks = [];
  let curr = null;
  for (const entry of timeline) {
    if (entry.runningTid === null) {
      if (curr) { blocks.push(curr); curr = null; }
      continue;
    }
    if (curr && curr.tid === entry.runningTid && curr.end === entry.time) {
      curr.end = entry.time + 1;
    } else {
      if (curr) blocks.push(curr);
      curr = { tid: entry.runningTid, start: entry.time, end: entry.time + 1 };
    }
  }
  if (curr) blocks.push(curr);
  return blocks;
}

function _roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function pickTimeStep(totalTime, chartWidth) {
  const maxLabels = Math.max(2, Math.floor(chartWidth / 50));
  const raw = totalTime / maxLabels;
  const candidates = [1, 2, 5, 10, 20, 50, 100];
  for (const c of candidates) if (c >= raw) return c;
  return candidates[candidates.length - 1];
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../types.js').SchedulingTrace} trace
 * @param {number} currentStep
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
export function renderGanttChart(ctx, trace, currentStep, canvasWidth, canvasHeight) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const timeline = trace.timeline;
  if (!timeline || timeline.length === 0) return;

  const totalTime = timeline[timeline.length - 1].time + (timeline[timeline.length - 1].runningTid === null ? 0 : 1);
  const span = Math.max(1, totalTime);

  const chartX = MARGIN.left;
  const chartY = MARGIN.top;
  const chartW = canvasWidth - MARGIN.left - MARGIN.right;
  const chartH = canvasHeight - MARGIN.top - MARGIN.bottom;
  const pxPerTick = chartW / span;

  const labelMap = buildLabelMap(trace);
  const colorMap = buildColorMap(trace);
  const blocks = buildBlocks(timeline);

  // Title
  ctx.fillStyle = '#e6edf3';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`Gantt — ${trace.algorithm}`, MARGIN.left, 8);

  // Chart background
  ctx.fillStyle = '#161b22';
  ctx.fillRect(chartX, chartY, chartW, chartH);
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  ctx.strokeRect(chartX, chartY, chartW, chartH);

  const R = 3; // block corner radius

  // Blocks (with progressive reveal)
  for (const block of blocks) {
    const bx = chartX + block.start * pxPerTick;
    const bw = Math.max(1, (block.end - block.start) * pxPerTick);
    const color = colorMap.get(block.tid) || '#888';
    const label = labelMap.get(block.tid) || `TID${block.tid}`;
    const activeEnd = Math.min(block.end, currentStep);

    // Dim future
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    _roundRect(ctx, bx, chartY + 1, bw, chartH - 2, R);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Active portion
    if (activeEnd > block.start) {
      const aw = Math.max(1, (activeEnd - block.start) * pxPerTick);
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.fillStyle = color;
      _roundRect(ctx, bx, chartY + 1, aw, chartH - 2, R);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Block border
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    _roundRect(ctx, bx, chartY + 1, bw, chartH - 2, R);
    ctx.stroke();

    // Label centered
    if (bw > 20) {
      ctx.fillStyle = activeEnd > block.start ? '#fff' : 'rgba(255,255,255,0.35)';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + bw / 2, chartY + chartH / 2);
    }
  }

  // Context switch lines
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].start === blocks[i - 1].end && blocks[i].tid !== blocks[i - 1].tid) {
      const x = chartX + blocks[i].start * pxPerTick;
      ctx.beginPath();
      ctx.moveTo(x, chartY);
      ctx.lineTo(x, chartY + chartH);
      ctx.stroke();
    }
  }

  // Time axis markers
  const step = pickTimeStep(span, chartW);
  ctx.strokeStyle = '#6e7681';
  ctx.fillStyle = '#8b949e';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 1;
  for (let t = 0; t <= span; t += step) {
    const x = chartX + t * pxPerTick;
    ctx.beginPath();
    ctx.moveTo(x, chartY + chartH);
    ctx.lineTo(x, chartY + chartH + 5);
    ctx.stroke();
    ctx.fillText(String(t), x, chartY + chartH + 8);
  }
  if (span % step !== 0) {
    const x = chartX + span * pxPerTick;
    ctx.beginPath();
    ctx.moveTo(x, chartY + chartH);
    ctx.lineTo(x, chartY + chartH + 5);
    ctx.stroke();
    ctx.fillText(String(span), x, chartY + chartH + 8);
  }

  // Current time indicator
  const cx = chartX + Math.max(0, Math.min(span, currentStep)) * pxPerTick;
  ctx.strokeStyle = '#f85149';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, chartY - 4);
  ctx.lineTo(cx, chartY + chartH + 4);
  ctx.stroke();

  ctx.fillStyle = '#f85149';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`t=${currentStep}`, cx, chartY - 4);
}

// gantt.js — Canvas 2D Gantt chart renderer. Consumes SchedulingTrace, renders progressively by step.
// Colors are derived deterministically per PID (pidToColor). All palette values read from CSS tokens.

import { pidToColor, contrastTextColor, token } from './color-utils.js';

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
 * Stable tid → color via pidToColor(pid). All threads of the same PID share one hue.
 */
function buildColorMap(trace) {
  const tidToPid = new Map();
  for (const tm of trace.threadMetrics) tidToPid.set(tm.tid, tm.pid);
  const map = new Map();
  for (const [tid, pid] of tidToPid) map.set(tid, pidToColor(pid));
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

  const labelMap  = buildLabelMap(trace);
  const colorMap  = buildColorMap(trace);
  const blocks    = buildBlocks(timeline);

  // Read CSS tokens
  const cBg        = token('--bg-surface');
  const cBorder    = token('--border-default');
  const cSubtle    = token('--border-subtle');
  const cPrimary   = token('--text-primary');
  const cTertiary  = token('--text-tertiary');
  const cAccent    = token('--accent');
  const fontMono   = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`;

  // Chart background
  ctx.fillStyle = cBg;
  ctx.fillRect(chartX, chartY, chartW, chartH);
  ctx.strokeStyle = cBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(chartX, chartY, chartW, chartH);

  // Title
  ctx.fillStyle = cPrimary;
  ctx.font = `500 13px ${fontMono}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`Gantt — ${trace.algorithm}`, chartX, 8);

  // Vertical grid lines every tick
  const step = pickTimeStep(span, chartW);
  ctx.strokeStyle = cSubtle;
  ctx.lineWidth = 1;
  for (let t = step; t < span; t += step) {
    const gx = chartX + t * pxPerTick;
    ctx.beginPath();
    ctx.moveTo(gx, chartY);
    ctx.lineTo(gx, chartY + chartH);
    ctx.stroke();
  }

  const R = 2; // block corner radius (spec: 2px)
  const BAR_PAD = 3; // vertical padding inside row

  // Blocks (with progressive reveal)
  for (const block of blocks) {
    const bx   = chartX + block.start * pxPerTick;
    const bw   = Math.max(1, (block.end - block.start) * pxPerTick);
    const color = colorMap.get(block.tid) || '#888';
    const label = labelMap.get(block.tid) || `TID${block.tid}`;
    const activeEnd = Math.min(block.end, currentStep);

    // Dimmed future portion
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = color;
    _roundRect(ctx, bx, chartY + BAR_PAD, bw, chartH - BAR_PAD * 2, R);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Active portion
    if (activeEnd > block.start) {
      const aw = Math.max(1, (activeEnd - block.start) * pxPerTick);
      ctx.fillStyle = color;
      _roundRect(ctx, bx, chartY + BAR_PAD, aw, chartH - BAR_PAD * 2, R);
      ctx.fill();
    }

    // Block border
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    _roundRect(ctx, bx, chartY + BAR_PAD, bw, chartH - BAR_PAD * 2, R);
    ctx.stroke();

    // Label — only if wide enough, hidden when too narrow (no truncation per spec)
    const minLabelWidth = 20;
    if (bw >= minLabelWidth) {
      const textColor = activeEnd > block.start ? contrastTextColor(color) : 'rgba(255,255,255,0.3)';
      ctx.fillStyle = textColor;
      ctx.font = `500 11px ${fontMono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + bw / 2, chartY + chartH / 2);
    }
  }

  // Context switch markers
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].start === blocks[i - 1].end && blocks[i].tid !== blocks[i - 1].tid) {
      const x = chartX + blocks[i].start * pxPerTick;
      ctx.beginPath();
      ctx.moveTo(x, chartY);
      ctx.lineTo(x, chartY + chartH);
      ctx.stroke();
    }
  }

  // Time axis labels
  ctx.strokeStyle = cTertiary;
  ctx.fillStyle = cTertiary;
  ctx.font = `400 11px ${fontMono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 1;
  for (let t = 0; t <= span; t += step) {
    const x = chartX + t * pxPerTick;
    ctx.beginPath();
    ctx.moveTo(x, chartY + chartH);
    ctx.lineTo(x, chartY + chartH + 4);
    ctx.stroke();
    ctx.fillText(String(t), x, chartY + chartH + 6);
  }
  if (span % step !== 0) {
    const x = chartX + span * pxPerTick;
    ctx.beginPath();
    ctx.moveTo(x, chartY + chartH);
    ctx.lineTo(x, chartY + chartH + 4);
    ctx.stroke();
    ctx.fillText(String(span), x, chartY + chartH + 6);
  }

  // Playhead — 2px accent line + triangle marker at top
  const clampedStep = Math.max(0, Math.min(span, currentStep));
  const cx = chartX + clampedStep * pxPerTick;

  ctx.strokeStyle = cAccent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, chartY - 6);
  ctx.lineTo(cx, chartY + chartH);
  ctx.stroke();

  // Triangle (downward pointing, sits above the chart)
  const TW = 5;
  ctx.fillStyle = cAccent;
  ctx.beginPath();
  ctx.moveTo(cx, chartY);
  ctx.lineTo(cx - TW, chartY - 8);
  ctx.lineTo(cx + TW, chartY - 8);
  ctx.closePath();
  ctx.fill();
}

// thread-visuals.js — Thread-specific renderers. Up to 8 rows (system cap).

import { pidToColor, contrastTextColor, token } from './color-utils.js';

// ── Thread Gantt ─────────────────────────────────────────────────────────────

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../types.js').ThreadTrace} trace
 * @param {number} currentStep
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
export function renderThreadGantt(ctx, trace, currentStep, canvasWidth, canvasHeight) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  if (!trace || !trace.timeline || trace.timeline.length === 0) return;

  const threads = trace.threads;
  const n = threads.length;
  const MARGIN = { top: 28, right: 20, bottom: 28, left: 70 };
  const chartW = canvasWidth  - MARGIN.left - MARGIN.right;
  const chartH = canvasHeight - MARGIN.top  - MARGIN.bottom;
  const rowH   = Math.max(28, chartH / n);

  const endTime    = trace.timeline[trace.timeline.length - 1].time + 1;
  const span       = Math.max(1, endTime);
  const pxPerTick  = chartW / span;
  const currentTime = currentStep < trace.timeline.length
    ? trace.timeline[currentStep].time
    : span;

  const cBg       = token('--bg-surface');
  const cSubtle   = token('--border-subtle');
  const cBorder   = token('--border-default');
  const cPrimary  = token('--text-primary');
  const cSecondary= token('--text-secondary');
  const cTertiary = token('--text-tertiary');
  const cAccent   = token('--accent');
  const fontMono  = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`;

  // Title
  ctx.fillStyle = cPrimary;
  ctx.font = `500 13px ${fontMono}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('Thread Gantt', MARGIN.left, 6);

  for (let ri = 0; ri < n; ri++) {
    const thread = threads[ri];
    // Each thread gets a unique hue derived from its parent PID + local index
    const color  = pidToColor(trace.pid * 100 + ri);
    const y0     = MARGIN.top + ri * rowH;
    const label  = n > 1 ? `P${trace.pid}-T${ri + 1}` : `P${trace.pid}`;

    // Row background (alternating subtle)
    ctx.fillStyle = ri % 2 === 0 ? cBg : token('--bg-elevated');
    ctx.fillRect(MARGIN.left, y0, chartW, rowH);
    ctx.strokeStyle = cSubtle;
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN.left, y0, chartW, rowH);

    // Row label
    ctx.fillStyle = cSecondary;
    ctx.font = `500 11px ${fontMono}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, MARGIN.left - 6, y0 + rowH / 2);

    // Blocks for this thread
    let blockStart = null;
    for (let si = 0; si < trace.timeline.length; si++) {
      const entry = trace.timeline[si];
      const isRunning = entry.runningTid === thread.tid;
      if (isRunning && blockStart === null) blockStart = entry.time;
      if (!isRunning && blockStart !== null) {
        _drawGanttBlock(ctx, blockStart, entry.time, y0, rowH, pxPerTick, MARGIN.left, color, currentTime, fontMono, label);
        blockStart = null;
      }
    }
    if (blockStart !== null) {
      _drawGanttBlock(ctx, blockStart, endTime, y0, rowH, pxPerTick, MARGIN.left, color, currentTime, fontMono, label);
    }
  }

  // Time axis
  const step = _pickStep(span, chartW);
  const axisY = MARGIN.top + n * rowH;
  ctx.strokeStyle = cTertiary;
  ctx.fillStyle   = cTertiary;
  ctx.font        = `400 11px ${fontMono}`;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth   = 1;
  for (let t = 0; t <= span; t += step) {
    const x = MARGIN.left + t * pxPerTick;
    ctx.beginPath(); ctx.moveTo(x, axisY); ctx.lineTo(x, axisY + 4); ctx.stroke();
    ctx.fillText(String(t), x, axisY + 6);
  }
  if (span % step !== 0) {
    const x = MARGIN.left + span * pxPerTick;
    ctx.beginPath(); ctx.moveTo(x, axisY); ctx.lineTo(x, axisY + 4); ctx.stroke();
    ctx.fillText(String(span), x, axisY + 6);
  }

  // Playhead — accent line + triangle
  const cx = MARGIN.left + Math.min(span, currentTime) * pxPerTick;
  ctx.strokeStyle = cAccent;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(cx, MARGIN.top - 6);
  ctx.lineTo(cx, MARGIN.top + n * rowH);
  ctx.stroke();

  const TW = 5;
  ctx.fillStyle = cAccent;
  ctx.beginPath();
  ctx.moveTo(cx, MARGIN.top);
  ctx.lineTo(cx - TW, MARGIN.top - 8);
  ctx.lineTo(cx + TW, MARGIN.top - 8);
  ctx.closePath();
  ctx.fill();
}

function _drawGanttBlock(ctx, start, end, y0, rowH, pxPerTick, offsetX, color, currentTime, fontMono, label) {
  const bx = offsetX + start * pxPerTick;
  const bw = Math.max(1, (end - start) * pxPerTick);
  const activeEnd = Math.min(end, currentTime);
  const R = 2;
  const PAD = 3;

  ctx.globalAlpha = 0.15;
  ctx.fillStyle   = color;
  _roundRectTh(ctx, bx, y0 + PAD, bw, rowH - PAD * 2, R);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (activeEnd > start) {
    const aw = Math.max(1, (activeEnd - start) * pxPerTick);
    ctx.fillStyle = color;
    _roundRectTh(ctx, bx, y0 + PAD, aw, rowH - PAD * 2, R);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1;
  _roundRectTh(ctx, bx, y0 + PAD, bw, rowH - PAD * 2, R);
  ctx.stroke();

  if (bw >= 20) {
    const textColor = activeEnd > start ? contrastTextColor(color) : 'rgba(255,255,255,0.3)';
    ctx.fillStyle = textColor;
    ctx.font = `500 11px ${fontMono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw / 2, y0 + rowH / 2);
  }
}

function _roundRectTh(ctx, x, y, w, h, r) {
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

function _pickStep(span, w) {
  const max = Math.max(2, Math.floor(w / 45));
  for (const c of [1,2,5,10,20,50]) if (span / c <= max) return c;
  return 50;
}

// ── Memory Sharing ────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} container
 * @param {import('../types.js').SharedResources} sr
 * @param {import('../types.js').Thread[]} threads
 * @param {number[]} activeTids
 */
export function renderMemorySharing(container, sr, threads, activeTids) {
  container.innerHTML = '';

  const sharedWrap = document.createElement('div');
  sharedWrap.className = 'ms-shared';

  const sharedTitle = document.createElement('div');
  sharedTitle.className = 'ms-segment-title';
  sharedTitle.textContent = 'Shared Address Space';
  sharedWrap.appendChild(sharedTitle);

  const segRow = document.createElement('div');
  segRow.className = 'ms-seg-row';

  // Shared segments use hues derived from page-segment index rather than the old palette
  const SEGMENT_PIDS = [0, 1, 2]; // arbitrary seed ids for code/data/heap
  for (const [idx, name, pages] of [
    [0, 'Code',  sr.sharedPageNumbers.slice(0, Math.ceil(sr.sharedPageNumbers.length / 3))],
    [1, 'Data',  sr.sharedPageNumbers.slice(Math.ceil(sr.sharedPageNumbers.length / 3), Math.ceil(2 * sr.sharedPageNumbers.length / 3))],
    [2, 'Heap',  sr.sharedPageNumbers.slice(Math.ceil(2 * sr.sharedPageNumbers.length / 3))],
  ]) {
    const seg = document.createElement('div');
    seg.className = 'ms-segment';
    seg.style.background = pidToColor(200 + idx);

    const lbl = document.createElement('div');
    lbl.className = 'ms-seg-label';
    lbl.textContent = name;
    seg.appendChild(lbl);

    const pgs = document.createElement('div');
    pgs.className = 'ms-seg-pages';
    pgs.textContent = pages.length > 0 ? `pp. ${pages.join(', ')}` : '—';
    seg.appendChild(pgs);
    segRow.appendChild(seg);
  }
  sharedWrap.appendChild(segRow);
  container.appendChild(sharedWrap);

  if (activeTids.length === 0) {
    const none = document.createElement('div');
    none.className = 'ms-no-stacks';
    none.textContent = 'No threads created yet.';
    container.appendChild(none);
    return;
  }

  const stacksTitle = document.createElement('div');
  stacksTitle.className = 'ms-segment-title';
  stacksTitle.style.marginTop = '12px';
  stacksTitle.textContent = 'Private Thread Stacks';
  container.appendChild(stacksTitle);

  const stackRow = document.createElement('div');
  stackRow.className = 'ms-stack-row';

  for (const stackInfo of sr.threadStacks) {
    if (!activeTids.includes(stackInfo.tid)) continue;
    const isMulti = threads.length > 1;
    const label = isMulti ? `T${stackInfo.localIndex} stack` : 'Stack';
    const stackColor = pidToColor(stackInfo.localIndex * 37 + 50);

    const block = document.createElement('div');
    block.className = 'ms-stack-block';
    block.style.borderColor = stackColor;

    const lbl = document.createElement('div');
    lbl.className = 'ms-stack-label';
    lbl.textContent = label;
    block.appendChild(lbl);

    const pgs = document.createElement('div');
    pgs.className = 'ms-stack-pages';
    pgs.textContent = `pp. ${stackInfo.stackPageNumbers.join(', ')}`;
    block.appendChild(pgs);

    const sz = document.createElement('div');
    sz.className = 'ms-stack-size';
    sz.textContent = `${stackInfo.stackPageNumbers.length} page${stackInfo.stackPageNumbers.length !== 1 ? 's' : ''}`;
    block.appendChild(sz);

    stackRow.appendChild(block);
  }
  container.appendChild(stackRow);
}

// ── Thread State Diagram ──────────────────────────────────────────────────────

const STATES = ['NEW', 'READY', 'RUNNING', 'WAITING', 'TERMINATED'];
const NODE_R  = 22;
const NODE_GAP = 16;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../types.js').Thread[]} threads
 * @param {{ tid: number, state: import('../types.js').ThreadState }[]} currentStates
 * @param {{ tid: number, state: import('../types.js').ThreadState }[]} previousStates
 * @param {import('../types.js').ProcessState} processState
 */
export function renderThreadStateDiagram(ctx, threads, currentStates, previousStates, processState) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!threads || threads.length === 0) return;

  const cBorder   = token('--border-default');
  const cSubtle   = token('--border-subtle');
  const cPrimary  = token('--text-primary');
  const cSecondary= token('--text-secondary');
  const cTertiary = token('--text-tertiary');
  const cElevated = token('--bg-elevated');
  const fontMono  = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`;

  const STATE_STROKE = {
    NEW:        token('--state-new'),
    READY:      token('--state-ready'),
    RUNNING:    token('--state-running'),
    WAITING:    token('--state-waiting'),
    TERMINATED: token('--state-finished'),
  };

  const n      = threads.length;
  const rowH   = Math.min(70, (H - 50) / n);
  const nodeW  = NODE_R * 2 + NODE_GAP;
  const totalW = STATES.length * nodeW - NODE_GAP;
  const startX = (W - totalW) / 2 + NODE_R;
  const MARGIN_TOP = 24;

  // Column headers
  ctx.font = `500 10px ${fontMono}`;
  ctx.fillStyle = cTertiary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let ci = 0; ci < STATES.length; ci++) {
    ctx.fillText(STATES[ci], startX + ci * nodeW, 6);
  }

  const stateMap = new Map((currentStates || []).map(s => [s.tid, s.state]));

  for (let ri = 0; ri < n; ri++) {
    const thread = threads[ri];
    const label  = n > 1 ? `T${ri + 1}` : `P${thread.parentPid}`;
    const state  = stateMap.get(thread.tid) || 'NEW';
    const cy     = MARGIN_TOP + ri * rowH + rowH / 2;
    const color  = pidToColor(thread.parentPid * 100 + ri);

    // Row label
    ctx.font      = `500 10px ${fontMono}`;
    ctx.fillStyle = cSecondary;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, startX - NODE_R - 8, cy);

    // Connector lines
    ctx.strokeStyle = cSubtle;
    ctx.lineWidth   = 1.5;
    for (let ci = 0; ci < STATES.length - 1; ci++) {
      const x1 = startX + ci * nodeW + NODE_R;
      const x2 = startX + (ci + 1) * nodeW - NODE_R;
      ctx.beginPath();
      ctx.moveTo(x1, cy);
      ctx.lineTo(x2 - 6, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, cy);
      ctx.lineTo(x2 - 8, cy - 4);
      ctx.lineTo(x2 - 8, cy + 4);
      ctx.closePath();
      ctx.fillStyle = cSubtle;
      ctx.fill();
    }

    // State nodes
    for (let ci = 0; ci < STATES.length; ci++) {
      const s  = STATES[ci];
      const cx = startX + ci * nodeW;
      const isActive = state === s;
      const stroke = STATE_STROKE[s];

      ctx.beginPath();
      ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? color : cElevated;
      ctx.fill();
      ctx.strokeStyle = isActive ? 'rgba(255,255,255,0.4)' : stroke;
      ctx.lineWidth   = isActive ? 2 : 1;
      ctx.stroke();

      const textFill = isActive ? contrastTextColor(color) : cTertiary;
      ctx.fillStyle    = textFill;
      ctx.font         = `${isActive ? '600' : '400'} 9px ${fontMono}`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s === 'TERMINATED' ? 'TERM' : s, cx, cy);
    }
  }

  // Process summary bar
  const barY = MARGIN_TOP + n * rowH + 8;
  const BAR_H = 22;
  const stateFill = STATE_STROKE[processState] || cBorder;
  const barW = Math.min(totalW + 60, W - 40);
  const barX = (W - barW) / 2;

  ctx.fillStyle   = cElevated;
  ctx.strokeStyle = stateFill;
  ctx.lineWidth   = 1;
  _roundRectSD(ctx, barX, barY, barW, BAR_H, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle    = cPrimary;
  ctx.font         = `500 11px ${fontMono}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Process: ${processState || 'NEW'}`, W / 2, barY + BAR_H / 2);
}

function _roundRectSD(ctx, x, y, w, h, r) {
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

// ── Thread Event Log ──────────────────────────────────────────────────────────

const EVENT_LABEL = {
  CREATED:    'CREATED',
  DISPATCHED: 'DISPATCHED',
  PREEMPTED:  'PREEMPTED',
  BLOCKED:    'BLOCKED',
  UNBLOCKED:  'UNBLOCKED',
  COMPLETED:  'COMPLETED',
  JOINED:     'JOINED',
};

/**
 * @param {HTMLElement} container
 * @param {Array<import('../types.js').ThreadEvent & {time:number}>} events
 * @param {number} currentTime
 */
export function renderThreadEventLog(container, events, currentTime) {
  container.innerHTML = '';

  const visible = events.filter(e => e.time <= currentTime);
  const dispatches  = visible.filter(e => e.type === 'DISPATCHED').length;
  const preemptions = visible.filter(e => e.type === 'PREEMPTED').length;
  const completions = visible.filter(e => e.type === 'COMPLETED').length;

  const summary = document.createElement('div');
  summary.className = 'tel-summary';
  summary.innerHTML =
    `<span>Dispatches: <strong>${dispatches}</strong></span>` +
    `<span>Preemptions: <strong>${preemptions}</strong></span>` +
    `<span>Completions: <strong>${completions}</strong></span>`;
  container.appendChild(summary);

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tel-empty';
    empty.textContent = 'No events yet.';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'tel-table';
  table.innerHTML = '<thead><tr><th>t</th><th>Type</th><th>Description</th></tr></thead>';
  const tbody = document.createElement('tbody');

  for (const ev of visible) {
    const tr = document.createElement('tr');
    tr.className = `tel-row tel-row--${ev.type.toLowerCase()}`;

    const tdTime = document.createElement('td');
    tdTime.textContent = ev.time;
    tr.appendChild(tdTime);

    const tdType = document.createElement('td');
    tdType.className = 'tel-type';
    tdType.textContent = EVENT_LABEL[ev.type] || ev.type;
    tr.appendChild(tdType);

    const tdDesc = document.createElement('td');
    tdDesc.textContent = ev.description;
    tr.appendChild(tdDesc);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
  container.scrollTop = container.scrollHeight;
}

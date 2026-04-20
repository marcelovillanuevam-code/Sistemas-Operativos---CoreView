// thread-visuals.js — Thread-specific renderers. Up to 8 rows (system cap).

const COLOR_PALETTE = [
  '#5b9cf6', '#f07b5e', '#6abf85', '#f5c842',
  '#a78bf5', '#ef5d52', '#4db8c8', '#e8879b',
];

const STATE_COLORS = {
  NEW:        '#30363d',
  READY:      '#7a6515',
  RUNNING:    '#1a4a2e',
  WAITING:    '#3b2d6e',
  TERMINATED: '#21262d',
};

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
  const rowH   = chartH / n;

  const endTime = trace.timeline[trace.timeline.length - 1].time + 1;
  const span    = Math.max(1, endTime);
  const pxPerTick = chartW / span;

  const currentTime = currentStep < trace.timeline.length
    ? trace.timeline[currentStep].time
    : span;

  // Title
  ctx.fillStyle = '#e6edf3';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('Thread Gantt', MARGIN.left, 6);

  for (let ri = 0; ri < n; ri++) {
    const thread = threads[ri];
    const color  = COLOR_PALETTE[ri % COLOR_PALETTE.length];
    const y0     = MARGIN.top + ri * rowH;
    const isMulti = n > 1;
    const label  = isMulti ? `P${trace.pid}-T${ri + 1}` : `P${trace.pid}`;

    // Row background
    ctx.fillStyle = ri % 2 === 0 ? '#161b22' : '#1c2130';
    ctx.fillRect(MARGIN.left, y0, chartW, rowH);
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN.left, y0, chartW, rowH);

    // Row label
    ctx.fillStyle = '#8b949e';
    ctx.font = 'bold 11px ui-monospace, monospace';
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
        _drawGanttBlock(ctx, blockStart, entry.time, y0, rowH, pxPerTick, MARGIN.left, color, currentTime);
        blockStart = null;
      }
    }
    if (blockStart !== null) {
      _drawGanttBlock(ctx, blockStart, endTime, y0, rowH, pxPerTick, MARGIN.left, color, currentTime);
    }
  }

  // Time axis
  const step = _pickStep(span, chartW);
  ctx.strokeStyle = '#6e7681';
  ctx.fillStyle   = '#8b949e';
  ctx.font        = '10px system-ui, sans-serif';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth   = 1;
  for (let t = 0; t <= span; t += step) {
    const x = MARGIN.left + t * pxPerTick;
    ctx.beginPath(); ctx.moveTo(x, MARGIN.top + chartH); ctx.lineTo(x, MARGIN.top + chartH + 4); ctx.stroke();
    ctx.fillText(String(t), x, MARGIN.top + chartH + 6);
  }
  if (span % step !== 0) {
    const x = MARGIN.left + span * pxPerTick;
    ctx.beginPath(); ctx.moveTo(x, MARGIN.top + chartH); ctx.lineTo(x, MARGIN.top + chartH + 4); ctx.stroke();
    ctx.fillText(String(span), x, MARGIN.top + chartH + 6);
  }

  // Current time indicator
  const cx = MARGIN.left + Math.min(span, currentTime) * pxPerTick;
  ctx.strokeStyle = '#f85149';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(cx, MARGIN.top - 4);
  ctx.lineTo(cx, MARGIN.top + chartH + 4);
  ctx.stroke();
  ctx.fillStyle   = '#f85149';
  ctx.font        = 'bold 10px system-ui, sans-serif';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`t=${currentTime}`, cx, MARGIN.top - 4);
}

function _drawGanttBlock(ctx, start, end, y0, rowH, pxPerTick, offsetX, color, currentTime) {
  const bx = offsetX + start * pxPerTick;
  const bw = Math.max(1, (end - start) * pxPerTick);
  const activeEnd = Math.min(end, currentTime);
  const R = 3;

  // Dim future
  ctx.globalAlpha = 0.18;
  ctx.fillStyle   = color;
  _roundRectTh(ctx, bx, y0 + 2, bw, rowH - 4, R);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Active portion
  if (activeEnd > start) {
    const aw = Math.max(1, (activeEnd - start) * pxPerTick);
    ctx.shadowColor = color;
    ctx.shadowBlur  = 5;
    ctx.fillStyle   = color;
    _roundRectTh(ctx, bx, y0 + 2, aw, rowH - 4, R);
    ctx.fill();
    ctx.shadowBlur  = 0;
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 1;
  _roundRectTh(ctx, bx, y0 + 2, bw, rowH - 4, R);
  ctx.stroke();
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
 * @param {number[]} activeTids   - tids whose stacks are visible (arrived)
 */
export function renderMemorySharing(container, sr, threads, activeTids) {
  container.innerHTML = '';

  // Shared segments header
  const sharedWrap = document.createElement('div');
  sharedWrap.className = 'ms-shared';

  const sharedTitle = document.createElement('div');
  sharedTitle.className = 'ms-segment-title';
  sharedTitle.textContent = 'Shared Address Space';
  sharedWrap.appendChild(sharedTitle);

  const segRow = document.createElement('div');
  segRow.className = 'ms-seg-row';

  for (const [name, color, pages] of [
    ['Code',  '#5b9cf6', sr.sharedPageNumbers.slice(0, Math.ceil(sr.sharedPageNumbers.length / 3))],
    ['Data',  '#f07b5e', sr.sharedPageNumbers.slice(Math.ceil(sr.sharedPageNumbers.length / 3), Math.ceil(2 * sr.sharedPageNumbers.length / 3))],
    ['Heap',  '#6abf85', sr.sharedPageNumbers.slice(Math.ceil(2 * sr.sharedPageNumbers.length / 3))],
  ]) {
    const seg = document.createElement('div');
    seg.className = 'ms-segment';
    seg.style.background = color;

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

  // Thread stacks
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
    const thread = threads.find(t => t.tid === stackInfo.tid);
    const isMulti = threads.length > 1;
    const label = isMulti ? `T${stackInfo.localIndex} stack` : 'Stack';

    const block = document.createElement('div');
    block.className = 'ms-stack-block';
    block.style.background = COLOR_PALETTE[(stackInfo.localIndex - 1) % COLOR_PALETTE.length] + '33';
    block.style.borderColor = COLOR_PALETTE[(stackInfo.localIndex - 1) % COLOR_PALETTE.length];

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
const NODE_R = 22;
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

  const n = threads.length;
  const isMulti = n > 1;

  // Layout: each row = one thread. 5 state nodes per row.
  const rowH  = Math.min(70, (H - 50) / n);
  const nodeW = (NODE_R * 2 + NODE_GAP);
  const totalW = STATES.length * nodeW - NODE_GAP;
  const startX = (W - totalW) / 2 + NODE_R;
  const MARGIN_TOP = 24;

  // Column headers
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.fillStyle = '#6e7681';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let ci = 0; ci < STATES.length; ci++) {
    const cx = startX + ci * nodeW;
    ctx.fillText(STATES[ci], cx, 6);
  }

  const stateMap = new Map((currentStates || []).map(s => [s.tid, s.state]));

  for (let ri = 0; ri < n; ri++) {
    const thread = threads[ri];
    const isMultiT = n > 1;
    const label  = isMultiT ? `T${ri + 1}` : `P${thread.parentPid}`;
    const state  = stateMap.get(thread.tid) || 'NEW';
    const cy     = MARGIN_TOP + ri * rowH + rowH / 2;
    const color  = COLOR_PALETTE[ri % COLOR_PALETTE.length];

    // Row label
    ctx.font      = 'bold 10px ui-monospace, monospace';
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, startX - NODE_R - 8, cy);

    // Arrows between state nodes
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth   = 1.5;
    for (let ci = 0; ci < STATES.length - 1; ci++) {
      const x1 = startX + ci * nodeW + NODE_R;
      const x2 = startX + (ci + 1) * nodeW - NODE_R;
      ctx.beginPath();
      ctx.moveTo(x1, cy);
      ctx.lineTo(x2, cy);
      ctx.stroke();
      // arrowhead
      ctx.beginPath();
      ctx.moveTo(x2, cy);
      ctx.lineTo(x2 - 7, cy - 4);
      ctx.lineTo(x2 - 7, cy + 4);
      ctx.closePath();
      ctx.fillStyle = '#30363d';
      ctx.fill();
    }

    // State nodes
    for (let ci = 0; ci < STATES.length; ci++) {
      const s  = STATES[ci];
      const cx = startX + ci * nodeW;
      const isActive = state === s;

      ctx.beginPath();
      ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? color : '#1c2130';
      ctx.fill();
      ctx.strokeStyle = isActive ? 'rgba(255,255,255,0.5)' : '#30363d';
      ctx.lineWidth   = isActive ? 2 : 1;
      ctx.stroke();

      ctx.fillStyle   = isActive ? '#fff' : '#484f58';
      ctx.font        = `${isActive ? 'bold ' : ''}9px system-ui, sans-serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      const short = s === 'TERMINATED' ? 'TERM' : s;
      ctx.fillText(short, cx, cy);
    }
  }

  // Process summary bar at bottom
  const barY = MARGIN_TOP + n * rowH + 8;
  const BAR_H = 22;
  const psColor = processState === 'TERMINATED' ? '#21262d'
    : processState === 'RUNNING'    ? '#1a4a2e'
    : processState === 'READY'      ? '#7a6515'
    : '#1c2130';

  ctx.fillStyle   = psColor;
  ctx.strokeStyle = '#484f58';
  ctx.lineWidth   = 1;
  const barW = Math.min(totalW + 60, W - 40);
  const barX = (W - barW) / 2;
  _roundRect(ctx, barX, barY, barW, BAR_H, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle   = processState === 'NEW' ? '#8b949e' : '#e6edf3';
  ctx.font        = 'bold 11px system-ui, sans-serif';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Process state: ${processState || 'NEW'}`, W / 2, barY + BAR_H / 2);
}

function _roundRect(ctx, x, y, w, h, r) {
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

const EVENT_ICON = {
  CREATED:    '🟢',
  DISPATCHED: '▶',
  PREEMPTED:  '⏸',
  BLOCKED:    '🔒',
  UNBLOCKED:  '🔓',
  COMPLETED:  '✓',
  JOINED:     '⛓',
};

/**
 * @param {HTMLElement} container
 * @param {Array<import('../types.js').ThreadEvent & {time:number}>} events
 * @param {number} currentTime  - show events with time <= currentTime
 */
export function renderThreadEventLog(container, events, currentTime) {
  container.innerHTML = '';

  const visible = events.filter(e => e.time <= currentTime);

  // Counters
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
    tdType.textContent = `${EVENT_ICON[ev.type] || ''} ${ev.type}`;
    tr.appendChild(tdType);

    const tdDesc = document.createElement('td');
    tdDesc.textContent = ev.description;
    tr.appendChild(tdDesc);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}

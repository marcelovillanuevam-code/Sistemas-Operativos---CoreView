// state-diagram.js — Canvas 2D state diagram. 5-node process state graph.
// Thread-level chips grouped inside each state node. Dashed arrows for transitions.

const NODE_FILL = {
  NEW:        '#1c2130',
  READY:      '#0d2818',
  RUNNING:    '#0d1e33',
  WAITING:    '#1e1a30',
  TERMINATED: '#1a1a1f',
};
const NODE_STROKE = {
  NEW:        '#484f58',
  READY:      '#238636',
  RUNNING:    '#1f6feb',
  WAITING:    '#7948d5',
  TERMINATED: '#6e7681',
};

const R = 36;       // node radius
const CHIP_W = 42;
const CHIP_H = 16;
const CHIP_GAP = 3;
const CHIP_PER_ROW = 4;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pid: number, state: string, threadStates?: {tid: number, state: string}[] }[]} processStates
 * @param {{ pid: number, state: string }[] | null} previousStates
 * @param {Map<number, string>} labelMap  tid → label string
 * @param {Map<number, string>} colorMap  tid → color hex
 */
export function renderStateDiagram(ctx, processStates, previousStates, labelMap, colorMap) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);

  // ── Node positions ────────────────────────────────────────────────────────
  const midY = Math.round(H * 0.34);
  const waitY = Math.round(H * 0.74);
  const pos = {
    NEW:        [Math.round(W * 0.08), midY],
    READY:      [Math.round(W * 0.30), midY],
    RUNNING:    [Math.round(W * 0.55), midY],
    WAITING:    [Math.round(W * 0.55), waitY],
    TERMINATED: [Math.round(W * 0.80), midY],
  };

  const [nx, ny]  = pos.NEW;
  const [rx, ry]  = pos.READY;
  const [ux, uy]  = pos.RUNNING;
  const [wx, wy]  = pos.WAITING;
  const [tx, ty]  = pos.TERMINATED;

  // ── Arrows ────────────────────────────────────────────────────────────────
  // NEW → READY
  _arrow(ctx, nx + R, ny, rx - R, ry, false, 'arrive');
  // READY → RUNNING
  _arrow(ctx, rx + R, ry, ux - R, uy, false, 'dispatch');
  // RUNNING → TERMINATED
  _arrow(ctx, ux + R, uy, tx - R, ty, false, 'complete');
  // RUNNING ↓ WAITING
  _arrow(ctx, ux, uy + R, wx, wy - R, false, 'block');
  // RUNNING → READY  (preempt — dashed arc above)
  _arcArrow(ctx, ux - R * 0.5, uy - R, rx + R * 0.5, ry - R, H * 0.04, true, 'preempt');
  // WAITING → READY  (dashed arc below)
  _arcArrow(ctx, wx - R * 0.7, wy + R * 0.5, rx + R * 0.3, ry + R * 0.8, H * 0.95, true, 'unblock');

  // ── State nodes ───────────────────────────────────────────────────────────
  for (const state of ['NEW', 'READY', 'RUNNING', 'WAITING', 'TERMINATED']) {
    const [cx, cy] = pos[state];
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = NODE_FILL[state];
    ctx.fill();
    ctx.strokeStyle = NODE_STROKE[state];
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 11px system-ui,sans-serif';
    ctx.fillStyle = '#e6edf3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state, cx, cy);
  }

  if (!processStates) return;

  // ── Collect thread labels per state ───────────────────────────────────────
  const byState = { NEW: [], READY: [], RUNNING: [], WAITING: [], TERMINATED: [] };

  for (const ps of processStates) {
    const threads = ps.threadStates && ps.threadStates.length > 0 ? ps.threadStates : null;
    if (threads) {
      for (const ts of threads) {
        const label = labelMap ? (labelMap.get(ts.tid) || `T${ts.tid}`) : `T${ts.tid}`;
        const color = colorMap ? (colorMap.get(ts.tid) || '#888') : '#888';
        if (byState[ts.state]) byState[ts.state].push({ label, color });
      }
    } else {
      // fallback: process-level
      const label = `P${ps.pid}`;
      const color = '#888';
      if (byState[ps.state]) byState[ps.state].push({ label, color });
    }
  }

  // ── Draw chips below each state node ──────────────────────────────────────
  for (const state of ['NEW', 'READY', 'RUNNING', 'WAITING', 'TERMINATED']) {
    const chips = byState[state];
    if (chips.length === 0) continue;
    const [cx, cy] = pos[state];
    const startY = cy + R + 6;
    _drawChips(ctx, chips, cx, startY);
  }
}

function _drawChips(ctx, chips, centerX, startY) {
  const rows = [];
  for (let i = 0; i < chips.length; i += CHIP_PER_ROW) {
    rows.push(chips.slice(i, i + CHIP_PER_ROW));
  }
  let y = startY;
  for (const row of rows) {
    const totalW = row.length * CHIP_W + (row.length - 1) * CHIP_GAP;
    let x = centerX - totalW / 2;
    for (const chip of row) {
      _roundRect(ctx, x, y, CHIP_W, CHIP_H, 3);
      ctx.fillStyle = chip.color;
      ctx.fill();
      ctx.font = 'bold 9px system-ui,sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(chip.label, x + CHIP_W / 2, y + CHIP_H / 2);
      x += CHIP_W + CHIP_GAP;
    }
    y += CHIP_H + CHIP_GAP;
  }
}

function _arrow(ctx, x1, y1, x2, y2, dashed, label) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;

  ctx.strokeStyle = '#484f58';
  ctx.fillStyle = '#484f58';
  ctx.lineWidth = 1.5;
  if (dashed) ctx.setLineDash([5, 3]); else ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead
  const ax = x2 - ux * 9;
  const ay = y2 - uy * 9;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(ax + uy * 5, ay - ux * 5);
  ctx.lineTo(ax - uy * 5, ay + ux * 5);
  ctx.closePath();
  ctx.fill();

  if (label) {
    ctx.font = '9px system-ui,sans-serif';
    ctx.fillStyle = '#6e7681';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, (x1 + x2) / 2 + uy * 12, (y1 + y2) / 2 - ux * 12);
  }
}

function _arcArrow(ctx, x1, y1, x2, y2, bendY, dashed, label) {
  const cpX = (x1 + x2) / 2;
  const cpY = bendY;

  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1.5;
  if (dashed) ctx.setLineDash([5, 3]); else ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cpX, cpY, x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead tangent at endpoint
  const dx = x2 - cpX, dy = y2 - cpY;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  ctx.fillStyle = '#30363d';
  const ax = x2 - ux * 9, ay = y2 - uy * 9;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(ax + uy * 5, ay - ux * 5);
  ctx.lineTo(ax - uy * 5, ay + ux * 5);
  ctx.closePath();
  ctx.fill();

  if (label) {
    ctx.font = '9px system-ui,sans-serif';
    ctx.fillStyle = '#484f58';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cpX, cpY - (bendY < y1 ? -10 : 10));
  }
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

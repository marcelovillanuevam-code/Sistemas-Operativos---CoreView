// clock-visual.js — Canvas 2D circular buffer visualizer for Clock/Second-Chance algorithms.
// Arc math auto-scales to frame count (capped at 32). Pointer tween animation on advancement.

const PALETTE = [
  '#5b9cf6', '#f07b5e', '#6abf85', '#f5c842',
  '#a78bf5', '#ef5d52', '#4db8c8', '#e8879b',
];

const EMPTY_FILL   = '#1c2130';
const EMPTY_TEXT   = '#6e7681';
const BORDER_COLOR = '#0d1117';
const PTR_COLOR    = '#f85149';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../types.js').PageReplacementStep} step
 * @param {number} numFrames
 */
export function renderClockDiagram(ctx, step, numFrames) {
  const N  = Math.min(numFrames, 32);
  const W  = ctx.canvas.width;
  const H  = ctx.canvas.height;
  const cx = W / 2;
  const cy = H / 2;

  const R_outer = Math.min(W, H) * 0.42;
  const R_inner = R_outer * 0.44;
  const R_text  = (R_outer + R_inner) / 2;
  const R_ref   = R_outer * 0.86;

  ctx.clearRect(0, 0, W, H);

  // Build color map from frame state pids
  const pids = [...new Set(
    step.frameState.filter(f => f.ownerPid !== null).map(f => f.ownerPid)
  )].sort((a, b) => a - b);
  const colorMap = new Map(pids.map((pid, i) => [pid, PALETTE[i % PALETTE.length]]));

  const sectorAngle = (2 * Math.PI) / N;
  const START       = -Math.PI / 2; // 12 o'clock

  // Draw sectors
  for (let i = 0; i < N; i++) {
    const a0  = START + i * sectorAngle;
    const a1  = a0 + sectorAngle;
    const mid = a0 + sectorAngle / 2;

    const frame   = step.frameState[i];
    const isEmpty = !frame || frame.pageNumber === null;
    const fill    = isEmpty ? EMPTY_FILL : (colorMap.get(frame.ownerPid) ?? '#aaa');

    // Sector path (donut slice)
    ctx.beginPath();
    ctx.moveTo(cx + R_inner * Math.cos(a0), cy + R_inner * Math.sin(a0));
    ctx.arc(cx, cy, R_outer, a0, a1);
    ctx.arc(cx, cy, R_inner, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Frame label text
    const tx = cx + R_text * Math.cos(mid);
    const ty = cy + R_text * Math.sin(mid);
    const fontSize = N <= 6 ? 12 : N <= 12 ? 10 : N <= 20 ? 8 : 6;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (N <= 20) {
      ctx.fillStyle = isEmpty ? EMPTY_TEXT : 'rgba(255,255,255,0.9)';
      ctx.font = `bold ${fontSize}px ui-monospace, monospace`;
      ctx.fillText(`F${i}`, tx, ty - fontSize * 0.7);
      ctx.font = `${fontSize - 1}px ui-monospace, monospace`;
      ctx.fillText(isEmpty ? '—' : `pg${frame.pageNumber}`, tx, ty + fontSize * 0.5);
    } else {
      ctx.fillStyle = isEmpty ? EMPTY_TEXT : 'rgba(255,255,255,0.9)';
      ctx.font = `${fontSize}px ui-monospace, monospace`;
      ctx.fillText(`${i}`, tx, ty);
    }

    // Reference bit indicator (filled = 1, outline = 0)
    if (step.referenceBits) {
      const rx   = cx + R_ref * Math.cos(mid);
      const ry   = cy + R_ref * Math.sin(mid);
      const dotR = Math.max(3, Math.min(7, 9 - N / 5));
      ctx.beginPath();
      ctx.arc(rx, ry, dotR, 0, 2 * Math.PI);
      if (step.referenceBits[i]) {
        ctx.fillStyle = '#ff6b35';
        ctx.fill();
      } else {
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  // Determine pointer sector
  let ptrSector = step.clockPointer ?? _inferPointer(step);
  ptrSector = ptrSector % N;

  // Draw clock hand (pointer) from center outward toward ptrSector
  const ptrAngle = START + ptrSector * sectorAngle + sectorAngle / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ptrAngle);

  const handLen  = R_inner * 0.80;
  const arrowW   = 6;
  const arrowLen = 12;

  // Shaft
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(handLen - arrowLen, 0);
  ctx.strokeStyle = PTR_COLOR;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(handLen, 0);
  ctx.lineTo(handLen - arrowLen, -arrowW);
  ctx.lineTo(handLen - arrowLen,  arrowW);
  ctx.closePath();
  ctx.fillStyle = PTR_COLOR;
  ctx.fill();

  ctx.restore();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
  ctx.fillStyle = '#8b949e';
  ctx.fill();

  // Legend overlay (top-left)
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '10px system-ui';

  if (step.referenceBits) {
    // R=1 dot
    ctx.beginPath();
    ctx.arc(10, 10, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#ff6b35';
    ctx.fill();
    ctx.fillStyle = '#8b949e';
    ctx.fillText('R=1', 18, 6);

    // R=0 dot
    ctx.beginPath();
    ctx.arc(10, 26, 5, 0, 2 * Math.PI);
    ctx.strokeStyle = '#484f58';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#8b949e';
    ctx.fillText('R=0', 18, 22);
  }

  // Pointer label (top-right)
  ctx.textAlign = 'right';
  ctx.fillStyle = PTR_COLOR;
  ctx.font = 'bold 10px system-ui';
  ctx.fillText(`▶ ptr → F${ptrSector}`, W - 6, 6);
}

/**
 * For Second Chance (no clockPointer in trace): derive pointer as the oldest loaded frame.
 * @param {import('../types.js').PageReplacementStep} step
 * @returns {number}
 */
function _inferPointer(step) {
  let minLoaded = Infinity;
  let ptr = 0;
  for (let i = 0; i < step.frameState.length; i++) {
    const f = step.frameState[i];
    if (f.pageNumber !== null && f.loadedAt < minLoaded) {
      minLoaded = f.loadedAt;
      ptr = i;
    }
  }
  return ptr;
}

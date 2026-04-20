// clock-visual.js — Canvas 2D circular buffer visualizer for Clock/Second-Chance algorithms.

import { pidToColor, contrastTextColor, token } from './color-utils.js';

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

  const cBg       = token('--bg-base');
  const cEmpty    = token('--bg-elevated');
  const cTertiary = token('--text-tertiary');
  const cSecondary= token('--text-secondary');
  const cAccent   = token('--accent');
  const cReady    = token('--state-ready');
  const fontMono  = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`;

  // Deterministic pid → color
  const pids = [...new Set(
    step.frameState.filter(f => f.ownerPid !== null).map(f => f.ownerPid)
  )].sort((a, b) => a - b);
  const colorMap = new Map(pids.map(pid => [pid, pidToColor(pid)]));

  const sectorAngle = (2 * Math.PI) / N;
  const START       = -Math.PI / 2; // 12 o'clock

  for (let i = 0; i < N; i++) {
    const a0  = START + i * sectorAngle;
    const a1  = a0 + sectorAngle;
    const mid = a0 + sectorAngle / 2;

    const frame   = step.frameState[i];
    const isEmpty = !frame || frame.pageNumber === null;
    const fill    = isEmpty ? cEmpty : (colorMap.get(frame.ownerPid) ?? '#888');

    // Donut sector
    ctx.beginPath();
    ctx.moveTo(cx + R_inner * Math.cos(a0), cy + R_inner * Math.sin(a0));
    ctx.arc(cx, cy, R_outer, a0, a1);
    ctx.arc(cx, cy, R_inner, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = cBg;
    ctx.lineWidth = 2;
    ctx.stroke();

    const tx = cx + R_text * Math.cos(mid);
    const ty = cy + R_text * Math.sin(mid);
    const fontSize = N <= 6 ? 12 : N <= 12 ? 10 : N <= 20 ? 8 : 6;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (N <= 20) {
      const textColor = isEmpty ? cTertiary : contrastTextColor(fill);
      ctx.fillStyle = textColor;
      ctx.font = `600 ${fontSize}px ${fontMono}`;
      ctx.fillText(`F${i}`, tx, ty - fontSize * 0.7);
      ctx.font = `400 ${fontSize - 1}px ${fontMono}`;
      ctx.fillText(isEmpty ? '—' : `pg${frame.pageNumber}`, tx, ty + fontSize * 0.5);
    } else {
      ctx.fillStyle = isEmpty ? cTertiary : contrastTextColor(fill);
      ctx.font = `400 ${fontSize}px ${fontMono}`;
      ctx.fillText(`${i}`, tx, ty);
    }

    // Reference bit dot (bottom-right of sector)
    if (step.referenceBits) {
      const rx   = cx + R_ref * Math.cos(mid);
      const ry_  = cy + R_ref * Math.sin(mid);
      const dotR = Math.max(3, Math.min(6, 9 - N / 5));
      ctx.beginPath();
      ctx.arc(rx, ry_, dotR, 0, 2 * Math.PI);
      if (step.referenceBits[i]) {
        ctx.fillStyle = cReady;
        ctx.fill();
      } else {
        ctx.strokeStyle = cTertiary;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  // Clock hand (pointer)
  let ptrSector = step.clockPointer ?? _inferPointer(step);
  ptrSector = ptrSector % N;
  const ptrAngle = START + ptrSector * sectorAngle + sectorAngle / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ptrAngle);

  const handLen  = R_inner * 0.80;
  const arrowW   = 5;
  const arrowLen = 10;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(handLen - arrowLen, 0);
  ctx.strokeStyle = cAccent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(handLen, 0);
  ctx.lineTo(handLen - arrowLen, -arrowW);
  ctx.lineTo(handLen - arrowLen,  arrowW);
  ctx.closePath();
  ctx.fillStyle = cAccent;
  ctx.fill();

  ctx.restore();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
  ctx.fillStyle = cSecondary;
  ctx.fill();

  // Legend (top-left)
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `400 10px ${fontMono}`;

  if (step.referenceBits) {
    ctx.beginPath();
    ctx.arc(10, 10, 4, 0, 2 * Math.PI);
    ctx.fillStyle = cReady;
    ctx.fill();
    ctx.fillStyle = cSecondary;
    ctx.fillText('R=1', 18, 6);

    ctx.beginPath();
    ctx.arc(10, 26, 4, 0, 2 * Math.PI);
    ctx.strokeStyle = cTertiary;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = cSecondary;
    ctx.fillText('R=0', 18, 22);
  }

  // Pointer label (top-right)
  ctx.textAlign = 'right';
  ctx.fillStyle = cAccent;
  ctx.font = `500 10px ${fontMono}`;
  ctx.fillText(`ptr F${ptrSector}`, W - 6, 6);
}

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

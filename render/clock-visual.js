// clock-visual.js - Canvas 2D visualizer for Clock/Second-Chance algorithms.

import { pidToColor, contrastTextColor, token } from './color-utils.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../types.js').PageReplacementStep} step
 * @param {number} numFrames
 */
export function renderClockDiagram(ctx, step, numFrames) {
  const N = Math.min(numFrames, 32);
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const cx = W / 2;
  const cy = H / 2 - 4;

  ctx.clearRect(0, 0, W, H);

  const cBg = token('--bg-base') || '#0A0A0B';
  const cSurface = token('--bg-surface') || '#141416';
  const cElevated = token('--bg-elevated') || '#1C1C1F';
  const cBorder = token('--border-default') || '#2E2E33';
  const cSubtle = token('--border-subtle') || '#242428';
  const cPrimary = token('--text-primary') || '#F4F4F5';
  const cSecondary = token('--text-secondary') || '#A1A1AA';
  const cTertiary = token('--text-tertiary') || '#71717A';
  const cAccent = token('--accent') || '#3B82F6';
  const cHit = token('--state-running') || '#10B981';
  const cFault = token('--state-blocked') || '#EF4444';
  const cReady = token('--state-ready') || '#F59E0B';
  const fontMono = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`;
  const fontUi = `'Inter', -apple-system, system-ui, sans-serif`;

  const ptr = _clockPointer(step, N);
  const activeFrame = _activeFrameIndex(step);
  const activeColor = step.isHit ? cHit : cFault;
  const radius = Math.min(W, H) * (N <= 8 ? 0.31 : 0.34);
  const compact = N > 12;
  const sectorAngle = (2 * Math.PI) / N;
  const start = -Math.PI / 2;

  _drawOrbit(ctx, cx, cy, radius, cSubtle);
  _drawHand(ctx, cx, cy, radius, ptr, sectorAngle, start, cAccent);
  _drawCenter(ctx, cx, cy, ptr, step, { cBg, cSurface, cBorder, cPrimary, cSecondary, cAccent, fontMono, fontUi });

  for (let i = 0; i < N; i++) {
    const angle = start + i * sectorAngle;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    const frame = step.frameState[i];
    const isPointer = i === ptr;
    const isActive = i === activeFrame;

    if (compact) {
      _drawCompactSlot(ctx, x, y, i, frame, step.referenceBits?.[i], {
        isPointer,
        isActive,
        activeColor,
        cElevated,
        cBorder,
        cPrimary,
        cTertiary,
        cAccent,
        cReady,
        fontMono,
      });
    } else {
      _drawSlot(ctx, x, y, i, frame, step.referenceBits?.[i], {
        isPointer,
        isActive,
        activeColor,
        cElevated,
        cBorder,
        cPrimary,
        cSecondary,
        cTertiary,
        cAccent,
        cReady,
        fontMono,
        fontUi,
        N,
      });
    }
  }

  _drawLegend(ctx, W, H, { cPrimary, cSecondary, cTertiary, cAccent, cReady, fontMono, fontUi });
}

function _drawOrbit(ctx, cx, cy, radius, color) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function _drawHand(ctx, cx, cy, radius, ptr, sectorAngle, start, color) {
  const angle = start + ptr * sectorAngle;
  const inset = radius < 120 ? 34 : 22;
  const endX = cx + (radius - inset) * Math.cos(angle);
  const endY = cy + (radius - inset) * Math.sin(angle);

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(endX, endY);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.save();
  ctx.translate(endX, endY);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-4, -6);
  ctx.lineTo(-4, 6);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function _drawCenter(ctx, cx, cy, ptr, step, colors) {
  const { cBg, cSurface, cBorder, cPrimary, cSecondary, cAccent, fontMono, fontUi } = colors;
  _roundRect(ctx, cx - 58, cy - 42, 116, 84, 8);
  ctx.fillStyle = cBg;
  ctx.fill();
  ctx.strokeStyle = cBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = cSecondary;
  ctx.font = `500 11px ${fontUi}`;
  ctx.fillText('Siguiente', cx, cy - 22);

  ctx.fillStyle = cAccent;
  ctx.font = `800 24px ${fontMono}`;
  ctx.fillText(`F${ptr}`, cx, cy + 1);

  ctx.fillStyle = cPrimary;
  ctx.font = `600 10px ${fontMono}`;
  ctx.fillText(step.isHit ? 'HIT' : 'FAULT', cx, cy + 25);

  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
  ctx.fillStyle = cSurface;
  ctx.fill();
}

function _drawSlot(ctx, x, y, idx, frame, bit, options) {
  const {
    isPointer,
    isActive,
    activeColor,
    cElevated,
    cBorder,
    cPrimary,
    cSecondary,
    cTertiary,
    cAccent,
    cReady,
    fontMono,
    fontUi,
    N,
  } = options;

  const w = N <= 4 ? 96 : N <= 8 ? 82 : 68;
  const h = N <= 4 ? 62 : 56;
  const left = x - w / 2;
  const top = y - h / 2;
  const isEmpty = !frame || frame.pageNumber === null;
  const fill = isEmpty ? null : pidToColor(frame.ownerPid);

  _roundRect(ctx, left, top, w, h, 8);
  ctx.fillStyle = cElevated;
  ctx.fill();
  ctx.strokeStyle = isActive ? activeColor : isPointer ? cAccent : cBorder;
  ctx.lineWidth = isActive || isPointer ? 2.5 : 1;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isPointer ? cAccent : cSecondary;
  ctx.font = `700 11px ${fontMono}`;
  ctx.fillText(`F${idx}`, left + 9, top + 13);

  _drawBitPill(ctx, left + w - 34, top + 5, bit, { cReady, cBorder, cPrimary, cTertiary, fontMono });

  if (!frame || frame.pageNumber === null) {
    ctx.textAlign = 'center';
    ctx.fillStyle = cTertiary;
    ctx.font = `500 12px ${fontUi}`;
    ctx.fillText('Libre', x, y + 9);
    return;
  }

  _roundRect(ctx, left + 10, top + 27, w - 20, 22, 5);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = contrastTextColor(fill);
  ctx.textAlign = 'center';
  ctx.font = `800 12px ${fontMono}`;
  ctx.fillText(`P${frame.ownerPid}:${frame.pageNumber}`, x, top + 38);
}

function _drawCompactSlot(ctx, x, y, idx, frame, bit, options) {
  const {
    isPointer,
    isActive,
    activeColor,
    cElevated,
    cBorder,
    cPrimary,
    cTertiary,
    cAccent,
    cReady,
    fontMono,
  } = options;
  const isEmpty = !frame || frame.pageNumber === null;
  const fill = isEmpty ? cElevated : pidToColor(frame.ownerPid);

  ctx.beginPath();
  ctx.arc(x, y, 13, 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = isActive ? activeColor : isPointer ? cAccent : cBorder;
  ctx.lineWidth = isActive || isPointer ? 2.5 : 1;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isEmpty ? cTertiary : contrastTextColor(fill);
  ctx.font = `700 8px ${fontMono}`;
  ctx.fillText(String(idx), x, y);

  ctx.beginPath();
  ctx.arc(x + 10, y - 10, 4, 0, 2 * Math.PI);
  if (bit) {
    ctx.fillStyle = cReady;
    ctx.fill();
  } else {
    ctx.fillStyle = cElevated;
    ctx.fill();
    ctx.strokeStyle = cTertiary;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function _drawBitPill(ctx, x, y, bit, colors) {
  const { cReady, cBorder, cPrimary, cTertiary, fontMono } = colors;
  _roundRect(ctx, x, y, 27, 16, 8);
  ctx.fillStyle = bit ? cReady : 'transparent';
  ctx.fill();
  ctx.strokeStyle = bit ? cReady : cBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = bit ? '#0A0A0B' : cTertiary;
  ctx.font = `800 9px ${fontMono}`;
  ctx.fillText(`R${bit ? '1' : '0'}`, x + 13.5, y + 8);
}

function _drawLegend(ctx, W, H, colors) {
  const { cPrimary, cSecondary, cTertiary, cAccent, cReady, fontMono, fontUi } = colors;
  const y = H - 32;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `500 11px ${fontUi}`;
  ctx.fillStyle = cSecondary;

  ctx.beginPath();
  ctx.arc(14, y, 5, 0, 2 * Math.PI);
  ctx.fillStyle = cReady;
  ctx.fill();
  ctx.fillStyle = cSecondary;
  ctx.fillText('R=1 segunda oportunidad', 26, y);

  ctx.beginPath();
  ctx.arc(W / 2 - 36, y, 5, 0, 2 * Math.PI);
  ctx.strokeStyle = cTertiary;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = cSecondary;
  ctx.fillText('R=0 candidato', W / 2 - 24, y);

  ctx.strokeStyle = cAccent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W - 112, y);
  ctx.lineTo(W - 92, y);
  ctx.stroke();
  ctx.fillStyle = cPrimary;
  ctx.font = `700 10px ${fontMono}`;
  ctx.fillText('puntero', W - 84, y);
}

function _roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function _activeFrameIndex(step) {
  return step.frameState.findIndex(f =>
    f.ownerPid === step.requested.pid && f.pageNumber === step.requested.pageNumber
  );
}

function _clockPointer(step, numFrames) {
  if (typeof step.clockPointer === 'number') return step.clockPointer % numFrames;
  const oldestLoaded = step.frameState
    .filter(f => f.pageNumber !== null)
    .sort((a, b) => a.loadedAt - b.loadedAt)[0];
  return oldestLoaded?.frameIndex ?? 0;
}

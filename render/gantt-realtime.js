// gantt-realtime.js - Buffered realtime Canvas renderer for Dispatcher core updates.

import { pidToColor, contrastTextColor, token } from './color-utils.js';

const MARGIN = { top: 32, right: 24, bottom: 34, left: 78 };
const ROW_MIN_H = 34;
const ROW_GAP = 6;

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function pickTimeStep(totalTime, width) {
  const maxLabels = Math.max(2, Math.floor(width / 56));
  const raw = totalTime / maxLabels;
  for (const candidate of [1, 2, 5, 10, 20, 50, 100]) {
    if (candidate >= raw) return candidate;
  }
  return 100;
}

function resizeCanvasToDisplay(canvas) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width || canvas.width));
  const cssHeight = Math.max(1, Math.round(rect.height || canvas.height));
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  return { dpr, cssWidth, cssHeight };
}

function normalizeCoreState(state) {
  if (!state || state.tid === null || state.tid === undefined) return null;
  return {
    tid: state.tid,
    pid: state.pid,
  };
}

function sameCoreState(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.tid === right.tid && left.pid === right.pid;
}

function textFit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}...`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out.length > 1 ? `${out}...` : '';
}

export class RealtimeGanttRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rafId = null;
    this.running = false;
    this.paused = false;

    this.numCores = 1;
    this.simSpeedMs = 100;
    this.title = '';
    this.totalTime = 1;
    this.labelMap = new Map();
    this.colorMap = new Map();

    this.segmentsByCore = [[]];
    this.currentCoreStates = [null];
    this.visibleAnchorTime = 0;
    this.wallAnchorMs = nowMs();
    this.frozenTime = 0;
  }

  reset({ numCores = 1, simSpeedMs = 100, trace = null, title = '', labelMap = new Map() } = {}) {
    this.stopLoop();
    this.running = false;
    this.paused = false;

    this.numCores = Math.max(1, Number(numCores) || 1);
    this.simSpeedMs = Math.max(1, Number(simSpeedMs) || 100);
    this.title = title;
    this.labelMap = labelMap;
    this.colorMap = new Map();
    this.totalTime = this._traceEndTime(trace);

    if (trace && Array.isArray(trace.threadMetrics)) {
      for (const metric of trace.threadMetrics) {
        this.colorMap.set(metric.tid, pidToColor(metric.pid));
      }
    }

    this.segmentsByCore = Array.from({ length: this.numCores }, () => []);
    this.currentCoreStates = Array(this.numCores).fill(null);
    this.visibleAnchorTime = 0;
    this.wallAnchorMs = nowMs();
    this.frozenTime = 0;
    this.draw();
  }

  start(simTime = 0) {
    this.running = true;
    this.paused = false;
    this.visibleAnchorTime = Math.max(0, Number(simTime) || 0);
    this.wallAnchorMs = nowMs();
    this.startLoop();
  }

  updateGanttBuffer(coreStates, simTime = 0) {
    const updateTime = Math.max(0, Number(simTime) || 0);
    const states = Array.from({ length: this.numCores }, (_, index) =>
      normalizeCoreState(coreStates[index])
    );

    for (let coreIndex = 0; coreIndex < this.numCores; coreIndex += 1) {
      const previous = this.currentCoreStates[coreIndex];
      const next = states[coreIndex];
      if (sameCoreState(previous, next)) continue;

      const segments = this.segmentsByCore[coreIndex];
      const open = segments[segments.length - 1];
      if (previous && open && open.end === null) {
        open.end = Math.max(open.start, updateTime);
      }

      if (next) {
        segments.push({
          tid: next.tid,
          pid: next.pid,
          start: updateTime,
          end: null,
        });
        if (!this.colorMap.has(next.tid) && next.pid !== null && next.pid !== undefined) {
          this.colorMap.set(next.tid, pidToColor(next.pid));
        }
      }
    }

    this.currentCoreStates = states;
    this.visibleAnchorTime = Math.max(this.visibleAnchorTime, updateTime);
    this.wallAnchorMs = nowMs();
  }

  pause() {
    if (!this.running || this.paused) return;
    this.frozenTime = this.currentVisibleTime();
    this.paused = true;
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.visibleAnchorTime = this.frozenTime;
    this.wallAnchorMs = nowMs();
    this.startLoop();
  }

  complete(simTime) {
    const endTime = Math.max(this.currentVisibleTime(), Number(simTime) || 0);
    for (let coreIndex = 0; coreIndex < this.numCores; coreIndex += 1) {
      const segments = this.segmentsByCore[coreIndex];
      const open = segments[segments.length - 1];
      if (open && open.end === null) open.end = Math.max(open.start, endTime);
    }
    this.currentCoreStates = Array(this.numCores).fill(null);
    this.visibleAnchorTime = endTime;
    this.frozenTime = endTime;
    this.paused = true;
    this.running = false;
    this.stopLoop();
    this.draw();
  }

  clear() {
    this.reset({ numCores: this.numCores, simSpeedMs: this.simSpeedMs });
  }

  currentVisibleTime() {
    if (this.paused) return this.frozenTime;
    if (!this.running) return this.visibleAnchorTime;
    const elapsedTicks = (nowMs() - this.wallAnchorMs) / this.simSpeedMs;
    return Math.max(this.visibleAnchorTime, this.visibleAnchorTime + elapsedTicks);
  }

  startLoop() {
    if (this.rafId !== null) return;
    const tick = () => {
      this.rafId = null;
      this.draw();
      if (this.running && !this.paused) {
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  draw() {
    if (!this.ctx) return;

    const { dpr, cssWidth, cssHeight } = resizeCanvasToDisplay(this.canvas);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const cBg = token('--bg-surface');
    const cElevated = token('--bg-elevated');
    const cBorder = token('--border-default');
    const cSubtle = token('--border-subtle');
    const cPrimary = token('--text-primary');
    const cSecondary = token('--text-secondary');
    const cTertiary = token('--text-tertiary');
    const cAccent = token('--accent');
    const fontMono = `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`;

    const chartX = MARGIN.left;
    const chartY = MARGIN.top;
    const chartW = Math.max(1, cssWidth - MARGIN.left - MARGIN.right);
    const chartH = Math.max(1, cssHeight - MARGIN.top - MARGIN.bottom);
    const rowH = Math.max(ROW_MIN_H, (chartH - ROW_GAP * (this.numCores - 1)) / this.numCores);
    const visibleTime = this.currentVisibleTime();
    const maxSegmentTime = this._maxSegmentTime(visibleTime);
    const span = Math.max(1, Math.ceil(Math.max(this.totalTime, maxSegmentTime, visibleTime)));
    const pxPerTick = chartW / span;

    ctx.fillStyle = cPrimary;
    ctx.font = `500 13px ${fontMono}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.title || 'Gantt realtime', chartX, 8);

    for (let coreIndex = 0; coreIndex < this.numCores; coreIndex += 1) {
      const y = chartY + coreIndex * (rowH + ROW_GAP);
      const rowFill = coreIndex % 2 === 0 ? cBg : cElevated;

      ctx.fillStyle = rowFill;
      ctx.fillRect(chartX, y, chartW, rowH);
      ctx.strokeStyle = cSubtle;
      ctx.lineWidth = 1;
      ctx.strokeRect(chartX, y, chartW, rowH);

      ctx.fillStyle = cSecondary;
      ctx.font = `500 11px ${fontMono}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Core ${coreIndex}`, chartX - 8, y + rowH / 2);
    }

    const step = pickTimeStep(span, chartW);
    ctx.strokeStyle = cSubtle;
    ctx.lineWidth = 1;
    for (let t = step; t < span; t += step) {
      const x = chartX + t * pxPerTick;
      ctx.beginPath();
      ctx.moveTo(x, chartY);
      ctx.lineTo(x, chartY + chartH);
      ctx.stroke();
    }

    for (let coreIndex = 0; coreIndex < this.numCores; coreIndex += 1) {
      const y = chartY + coreIndex * (rowH + ROW_GAP);
      for (const segment of this.segmentsByCore[coreIndex]) {
        const end = segment.end === null ? visibleTime : segment.end;
        if (end <= segment.start) continue;
        this._drawSegment(ctx, segment, chartX, y, rowH, pxPerTick, end, fontMono, cBorder);
      }
    }

    const axisY = chartY + chartH;
    ctx.strokeStyle = cTertiary;
    ctx.fillStyle = cTertiary;
    ctx.font = `400 11px ${fontMono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= span; t += step) {
      const x = chartX + t * pxPerTick;
      ctx.beginPath();
      ctx.moveTo(x, axisY);
      ctx.lineTo(x, axisY + 4);
      ctx.stroke();
      ctx.fillText(String(t), x, axisY + 7);
    }
    if (span % step !== 0) {
      const x = chartX + span * pxPerTick;
      ctx.beginPath();
      ctx.moveTo(x, axisY);
      ctx.lineTo(x, axisY + 4);
      ctx.stroke();
      ctx.fillText(String(span), x, axisY + 7);
    }

    const playheadX = chartX + Math.min(span, visibleTime) * pxPerTick;
    ctx.strokeStyle = cAccent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, chartY - 6);
    ctx.lineTo(playheadX, chartY + chartH);
    ctx.stroke();

    ctx.fillStyle = cAccent;
    ctx.beginPath();
    ctx.moveTo(playheadX, chartY);
    ctx.lineTo(playheadX - 5, chartY - 8);
    ctx.lineTo(playheadX + 5, chartY - 8);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = cBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(chartX, chartY, chartW, chartH);
  }

  _drawSegment(ctx, segment, chartX, rowY, rowH, pxPerTick, visibleEnd, fontMono, borderColor) {
    const x = chartX + segment.start * pxPerTick;
    const w = Math.max(1, (visibleEnd - segment.start) * pxPerTick);
    const pad = 4;
    const y = rowY + pad;
    const h = Math.max(1, rowH - pad * 2);
    const color = this.colorMap.get(segment.tid) || pidToColor(segment.pid ?? segment.tid);
    const label = this.labelMap.get(segment.tid) || `T${segment.tid}`;

    ctx.fillStyle = color;
    roundRect(ctx, x, y, w, h, 2);
    ctx.fill();

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 2);
    ctx.stroke();

    if (w < 24) return;
    ctx.fillStyle = contrastTextColor(color);
    ctx.font = `600 11px ${fontMono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fitted = textFit(ctx, label, w - 8);
    if (fitted) ctx.fillText(fitted, x + w / 2, rowY + rowH / 2);
  }

  _traceEndTime(trace) {
    if (!trace || !Array.isArray(trace.timeline) || trace.timeline.length === 0) {
      return 1;
    }
    const last = trace.timeline[trace.timeline.length - 1];
    const lastRunning = Array.isArray(last.runningTids)
      ? last.runningTids.some(tid => tid !== null && tid !== undefined)
      : last.runningTid !== null && last.runningTid !== undefined;
    return Math.max(1, last.time + (lastRunning ? 1 : 0));
  }

  _maxSegmentTime(fallback) {
    let max = fallback;
    for (const segments of this.segmentsByCore) {
      for (const segment of segments) {
        max = Math.max(max, segment.end ?? fallback);
      }
    }
    return max;
  }
}

export function createRealtimeGanttRenderer(canvas) {
  return new RealtimeGanttRenderer(canvas);
}

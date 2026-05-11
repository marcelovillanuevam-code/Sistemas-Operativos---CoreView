// cpu-cores.js - DOM renderer for physical CPU core activity.

import { pidToColor } from './color-utils.js';

function formatPct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0%';
  return `${Math.round(numeric)}%`;
}

function normalizeState(state) {
  if (!state || state.tid === null || state.tid === undefined) return null;
  return {
    tid: state.tid,
    pid: state.pid,
  };
}

/**
 * @param {HTMLElement} container
 * @param {object} options
 * @param {number} options.numCores
 * @param {Array<object|null>} [options.coreStates]
 * @param {number[]} [options.coreUsage]
 * @param {Map<number,string>} [options.labelMap]
 * @param {Map<number,string>} [options.colorMap]
 */
export function renderCpuCores(container, {
  numCores,
  coreStates = [],
  coreUsage = [],
  labelMap = new Map(),
  colorMap = new Map(),
} = {}) {
  if (!container) return;

  const count = Math.max(1, Number(numCores) || 1);
  container.innerHTML = '';

  for (let coreIndex = 0; coreIndex < count; coreIndex += 1) {
    const state = normalizeState(coreStates[coreIndex]);
    const usage = Math.max(0, Math.min(100, Number(coreUsage[coreIndex] || 0)));
    const color = state
      ? colorMap.get(state.tid) || pidToColor(state.tid)
      : 'var(--border-default)';
    const label = state ? labelMap.get(state.tid) || `T${state.tid}` : 'Ocioso';

    const card = document.createElement('article');
    card.className = `tm-core-card${state ? ' tm-core-card--active' : ''}`;

    const top = document.createElement('div');
    top.className = 'tm-core-top';

    const title = document.createElement('span');
    title.className = 'tm-core-label';
    title.textContent = `Core ${coreIndex}`;
    top.appendChild(title);

    const thread = document.createElement('span');
    thread.className = 'tm-core-thread';
    thread.textContent = label;
    if (state) thread.style.color = color;
    top.appendChild(thread);

    card.appendChild(top);

    const percent = document.createElement('div');
    percent.className = 'tm-core-percent';
    percent.textContent = formatPct(usage);
    card.appendChild(percent);

    const meter = document.createElement('div');
    meter.className = 'tm-core-meter';
    const bar = document.createElement('span');
    bar.className = 'tm-core-meter-fill';
    bar.style.width = `${usage}%`;
    bar.style.background = state ? color : 'var(--border-default)';
    meter.appendChild(bar);
    card.appendChild(meter);

    container.appendChild(card);
  }
}

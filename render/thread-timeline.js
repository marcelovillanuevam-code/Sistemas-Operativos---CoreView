// thread-timeline.js - DOM timeline for thread states and core assignment.

import { pidToColor } from './color-utils.js';

function entryRunningTids(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.runningTids)) {
    return entry.runningTids.filter(tid => tid !== null && tid !== undefined);
  }
  return entry.runningTid === null || entry.runningTid === undefined ? [] : [entry.runningTid];
}

function flatThreadStates(entry) {
  if (!entry) return new Map();
  if (Array.isArray(entry.threadStates)) {
    return new Map(entry.threadStates.map(state => [state.tid, state.state]));
  }

  const states = new Map();
  for (const processState of entry.processStates || []) {
    for (const threadState of processState.threadStates || []) {
      states.set(threadState.tid, threadState.state);
    }
  }
  return states;
}

function normalizeCoreTid(entry, coreIndex) {
  if (!entry) return null;
  if (Array.isArray(entry.runningTids)) {
    return entry.runningTids[coreIndex] ?? null;
  }
  if (coreIndex === 0) return entry.runningTid ?? null;
  return null;
}

function threadStateAt(entry, tid) {
  const running = new Set(entryRunningTids(entry));
  if (running.has(tid)) return 'RUNNING';
  return flatThreadStates(entry).get(tid) || 'NEW';
}

function makeCell({
  text = '',
  title = '',
  className = '',
  color = '',
} = {}) {
  const cell = document.createElement('span');
  cell.className = `tm-tick ${className}`.trim();
  if (text) cell.textContent = text;
  if (title) cell.title = title;
  if (color) cell.style.setProperty('--tm-tick-color', color);
  return cell;
}

function appendRow(container, label, cells) {
  const row = document.createElement('div');
  row.className = 'tm-timeline-row';

  const labelEl = document.createElement('div');
  labelEl.className = 'tm-timeline-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const cellsEl = document.createElement('div');
  cellsEl.className = 'tm-timeline-cells';
  for (const cell of cells) cellsEl.appendChild(cell);
  row.appendChild(cellsEl);

  container.appendChild(row);
}

function renderLegend(container, threads, labelMap, colorMap) {
  const legend = document.createElement('div');
  legend.className = 'tm-legend';

  for (const thread of threads) {
    const color = colorMap.get(thread.tid) || pidToColor(thread.tid);
    const item = document.createElement('span');
    item.className = 'tm-legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'tm-legend-swatch';
    swatch.style.background = color;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(thread.shortLabel || labelMap.get(thread.tid) || `T${thread.tid}`));
    legend.appendChild(item);
  }

  const idle = document.createElement('span');
  idle.className = 'tm-legend-item';
  const idleSwatch = document.createElement('span');
  idleSwatch.className = 'tm-legend-swatch tm-legend-swatch--idle';
  idle.appendChild(idleSwatch);
  idle.appendChild(document.createTextNode('Ocioso / Espera'));
  legend.appendChild(idle);

  container.appendChild(legend);
}

/**
 * @param {HTMLElement} container
 * @param {object} options
 * @param {object} options.trace
 * @param {object[]} options.threads
 * @param {number} options.currentIndex
 * @param {number} options.numCores
 * @param {Map<number,string>} [options.labelMap]
 * @param {Map<number,string>} [options.colorMap]
 */
export function renderThreadTimeline(container, {
  trace,
  threads = [],
  currentIndex = 0,
  numCores = 1,
  labelMap = new Map(),
  colorMap = new Map(),
} = {}) {
  if (!container) return;
  container.innerHTML = '';

  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  if (timeline.length === 0 || threads.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tm-timeline-empty';
    empty.textContent = 'Ejecuta la simulacion para ver la asignacion.';
    container.appendChild(empty);
    return;
  }

  const visible = timeline.slice(0, Math.min(timeline.length, currentIndex + 1));

  for (const thread of threads) {
    const color = colorMap.get(thread.tid) || pidToColor(thread.tid);
    const cells = visible.map(entry => {
      const state = threadStateAt(entry, thread.tid);
      if (state === 'RUNNING') {
        return makeCell({
          text: labelMap.get(thread.tid) || `T${thread.tid}`,
          title: `t=${entry.time}: ejecutando`,
          className: 'tm-tick--run',
          color,
        });
      }
      if (state === 'WAITING_GIL') {
        return makeCell({
          title: `t=${entry.time}: esperando GIL`,
          className: 'tm-tick--gil-wait',
        });
      }
      if (state === 'READY') {
        return makeCell({
          title: `t=${entry.time}: listo`,
          className: 'tm-tick--ready',
        });
      }
      if (state === 'TERMINATED') {
        return makeCell({
          title: `t=${entry.time}: terminado`,
          className: 'tm-tick--done',
        });
      }
      return makeCell({
        title: `t=${entry.time}: sin ejecutar`,
        className: 'tm-tick--idle',
      });
    });
    appendRow(container, thread.displayLabel || labelMap.get(thread.tid) || `Hilo ${thread.tid}`, cells);
  }

  const separator = document.createElement('div');
  separator.className = 'tm-timeline-separator';
  separator.textContent = '--- HW CORES ---';
  container.appendChild(separator);

  const coreCount = Math.max(1, Number(numCores) || 1);
  for (let coreIndex = 0; coreIndex < coreCount; coreIndex += 1) {
    const cells = visible.map(entry => {
      const tid = normalizeCoreTid(entry, coreIndex);
      if (tid !== null && tid !== undefined) {
        const color = colorMap.get(tid) || pidToColor(tid);
        return makeCell({
          text: labelMap.get(tid) || `T${tid}`,
          title: `t=${entry.time}: ${labelMap.get(tid) || `T${tid}`}`,
          className: 'tm-tick--core',
          color,
        });
      }
      return makeCell({
        title: `t=${entry.time}: ocioso`,
        className: 'tm-tick--idle',
      });
    });
    appendRow(container, `Core ${coreIndex}`, cells);
  }

  renderLegend(container, threads, labelMap, colorMap);
}

// threads-multicore.js - Visual comparison of real parallel workers vs. CPython GIL serialization.

import { Dispatcher } from '../engine/dispatcher.js';
import { expandToThreads } from '../engine/thread-utils.js';
import { GIL_SWITCH_INTERVAL, runGILScheduler } from '../engine/gil-scheduler.js';
import { pidToColor } from '../render/color-utils.js';
import { renderCpuCores } from '../render/cpu-cores.js';
import { renderThreadTimeline } from '../render/thread-timeline.js';

const DEFAULT_TICK_MS = 160;
const THREAD_BURST_TICKS = 32;
const CORE_COUNTS = [1, 2, 4, 8];
const THREAD_COUNTS = [1, 2, 4, 8, 16];

let _timer = null;
let _trace = null;
let _threads = [];
let _labelMap = new Map();
let _colorMap = new Map();
let _currentIndex = 0;
let _dispatcher = null;
let _runToken = 0;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCpuBoundProcesses(threadCount) {
  const threads = Array.from({ length: threadCount }, (_, index) => ({
    tid: index + 1,
    parentPid: 1,
    arrivalTime: 0,
    burstTime: THREAD_BURST_TICKS,
    priority: 1,
    state: 'NEW',
    remainingTime: THREAD_BURST_TICKS,
    stackPages: 1,
  }));

  return [{
    pid: 1,
    arrivalTime: 0,
    burstTime: threads.reduce((sum, thread) => sum + thread.burstTime, 0),
    priority: 1,
    sharedPages: 2,
    numPages: 2 + threadCount,
    threads,
  }];
}

function buildThreadContext(processes) {
  const entities = expandToThreads(processes).map((entity, index) => ({
    ...entity,
    displayLabel: `Hilo ${index + 1}`,
    shortLabel: `T${index + 1}`,
  }));
  const labelMap = new Map();
  const colorMap = new Map();

  entities.forEach((entity, index) => {
    labelMap.set(entity.tid, `T${index + 1}`);
    colorMap.set(entity.tid, pidToColor((index + 1) * 17));
  });

  return { entities, labelMap, colorMap };
}

function normalizeCoreStates(entry, threadsByTid, numCores) {
  if (!entry) return Array(numCores).fill(null);
  if (Array.isArray(entry.coreStates) && entry.coreStates.length > 0) {
    return Array.from({ length: numCores }, (_, index) => {
      const state = entry.coreStates[index];
      return state ? { tid: state.tid, pid: state.pid } : null;
    });
  }

  const runningTids = Array.isArray(entry.runningTids)
    ? entry.runningTids
    : [entry.runningTid ?? null];

  return Array.from({ length: numCores }, (_, index) => {
    const tid = runningTids[index] ?? null;
    if (tid === null || tid === undefined) return null;
    const thread = threadsByTid.get(tid);
    return { tid, pid: thread ? thread.pid : null };
  });
}

function usageFromEntry(entry, coreStates) {
  if (entry && Array.isArray(entry.coreUsage)) {
    return coreStates.map((_, index) => Number(entry.coreUsage[index] || 0));
  }
  return coreStates.map(state => state ? 100 : 0);
}

function totalUsagePct(coreUsage, numCores) {
  if (!Array.isArray(coreUsage) || numCores <= 0) return 0;
  return coreUsage.reduce((sum, value) => sum + Number(value || 0), 0) / numCores;
}

function buildRuntime(mode, processes, numCores) {
  if (mode === 'python-gil') {
    return {
      trace: runGILScheduler({
        processes: clone(processes),
        numCores,
        switchInterval: GIL_SWITCH_INTERVAL,
      }),
      dispatcher: null,
    };
  }

  const dispatcher = new Dispatcher({
    processes: clone(processes),
    numCores,
    algorithm: 'FCFS',
    simSpeedMs: DEFAULT_TICK_MS,
  });
  return {
    trace: dispatcher.trace,
    dispatcher,
  };
}

function setButtonState(runButton, stopButton, running) {
  runButton.disabled = running;
  stopButton.disabled = !running;
}

function stopTimer() {
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
  }
}

function stopActiveDispatcher() {
  const dispatcher = _dispatcher;
  _dispatcher = null;
  if (dispatcher && !dispatcher.completed && !dispatcher.stopped) {
    dispatcher.stop();
  }
}

export function initThreadsMulticoreScreen() {
  const root = document.querySelector('[data-screen="threads-multicore"]');
  if (!root) return;

  root.innerHTML = `
    <h2>Multi-Core Threads</h2>
    <p class="screen-desc">
      Compara threads CPU-bound corriendo sobre Workers reales contra el bloqueo GIL de CPython.
    </p>

    <div class="tm-control-panel">
      <label class="tm-field">
        <span>Lenguaje / Entorno</span>
        <select id="tm-mode">
          <option value="workers">JavaScript (Web Workers)</option>
          <option value="python-gil">Python (Bloqueo GIL)</option>
        </select>
      </label>

      <label class="tm-field">
        <span>Núcleos (CPU Cores)</span>
        <select id="tm-cores">
          ${CORE_COUNTS.map(count => `<option value="${count}"${count === 4 ? ' selected' : ''}>${count}</option>`).join('')}
        </select>
      </label>

      <label class="tm-field">
        <span>Hilos a lanzar (Threads)</span>
        <select id="tm-threads">
          ${THREAD_COUNTS.map(count => `<option value="${count}"${count === 4 ? ' selected' : ''}>${count}</option>`).join('')}
        </select>
      </label>

      <div class="tm-actions">
        <button type="button" id="tm-run" class="inp-btn tm-run-btn">EJECUTAR</button>
        <button type="button" id="tm-stop" class="inp-btn tm-stop-btn" disabled>DETENER</button>
      </div>
    </div>

    <div id="tm-mode-note" class="tm-mode-note"></div>

    <div class="tm-workspace">
      <section class="tm-panel tm-cpu-panel">
        <div class="tm-panel-title" id="tm-cpu-title">CPU FÍSICA (4 núcleos)</div>
        <div id="tm-cpu-cores" class="tm-core-grid"></div>
      </section>

      <section class="tm-panel tm-timeline-panel">
        <div class="tm-panel-title">LÍNEA DE TIEMPO (ASIGNACIÓN)</div>
        <div id="tm-timeline" class="tm-timeline"></div>
      </section>
    </div>

    <footer class="tm-total-footer">
      <span>USO TOTAL DEL PROCESO</span>
      <strong id="tm-total-usage">0%</strong>
    </footer>
  `;

  const modeEl = root.querySelector('#tm-mode');
  const coresEl = root.querySelector('#tm-cores');
  const threadsEl = root.querySelector('#tm-threads');
  const runButton = root.querySelector('#tm-run');
  const stopButton = root.querySelector('#tm-stop');
  const modeNoteEl = root.querySelector('#tm-mode-note');
  const cpuTitleEl = root.querySelector('#tm-cpu-title');
  const coresContainer = root.querySelector('#tm-cpu-cores');
  const timelineContainer = root.querySelector('#tm-timeline');
  const totalUsageEl = root.querySelector('#tm-total-usage');

  function selectedMode() {
    return modeEl.value || 'workers';
  }

  function selectedCores() {
    return Number(coresEl.value) || 4;
  }

  function selectedThreads() {
    return Number(threadsEl.value) || 4;
  }

  function renderModeNote() {
    if (selectedMode() === 'python-gil') {
      modeNoteEl.textContent =
        `GIL activo: una sola hebra ejecuta bytecode por tick; el token rota cada ${GIL_SWITCH_INTERVAL} ticks.`;
      return;
    }
    modeNoteEl.textContent =
      'Workers activos: el Dispatcher puede ocupar varios cores físicos en el mismo tick.';
  }

  function renderStep() {
    const numCores = selectedCores();
    const entry = _trace?.timeline?.[_currentIndex] || null;
    const threadsByTid = new Map(_threads.map(thread => [thread.tid, thread]));
    const coreStates = normalizeCoreStates(entry, threadsByTid, numCores);
    const coreUsage = usageFromEntry(entry, coreStates);
    const usagePct = totalUsagePct(coreUsage, numCores);

    cpuTitleEl.textContent = `CPU FÍSICA (${numCores} núcleos)`;
    renderCpuCores(coresContainer, {
      numCores,
      coreStates,
      coreUsage,
      labelMap: _labelMap,
      colorMap: _colorMap,
    });
    renderThreadTimeline(timelineContainer, {
      trace: _trace,
      threads: _threads,
      currentIndex: _currentIndex,
      numCores,
      labelMap: _labelMap,
      colorMap: _colorMap,
    });
    totalUsageEl.textContent = `${Math.round(usagePct)}%`;
  }

  function renderIdle() {
    const numCores = selectedCores();
    const processes = buildCpuBoundProcesses(selectedThreads());
    const context = buildThreadContext(processes);
    _threads = context.entities;
    _labelMap = context.labelMap;
    _colorMap = context.colorMap;
    _trace = { timeline: [] };
    _currentIndex = 0;

    cpuTitleEl.textContent = `CPU FÍSICA (${numCores} núcleos)`;
    renderCpuCores(coresContainer, {
      numCores,
      coreStates: Array(numCores).fill(null),
      coreUsage: Array(numCores).fill(0),
      labelMap: _labelMap,
      colorMap: _colorMap,
    });
    renderThreadTimeline(timelineContainer, {
      trace: _trace,
      threads: _threads,
      currentIndex: 0,
      numCores,
      labelMap: _labelMap,
      colorMap: _colorMap,
    });
    totalUsageEl.textContent = '0%';
    renderModeNote();
  }

  function finishRun() {
    stopTimer();
    stopActiveDispatcher();
    setButtonState(runButton, stopButton, false);
  }

  async function runSimulation() {
    stopTimer();
    stopActiveDispatcher();
    const runToken = _runToken + 1;
    _runToken = runToken;

    const numCores = selectedCores();
    const processes = buildCpuBoundProcesses(selectedThreads());
    const context = buildThreadContext(processes);
    const runtime = buildRuntime(selectedMode(), processes, numCores);

    _threads = context.entities;
    _labelMap = context.labelMap;
    _colorMap = context.colorMap;
    _trace = runtime.trace;
    _dispatcher = runtime.dispatcher;
    _currentIndex = 0;

    renderModeNote();
    setButtonState(runButton, stopButton, true);
    renderStep();

    if (_dispatcher) {
      _dispatcher
        .onComplete(() => {
          if (runToken !== _runToken) return;
          console.info('[CoreView Worker] run complete', {
            workersAlive: _dispatcher?.workerPool?.size ?? 0,
          });
        })
        .onError(error => {
          if (runToken !== _runToken) return;
          modeNoteEl.textContent = `Error al iniciar Workers: ${error.message || error}`;
          finishRun();
        });

      try {
        await _dispatcher.start();
      } catch (error) {
        if (runToken !== _runToken) return;
        modeNoteEl.textContent = `Error al iniciar Workers: ${error.message || error}`;
        finishRun();
        return;
      }
    }

    _timer = setInterval(() => {
      if (runToken !== _runToken) {
        stopTimer();
        return;
      }

      if (!_trace || !_trace.timeline || _trace.timeline.length === 0) {
        finishRun();
        return;
      }

      if (_currentIndex >= _trace.timeline.length - 1) {
        finishRun();
        return;
      }

      _currentIndex += 1;
      renderStep();
    }, DEFAULT_TICK_MS);
  }

  function stopSimulation() {
    stopTimer();
    _runToken += 1;
    stopActiveDispatcher();
    setButtonState(runButton, stopButton, false);
  }

  runButton.addEventListener('click', runSimulation);
  stopButton.addEventListener('click', stopSimulation);

  modeEl.addEventListener('change', () => {
    if (_timer === null) renderIdle();
  });
  coresEl.addEventListener('change', () => {
    if (_timer === null) renderIdle();
  });
  threadsEl.addEventListener('change', () => {
    if (_timer === null) renderIdle();
  });

  document.querySelector('[data-tab="threads-multicore"]')?.addEventListener('click', () => {
    if (_timer === null) renderIdle();
  });

  renderIdle();
}

// screen-threads.js - Threads screen powered by Dispatcher realtime execution.

import { AppState } from '../app.js';
import { Dispatcher } from '../engine/dispatcher.js';
import { expandToThreads } from '../engine/thread-utils.js';
import { createRealtimeGanttRenderer } from '../render/gantt-realtime.js';
import { navigateTo } from '../render/ui-feedback.js';
import { buildResultsCSV, downloadCSV } from '../engine/csv-export.js';

const DEFAULT_SIM_SPEED_MS = 200;
const DEFAULT_QUANTUM = 2;
const CORE_COUNTS = [1, 2, 4, 8];

const ALGORITHMS = [
  { value: 'FCFS', label: 'FCFS' },
  { value: 'SJF', label: 'SJF' },
  { value: 'HRRN', label: 'HRRN' },
  { value: 'RR', label: 'RR' },
  { value: 'SRTF', label: 'SRTF' },
  { value: 'PRIORITY_PREEMPTIVE', label: 'Prioridad' },
];

// Appendix C.1: 3 processes, 6 threads.
const C1_PROCESSES = [
  {
    pid: 1,
    arrivalTime: 0,
    burstTime: 8,
    priority: 2,
    sharedPages: 3,
    numPages: 5,
    threads: [
      { tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 2, state: 'NEW', remainingTime: 5, stackPages: 1 },
      { tid: 2, parentPid: 1, arrivalTime: 0, burstTime: 3, priority: 2, state: 'NEW', remainingTime: 3, stackPages: 1 },
    ],
  },
  {
    pid: 2,
    arrivalTime: 1,
    burstTime: 4,
    priority: 1,
    sharedPages: 3,
    numPages: 4,
    threads: [
      { tid: 3, parentPid: 2, arrivalTime: 1, burstTime: 4, priority: 1, state: 'NEW', remainingTime: 4, stackPages: 1 },
    ],
  },
  {
    pid: 3,
    arrivalTime: 3,
    burstTime: 7,
    priority: 3,
    sharedPages: 4,
    numPages: 8,
    threads: [
      { tid: 4, parentPid: 3, arrivalTime: 3, burstTime: 2, priority: 3, state: 'NEW', remainingTime: 2, stackPages: 1 },
      { tid: 5, parentPid: 3, arrivalTime: 4, burstTime: 3, priority: 3, state: 'NEW', remainingTime: 3, stackPages: 2 },
      { tid: 6, parentPid: 3, arrivalTime: 5, burstTime: 2, priority: 3, state: 'NEW', remainingTime: 2, stackPages: 1 },
    ],
  },
];

let _dispatcher = null;
let _gantt = null;
let _runId = 0;
let _selectedCores = 1;
let _isPaused = false;
let _statusTimer = null;
let _activeTrace = null;
let _activeSpeedMs = DEFAULT_SIM_SPEED_MS;
let _activeTotalThreads = 0;
let _activeLabelMap = new Map();
let _activeThreadDetails = new Map();
let _completedMetrics = new Map();
let _lastExportMetrics = [];
let _lastExportNumCores = 1;

function cloneProcesses(processes) {
  return JSON.parse(JSON.stringify(processes));
}

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return '-';
  return value.toFixed(digits);
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function getTraceEndTime(trace) {
  if (!trace || !Array.isArray(trace.threadMetrics) || trace.threadMetrics.length === 0) {
    return 0;
  }
  return Math.max(...trace.threadMetrics.map(metric => metric.completionTime || 0));
}

function getObservedCompletion(metrics, speedMs) {
  if (Number.isFinite(metrics?.finishedAtWallMs) && speedMs > 0) {
    return metrics.finishedAtWallMs / speedMs;
  }
  if (Number.isFinite(metrics?.finishedAtSimMs) && speedMs > 0) {
    return metrics.finishedAtSimMs / speedMs;
  }
  return Number.isFinite(metrics?.completionTime) ? metrics.completionTime : null;
}

function diffPct(observed, expected) {
  if (!Number.isFinite(observed) || !Number.isFinite(expected)) return null;
  if (expected === 0) return Math.abs(observed) < 0.001 ? 0 : 100;
  return Math.abs(observed - expected) / Math.abs(expected) * 100;
}

function buildThreadContext(processes) {
  const entities = expandToThreads(processes);
  const byPid = new Map();
  const labelMap = new Map();
  const details = new Map();

  for (const entity of entities) {
    if (!byPid.has(entity.pid)) byPid.set(entity.pid, []);
    byPid.get(entity.pid).push(entity);
  }
  for (const group of byPid.values()) {
    group.sort((left, right) => left.tid - right.tid);
  }

  for (const entity of entities) {
    const group = byPid.get(entity.pid) || [entity];
    const localIndex = Math.max(0, group.findIndex(item => item.tid === entity.tid)) + 1;
    const tidLabel = `T${localIndex}`;
    const fullLabel = group.length > 1 ? `P${entity.pid}-${tidLabel}` : `P${entity.pid}`;

    labelMap.set(entity.tid, fullLabel);
    details.set(entity.tid, {
      pid: entity.pid,
      tidLabel,
      fullLabel,
      burstTime: entity.burstTime,
      arrivalTime: entity.arrivalTime,
    });
  }

  return { entities, labelMap, details };
}

function ensureThreadsStyles() {
  if (document.getElementById('threads-runtime-styles')) return;

  const style = document.createElement('style');
  style.id = 'threads-runtime-styles';
  style.textContent = `
    [data-screen="threads"] .th-runtime-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: var(--space-3);
      align-items: end;
      margin-bottom: var(--space-3);
    }

    [data-screen="threads"] .th-field {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      color: var(--text-secondary);
      font-size: 13px;
    }

    [data-screen="threads"] .th-field select,
    [data-screen="threads"] .th-field input[type="range"] {
      min-height: 34px;
    }

    [data-screen="threads"] .th-field select {
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
      background: var(--bg-surface);
      color: var(--text-primary);
      font-family: var(--font-ui);
      font-size: 13px;
    }

    [data-screen="threads"] .th-field input[type="range"] {
      accent-color: var(--accent);
    }

    [data-screen="threads"] .th-core-buttons {
      display: flex;
      gap: var(--space-1);
      flex-wrap: wrap;
    }

    [data-screen="threads"] .th-speed-row,
    [data-screen="threads"] .th-quantum-row {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    [data-screen="threads"] .th-speed-readout {
      min-width: 86px;
      color: var(--text-tertiary);
      font-family: var(--font-mono);
      font-size: 11px;
      line-height: 1.2;
      text-align: right;
    }

    [data-screen="threads"] .th-status-strip {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      background: var(--bg-surface);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      font-size: 13px;
    }

    [data-screen="threads"] .th-status-item {
      display: flex;
      gap: var(--space-2);
      align-items: baseline;
      min-width: 150px;
    }

    [data-screen="threads"] .th-status-value {
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-weight: 600;
    }

    [data-screen="threads"] .th-status-note {
      color: var(--text-tertiary);
      font-size: 11px;
      line-height: 1.2;
    }

    [data-screen="threads"] .th-metrics-wrap {
      overflow-x: auto;
    }

    [data-screen="threads"] .th-metrics-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      flex-wrap: wrap;
    }

    [data-screen="threads"] .th-error {
      margin-top: var(--space-2);
    }
  `;
  document.head.appendChild(style);
}

export function initThreadsScreen() {
  const root = document.querySelector('[data-screen="threads"]');
  if (!root) return;

  ensureThreadsStyles();

  root.innerHTML = `
    <h2>Threads - Ejecucion Multi-Core</h2>
    <p class="screen-desc">
      Ejecuta threads con el Dispatcher y observa el Gantt multi-core en tiempo real.
    </p>

    <div id="th-data-banner"></div>

    <div class="sched-config-panel">
      <div class="th-runtime-grid">
        <label class="th-field">
          Algoritmo
          <select id="th-algorithm">
            ${ALGORITHMS.map(algo => `<option value="${algo.value}">${algo.label}</option>`).join('')}
          </select>
        </label>

        <div class="th-field">
          <span>Cores</span>
          <div class="th-core-buttons" id="th-core-buttons">
            ${CORE_COUNTS.map(count => (
              `<button type="button" class="sched-algo-btn${count === _selectedCores ? ' active' : ''}" data-cores="${count}">${count}</button>`
            )).join('')}
          </div>
        </div>

        <label class="th-field" id="th-quantum-field" hidden>
          Quantum
          <span class="th-quantum-row">
            <input type="number" id="th-quantum" class="inp-num" min="1" max="20" value="${DEFAULT_QUANTUM}">
            <span class="th-status-note">ticks</span>
          </span>
        </label>

        <label class="th-field">
          Velocidad
          <span class="th-speed-row">
            <input type="range" id="th-speed" min="50" max="600" step="10" value="${DEFAULT_SIM_SPEED_MS}">
            <span id="th-speed-label" class="th-speed-readout">${DEFAULT_SIM_SPEED_MS} ms/tick</span>
          </span>
        </label>
      </div>

      <div class="sched-controls">
        <button type="button" data-action="run">Run</button>
        <button type="button" data-action="pause">Pause</button>
        <button type="button" data-action="resume">Resume</button>
        <button type="button" data-action="stop">Stop</button>
        <span class="sched-step">
          simMs <span id="th-sim-time">0</span>
        </span>
      </div>

      <div id="th-error" class="inp-error th-error" hidden></div>
    </div>

    <div class="sched-section">
      <div class="sched-section-title">
        Gantt en tiempo real
        <span class="help-hint" tabindex="0" data-tooltip="El Dispatcher emite cambios de core; el canvas consume un buffer y se redibuja con requestAnimationFrame.">?</span>
      </div>
      <canvas id="th-gantt" width="900" height="320" style="width:100%; height:320px;"></canvas>
    </div>

    <div class="sched-section">
      <div class="sched-section-title">
        Estado actual
        <span class="help-hint" tabindex="0" data-tooltip="RUNNING cuenta los cores ocupados en el último update del Dispatcher. Workers activos muestra los workers vivos en la corrida actual.">?</span>
      </div>
      <div class="th-status-strip">
        <div class="th-status-item">
          <span>Threads RUNNING ahora</span>
          <span id="th-running-count" class="th-status-value">0 / 0</span>
        </div>
        <div class="th-status-item">
          <span>Workers activos</span>
          <span id="th-worker-count" class="th-status-value">0</span>
        </div>
        <div class="th-status-item">
          <span>Estado</span>
          <span id="th-runtime-state" class="th-status-value">IDLE</span>
        </div>
      </div>
    </div>

    <div class="sched-section">
      <div class="sched-section-title th-metrics-title-row">
        <span>
          Metricas observadas vs. trace deterministico
          <span class="help-hint" tabindex="0" data-tooltip="CT obs usa el tiempo activo de pared convertido a ticks. CT trace viene del trace deterministico calculado por el Dispatcher.">?</span>
        </span>
        <button type="button" id="th-export-csv" class="inp-btn" hidden>Exportar CSV</button>
      </div>
      <div class="th-metrics-wrap">
        <table class="inp-table">
          <thead>
            <tr>
              <th>Proceso</th>
              <th>TID</th>
              <th>CT obs</th>
              <th>CT trace</th>
              <th>diff %</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody id="th-metrics-body"></tbody>
        </table>
      </div>
    </div>
  `;

  const dataBannerEl = root.querySelector('#th-data-banner');
  const algorithmEl = root.querySelector('#th-algorithm');
  const coreButtonsEl = root.querySelector('#th-core-buttons');
  const quantumFieldEl = root.querySelector('#th-quantum-field');
  const quantumEl = root.querySelector('#th-quantum');
  const speedEl = root.querySelector('#th-speed');
  const speedLabelEl = root.querySelector('#th-speed-label');
  const simTimeEl = root.querySelector('#th-sim-time');
  const runningCountEl = root.querySelector('#th-running-count');
  const workerCountEl = root.querySelector('#th-worker-count');
  const runtimeStateEl = root.querySelector('#th-runtime-state');
  const metricsBodyEl = root.querySelector('#th-metrics-body');
  const exportCsvBtn = root.querySelector('#th-export-csv');
  const errorEl = root.querySelector('#th-error');
  const ganttCanvas = root.querySelector('#th-gantt');

  _gantt = createRealtimeGanttRenderer(ganttCanvas);

  function renderDataBanner() {
    const usingUserData = AppState.processes && AppState.processes.length > 0;
    if (usingUserData) {
      dataBannerEl.innerHTML =
        `<div class="banner-info">` +
        `  <span class="banner-icon">i</span>` +
        `  Ejecutando con tus <b>${AppState.processes.length}</b> proceso(s) ingresados.` +
        `</div>`;
    } else {
      dataBannerEl.innerHTML =
        `<div class="banner-info banner-warn">` +
        `  <span class="banner-icon">!</span>` +
        `  Mostrando un <b>ejemplo</b> con 3 procesos y 6 threads. ` +
        `  <a href="#" id="th-goto-input">Ir a Entrada para definir tus procesos</a>` +
        `</div>`;
      dataBannerEl.querySelector('#th-goto-input')?.addEventListener('click', event => {
        event.preventDefault();
        navigateTo('input');
      });
    }
  }

  function getProcessesFromInput() {
    const processes = AppState.processes && AppState.processes.length > 0
      ? AppState.processes
      : C1_PROCESSES;
    return cloneProcesses(processes);
  }

  function getSelectedAlgorithm() {
    return algorithmEl.value || 'FCFS';
  }

  function getSelectedCores() {
    return _selectedCores;
  }

  function getQuantum() {
    const value = Number(quantumEl.value);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_QUANTUM;
  }

  function getSpeedMs() {
    const value = Number(speedEl.value);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_SIM_SPEED_MS;
  }

  function showError(message) {
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function setRuntimeState(value) {
    runtimeStateEl.textContent = value;
  }

  function workerCount() {
    return _dispatcher?.workerPool?.size ?? 0;
  }

  function updateStatus({ runningNow = null } = {}) {
    const runningValue = runningNow === null ? null : Number(runningNow);
    if (Number.isFinite(runningValue)) {
      runningCountEl.textContent = `${runningValue} / ${_activeTotalThreads}`;
    }
    workerCountEl.textContent = String(workerCount());
    if (_dispatcher && _gantt) {
      simTimeEl.textContent = formatNumber(_gantt.currentVisibleTime() * _activeSpeedMs, 0);
    }
  }

  function startStatusTimer() {
    stopStatusTimer();
    _statusTimer = setInterval(() => updateStatus(), 120);
  }

  function stopStatusTimer() {
    if (_statusTimer !== null) {
      clearInterval(_statusTimer);
      _statusTimer = null;
    }
  }

  function resetMetrics() {
    _completedMetrics.clear();
    _lastExportMetrics = [];
    exportCsvBtn.hidden = true;
    metricsBodyEl.innerHTML =
      `<tr><td colspan="6" class="pg-cell-result">Run para recolectar metricas.</td></tr>`;
  }

  function renderMetricsRows(metricsList, isFinal = false) {
    const traceMetricsByTid = new Map((_activeTrace?.threadMetrics || []).map(metric => [metric.tid, metric]));
    const rows = [];

    for (const metric of metricsList) {
      const expected = traceMetricsByTid.get(metric.tid);
      if (!expected) continue;

      const detail = _activeThreadDetails.get(metric.tid) || {
        pid: metric.pid,
        tidLabel: `T${metric.tid}`,
      };
      const observed = getObservedCompletion(metric, _activeSpeedMs);
      const expectedCt = expected.completionTime;
      const diff = diffPct(observed, expectedCt);
      const ok = Number.isFinite(diff) && diff < 10;

      rows.push(`
        <tr>
          <td>P${detail.pid}</td>
          <td>${detail.tidLabel}</td>
          <td>${formatNumber(observed, 1)}</td>
          <td>${formatNumber(expectedCt, 1)}</td>
          <td>${Number.isFinite(diff) ? `${formatNumber(diff, 1)}%` : '-'}</td>
          <td>${ok ? 'OK' : isFinal ? 'Revisar' : 'Parcial'}</td>
        </tr>
      `);
    }

    if (rows.length === 0) {
      metricsBodyEl.innerHTML =
        `<tr><td colspan="6" class="pg-cell-result">Sin threads completados todavia.</td></tr>`;
      return;
    }

    metricsBodyEl.innerHTML = rows.join('');
  }

  function appendMetricsRow(tid, metrics) {
    _completedMetrics.set(tid, metrics);
    renderMetricsRows([..._completedMetrics.values()], false);
  }

  function compareWithTrace(allMetrics) {
    renderMetricsRows(allMetrics, true);
  }

  function updateGanttBuffer(coreStates, currentSimTime) {
    _gantt.updateGanttBuffer(coreStates, currentSimTime);
  }

  function resetRuntimeView() {
    _activeTrace = null;
    _activeTotalThreads = 0;
    _activeLabelMap = new Map();
    _activeThreadDetails = new Map();
    _activeSpeedMs = getSpeedMs();
    _isPaused = false;

    stopStatusTimer();
    _gantt.reset({
      numCores: getSelectedCores(),
      simSpeedMs: _activeSpeedMs,
      title: 'Gantt en tiempo real',
      labelMap: new Map(),
    });
    resetMetrics();
    runningCountEl.textContent = '0 / 0';
    workerCountEl.textContent = '0';
    simTimeEl.textContent = '0';
    setRuntimeState('IDLE');
    showError('');
  }

  function stopCurrentDispatcher({ resetView = false } = {}) {
    _runId += 1;
    const current = _dispatcher;
    _dispatcher = null;
    _isPaused = false;
    stopStatusTimer();
    if (current && !current.stopped && !current.completed) {
      current.stop();
    }
    if (resetView) resetRuntimeView();
  }

  async function runDispatcher() {
    stopCurrentDispatcher();
    const runId = _runId + 1;
    _runId = runId;
    showError('');

    const processes = getProcessesFromInput();
    const threadContext = buildThreadContext(processes);
    _activeTotalThreads = threadContext.entities.length;
    _activeLabelMap = threadContext.labelMap;
    _activeThreadDetails = threadContext.details;
    _activeSpeedMs = getSpeedMs();
    _completedMetrics.clear();

    let dispatcher;
    try {
      dispatcher = new Dispatcher({
        processes,
        numCores: getSelectedCores(),
        algorithm: getSelectedAlgorithm(),
        quantum: getQuantum(),
        simSpeedMs: _activeSpeedMs,
      });
    } catch (error) {
      resetRuntimeView();
      showError(error.message || String(error));
      setRuntimeState('ERROR');
      return;
    }

    _dispatcher = dispatcher;
    _activeTrace = dispatcher.trace;
    _lastExportNumCores = dispatcher.numCores;
    AppState.schedulingTrace = _activeTrace;
    AppState.currentAlgorithm = getSelectedAlgorithm();
    resetMetrics();

    _gantt.reset({
      numCores: dispatcher.numCores,
      simSpeedMs: _activeSpeedMs,
      trace: _activeTrace,
      title: `${getSelectedAlgorithm()} - ${dispatcher.numCores} core${dispatcher.numCores === 1 ? '' : 's'}`,
      labelMap: _activeLabelMap,
    });
    _gantt.start(0);

    runningCountEl.textContent = `0 / ${_activeTotalThreads}`;
    workerCountEl.textContent = '0';
    simTimeEl.textContent = '0';
    setRuntimeState('STARTING');
    startStatusTimer();

    let runFailed = false;

    dispatcher
      .onCoreUpdate(coreStates => {
        if (runId !== _runId || dispatcher !== _dispatcher) return;
        if (_isPaused) return;

        const currentSimTime = dispatcher.simTime;
        updateGanttBuffer(coreStates, currentSimTime);

        const runningNow = coreStates.filter(core => core !== null).length;
        updateStatus({ runningNow });
        setRuntimeState(runningNow > 0 ? 'RUNNING' : 'WAITING');
      })
      .onThreadDone((tid, metrics) => {
        if (runId !== _runId || dispatcher !== _dispatcher) return;
        appendMetricsRow(tid, metrics);
        updateStatus();
      })
      .onComplete((allMetrics, totalSimMs) => {
        if (runId !== _runId || dispatcher !== _dispatcher) return;
        if (runFailed) return;

        _gantt.complete(totalSimMs / _activeSpeedMs);
        compareWithTrace(allMetrics);
        _lastExportMetrics = allMetrics.map(metric => ({ ...metric }));
        exportCsvBtn.hidden = false;
        stopStatusTimer();
        runningCountEl.textContent = `0 / ${_activeTotalThreads}`;
        workerCountEl.textContent = String(workerCount());
        simTimeEl.textContent = formatNumber(getTraceEndTime(_activeTrace) * _activeSpeedMs, 0);
        setRuntimeState('COMPLETE');
      })
      .onError(error => {
        if (runId !== _runId || dispatcher !== _dispatcher) return;
        runFailed = true;
        showError(error.message || String(error));
        setRuntimeState('ERROR');
        stopStatusTimer();
        updateStatus();
      });

    try {
      await dispatcher.start();
      if (runId !== _runId || dispatcher !== _dispatcher) return;
      updateStatus();
      if (!dispatcher.completed && !dispatcher.stopped) {
        setRuntimeState('RUNNING');
      }
    } catch (error) {
      if (runId !== _runId) return;
      showError(error.message || String(error));
      setRuntimeState('ERROR');
      stopStatusTimer();
    }
  }

  function pauseDispatcher() {
    if (!_dispatcher || _dispatcher.paused || _dispatcher.completed || _dispatcher.stopped) return;
    _isPaused = true;
    _gantt.pause();
    _dispatcher.pause();
    setRuntimeState('PAUSED');
    updateStatus();
  }

  function resumeDispatcher() {
    if (!_dispatcher || !_dispatcher.paused || _dispatcher.completed || _dispatcher.stopped) return;
    _isPaused = false;
    _gantt.resume();
    _dispatcher.resume();
    setRuntimeState('RUNNING');
    startStatusTimer();
    updateStatus();
  }

  function updateQuantumVisibility() {
    quantumFieldEl.hidden = getSelectedAlgorithm() !== 'RR';
  }

  function updateSpeedLabel() {
    speedLabelEl.textContent = `${getSpeedMs()} ms/tick`;
  }

  coreButtonsEl.addEventListener('click', event => {
    const button = event.target.closest('button[data-cores]');
    if (!button) return;
    _selectedCores = Number(button.dataset.cores) || 1;
    coreButtonsEl.querySelectorAll('button[data-cores]').forEach(item => {
      item.classList.toggle('active', item === button);
    });
    if (!_dispatcher || _dispatcher.completed || _dispatcher.stopped) {
      _gantt.reset({
        numCores: getSelectedCores(),
        simSpeedMs: getSpeedMs(),
        title: 'Gantt en tiempo real',
      });
    }
  });

  algorithmEl.addEventListener('change', updateQuantumVisibility);
  speedEl.addEventListener('input', updateSpeedLabel);

  root.querySelector('[data-action="run"]').addEventListener('click', () => {
    void runDispatcher();
  });
  root.querySelector('[data-action="pause"]').addEventListener('click', pauseDispatcher);
  root.querySelector('[data-action="resume"]').addEventListener('click', resumeDispatcher);
  root.querySelector('[data-action="stop"]').addEventListener('click', () => {
    stopCurrentDispatcher({ resetView: true });
  });
  exportCsvBtn.addEventListener('click', () => {
    const metrics = _lastExportMetrics.length > 0
      ? _lastExportMetrics
      : (_activeTrace?.threadMetrics || []);
    if (!metrics.length) return;

    const algorithm = getSelectedAlgorithm();
    const csv = buildResultsCSV(metrics, {
      algorithm,
      numCores: _lastExportNumCores || getSelectedCores(),
      quantum: algorithm === 'RR' ? getQuantum() : undefined,
      processes: getProcessesFromInput(),
    });
    downloadCSV(csv, `coreview-${algorithm}-${_lastExportNumCores || getSelectedCores()}cores-${timestampForFilename()}.csv`);
  });

  document.querySelector('[data-tab="threads"]')?.addEventListener('click', () => {
    renderDataBanner();
    if (_gantt) _gantt.draw();
  });

  renderDataBanner();
  updateQuantumVisibility();
  updateSpeedLabel();
  resetRuntimeView();
}

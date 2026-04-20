// screen-threads.js — Threads screen. Process selector, 5 panels, own AnimationController.

import { AppState }              from '../app.js';
import { generateThreadTrace }   from '../engine/thread-utils.js';
import { makeAnimationController } from '../render/animation.js';
import { renderThreadGantt }     from '../render/thread-visuals.js';
import { renderMemorySharing }   from '../render/thread-visuals.js';
import { renderThreadStateDiagram } from '../render/thread-visuals.js';
import { renderThreadEventLog }  from '../render/thread-visuals.js';

// ── Default processes (Appendix C.1) ─────────────────────────────────────────
const C1_PROCESSES = [
  {
    pid: 1, arrivalTime: 0, burstTime: 8, priority: 2, sharedPages: 3, numPages: 5,
    threads: [
      { tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 2, state: 'NEW', remainingTime: 5, stackPages: 1 },
      { tid: 2, parentPid: 1, arrivalTime: 0, burstTime: 3, priority: 2, state: 'NEW', remainingTime: 3, stackPages: 1 },
    ],
  },
  {
    pid: 2, arrivalTime: 1, burstTime: 4, priority: 1, sharedPages: 3, numPages: 4,
    threads: [
      { tid: 3, parentPid: 2, arrivalTime: 1, burstTime: 4, priority: 1, state: 'NEW', remainingTime: 4, stackPages: 1 },
    ],
  },
  {
    pid: 3, arrivalTime: 3, burstTime: 7, priority: 3, sharedPages: 4, numPages: 8,
    threads: [
      { tid: 4, parentPid: 3, arrivalTime: 3, burstTime: 2, priority: 3, state: 'NEW', remainingTime: 2, stackPages: 1 },
      { tid: 5, parentPid: 3, arrivalTime: 4, burstTime: 3, priority: 3, state: 'NEW', remainingTime: 3, stackPages: 2 },
      { tid: 6, parentPid: 3, arrivalTime: 5, burstTime: 2, priority: 3, state: 'NEW', remainingTime: 2, stackPages: 1 },
    ],
  },
];

// ── Module state ──────────────────────────────────────────────────────────────
let _controller = null;
let _trace      = null;
let _allEvents  = [];

export function initThreadsScreen() {
  const root = document.querySelector('[data-screen="threads"]');
  if (!root) return;

  root.innerHTML = `
    <h2>Threads</h2>

    <div class="th-selector-bar">
      <label>Process:
        <select id="th-proc-select"></select>
      </label>
    </div>

    <div class="sched-controls">
      <button data-action="play">▶ Play</button>
      <button data-action="pause">⏸ Pause</button>
      <button data-action="step-back">⏮ Step Back</button>
      <button data-action="step-forward">⏭ Step Forward</button>
      <label>Speed:
        <select data-action="speed">
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
        </select>
      </label>
      <span class="sched-step">
        Step <span id="th-step-display">0</span> / <span id="th-step-total">0</span>
      </span>
    </div>

    <div class="sched-section">
      <div class="sched-section-title">Thread Gantt</div>
      <canvas id="th-gantt" width="900" height="180"></canvas>
    </div>

    <div class="sched-section">
      <div class="sched-section-title">Thread State Diagram</div>
      <canvas id="th-state-diagram" width="900" height="300"></canvas>
    </div>

    <div class="sched-section">
      <div class="sched-section-title">Memory Sharing View</div>
      <div id="th-memory-sharing" class="ms-container"></div>
    </div>

    <div class="sched-section">
      <div class="sched-section-title">Event Log</div>
      <div id="th-event-log" class="tel-container"></div>
    </div>
  `;

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const procSelect   = root.querySelector('#th-proc-select');
  const ganttCanvas  = root.querySelector('#th-gantt');
  const ganttCtx     = ganttCanvas.getContext('2d');
  const stateCanvas  = root.querySelector('#th-state-diagram');
  const stateCtx     = stateCanvas.getContext('2d');
  const memContainer = root.querySelector('#th-memory-sharing');
  const logContainer = root.querySelector('#th-event-log');
  const stepDisplay  = root.querySelector('#th-step-display');
  const stepTotal    = root.querySelector('#th-step-total');

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function _getProcesses() {
    return AppState.processes && AppState.processes.length > 0
      ? AppState.processes
      : C1_PROCESSES;
  }

  function _buildSelector() {
    const procs = _getProcesses();
    procSelect.innerHTML = '';
    for (const p of procs) {
      const opt = document.createElement('option');
      opt.value = p.pid;
      const threadCount = p.threads && p.threads.length > 0 ? p.threads.length : 1;
      const suffix = threadCount > 1 ? ` (${threadCount} threads)` : '';
      opt.textContent = `P${p.pid}${suffix}`;
      procSelect.appendChild(opt);
    }
  }

  function _run(pid) {
    if (_controller) _controller.pause();

    const procs = _getProcesses();
    const config = AppState.currentAlgorithm
      ? { algorithm: AppState.currentAlgorithm }
      : { algorithm: 'FCFS' };

    _trace = generateThreadTrace(procs, pid, config);
    AppState.threadTraces.set(pid, _trace);
    AppState.selectedThreadPid = pid;

    _allEvents = _trace.allEvents || [];

    const totalSteps = _trace.timeline.length;
    stepTotal.textContent = String(totalSteps - 1);

    // Resize state canvas based on thread count
    const n = _trace.threads.length;
    stateCanvas.height = Math.max(160, n * 70 + 60);

    // Resize gantt canvas based on thread count
    ganttCanvas.height = Math.max(80, n * 50 + 56);

    _controller = makeAnimationController(totalSteps);
    _controller.onStepChange(_renderStep);
    _renderStep(0);

    root.querySelector('[data-action="speed"]').value = '1';
  }

  function _renderStep(step) {
    const s = step !== undefined ? step : _controller.getCurrentStep();
    stepDisplay.textContent = String(s);

    if (!_trace || s >= _trace.timeline.length) return;

    const entry = _trace.timeline[s];
    const currentTime = entry.time;

    // Panel 2: Thread Gantt
    renderThreadGantt(ganttCtx, _trace, s, ganttCanvas.width, ganttCanvas.height);

    // Panel 4: Thread State Diagram
    const currentStates = entry.threadStates.map(ts => ({ tid: ts.tid, state: ts.state }));
    // Determine process state
    const allTerminated = currentStates.every(ts => ts.state === 'TERMINATED');
    const anyRunning    = currentStates.some(ts => ts.state === 'RUNNING');
    const anyReady      = currentStates.some(ts => ts.state === 'READY');
    const processState  = allTerminated ? 'TERMINATED'
      : anyRunning  ? 'RUNNING'
      : anyReady    ? 'READY'
      : currentTime >= _trace.processArrivalTime ? 'READY'
      : 'NEW';

    renderThreadStateDiagram(stateCtx, _trace.threads, currentStates, null, processState);

    // Panel 3: Memory Sharing — stacks visible for threads that have arrived
    const activeTids = _trace.threads
      .filter(t => t.arrivalTime <= currentTime)
      .map(t => t.tid);
    renderMemorySharing(memContainer, _trace.sharedResources, _trace.threads, activeTids);

    // Panel 5: Event Log
    renderThreadEventLog(logContainer, _allEvents, currentTime);
  }

  // ── Controls ─────────────────────────────────────────────────────────────────
  procSelect.addEventListener('change', () => {
    _run(Number(procSelect.value));
  });

  root.querySelector('[data-action="play"]').addEventListener('click', () => {
    if (_controller) _controller.play();
  });
  root.querySelector('[data-action="pause"]').addEventListener('click', () => {
    if (_controller) _controller.pause();
  });
  root.querySelector('[data-action="step-back"]').addEventListener('click', () => {
    if (_controller) _controller.stepBackward();
  });
  root.querySelector('[data-action="step-forward"]').addEventListener('click', () => {
    if (_controller) _controller.stepForward();
  });
  root.querySelector('[data-action="speed"]').addEventListener('change', e => {
    if (_controller) _controller.setSpeed(Number(e.target.value));
  });

  // Re-run when tab activated
  document.querySelector('[data-tab="threads"]')?.addEventListener('click', () => {
    _buildSelector();
    const pid = Number(procSelect.value) || _getProcesses()[0].pid;
    _run(pid);
  });

  // ── Initial render ──────────────────────────────────────────────────────────
  _buildSelector();
  const initPid = _getProcesses()[0].pid;
  _run(initPid);
}

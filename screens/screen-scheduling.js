// screen-scheduling.js — Scheduling screen. Algorithm selector, animation, all visualizations.
// Wires engine → renderers → AnimationController. Caches traces per (algo+config+processes).

import { AppState }             from '../app.js';
import { runFCFS }              from '../engine/scheduling-fcfs.js';
import { runSJF }               from '../engine/scheduling-sjf.js';
import { runHRRN }              from '../engine/scheduling-hrrn.js';
import { runRoundRobin }        from '../engine/scheduling-rr.js';
import { runSRTF }              from '../engine/scheduling-srtf.js';
import { runPriorityPreemptive } from '../engine/scheduling-priority.js';
import { runMLQ }               from '../engine/scheduling-mlq.js';
import { runMLFQ }              from '../engine/scheduling-mlfq.js';
import { makeAnimationController } from '../render/animation.js';
import { renderGanttChart }     from '../render/gantt.js';
import { renderReadyQueue }     from '../render/ready-queue.js';
import { renderStateDiagram }   from '../render/state-diagram.js';
import { renderMetricsDashboard } from '../render/metrics-dashboard.js';
import { pidToColor }             from '../render/color-utils.js';

// ─── Defaults ────────────────────────────────────────────────────────────────

const A1_PROCESSES = [
  { pid: 1, arrivalTime: 0, burstTime: 5, priority: 2, sharedPages: 4, numPages: 5, threads: [] },
  { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1, sharedPages: 3, numPages: 4, threads: [] },
  { pid: 3, arrivalTime: 2, burstTime: 7, priority: 3, sharedPages: 5, numPages: 8, threads: [] },
];

const DEFAULT_MLQ_CONFIG = {
  algorithm: 'MLQ',
  mlqQueues: [
    { algorithm: 'RR',   priorityRange: [1, 1], quantum: 2 },
    { algorithm: 'RR',   priorityRange: [2, 2], quantum: 4 },
    { algorithm: 'FCFS', priorityRange: [3, 99] },
  ],
};

const DEFAULT_MLFQ_CONFIG = {
  algorithm: 'MLFQ',
  mlfqLevels: [
    { algorithm: 'RR',   quantum: 2 },
    { algorithm: 'RR',   quantum: 4 },
    { algorithm: 'FCFS', quantum: Infinity },
  ],
};

// ─── Module state ─────────────────────────────────────────────────────────────

const _cache = new Map();    // cacheKey → SchedulingTrace
let _lastProcKey = '';       // JSON of processes when cache was built
let _controller  = null;     // current AnimationController
let _prevProcessStates = null; // for state diagram transition tracking

// ─── Cache helpers ────────────────────────────────────────────────────────────

function _procKey() {
  return JSON.stringify(AppState.processes);
}

function _ensureFreshCache() {
  const k = _procKey();
  if (k !== _lastProcKey) {
    _cache.clear();
    _lastProcKey = k;
  }
}

function _getCached(cacheKey, compute) {
  _ensureFreshCache();
  if (!_cache.has(cacheKey)) _cache.set(cacheKey, compute());
  return _cache.get(cacheKey);
}

// ─── Label / color maps (built per trace) ────────────────────────────────────

function _buildLabelMap(trace) {
  const byPid = new Map();
  for (const m of trace.threadMetrics) {
    if (!byPid.has(m.pid)) byPid.set(m.pid, []);
    byPid.get(m.pid).push(m.tid);
  }
  for (const tids of byPid.values()) tids.sort((a, b) => a - b);
  const map = new Map();
  for (const [pid, tids] of byPid) {
    if (tids.length === 1) {
      map.set(tids[0], `P${pid}`);
    } else {
      tids.forEach((tid, i) => map.set(tid, `P${pid}-T${i + 1}`));
    }
  }
  return map;
}

function _buildColorMap(trace) {
  const map = new Map();
  for (const m of trace.threadMetrics) map.set(m.tid, pidToColor(m.pid));
  return map;
}

// ─── Queue-levels renderer (inline, MLQ/MLFQ only) ───────────────────────────

function _renderQueueLevels(container, entry, config, labelMap, colorMap) {
  container.innerHTML = '';
  if (!entry.queueLevels) return;

  const levels = entry.queueLevels;
  const isMlfq = config.algorithm === 'MLFQ';
  const cfgLevels = isMlfq ? (config.mlfqLevels || []) : (config.mlqQueues || []);

  for (const ql of levels) {
    const row = document.createElement('div');
    row.className = 'sched-ql-row';

    const lbl = document.createElement('span');
    lbl.className = 'sched-ql-label';
    const idx = isMlfq ? ql.level : ql.level - 1;
    const cfgEntry = cfgLevels[idx];
    let desc = `Q${ql.level} (${ql.algorithm}`;
    if (cfgEntry && ql.algorithm === 'RR') {
      const q = cfgEntry.quantum;
      if (q && isFinite(q)) desc += ` q=${q}`;
    }
    if (!isMlfq && cfgEntry && cfgEntry.priorityRange) {
      desc += ` pri ${cfgEntry.priorityRange[0]}–${cfgEntry.priorityRange[1]}`;
    }
    desc += ')';
    lbl.textContent = desc;
    row.appendChild(lbl);

    const slot = document.createElement('div');
    slot.className = 'sched-ql-slot';
    if (ql.entities.length === 0) {
      const emp = document.createElement('span');
      emp.className = 'rq-empty';
      emp.textContent = '(empty)';
      slot.appendChild(emp);
    } else {
      for (const e of ql.entities) {
        const chip = document.createElement('div');
        chip.className = 'sched-ql-chip';
        chip.textContent = e.label || labelMap.get(e.tid) || `T${e.tid}`;
        chip.style.backgroundColor = colorMap.get(e.tid) || '#888';
        chip.title = `rem: ${e.remainingTime}`;
        slot.appendChild(chip);
      }
    }
    row.appendChild(slot);
    container.appendChild(row);
  }

  // Show promotions/demotions for MLFQ
  if (isMlfq && entry.promotions && entry.promotions.length > 0) {
    const note = document.createElement('div');
    note.className = 'sched-ql-note sched-ql-note--promote';
    note.textContent = '↑ ' + entry.promotions.map(p =>
      `${labelMap.get(p.tid) || p.tid}: Q${p.from}→Q${p.to}`
    ).join(', ');
    container.appendChild(note);
  }
  if (isMlfq && entry.demotions && entry.demotions.length > 0) {
    const note = document.createElement('div');
    note.className = 'sched-ql-note sched-ql-note--demote';
    note.textContent = '↓ ' + entry.demotions.map(d =>
      `${labelMap.get(d.tid) || d.tid}: Q${d.from}→Q${d.to}`
    ).join(', ');
    container.appendChild(note);
  }
}

// ─── Main init ────────────────────────────────────────────────────────────────

export function initSchedulingScreen() {
  const root = document.querySelector('[data-screen="scheduling"]');
  if (!root) return;

  root.innerHTML = `
    <h2>Scheduling</h2>

    <div class="sched-algo-bar">
      <button class="sched-algo-btn" data-algo="FCFS">FCFS</button>
      <button class="sched-algo-btn" data-algo="SJF">SJF</button>
      <button class="sched-algo-btn" data-algo="HRRN">HRRN</button>
      <button class="sched-algo-btn" data-algo="RR">RR</button>
      <button class="sched-algo-btn" data-algo="SRTF">SRTF</button>
      <button class="sched-algo-btn" data-algo="PRIORITY_PREEMPTIVE">Priority</button>
      <button class="sched-algo-btn" data-algo="MLQ">MLQ</button>
      <button class="sched-algo-btn" data-algo="MLFQ">MLFQ</button>
    </div>

    <div id="sched-cfg-rr"    class="sched-config-panel" hidden>
      <label>Quantum (ticks):
        <input type="number" id="sched-quantum" class="inp-num" min="1" value="2" style="width:60px">
      </label>
    </div>

    <div id="sched-cfg-mlq"  class="sched-config-panel" hidden>
      <strong>Default MLQ config:</strong>
      Q1 RR q=2 (priority 1) · Q2 RR q=4 (priority 2) · Q3 FCFS (priority 3+)
    </div>

    <div id="sched-cfg-mlfq" class="sched-config-panel" hidden>
      <strong>Default MLFQ config:</strong>
      Q0 RR q=2 · Q1 RR q=4 · Q2 FCFS · Aging: 15 ticks in Q2 → promote to Q0
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
        Step <span id="sched-step-display">0</span> / <span id="sched-step-total">0</span>
      </span>
    </div>

    <div class="sched-section">
      <div class="sched-section-title">Gantt Chart</div>
      <canvas id="sched-gantt" width="900" height="220"></canvas>
    </div>

    <div class="sched-section">
      <div class="sched-section-title">Ready Queue</div>
      <div id="sched-ready-queue" class="rq-container"></div>
    </div>

    <div id="sched-queue-levels-wrap" class="sched-section" hidden>
      <div class="sched-section-title">Queue Levels</div>
      <div id="sched-queue-levels" class="sched-queue-levels"></div>
    </div>

    <div class="sched-section">
      <div class="sched-section-title">Process State Diagram</div>
      <canvas id="sched-state-diagram" width="900" height="300"></canvas>
    </div>

    <div class="sched-section">
      <div class="sched-section-title">Metrics</div>
      <div id="sched-metrics"></div>
    </div>
  `;

  // ── DOM refs ────────────────────────────────────────────────────────────
  const ganttCanvas     = root.querySelector('#sched-gantt');
  const ganttCtx        = ganttCanvas.getContext('2d');
  const stateCanvas     = root.querySelector('#sched-state-diagram');
  const stateCtx        = stateCanvas.getContext('2d');
  const rqContainer     = root.querySelector('#sched-ready-queue');
  const qlWrap          = root.querySelector('#sched-queue-levels-wrap');
  const qlContainer     = root.querySelector('#sched-queue-levels');
  const metricsContainer= root.querySelector('#sched-metrics');
  const stepDisplay     = root.querySelector('#sched-step-display');
  const stepTotal       = root.querySelector('#sched-step-total');
  const cfgRR           = root.querySelector('#sched-cfg-rr');
  const cfgMLQ          = root.querySelector('#sched-cfg-mlq');
  const cfgMLFQ         = root.querySelector('#sched-cfg-mlfq');

  let currentAlgo = 'FCFS';
  let currentTrace = null;
  let labelMap = null;
  let colorMap = null;

  // ── Config panels ────────────────────────────────────────────────────────
  function _showConfig(algo) {
    cfgRR.hidden   = algo !== 'RR';
    cfgMLQ.hidden  = algo !== 'MLQ';
    cfgMLFQ.hidden = algo !== 'MLFQ';
    qlWrap.hidden  = algo !== 'MLQ' && algo !== 'MLFQ';
  }

  // ── Compute trace ────────────────────────────────────────────────────────
  function _getProcesses() {
    return AppState.processes && AppState.processes.length > 0
      ? AppState.processes
      : A1_PROCESSES;
  }

  function _computeTrace(algo) {
    const procs = _getProcesses();
    const quantum = parseInt(root.querySelector('#sched-quantum').value, 10) || 2;
    switch (algo) {
      case 'FCFS':               return runFCFS(procs);
      case 'SJF':                return runSJF(procs);
      case 'HRRN':               return runHRRN(procs);
      case 'RR':                 return runRoundRobin(procs, quantum);
      case 'SRTF':               return runSRTF(procs);
      case 'PRIORITY_PREEMPTIVE': return runPriorityPreemptive(procs);
      case 'MLQ':                return runMLQ(procs, DEFAULT_MLQ_CONFIG);
      case 'MLFQ':               return runMLFQ(procs, DEFAULT_MLFQ_CONFIG);
      default:                   return runFCFS(procs);
    }
  }

  function _cacheKey(algo) {
    if (algo === 'RR') {
      const q = parseInt(root.querySelector('#sched-quantum').value, 10) || 2;
      return `RR_q${q}`;
    }
    return algo;
  }

  // ── Run and display ───────────────────────────────────────────────────────
  function _run(algo) {
    if (_controller) _controller.pause();

    currentAlgo = algo;
    _showConfig(algo);

    const key = _cacheKey(algo);
    currentTrace = _getCached(key, () => _computeTrace(algo));
    AppState.schedulingTrace  = currentTrace;
    AppState.currentAlgorithm = algo;

    labelMap = _buildLabelMap(currentTrace);
    colorMap = _buildColorMap(currentTrace);
    _prevProcessStates = null;

    const totalSteps = currentTrace.timeline.length;
    stepTotal.textContent = String(totalSteps - 1);

    _controller = makeAnimationController(totalSteps);
    _controller.onStepChange(_renderStep);
    _renderStep(0);

    // Metrics don't change with animation — render once
    renderMetricsDashboard(metricsContainer, [currentTrace]);

    // Sync speed selector
    root.querySelector('[data-action="speed"]').value = '1';
  }

  // ── Per-step render ───────────────────────────────────────────────────────
  function _renderStep(step) {
    const s = step !== undefined ? step : _controller.getCurrentStep();
    stepDisplay.textContent = String(s);

    const entry = currentTrace.timeline[s];
    const gW = ganttCanvas.width;
    const gH = ganttCanvas.height;

    renderGanttChart(ganttCtx, currentTrace, s, gW, gH);
    renderReadyQueue(rqContainer, entry, labelMap, colorMap);

    if (currentAlgo === 'MLQ' || currentAlgo === 'MLFQ') {
      const cfg = currentAlgo === 'MLQ' ? DEFAULT_MLQ_CONFIG : DEFAULT_MLFQ_CONFIG;
      _renderQueueLevels(qlContainer, entry, cfg, labelMap, colorMap);
    }

    renderStateDiagram(stateCtx, entry.processStates, _prevProcessStates, labelMap, colorMap);
    _prevProcessStates = entry.processStates;
  }

  // ── Algorithm button clicks ───────────────────────────────────────────────
  root.querySelectorAll('.sched-algo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.sched-algo-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _run(btn.dataset.algo);
    });
  });

  // ── Quantum input re-run ──────────────────────────────────────────────────
  root.querySelector('#sched-quantum').addEventListener('change', () => {
    if (currentAlgo === 'RR') _run('RR');
  });

  // ── Animation controls ────────────────────────────────────────────────────
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

  // ── Re-run when tab is activated (picks up input changes) ─────────────────
  document.querySelector('[data-tab="scheduling"]')?.addEventListener('click', () => {
    _ensureFreshCache();
    _run(currentAlgo);
  });

  // ── Initial render ────────────────────────────────────────────────────────
  root.querySelector('[data-algo="FCFS"]').classList.add('active');
  _run('FCFS');
}

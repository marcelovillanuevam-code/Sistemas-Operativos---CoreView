// screen-paging.js — Page Replacement screen glue. Reads AppState.memoryConfig + referenceString,
// runs selected algorithm, wires AnimationController to PageTable and ClockVisual renderers.

import { AppState }               from '../app.js';
import { generateReferenceString } from '../data.js';
import { runFIFO }                from '../engine/paging-fifo.js';
import { runLRU }                 from '../engine/paging-lru.js';
import { runOptimal }             from '../engine/paging-optimal.js';
import { runClock }               from '../engine/paging-clock.js';
import { runSecondChance }        from '../engine/paging-second-chance.js';
import { makeAnimationController } from '../render/animation.js';
import { renderPageReplacementTable } from '../render/page-table.js';
import { renderClockDiagram }     from '../render/clock-visual.js';

// ─── Defaults ─────────────────────────────────────────────────────────────────

// Appendix B reference string: [1,2,3,4,1,2,5,1,2,3,4,5], all pid=1
const DEFAULT_REFS = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5].map(n => ({ pid: 1, pageNumber: n }));

const A1_PROCESSES = [
  { pid: 1, arrivalTime: 0, burstTime: 5, priority: 2, sharedPages: 4, numPages: 5,
    threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 2, stackPages: 1 }] },
  { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1, sharedPages: 3, numPages: 4,
    threads: [{ tid: 2, parentPid: 2, arrivalTime: 1, burstTime: 3, priority: 1, stackPages: 1 }] },
  { pid: 3, arrivalTime: 2, burstTime: 7, priority: 3, sharedPages: 5, numPages: 6,
    threads: [{ tid: 3, parentPid: 3, arrivalTime: 2, burstTime: 7, priority: 3, stackPages: 1 }] },
];

const CLOCK_ALGOS = new Set(['CLOCK', 'SECOND_CHANCE']);

// ─── Module state ──────────────────────────────────────────────────────────────

let _algo      = 'FIFO';
let _numFrames = 3;
let _refs      = [...DEFAULT_REFS];
let _trace     = null;
let _ctrl      = null;

// ─── Engine dispatch ──────────────────────────────────────────────────────────

function _runEngine() {
  switch (_algo) {
    case 'FIFO':          return runFIFO(_numFrames, _refs);
    case 'LRU':           return runLRU(_numFrames, _refs);
    case 'OPTIMAL':       return runOptimal(_numFrames, _refs);
    case 'CLOCK':         return runClock(_numFrames, _refs);
    case 'SECOND_CHANCE': return runSecondChance(_numFrames, _refs);
    default:              return runFIFO(_numFrames, _refs);
  }
}

// ─── Reference-string helpers ─────────────────────────────────────────────────

function _parseCustomString(raw) {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const refs = [];
  for (const tok of tokens) {
    if (tok.includes(':')) {
      const [pidStr, pgStr] = tok.split(':');
      const pid = parseInt(pidStr, 10);
      const pg  = parseInt(pgStr, 10);
      if (isNaN(pid) || isNaN(pg)) return null;
      refs.push({ pid, pageNumber: pg });
    } else {
      const pg = parseInt(tok, 10);
      if (isNaN(pg)) return null;
      refs.push({ pid: 1, pageNumber: pg });
    }
  }
  return refs;
}

// ─── Main init ────────────────────────────────────────────────────────────────

export function initPagingScreen() {
  const root = document.querySelector('[data-screen="paging"]');
  if (!root) return;

  root.innerHTML = `
    <h2>Page Replacement</h2>

    <!-- Algorithm selector -->
    <div class="pg-algo-bar">
      <button class="pg-algo-btn active" data-algo="FIFO">FIFO</button>
      <button class="pg-algo-btn" data-algo="LRU">LRU</button>
      <button class="pg-algo-btn" data-algo="OPTIMAL">Optimal</button>
      <button class="pg-algo-btn" data-algo="CLOCK">Clock</button>
      <button class="pg-algo-btn" data-algo="SECOND_CHANCE">Second Chance</button>
    </div>

    <!-- Configuration -->
    <div class="pg-config">
      <div class="pg-config-row">
        <label class="pg-config-label">
          Frames:
          <input id="pg-frames" type="number" class="inp-num" min="1" max="32" value="3" style="width:60px">
        </label>
        <span class="pg-config-sep">|</span>
        <div class="pg-src-toggle">
          <button class="pg-src-btn active" id="pg-src-auto">Auto</button>
          <button class="pg-src-btn" id="pg-src-custom">Custom</button>
        </div>
      </div>
      <div id="pg-auto-panel" class="pg-config-row">
        <label class="pg-config-label">
          Length:
          <input id="pg-reflen" type="number" class="inp-num" min="1" max="200" value="20" style="width:60px">
        </label>
        <button class="inp-btn" id="pg-btn-generate">Generate</button>
      </div>
      <div id="pg-custom-panel" class="pg-config-row" hidden>
        <label class="pg-config-label">Reference string:</label>
        <input id="pg-custom-str" class="pg-custom-input"
          placeholder="e.g. 1 2 3 4 1 2 5 1 2 3 4 5   or   1:0 2:0 1:1">
        <button class="inp-btn" id="pg-btn-apply">Apply</button>
        <span id="pg-custom-err" class="pg-custom-err" hidden></span>
      </div>
    </div>

    <!-- Animation controls -->
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
        Step <span id="pg-step-cur">0</span> / <span id="pg-step-tot">0</span>
      </span>
    </div>

    <!-- Reference string display -->
    <div class="sched-section">
      <div class="sched-section-title">Reference String</div>
      <div id="pg-refstring" class="pg-refstring"></div>
    </div>

    <!-- Hit/Fault indicator -->
    <div id="pg-indicator" class="pg-indicator"></div>

    <!-- Summary stats (whole trace) -->
    <div id="pg-stats" class="pg-stats"></div>

    <!-- Main body: table + clock canvas -->
    <div class="pg-body">
      <div class="pg-table-col">
        <div class="sched-section-title">Frame States</div>
        <div id="pg-table-container"></div>
      </div>
      <div class="pg-clock-col" id="pg-clock-col" hidden>
        <div class="sched-section-title">Clock Buffer</div>
        <canvas id="pg-clock-canvas" width="360" height="360"></canvas>
      </div>
    </div>
  `;

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const framesInput    = root.querySelector('#pg-frames');
  const reflenInput    = root.querySelector('#pg-reflen');
  const customInput    = root.querySelector('#pg-custom-str');
  const customErr      = root.querySelector('#pg-custom-err');
  const autoPanel      = root.querySelector('#pg-auto-panel');
  const customPanel    = root.querySelector('#pg-custom-panel');
  const srcAutoBtn     = root.querySelector('#pg-src-auto');
  const srcCustomBtn   = root.querySelector('#pg-src-custom');
  const refstringEl    = root.querySelector('#pg-refstring');
  const indicatorEl    = root.querySelector('#pg-indicator');
  const statsEl        = root.querySelector('#pg-stats');
  const tableContainer = root.querySelector('#pg-table-container');
  const clockCol       = root.querySelector('#pg-clock-col');
  const clockCanvas    = root.querySelector('#pg-clock-canvas');
  const clockCtx       = clockCanvas.getContext('2d');
  const stepCur        = root.querySelector('#pg-step-cur');
  const stepTot        = root.querySelector('#pg-step-tot');

  let _useAuto = true;

  // ── Reference string source toggle ─────────────────────────────────────────
  srcAutoBtn.addEventListener('click', () => {
    _useAuto = true;
    srcAutoBtn.classList.add('active');
    srcCustomBtn.classList.remove('active');
    autoPanel.hidden = false;
    customPanel.hidden = true;
    _generateAndRun();
  });

  srcCustomBtn.addEventListener('click', () => {
    _useAuto = false;
    srcCustomBtn.classList.add('active');
    srcAutoBtn.classList.remove('active');
    customPanel.hidden = false;
    autoPanel.hidden = true;
    // Pre-fill custom input with current ref string
    customInput.value = _refs.map(r => r.pageNumber).join(' ');
  });

  // ── Config changes ──────────────────────────────────────────────────────────
  framesInput.addEventListener('change', () => {
    const v = parseInt(framesInput.value, 10);
    if (v >= 1 && v <= 32) { _numFrames = v; _run(); }
  });

  root.querySelector('#pg-btn-generate').addEventListener('click', _generateAndRun);
  root.querySelector('#pg-btn-apply').addEventListener('click', _applyCustom);

  customInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') _applyCustom();
  });

  // ── Algorithm buttons ───────────────────────────────────────────────────────
  root.querySelectorAll('.pg-algo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.pg-algo-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _algo = btn.dataset.algo;
      _run();
    });
  });

  // ── Animation controls ──────────────────────────────────────────────────────
  root.querySelector('[data-action="play"]').addEventListener('click', () => _ctrl?.play());
  root.querySelector('[data-action="pause"]').addEventListener('click', () => _ctrl?.pause());
  root.querySelector('[data-action="step-back"]').addEventListener('click', () => _ctrl?.stepBackward());
  root.querySelector('[data-action="step-forward"]').addEventListener('click', () => _ctrl?.stepForward());
  root.querySelector('[data-action="speed"]').addEventListener('change', e => {
    _ctrl?.setSpeed(Number(e.target.value));
  });

  // ── Re-run when tab is activated ────────────────────────────────────────────
  document.querySelector('[data-tab="paging"]')?.addEventListener('click', () => {
    if (_useAuto) _generateAndRun();
    else _run();
  });

  // ─── Generate reference string (auto mode) ─────────────────────────────────
  function _generateAndRun() {
    const length = parseInt(reflenInput.value, 10) || 20;
    const procs  = (AppState.processes && AppState.processes.length > 0)
      ? AppState.processes
      : A1_PROCESSES;
    _refs = generateReferenceString(procs, length);
    _numFrames = parseInt(framesInput.value, 10) || 3;
    _run();
  }

  // ─── Apply custom reference string ─────────────────────────────────────────
  function _applyCustom() {
    const parsed = _parseCustomString(customInput.value);
    if (!parsed || parsed.length === 0) {
      customErr.textContent = 'Invalid format. Use space-separated numbers, e.g. "1 2 3 4 1 2 5".';
      customErr.hidden = false;
      return;
    }
    customErr.hidden = true;
    _refs = parsed;
    _numFrames = parseInt(framesInput.value, 10) || 3;
    _run();
  }

  // ─── Run simulation and wire animation ─────────────────────────────────────
  function _run() {
    if (_ctrl) _ctrl.pause();

    _trace = _runEngine();
    AppState.pageReplacementTrace = _trace;
    AppState.referenceString = _refs;

    const total = _trace.steps.length;
    stepTot.textContent = String(total);
    stepCur.textContent = '1';

    // Show/hide clock visual
    const needsClock = CLOCK_ALGOS.has(_algo);
    clockCol.hidden = !needsClock;

    // Build reference string chips (once per run)
    _buildRefStringChips();

    // Summary stats (static, whole trace)
    _renderStats();

    // Create animation controller
    _ctrl = makeAnimationController(total);
    _ctrl.onStepChange(_renderStep);

    // Reset speed selector
    root.querySelector('[data-action="speed"]').value = '1';

    _renderStep(0);
  }

  // ─── Build reference string chip row ───────────────────────────────────────
  function _buildRefStringChips() {
    refstringEl.innerHTML = '';
    const allSamePid = _refs.every(r => r.pid === _refs[0].pid);
    for (let i = 0; i < _refs.length; i++) {
      const ref  = _refs[i];
      const chip = document.createElement('div');
      chip.className = 'pg-ref-step';
      chip.dataset.step = i;
      const label = allSamePid ? `${ref.pageNumber}` : `P${ref.pid}:${ref.pageNumber}`;
      chip.innerHTML =
        `<div class="pg-ref-step-num">${i + 1}</div>` +
        `<div class="pg-ref-step-page">${label}</div>`;
      refstringEl.appendChild(chip);
    }
  }

  // ─── Per-step render ────────────────────────────────────────────────────────
  function _renderStep(stepIdx) {
    const s = stepIdx !== undefined ? stepIdx : _ctrl.getCurrentStep();
    stepCur.textContent = String(s + 1);

    const step = _trace.steps[s];

    // Update reference string highlight + scroll current into view
    for (const chip of refstringEl.children) {
      const idx = parseInt(chip.dataset.step);
      chip.classList.toggle('pg-ref-step--current', idx === s);
      chip.classList.toggle('pg-ref-step--past', idx < s);
    }
    const curChip = refstringEl.querySelector('.pg-ref-step--current');
    if (curChip) curChip.scrollIntoView({ inline: 'nearest', block: 'nearest' });

    // Hit/Fault indicator
    _renderIndicator(step);

    // Page table
    renderPageReplacementTable(tableContainer, _trace, s);

    // Clock diagram
    if (CLOCK_ALGOS.has(_algo)) {
      renderClockDiagram(clockCtx, step, _numFrames);
    }
  }

  // ─── Hit/Fault indicator ────────────────────────────────────────────────────
  function _renderIndicator(step) {
    const hits = step.stepIndex + 1 - step.faultsSoFar;
    indicatorEl.innerHTML =
      (step.isHit
        ? `<span class="pg-badge pg-badge--hit pg-badge--lg">HIT</span>`
        : `<span class="pg-badge pg-badge--fault pg-badge--lg">PAGE FAULT</span>`) +
      `<span class="pg-indicator-stat">Faults: <b>${step.faultsSoFar}</b></span>` +
      `<span class="pg-indicator-stat">Hits: <b>${hits}</b></span>` +
      `<span class="pg-indicator-stat">Step: <b>${step.stepIndex + 1}</b> / <b>${_trace.steps.length}</b></span>`;
  }

  // ─── Whole-trace summary stats ──────────────────────────────────────────────
  function _renderStats() {
    statsEl.innerHTML =
      `<span>Algorithm: <b>${_algo}</b></span>` +
      `<span>Frames: <b>${_numFrames}</b></span>` +
      `<span>Total Refs: <b>${_trace.referenceString.length}</b></span>` +
      `<span>Total Faults: <b>${_trace.totalFaults}</b></span>` +
      `<span>Total Hits: <b>${_trace.totalHits}</b></span>` +
      `<span>Hit Rate: <b>${(_trace.hitRate * 100).toFixed(1)}%</b></span>`;
  }

  // ── Initial render ──────────────────────────────────────────────────────────
  _refs      = [...DEFAULT_REFS];
  _numFrames = 3;
  _run();
}

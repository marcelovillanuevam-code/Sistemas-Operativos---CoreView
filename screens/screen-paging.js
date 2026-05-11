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
import { toast, navigateTo }      from '../render/ui-feedback.js';

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

const ALGO_DESCRIPTIONS = {
  FIFO:          'FIFO — Reemplaza la página que ha estado más tiempo en memoria.',
  LRU:           'LRU — Reemplaza la página menos recientemente usada (Least Recently Used).',
  OPTIMAL:       'Optimal — Reemplaza la página que tardará más en volver a usarse. Referencia teórica.',
  CLOCK:         'Clock — Algoritmo del reloj con bit de referencia, recorrido circular.',
  SECOND_CHANCE: 'Second Chance — FIFO con bit de referencia: si está marcado, da una segunda oportunidad.',
};

let _algo      = 'FIFO';
let _numFrames = 3;
let _refs      = [...DEFAULT_REFS];
let _trace     = null;
let _ctrl      = null;

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

/**
 * Generates a random reference string with ~70% locality (stay in current process/region).
 * @param {{ pid: number, numPages: number }[]} procs
 * @param {number} length
 * @returns {{ pid: number, pageNumber: number }[]}
 */
function _generateRandomRefs(procs, length) {
  if (!procs.length || length <= 0) return [];
  const refs = [];
  let pidIdx = Math.floor(Math.random() * procs.length);
  let lastPage = 0;
  for (let i = 0; i < length; i++) {
    // 30% chance to switch process
    if (Math.random() < 0.3) pidIdx = Math.floor(Math.random() * procs.length);
    const proc = procs[pidIdx];
    const pages = proc.numPages || 1;
    // 70% locality: pick a nearby page; 30% random jump
    const page = Math.random() < 0.7
      ? (lastPage + Math.floor(Math.random() * 3)) % pages
      : Math.floor(Math.random() * pages);
    refs.push({ pid: proc.pid, pageNumber: page });
    lastPage = page;
  }
  return refs;
}

function _parseCustomString(raw) {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length > 200) return null;
  const refs = [];
  for (const tok of tokens) {
    if (tok.includes(':')) {
      const [pidStr, pgStr] = tok.split(':');
      const pid = parseInt(pidStr, 10);
      const pg  = parseInt(pgStr, 10);
      if (isNaN(pid) || isNaN(pg) || pid < 1 || pg < 0) return null;
      refs.push({ pid, pageNumber: pg });
    } else {
      const pg = parseInt(tok, 10);
      if (isNaN(pg) || pg < 0) return null;
      refs.push({ pid: 1, pageNumber: pg });
    }
  }
  return refs;
}

export function initPagingScreen() {
  const root = document.querySelector('[data-screen="paging"]');
  if (!root) return;

  root.innerHTML = `
    <h2>Reemplazo de páginas</h2>
    <p class="screen-desc">
      Selecciona un algoritmo y una <b>cadena de referencias</b> de páginas.
      El simulador muestra paso a paso qué páginas están en cada marco, los
      hits y los page faults.
    </p>

    <div id="pg-data-banner"></div>

    <div class="pg-algo-bar">
      <button class="pg-algo-btn active" data-algo="FIFO">FIFO</button>
      <button class="pg-algo-btn" data-algo="LRU">LRU</button>
      <button class="pg-algo-btn" data-algo="OPTIMAL">Optimal</button>
      <button class="pg-algo-btn" data-algo="CLOCK">Clock</button>
      <button class="pg-algo-btn" data-algo="SECOND_CHANCE">Second Chance</button>
    </div>

    <div id="pg-algo-desc" class="sched-config-panel"></div>
    <div class="concept-panel">
      <div class="concept-panel-title">Que estas viendo</div>
      <div class="concept-panel-grid">
        <div><b>Cadena de referencias</b>: paginas solicitadas en orden. La pagina actual avanza con Play o Siguiente.</div>
        <div><b>Marcos</b>: cupos fisicos disponibles. Si la pagina pedida ya esta cargada hay HIT.</div>
        <div><b>Page fault</b>: la pagina no esta en memoria; el algoritmo decide que pagina cargar o reemplazar.</div>
      </div>
    </div>

    <div class="pg-config">
      <div class="pg-config-row">
        <label class="pg-config-label">
          Marcos:
          <input id="pg-frames" type="number" class="inp-num" min="1" max="32" value="3" style="width:60px">
          <span class="help-hint" tabindex="0" data-tooltip="Número de marcos físicos disponibles para esta simulación de paginación. Independiente de la configuración de Memoria. Rango: 1–32.">?</span>
        </label>
        <span class="pg-config-sep">|</span>
        <span class="pg-config-label">Origen de la cadena:</span>
        <div class="pg-src-toggle">
          <button class="pg-src-btn active" id="pg-src-auto">Auto</button>
          <button class="pg-src-btn" id="pg-src-custom">Personalizada</button>
        </div>
      </div>
      <div id="pg-auto-panel" class="pg-config-row">
        <label class="pg-config-label">
          Longitud:
          <input id="pg-reflen" type="number" class="inp-num" min="1" max="100" value="20" style="width:60px">
        </label>
        <button class="inp-btn" id="pg-btn-generate">Generar</button>
        <span class="field-help">Genera una cadena alternando páginas de los procesos cargados.</span>
      </div>
      <div id="pg-custom-panel" class="pg-config-row" hidden>
        <label class="pg-config-label">Cadena de referencias:</label>
        <input id="pg-custom-str" class="pg-custom-input"
          placeholder="ej: 1 2 3 4 1 2 5 1 2 3 4 5   o   1:0 2:0 1:1">
        <button class="inp-btn" id="pg-btn-apply">Aplicar</button>
        <span id="pg-custom-err" class="pg-custom-err" hidden></span>
        <div class="field-help">
          Números separados por espacio. Usa <code>pid:página</code> para multiproceso.
          Máx. 200 referencias.
        </div>
      </div>
    </div>

    <div class="sched-controls">
      <button data-action="play"         title="Reproducir">▶ Play</button>
      <button data-action="pause"        title="Pausar">⏸ Pausa</button>
      <button data-action="step-back"    title="Paso atrás">⏮ Atrás</button>
      <button data-action="step-forward" title="Paso adelante">⏭ Siguiente</button>
      <label>Velocidad:
        <select data-action="speed">
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
        </select>
      </label>
      <span class="sched-step">
        Paso <span id="pg-step-cur">0</span> / <span id="pg-step-tot">0</span>
      </span>
    </div>

    <div class="sched-section">
      <div class="sched-section-title">
        Cadena de referencias
        <span class="help-hint" tabindex="0" data-tooltip="Secuencia de páginas solicitadas en orden temporal. Cada chip representa una referencia. La actual se resalta en amarillo.">?</span>
      </div>
      <div id="pg-refstring" class="pg-refstring"></div>
    </div>

    <div id="pg-indicator" class="pg-indicator"></div>

    <div id="pg-stats" class="pg-stats"></div>

    <div class="pg-body">
      <div class="pg-table-col">
        <div class="sched-section-title">
          Estado de los marcos
          <span class="help-hint" tabindex="0" data-tooltip="Tabla con el contenido de cada marco después de cada referencia. Verde = hit (ya estaba). Rojo = page fault (hubo que cargarla).">?</span>
        </div>
        <div id="pg-table-container"></div>
      </div>
      <div class="pg-clock-col" id="pg-clock-col" hidden>
        <div class="sched-section-title">Buffer del Clock</div>
        <canvas id="pg-clock-canvas" width="360" height="360"></canvas>
      </div>
    </div>
  `;

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
  const algoDescEl     = root.querySelector('#pg-algo-desc');
  const dataBannerEl   = root.querySelector('#pg-data-banner');

  let _useAuto = true;

  function _renderDataBanner() {
    const usingUserData = AppState.processes && AppState.processes.length > 0;
    if (usingUserData) {
      dataBannerEl.innerHTML =
        `<div class="banner-info">` +
        `  <span class="banner-icon">●</span>` +
        `  Generando cadenas a partir de tus <b>${AppState.processes.length}</b> proceso(s).` +
        `</div>`;
    } else {
      dataBannerEl.innerHTML =
        `<div class="banner-info banner-warn">` +
        `  <span class="banner-icon">⚠</span>` +
        `  Usando una cadena de referencias de <b>ejemplo</b>. ` +
        `  <a href="#" id="pg-goto-input">Ir a Entrada para usar tus procesos →</a>` +
        `</div>`;
      dataBannerEl.querySelector('#pg-goto-input')?.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo('input');
      });
    }
  }

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
    customInput.value = _refs.map(r => r.pageNumber).join(' ');
  });

  framesInput.addEventListener('change', () => {
    let v = parseInt(framesInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > 32) v = 32;
    framesInput.value = v;
    _numFrames = v;
    _run();
  });

  reflenInput.addEventListener('change', () => {
    let v = parseInt(reflenInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > 100) v = 100;
    reflenInput.value = v;
  });

  root.querySelector('#pg-btn-generate').addEventListener('click', _generateAndRun);
  root.querySelector('#pg-btn-apply').addEventListener('click', _applyCustom);

  customInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') _applyCustom();
  });

  root.querySelectorAll('.pg-algo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.pg-algo-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _algo = btn.dataset.algo;
      algoDescEl.textContent = ALGO_DESCRIPTIONS[_algo] || '';
      _run();
    });
  });

  root.querySelector('[data-action="play"]').addEventListener('click', () => _ctrl?.play());
  root.querySelector('[data-action="pause"]').addEventListener('click', () => _ctrl?.pause());
  root.querySelector('[data-action="step-back"]').addEventListener('click', () => _ctrl?.stepBackward());
  root.querySelector('[data-action="step-forward"]').addEventListener('click', () => _ctrl?.stepForward());
  root.querySelector('[data-action="speed"]').addEventListener('change', e => {
    _ctrl?.setSpeed(Number(e.target.value));
  });

  document.querySelector('[data-tab="paging"]')?.addEventListener('click', () => {
    _renderDataBanner();
    if (_useAuto) _generateAndRun();
    else _run();
  });

  function _generateAndRun() {
    const length = parseInt(reflenInput.value, 10) || 20;
    const procs  = (AppState.processes && AppState.processes.length > 0)
      ? AppState.processes
      : A1_PROCESSES;
    _refs = _generateRandomRefs(procs, length);
    _numFrames = parseInt(framesInput.value, 10) || 3;
    _run();
  }

  function _applyCustom() {
    const parsed = _parseCustomString(customInput.value);
    if (!parsed || parsed.length === 0) {
      customErr.textContent = 'Formato inválido. Usa números separados por espacio (máx. 200).';
      customErr.hidden = false;
      toast('Cadena de referencias inválida.', 'err');
      return;
    }
    customErr.hidden = true;
    _refs = parsed;
    _numFrames = parseInt(framesInput.value, 10) || 3;
    _run();
    toast(`Aplicada cadena de ${parsed.length} referencias.`, 'ok', 1800);
  }

  function _run() {
    if (_ctrl) _ctrl.pause();

    _trace = _runEngine();
    AppState.pageReplacementTrace = _trace;
    AppState.referenceString = _refs;

    const total = _trace.steps.length;
    stepTot.textContent = String(total);
    stepCur.textContent = '1';

    const needsClock = CLOCK_ALGOS.has(_algo);
    clockCol.hidden = !needsClock;

    _buildRefStringChips();
    _renderStats();

    _ctrl = makeAnimationController(total);
    _ctrl.onStepChange(_renderStep);

    root.querySelector('[data-action="speed"]').value = '1';

    _renderStep(0);
    algoDescEl.textContent = ALGO_DESCRIPTIONS[_algo] || '';
  }

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

  function _renderStep(stepIdx) {
    const s = stepIdx !== undefined ? stepIdx : _ctrl.getCurrentStep();
    stepCur.textContent = String(s + 1);

    const step = _trace.steps[s];

    for (const chip of refstringEl.children) {
      const idx = parseInt(chip.dataset.step);
      chip.classList.toggle('pg-ref-step--current', idx === s);
      chip.classList.toggle('pg-ref-step--past', idx < s);
    }
    const curChip = refstringEl.querySelector('.pg-ref-step--current');
    if (curChip) curChip.scrollIntoView({ inline: 'nearest', block: 'nearest' });

    _renderIndicator(step);
    renderPageReplacementTable(tableContainer, _trace, s);

    if (CLOCK_ALGOS.has(_algo)) {
      renderClockDiagram(clockCtx, step, _numFrames);
    }
  }

  function _renderIndicator(step) {
    const hits = step.stepIndex + 1 - step.faultsSoFar;
    indicatorEl.innerHTML =
      (step.isHit
        ? `<span class="pg-badge pg-badge--hit pg-badge--lg">HIT</span>`
        : `<span class="pg-badge pg-badge--fault pg-badge--lg">PAGE FAULT</span>`) +
      `<span class="pg-indicator-stat">Fallos: <b>${step.faultsSoFar}</b></span>` +
      `<span class="pg-indicator-stat">Aciertos: <b>${hits}</b></span>` +
      `<span class="pg-indicator-stat">Paso: <b>${step.stepIndex + 1}</b> / <b>${_trace.steps.length}</b></span>`;
  }

  function _renderStats() {
    statsEl.innerHTML =
      `<span>Algoritmo: <b>${_algo}</b></span>` +
      `<span>Marcos: <b>${_numFrames}</b></span>` +
      `<span>Referencias: <b>${_trace.referenceString.length}</b></span>` +
      `<span>Total Fallos: <b>${_trace.totalFaults}</b></span>` +
      `<span>Total Aciertos: <b>${_trace.totalHits}</b></span>` +
      `<span>Tasa de aciertos: <b>${(_trace.hitRate * 100).toFixed(1)}%</b></span>`;
  }

  _renderDataBanner();
  _refs      = [...DEFAULT_REFS];
  _numFrames = 3;
  _run();
}

// screen-input.js — Input screen glue. Wires process/memory form DOM to data.js parsers.
// Produces Process[] (with threads) and MemoryConfig, stores in AppState.

import {
  parseProcessesFromForm,
  parseProcessesFromFileValidated,
  parseMemoryConfig,
  validateProcesses,
  generateReferenceString,
} from '../data.js';
import { AppState } from '../app.js';
import {
  cloneProcessMetadata,
  getProcessTable,
  setProcessTable,
  simulatedFork,
} from '../engine/process-model.js';
import { toast, setAppStatus, navigateTo } from '../render/ui-feedback.js';

// Hard limits to prevent absurd inputs and catastrophic UI.
const LIMITS = {
  arrival:    { min: 0, max: 200 },
  burst:      { min: 1, max: 100 },
  priority:   { min: 1, max: 99 },
  shared:     { min: 1, max: 32 },
  threads:    { min: 0, max: 8 },
  stackPages: { min: 1, max: 16 },
  totalMem:   { min: 8,  max: 8192 },
  pageSize:   { min: 1,  max: 1024 },
  processes:  { min: 1, max: 16 },
};
const IMPORT_ROW_DELAY_MS = 60;

const EXAMPLE_PRESETS = [
  {
    id: 'basic',
    title: 'Base 5 columnas',
    meta: '3 procesos',
    description: 'Carga mínima para FCFS, SJF, Priority y page replacement simple.',
    memory: { totalMemory: 256, pageSize: 32 },
    showThreads: false,
    processes: [
      { pid: 1, arrivalTime: 0, burstTime: 5, priority: 2, sharedPages: 4, threads: [] },
      { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1, sharedPages: 3, threads: [] },
      { pid: 3, arrivalTime: 2, burstTime: 7, priority: 3, sharedPages: 5, threads: [] },
    ],
  },
  {
    id: 'threads',
    title: 'Threads escalonados',
    meta: '3 procesos / 6 threads',
    description: 'Expone CPU bursts por thread, llegadas distintas y stacks privados.',
    memory: { totalMemory: 512, pageSize: 64 },
    showThreads: true,
    processes: [
      {
        pid: 1,
        arrivalTime: 0,
        burstTime: 8,
        priority: 2,
        sharedPages: 3,
        threads: [
          { arrivalTime: 0, burstTime: 5, stackPages: 1 },
          { arrivalTime: 0, burstTime: 3, stackPages: 1 },
        ],
      },
      {
        pid: 2,
        arrivalTime: 1,
        burstTime: 4,
        priority: 1,
        sharedPages: 3,
        threads: [
          { arrivalTime: 1, burstTime: 4, stackPages: 1 },
        ],
      },
      {
        pid: 3,
        arrivalTime: 3,
        burstTime: 7,
        priority: 3,
        sharedPages: 4,
        threads: [
          { arrivalTime: 3, burstTime: 2, stackPages: 1 },
          { arrivalTime: 4, burstTime: 3, stackPages: 2 },
          { arrivalTime: 5, burstTime: 2, stackPages: 1 },
        ],
      },
    ],
  },
  {
    id: 'fork-cow',
    title: 'Fork + COW',
    meta: 'Padres, hijos y COW',
    description: 'Crea hijos con fork() para revisar Copy-on-Write en Memoria.',
    memory: { totalMemory: 512, pageSize: 32 },
    showThreads: true,
    forks: [1, 2],
    processes: [
      {
        pid: 1,
        arrivalTime: 0,
        burstTime: 6,
        priority: 2,
        sharedPages: 4,
        threads: [
          { arrivalTime: 0, burstTime: 4, stackPages: 1 },
          { arrivalTime: 1, burstTime: 2, stackPages: 1 },
        ],
      },
      {
        pid: 2,
        arrivalTime: 2,
        burstTime: 5,
        priority: 1,
        sharedPages: 5,
        threads: [
          { arrivalTime: 2, burstTime: 3, stackPages: 2 },
          { arrivalTime: 3, burstTime: 2, stackPages: 1 },
        ],
      },
      { pid: 3, arrivalTime: 4, burstTime: 4, priority: 4, sharedPages: 2, threads: [] },
    ],
  },
  {
    id: 'mixed-stress',
    title: 'Mixto completo',
    meta: '5 procesos / prioridades',
    description: 'Combina single-thread, multi-thread, memoria baja y colas con prioridad.',
    memory: { totalMemory: 256, pageSize: 16 },
    showThreads: true,
    processes: [
      { pid: 1, arrivalTime: 0, burstTime: 9, priority: 4, sharedPages: 6, threads: [] },
      {
        pid: 2,
        arrivalTime: 1,
        burstTime: 7,
        priority: 1,
        sharedPages: 4,
        threads: [
          { arrivalTime: 1, burstTime: 2, stackPages: 1 },
          { arrivalTime: 2, burstTime: 3, stackPages: 2 },
          { arrivalTime: 3, burstTime: 2, stackPages: 1 },
        ],
      },
      { pid: 3, arrivalTime: 2, burstTime: 4, priority: 2, sharedPages: 3, threads: [] },
      {
        pid: 4,
        arrivalTime: 4,
        burstTime: 6,
        priority: 5,
        sharedPages: 2,
        threads: [
          { arrivalTime: 4, burstTime: 3, stackPages: 1 },
          { arrivalTime: 6, burstTime: 3, stackPages: 2 },
        ],
      },
      { pid: 5, arrivalTime: 6, burstTime: 3, priority: 3, sharedPages: 5, threads: [] },
    ],
  },
];

// Auto-incrementing PID counter; resets to 1 on clear/example load.
let _nextPid = 1;
// Map<pid, { localTidCounter: number }>
const _procMeta = new Map();
const _forkMetaByPid = new Map();
let _loadedFileCount = 0;
let _importRenderToken = 0;

function _helpHint(text, pos = '') {
  const posAttr = pos ? ` data-tooltip-pos="${pos}"` : '';
  return `<span class="help-hint" tabindex="0" data-tooltip="${text}"${posAttr}>i</span>`;
}

function _renderExampleCards() {
  return EXAMPLE_PRESETS.map((preset, index) => `
    <button type="button" class="inp-example-card" data-example-id="${preset.id}"${index === 0 ? ' id="inp-load-example"' : ''}>
      <span class="inp-example-meta">${preset.meta}</span>
      <span class="inp-example-title">${preset.title}</span>
      <span class="inp-example-desc">${preset.description}</span>
      <span class="inp-example-memory">${preset.memory.totalMemory} KB / ${preset.memory.pageSize} KB = ${preset.memory.totalMemory / preset.memory.pageSize} frames</span>
    </button>
  `).join('');
}

function _fieldCell(label, hint, inputHtml, className = '') {
  return `
    <td class="inp-field-cell ${className}">
      <label class="inp-field">
        <span class="inp-field-top">${label} ${_helpHint(hint)}</span>
        ${inputHtml}
      </label>
    </td>
  `;
}

function _processCells(proc, { hasThreads = false, pidCell = null } = {}) {
  const pid = proc.pid;
  const threads = Array.isArray(proc.threads) ? proc.threads : [];
  const threadCount = threads.length;
  const threadLabel = `${threadCount} thread${threadCount !== 1 ? 's' : ''}`;
  const toggleText = `▼ ${threadLabel}`;

  return `
    <td class="inp-pid-cell">
      <span class="inp-pid-kicker">Proceso</span>
      ${pidCell || `<span class="inp-pid-main">P${pid}</span>`}
    </td>
    ${_fieldCell(
      'Llegada',
      `Instante en que el proceso entra al sistema. Tick >= 0. Rango: ${LIMITS.arrival.min}-${LIMITS.arrival.max}.`,
      `<input type="number" class="inp-num inp-arrival" min="${LIMITS.arrival.min}" max="${LIMITS.arrival.max}" value="${proc.arrivalTime}">`,
      'inp-field-cell--arrival'
    )}
    ${_fieldCell(
      'CPU burst',
      `Tiempo total de CPU. Si tiene threads, se calcula como suma de CPU bursts. Rango: ${LIMITS.burst.min}-${LIMITS.burst.max}.`,
      `<input type="number" class="inp-num inp-burst${hasThreads ? ' inp-readonly' : ''}" min="${LIMITS.burst.min}" max="${LIMITS.burst.max}" value="${proc.burstTime}"${hasThreads ? ' readonly' : ''}>`,
      'inp-field-cell--burst'
    )}
    ${_fieldCell(
      'Prioridad',
      `Menor número = mayor prioridad. Usado por Priority, MLQ y MLFQ. Rango: ${LIMITS.priority.min}-${LIMITS.priority.max}.`,
      `<input type="number" class="inp-num inp-priority" min="${LIMITS.priority.min}" max="${LIMITS.priority.max}" value="${proc.priority}">`,
      'inp-field-cell--priority'
    )}
    ${_fieldCell(
      'Shared pages',
      `Páginas compartidas por todos los threads. Total = sharedPages + suma(stackPages). Rango: ${LIMITS.shared.min}-${LIMITS.shared.max}.`,
      `<input type="number" class="inp-num inp-shared" min="${LIMITS.shared.min}" max="${LIMITS.shared.max}" value="${proc.sharedPages}">`,
      'inp-field-cell--shared'
    )}
    <td class="inp-thread-cell">
      <div class="inp-field">
        <span class="inp-field-top">Threads ${_helpHint(`Desglosa el CPU burst en threads independientes. Máximo ${LIMITS.threads.max} por proceso.`)}</span>
        <div class="inp-thread-actions">
          <button type="button" class="inp-btn-sm inp-toggle-threads" data-pid="${pid}"${hasThreads ? '' : ' hidden'}>${toggleText}</button>
          <button type="button" class="inp-btn-sm inp-add-thread" data-pid="${pid}">+ Thread</button>
        </div>
      </div>
    </td>
    <td class="inp-action-cell">
      <span class="inp-field-top">Acciones ${_helpHint('Fork duplica el proceso y activa páginas Copy-on-Write para revisarlas en Memoria.', 'left')}</span>
      <div class="inp-row-actions">
        <button type="button" class="inp-btn-sm inp-fork-proc" data-pid="${pid}" title="Simular fork()">Fork()</button>
        <button type="button" class="inp-btn-sm inp-btn-danger inp-del-proc" data-pid="${pid}" title="Eliminar proceso">×</button>
      </div>
    </td>
  `;
}

function _threadCells(localTid, arrival, burst, stackPages) {
  return `
    <span class="inp-thread-label">T${localTid}</span>
    <label class="inp-thread-field">
      <span>Llegada ${_helpHint(`Tick de llegada del thread. Debe ser >= llegada del proceso.`)}</span>
      <input type="number" class="inp-num inp-t-arrival" min="${LIMITS.arrival.min}" max="${LIMITS.arrival.max}" value="${arrival}" title="Thread arrival">
    </label>
    <label class="inp-thread-field">
      <span>CPU burst ${_helpHint(`CPU requerida por este thread. Rango: ${LIMITS.burst.min}-${LIMITS.burst.max}.`)}</span>
      <input type="number" class="inp-num inp-t-burst" min="${LIMITS.burst.min}" max="${LIMITS.burst.max}" value="${burst}" title="Thread burst">
    </label>
    <label class="inp-thread-field">
      <span>Stack ${_helpHint(`Páginas privadas del stack del thread. Rango: ${LIMITS.stackPages.min}-${LIMITS.stackPages.max}.`)}</span>
      <input type="number" class="inp-num inp-t-stack" min="${LIMITS.stackPages.min}" max="${LIMITS.stackPages.max}" value="${stackPages}" title="Stack pages">
    </label>
    <button type="button" class="inp-btn-sm inp-btn-danger inp-del-thread" title="Eliminar thread">×</button>
  `;
}

export function initInputScreen() {
  const root = document.querySelector('[data-screen="input"]');
  if (!root) return;

  _ensureForkStyles();

  root.innerHTML = `
    <h2>Entrada de procesos</h2>
    <p class="screen-desc">
      Define los procesos que serán simulados. Cada proceso tiene un tiempo de
      llegada, una ráfaga total de CPU, una prioridad y un número de páginas
      compartidas. Opcionalmente puedes desglosar la ráfaga en varios threads.
    </p>

    <section class="inp-section">
      <div class="inp-section-header">
        <h3>Procesos</h3>
        <button class="help-panel-toggle" id="inp-help-toggle">¿Cómo funciona el archivo .txt?</button>
      </div>

      <div id="inp-help-panel" class="help-panel" hidden>
        <p><b>Hay dos formatos aceptados.</b> Los archivos son valores separados por
        comas (CSV). Las líneas que comienzan con <code>#</code> son comentarios y
        se ignoran.</p>

        <div class="help-format">
          <div class="help-format-title">1) Single-threaded — 5 columnas</div>
          <div class="help-format-cols">
            <code>pid,arrival,burst,priority,sharedPages</code>
          </div>
          <div class="help-format-label">Ejemplo (3 procesos):</div>
<pre class="help-format-sample"># pid,arrival,burst,priority,sharedPages
1,0,5,2,4
2,1,3,1,3
3,2,7,3,5</pre>
        </div>

        <div class="help-format">
          <div class="help-format-title">2) Multi-threaded — 9 columnas (una fila por thread)</div>
          <div class="help-format-cols">
            <code>pid,arrival,procBurst,priority,sharedPages,tid,tArrival,tBurst,stackPages</code>
          </div>
          <div class="help-format-note">
            El campo <code>procBurst</code> a nivel de proceso se ignora; se
            calcula automáticamente como la suma de las ráfagas de los threads.
            El <code>tid</code> también se ignora (los TIDs se reasignan
            globalmente). Repite la primera fila por cada thread del proceso.
          </div>
          <div class="help-format-label">Ejemplo (3 procesos: P1 con 2 threads, P2 con 1, P3 con 3 threads):</div>
<pre class="help-format-sample"># pid,arr,procBurst(ignorado),pri,sharedPg,tid(ignorado),tArr,tBurst,stackPg
1,0,0,2,3,1,0,5,1
1,0,0,2,3,2,0,3,1
2,1,0,1,3,1,1,4,1
3,3,0,3,4,1,3,2,1
3,3,0,3,4,2,4,3,2
3,3,0,3,4,3,5,2,1</pre>
        </div>

        <div class="help-format-actions">
          <button class="inp-btn-sm" id="inp-download-template-5">⬇ Descargar plantilla 5-col</button>
          <button class="inp-btn-sm" id="inp-download-template-9">⬇ Descargar plantilla 9-col</button>
        </div>
      </div>

      <div class="inp-toolbar">
        <button id="inp-add-process" class="inp-btn">+ Agregar proceso</button>
        <label class="inp-btn" for="inp-file-upload" style="cursor:pointer">Subir .txt</label>
        <label class="inp-btn" id="inp-load-another-file" for="inp-file-upload" style="cursor:pointer" hidden>Cargar otro archivo</label>
        <input type="file" id="inp-file-upload" accept=".txt,.csv" style="display:none">
        <button id="inp-clear-all" class="inp-btn inp-btn-outline-danger">Limpiar todo</button>
      </div>
      <div class="inp-examples">
        <div class="inp-examples-head">
          <div>
            <div class="inp-examples-title">Ejemplos de carga</div>
            <div class="inp-examples-desc">Escenarios listos para probar procesos, threads, fork(), COW y page replacement.</div>
          </div>
          ${_helpHint('Cada ejemplo reemplaza la captura actual y ajusta memoria con valores válidos.', 'left')}
        </div>
        <div class="inp-example-grid">
          ${_renderExampleCards()}
        </div>
      </div>
      <div id="inp-file-summary" class="inp-file-summary" hidden></div>
      <div id="inp-file-error" class="inp-error" hidden></div>
      <div class="concept-panel">
        <div class="concept-panel-title">Fork y Copy-on-Write</div>
        <div class="concept-panel-grid">
          <div><b>Fork()</b> duplica un proceso desde la fila seleccionada y crea un hijo schedulable.</div>
          <div><b>COW</b> hace que padre e hijo compartan páginas al inicio; la copia privada aparece hasta escribir en Memoria.</div>
          <div><b>Flujo</b>: presiona <span class="concept-kbd">Fork()</span>, luego <span class="concept-kbd">Ejecutar simulación</span> y revisa la pantalla Memoria.</div>
        </div>
      </div>
      <div id="inp-fork-summary" class="fork-summary" hidden></div>
      <table class="inp-table inp-process-list" id="inp-process-table">
        <thead>
          <tr>
            <th>PID</th>
            <th>Llegada</th>
            <th>Ráfaga</th>
            <th>Prioridad</th>
            <th>Pág. compartidas</th>
            <th>Threads</th>
            <th>Memoria</th>
          </tr>
        </thead>
        <tbody id="inp-tbody"></tbody>
      </table>
      <div id="inp-proc-errors" class="inp-error" hidden></div>
    </section>

    <section class="inp-section inp-memory-section">
      <div class="inp-section-header">
        <h3>Configuración de memoria</h3>
        <span class="inp-memory-validity">Solo combinaciones divisibles y dentro de rango</span>
      </div>
      <div class="inp-memory-grid">
        <div class="inp-memory-stepper">
          <div class="inp-memory-label">
            <span>Memoria total (KB) ${_helpHint(`Memoria física disponible. Valores válidos entre ${LIMITS.totalMem.min} y ${LIMITS.totalMem.max} KB.`)}</span>
            <span class="field-help" id="inp-mem-size-help">Paso válido actual</span>
          </div>
          <div class="inp-stepper">
            <button type="button" class="inp-step-btn" data-memory-step="total" data-dir="-1" aria-label="Memoria anterior">−</button>
            <input type="text" id="inp-mem-size" class="inp-stepper-value" value="256" readonly aria-label="Memoria total en KB">
            <button type="button" class="inp-step-btn" data-memory-step="total" data-dir="1" aria-label="Memoria siguiente">+</button>
          </div>
        </div>
        <div class="inp-memory-stepper">
          <div class="inp-memory-label">
            <span>Page size (KB) ${_helpHint(`Tamaño de cada página/frame. Solo se muestran tamaños que dividen la memoria total.`)}</span>
            <span class="field-help" id="inp-page-size-help">Paso válido actual</span>
          </div>
          <div class="inp-stepper">
            <button type="button" class="inp-step-btn" data-memory-step="page" data-dir="-1" aria-label="Página anterior">−</button>
            <input type="text" id="inp-page-size" class="inp-stepper-value" value="32" readonly aria-label="Tamaño de página en KB">
            <button type="button" class="inp-step-btn" data-memory-step="page" data-dir="1" aria-label="Página siguiente">+</button>
          </div>
        </div>
        <div class="inp-frames-card">
          <span class="field-label">Frames generados</span>
          <span id="inp-frames-display" class="inp-frames-display">8 frames</span>
          <span id="inp-frames-breakdown" class="inp-frames-breakdown">256 KB / 32 KB por frame</span>
        </div>
      </div>
      <div id="inp-mem-error" class="inp-error" hidden></div>
    </section>

    <div class="inp-run-bar">
      <span class="inp-run-bar-msg" id="inp-run-bar-msg">
        Configura tus procesos y luego ejecuta la simulación.
      </span>
      <button id="inp-run-btn" class="inp-btn inp-btn-primary">Ejecutar simulación →</button>
    </div>
  `;

  // ── Wiring ──────────────────────────────────────────────────────────────
  document.getElementById('inp-add-process').addEventListener('click', _addProcessRow);
  document.getElementById('inp-file-upload').addEventListener('change', _handleFileUpload);
  document.getElementById('inp-clear-all').addEventListener('click', _clearAll);
  document.getElementById('inp-run-btn').addEventListener('click', _handleRunSimulation);
  root.querySelectorAll('[data-example-id]').forEach(button => {
    button.addEventListener('click', () => _loadExample(button.dataset.exampleId));
  });

  document.getElementById('inp-help-toggle').addEventListener('click', () => {
    const p = document.getElementById('inp-help-panel');
    p.hidden = !p.hidden;
  });
  document.getElementById('inp-download-template-5')
    .addEventListener('click', () => _downloadTemplate(5));
  document.getElementById('inp-download-template-9')
    .addEventListener('click', () => _downloadTemplate(9));

  root.querySelectorAll('[data-memory-step]').forEach(button => {
    button.addEventListener('click', () => _stepMemoryValue(button.dataset.memoryStep, Number(button.dataset.dir)));
  });

  // Hook hero buttons (from the home screen)
  document.getElementById('hero-start')?.addEventListener('click', () => navigateTo('input'));
  document.getElementById('hero-load-example')?.addEventListener('click', () => {
    navigateTo('input');
    setTimeout(_loadExample, 50);
  });

  _addProcessRow();
  _setMemoryConfig(256, 32);
}

function _ensureForkStyles() {
  if (document.getElementById('input-fork-styles')) return;

  const style = document.createElement('style');
  style.id = 'input-fork-styles';
  style.textContent = `
    [data-screen="input"] .inp-row-actions {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      justify-content: flex-end;
      flex-wrap: wrap;
    }

    [data-screen="input"] .inp-file-summary {
      margin-top: var(--space-2);
      color: var(--text-secondary);
      font-size: 13px;
      font-family: var(--font-mono);
    }

    [data-screen="input"] .process-row-entering {
      opacity: 0;
      transform: translateY(-4px);
      animation: process-fade-in 0.3s ease-out forwards;
    }

    @keyframes process-fade-in {
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    [data-screen="input"] .inp-proc-row--fork-child > td {
      background: var(--bg-elevated);
    }

    [data-screen="input"] .inp-proc-row--fork-child .inp-pid-cell {
      padding-left: var(--space-6);
      border-left: 2px solid var(--accent);
    }

    [data-screen="input"] .inp-pid-main {
      display: block;
      color: var(--accent);
      font-family: var(--font-mono);
      font-weight: 600;
      line-height: 1.2;
    }

    [data-screen="input"] .inp-pid-sub {
      display: block;
      margin-top: 2px;
      color: var(--text-tertiary);
      font-family: var(--font-ui);
      font-size: 11px;
      font-weight: 500;
      line-height: 1.2;
      text-transform: none;
    }
  `;
  document.head.appendChild(style);
}

// ─── Bound clamp helper ──────────────────────────────────────────────────────

function _clampInput(input, bounds) {
  let v = parseInt(input.value, 10);
  if (isNaN(v)) v = bounds.min;
  if (v < bounds.min) v = bounds.min;
  if (v > bounds.max) v = bounds.max;
  input.value = v;
  return v;
}

function _attachClamp(input, bounds) {
  input.addEventListener('blur', () => _clampInput(input, bounds));
}

// ─── Process row ─────────────────────────────────────────────────────────────

function _addProcessRow() {
  const procCount = document.querySelectorAll('.inp-proc-row').length;
  if (procCount >= LIMITS.processes.max) {
    toast(`Máximo ${LIMITS.processes.max} procesos por simulación.`, 'warn');
    return;
  }

  const pid = _nextPid++;
  _procMeta.set(pid, { localTidCounter: 0 });

  const tbody = document.getElementById('inp-tbody');

  const tr = document.createElement('tr');
  tr.className = 'inp-proc-row';
  tr.dataset.pid = pid;
  tr.innerHTML = _processCells({
    pid,
    arrivalTime: 0,
    burstTime: 5,
    priority: 1,
    sharedPages: 1,
    threads: [],
  });
  tbody.appendChild(tr);

  const containerTr = _makeThreadContainer(pid);
  tbody.appendChild(containerTr);

  // Wire delete + thread buttons
  tr.querySelector('.inp-del-proc').addEventListener('click', () => _deleteProcess(pid));
  tr.querySelector('.inp-fork-proc').addEventListener('click', () => _forkProcess(pid));
  tr.querySelector('.inp-add-thread').addEventListener('click', () => _addThreadRow(pid));
  tr.querySelector('.inp-toggle-threads').addEventListener('click', () => _toggleThreads(pid));

  // Attach clamps to numeric inputs
  _attachClamp(tr.querySelector('.inp-arrival'),  LIMITS.arrival);
  _attachClamp(tr.querySelector('.inp-burst'),    LIMITS.burst);
  _attachClamp(tr.querySelector('.inp-priority'), LIMITS.priority);
  _attachClamp(tr.querySelector('.inp-shared'),   LIMITS.shared);
}

function _makeThreadContainer(pid) {
  const tr = document.createElement('tr');
  tr.className = 'inp-thread-container';
  tr.dataset.parentPid = pid;
  tr.hidden = true;
  tr.innerHTML = `
    <td colspan="7" class="inp-thread-td">
      <div class="inp-thread-header">
        <span>Threads del proceso</span>
        <span>Los campos de cada thread actualizan el CPU burst total del proceso.</span>
      </div>
      <div class="inp-thread-list" data-pid="${pid}"></div>
    </td>
  `;
  return tr;
}

function _deleteProcess(pid) {
  document.querySelector(`.inp-proc-row[data-pid="${pid}"]`)?.remove();
  document.querySelector(`.inp-thread-container[data-parent-pid="${pid}"]`)?.remove();
  _procMeta.delete(pid);
  _forkMetaByPid.delete(pid);
  _updateLoadedFilesUI();
  _renderForkSummary();
}

function _clearAll() {
  _importRenderToken += 1;
  document.getElementById('inp-tbody').innerHTML = '';
  _procMeta.clear();
  _forkMetaByPid.clear();
  _loadedFileCount = 0;
  _nextPid = 1;
  document.getElementById('inp-proc-errors').hidden = true;
  document.getElementById('inp-file-error').hidden = true;
  document.getElementById('inp-file-error').innerHTML = '';
  _updateLoadedFilesUI(0);
  _addProcessRow();
  _renderForkSummary();
  toast('Procesos limpiados.', 'info', 1800);
}

function _processRowCount() {
  return document.querySelectorAll('.inp-proc-row').length;
}

function _maxCurrentPid() {
  return Math.max(0, ...[...document.querySelectorAll('.inp-proc-row')]
    .map(row => Number(row.dataset.pid))
    .filter(Number.isFinite));
}

function _updateLoadedFilesUI(processCount = _processRowCount()) {
  const summary = document.getElementById('inp-file-summary');
  const loadAnother = document.getElementById('inp-load-another-file');
  if (!summary || !loadAnother) return;

  const hasLoadedFiles = _loadedFileCount > 0;
  loadAnother.hidden = !hasLoadedFiles;
  summary.hidden = !hasLoadedFiles;
  if (hasLoadedFiles) {
    const fileWord = _loadedFileCount === 1 ? 'archivo' : 'archivos';
    summary.textContent = `Cargado de ${_loadedFileCount} ${fileWord}: ${processCount} procesos totales`;
  } else {
    summary.textContent = '';
  }
}

function _cloneImportedProcess(proc, newPid) {
  const copy = JSON.parse(JSON.stringify(proc));
  copy.pid = newPid;
  if (Array.isArray(copy.threads)) {
    copy.threads = copy.threads.map(thread => ({
      ...thread,
      parentPid: newPid,
    }));
  }
  return copy;
}

function _prepareImportedProcesses(processes, shouldRenumber) {
  if (!shouldRenumber) return processes.map(proc => _cloneImportedProcess(proc, proc.pid));
  let nextPid = _maxCurrentPid() + 1;
  return processes.map(proc => _cloneImportedProcess(proc, nextPid++));
}

// ─── Thread sub-rows ─────────────────────────────────────────────────────────

function _addThreadRow(pid) {
  const meta = _procMeta.get(pid);
  if (!meta) return;

  const procRow  = document.querySelector(`.inp-proc-row[data-pid="${pid}"]`);
  const threadList = document.querySelector(`.inp-thread-list[data-pid="${pid}"]`);
  const existing = threadList.querySelectorAll('.inp-thread-row').length;

  if (existing >= LIMITS.threads.max) {
    toast(`Máximo ${LIMITS.threads.max} threads por proceso.`, 'warn');
    return;
  }

  meta.localTidCounter++;
  const localTid = meta.localTidCounter;

  const procArr  = parseInt(procRow.querySelector('.inp-arrival').value) || 0;

  // First thread inherits the current process burst; subsequent threads default to 3.
  const isFirst   = existing === 0;
  const defBurst  = isFirst ? (parseInt(procRow.querySelector('.inp-burst').value) || 3) : 3;

  const div = document.createElement('div');
  div.className = 'inp-thread-row';
  div.dataset.pid      = pid;
  div.dataset.localTid = localTid;
  div.innerHTML = _threadCells(localTid, procArr, defBurst, 1);
  threadList.appendChild(div);

  div.querySelector('.inp-del-thread').addEventListener('click', () => {
    div.remove();
    _syncBurst(pid);
    _syncToggle(pid);
  });
  div.querySelector('.inp-t-burst').addEventListener('input', () => _syncBurst(pid));

  _attachClamp(div.querySelector('.inp-t-arrival'), LIMITS.arrival);
  _attachClamp(div.querySelector('.inp-t-burst'),   LIMITS.burst);
  _attachClamp(div.querySelector('.inp-t-stack'),   LIMITS.stackPages);

  _syncBurst(pid);
  _syncToggle(pid);
}

function _syncBurst(pid) {
  const procRow    = document.querySelector(`.inp-proc-row[data-pid="${pid}"]`);
  const threadList = document.querySelector(`.inp-thread-list[data-pid="${pid}"]`);
  const rows       = threadList.querySelectorAll('.inp-thread-row');
  const burstInput = procRow.querySelector('.inp-burst');

  if (rows.length === 0) {
    burstInput.readOnly = false;
    burstInput.classList.remove('inp-readonly');
  } else {
    burstInput.readOnly = true;
    burstInput.classList.add('inp-readonly');
    const sum = [...rows].reduce((s, r) => s + (parseInt(r.querySelector('.inp-t-burst').value) || 0), 0);
    burstInput.value = sum;
  }
}

function _syncToggle(pid) {
  const threadList = document.querySelector(`.inp-thread-list[data-pid="${pid}"]`);
  const count      = threadList.querySelectorAll('.inp-thread-row').length;
  const toggleBtn  = document.querySelector(`.inp-proc-row[data-pid="${pid}"] .inp-toggle-threads`);
  const container  = document.querySelector(`.inp-thread-container[data-parent-pid="${pid}"]`);

  if (count === 0) {
    toggleBtn.hidden  = true;
    container.hidden  = true;
  } else {
    toggleBtn.hidden  = false;
    container.hidden  = false;
    const arrow = container.hidden ? '►' : '▼';
    toggleBtn.textContent = `${arrow} ${count} thread${count !== 1 ? 's' : ''}`;
  }
}

function _toggleThreads(pid) {
  const container  = document.querySelector(`.inp-thread-container[data-parent-pid="${pid}"]`);
  const toggleBtn  = document.querySelector(`.inp-proc-row[data-pid="${pid}"] .inp-toggle-threads`);
  const threadList = document.querySelector(`.inp-thread-list[data-pid="${pid}"]`);
  const count      = threadList.querySelectorAll('.inp-thread-row').length;

  container.hidden = !container.hidden;
  const arrow = container.hidden ? '►' : '▼';
  toggleBtn.textContent = `${arrow} ${count} thread${count !== 1 ? 's' : ''}`;
}

// ─── Memory config ────────────────────────────────────────────────────────────

function _cloneMetaValue(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function _applyForkMetadata(processes) {
  for (const process of processes) {
    const meta = _forkMetaByPid.get(process.pid);
    if (!meta) continue;

    if (meta.isForkChild) process.isForkChild = true;
    if (meta.forkParentPid !== null && meta.forkParentPid !== undefined) {
      process.forkParentPid = meta.forkParentPid;
    }
    if (meta.forkLabel) process.forkLabel = meta.forkLabel;
    if (Array.isArray(meta.forkChildrenPids)) {
      process.forkChildrenPids = meta.forkChildrenPids.slice();
    }
    if (meta.memory) {
      process.memory = _cloneMetaValue(meta.memory);
      if (Array.isArray(process.memory.cowPages)) {
        process.memory.cowPages = process.memory.cowPages
          .filter(entry => entry.pageNumber < process.numPages);
      }
    }
  }
}

function _syncForkMetadataFromProcesses(processes) {
  for (const process of processes) {
    const meta = cloneProcessMetadata(process);
    if (meta.isForkChild || meta.forkChildrenPids.length > 0 || meta.memory) {
      _forkMetaByPid.set(process.pid, meta);
    }
  }
}

function _parentHasExplicitThreads(parentPid) {
  const threadList = document.querySelector(`.inp-thread-list[data-pid="${parentPid}"]`);
  return Boolean(threadList && threadList.querySelector('.inp-thread-row'));
}

function _findForkInsertionPoint(parentPid) {
  const tbody = document.getElementById('inp-tbody');
  let insertionPoint = document.querySelector(`.inp-thread-container[data-parent-pid="${parentPid}"]`)
    || document.querySelector(`.inp-proc-row[data-pid="${parentPid}"]`);

  for (const row of [...tbody.querySelectorAll('.inp-proc-row')]) {
    if (Number(row.dataset.forkParentPid) !== parentPid) continue;
    const childContainer = document.querySelector(`.inp-thread-container[data-parent-pid="${row.dataset.pid}"]`);
    insertionPoint = childContainer || row;
  }

  return insertionPoint;
}

function _makePidCell(proc) {
  if (!proc.isForkChild) return `P${proc.pid}`;
  const label = proc.forkLabel || `P${proc.pid}`;
  const parentLabel = _forkMetaByPid.get(proc.forkParentPid)?.forkLabel || `P${proc.forkParentPid}`;
  return (
    `<span class="inp-pid-main">${label}</span>` +
    `<span class="inp-pid-sub">child of ${parentLabel} · PID ${proc.pid}</span>`
  );
}

function _renderForkSummary() {
  const summary = document.getElementById('inp-fork-summary');
  if (!summary) return;

  const forks = [..._forkMetaByPid.entries()]
    .filter(([, meta]) => meta.isForkChild && meta.forkParentPid !== null && meta.forkParentPid !== undefined)
    .sort(([leftPid], [rightPid]) => leftPid - rightPid);

  if (forks.length === 0) {
    summary.hidden = true;
    summary.innerHTML = '';
    return;
  }

  const rows = forks.map(([childPid, meta]) => {
    const childLabel = meta.forkLabel || `P${childPid}`;
    const parentMeta = _forkMetaByPid.get(meta.forkParentPid);
    const parentLabel = parentMeta?.forkLabel || `P${meta.forkParentPid}`;
    const cowCount = meta.memory?.cowPages?.length || 0;
    return (
      `<span class="fork-summary-row">` +
      `<span class="fork-chip fork-chip--parent">${parentLabel}</span>` +
      `<span class="fork-arrow">-&gt;</span>` +
      `<span class="fork-chip fork-chip--child">${childLabel}</span>` +
      `<span class="fork-summary-note">PID ${childPid}, ${cowCount} página${cowCount !== 1 ? 's' : ''} COW compartida${cowCount !== 1 ? 's' : ''}</span>` +
      `</span>`
    );
  }).join('');

  summary.hidden = false;
  summary.innerHTML =
    `<div class="fork-summary-title">Forks activos</div>` +
    `<div class="fork-summary-list">${rows}</div>` +
    `<div class="fork-summary-help">El hijo entra al scheduler como proceso normal; la relación padre/hijo y COW se ve con detalle en Memoria.</div>`;
}

function _insertProcessFromModel(proc, { showThreads = false, afterNode = null } = {}) {
  const tbody = document.getElementById('inp-tbody');
  const hasThreads = showThreads && proc.threads.length > 0;
  _procMeta.set(proc.pid, { localTidCounter: hasThreads ? proc.threads.length : 0 });

  const tr = document.createElement('tr');
  tr.className = `inp-proc-row${proc.isForkChild ? ' inp-proc-row--fork-child' : ''}`;
  tr.dataset.pid = proc.pid;
  if (proc.forkParentPid !== undefined && proc.forkParentPid !== null) {
    tr.dataset.forkParentPid = proc.forkParentPid;
  }
  tr.innerHTML = _processCells(proc, { hasThreads, pidCell: _makePidCell(proc) });

  const containerTr = _makeThreadContainer(proc.pid);
  containerTr.hidden = !hasThreads;

  if (afterNode) {
    afterNode.after(tr);
    tr.after(containerTr);
  } else {
    tbody.appendChild(tr);
    tbody.appendChild(containerTr);
  }

  tr.querySelector('.inp-del-proc').addEventListener('click', () => _deleteProcess(proc.pid));
  tr.querySelector('.inp-fork-proc').addEventListener('click', () => _forkProcess(proc.pid));
  tr.querySelector('.inp-add-thread').addEventListener('click', () => _addThreadRow(proc.pid));
  tr.querySelector('.inp-toggle-threads').addEventListener('click', () => _toggleThreads(proc.pid));

  _attachClamp(tr.querySelector('.inp-arrival'),  LIMITS.arrival);
  _attachClamp(tr.querySelector('.inp-burst'),    LIMITS.burst);
  _attachClamp(tr.querySelector('.inp-priority'), LIMITS.priority);
  _attachClamp(tr.querySelector('.inp-shared'),   LIMITS.shared);

  if (hasThreads) {
    const threadList = containerTr.querySelector('.inp-thread-list');
    proc.threads.forEach((thread, index) => {
      const localTid = index + 1;
      const div = document.createElement('div');
      div.className = 'inp-thread-row';
      div.dataset.pid = proc.pid;
      div.dataset.localTid = localTid;
      div.innerHTML = _threadCells(localTid, thread.arrivalTime, thread.burstTime, thread.stackPages);
      threadList.appendChild(div);

      div.querySelector('.inp-del-thread').addEventListener('click', () => {
        div.remove();
        _syncBurst(proc.pid);
        _syncToggle(proc.pid);
      });
      div.querySelector('.inp-t-burst').addEventListener('input', () => _syncBurst(proc.pid));

      _attachClamp(div.querySelector('.inp-t-arrival'), LIMITS.arrival);
      _attachClamp(div.querySelector('.inp-t-burst'),   LIMITS.burst);
      _attachClamp(div.querySelector('.inp-t-stack'),   LIMITS.stackPages);
    });
  }

  return { tr, containerTr };
}

function _parseCurrentProcessesForFork() {
  const fd = new FormData();
  fd.set('processes', JSON.stringify(_collectRawProcesses()));
  const processes = parseProcessesFromForm(fd);
  _applyForkMetadata(processes);
  return processes;
}

function _forkProcess(parentPid, { silent = false } = {}) {
  const procCount = document.querySelectorAll('.inp-proc-row').length;
  if (procCount >= LIMITS.processes.max) {
    toast(`Máximo ${LIMITS.processes.max} procesos por simulación.`, 'warn');
    return;
  }

  try {
    const processes = _parseCurrentProcessesForFork();
    setProcessTable(processes);
    const child = simulatedFork(parentPid);
    _syncForkMetadataFromProcesses(getProcessTable());

    const afterNode = _findForkInsertionPoint(parentPid);
    _insertProcessFromModel(child, {
      showThreads: _parentHasExplicitThreads(parentPid),
      afterNode,
    });
    _nextPid = Math.max(_nextPid, child.pid + 1);
    _renderForkSummary();
    if (!silent) toast(`${child.forkLabel || `P${child.pid}`} creado por fork() de P${parentPid}.`, 'ok');
  } catch (error) {
    toast(error.message || 'No se pudo simular fork().', 'err');
  }
}

function _validPageValues(totalMemory) {
  const maxPage = Math.min(LIMITS.pageSize.max, totalMemory);
  const values = [];
  for (let value = LIMITS.pageSize.min; value <= maxPage; value += 1) {
    if (totalMemory % value === 0) values.push(value);
  }
  return values;
}

function _validTotalValues(pageSize) {
  const step = Math.max(LIMITS.pageSize.min, pageSize);
  const first = Math.ceil(LIMITS.totalMem.min / step) * step;
  const values = [];
  for (let value = first; value <= LIMITS.totalMem.max; value += step) {
    values.push(value);
  }
  return values;
}

function _nearestOption(options, value) {
  if (!options.length) return value;
  return options.reduce((best, option) => (
    Math.abs(option - value) < Math.abs(best - value) ? option : best
  ), options[0]);
}

function _optionStep(options, value, dir) {
  const currentIndex = options.indexOf(value);
  const baseIndex = currentIndex === -1 ? options.indexOf(_nearestOption(options, value)) : currentIndex;
  const nextIndex = Math.max(0, Math.min(options.length - 1, baseIndex + dir));
  return options[nextIndex];
}

function _setStepperDisabled(kind, value, options) {
  document.querySelectorAll(`[data-memory-step="${kind}"]`).forEach(button => {
    const dir = Number(button.dataset.dir);
    button.disabled = dir < 0 ? value <= options[0] : value >= options[options.length - 1];
  });
}

function _setMemoryConfig(totalMemory, pageSize) {
  const requestedPage = Math.max(
    LIMITS.pageSize.min,
    Math.min(LIMITS.pageSize.max, Math.round(Number(pageSize) || 32))
  );
  const requestedTotal = Math.max(
    LIMITS.totalMem.min,
    Math.min(LIMITS.totalMem.max, Math.round(Number(totalMemory) || 256))
  );

  const validTotalsForRequestedPage = _validTotalValues(requestedPage);
  const total = validTotalsForRequestedPage.includes(requestedTotal)
    ? requestedTotal
    : _nearestOption(validTotalsForRequestedPage, requestedTotal);
  const validPages = _validPageValues(total);
  const page = validPages.includes(requestedPage) ? requestedPage : _nearestOption(validPages, requestedPage);
  const validTotals = _validTotalValues(page);

  const memInput = document.getElementById('inp-mem-size');
  const pageInput = document.getElementById('inp-page-size');
  if (!memInput || !pageInput) return;

  memInput.value = String(total);
  pageInput.value = String(page);

  const memHelp = document.getElementById('inp-mem-size-help');
  const pageHelp = document.getElementById('inp-page-size-help');
  if (memHelp) memHelp.textContent = `${validTotals.length} valores válidos con página de ${page} KB`;
  if (pageHelp) pageHelp.textContent = `${validPages.length} tamaños válidos para ${total} KB`;

  _setStepperDisabled('total', total, validTotals);
  _setStepperDisabled('page', page, validPages);
  _updateFramesDisplay();
}

function _stepMemoryValue(kind, dir) {
  const total = parseInt(document.getElementById('inp-mem-size').value, 10);
  const page = parseInt(document.getElementById('inp-page-size').value, 10);

  if (kind === 'total') {
    const validTotals = _validTotalValues(page);
    const nextTotal = _optionStep(validTotals, total, dir);
    _setMemoryConfig(nextTotal, page);
    return;
  }

  const validPages = _validPageValues(total);
  const nextPage = _optionStep(validPages, page, dir);
  _setMemoryConfig(total, nextPage);
}

function _updateFramesDisplay() {
  const memSizeInput = document.getElementById('inp-mem-size');
  const pageSizeInput = document.getElementById('inp-page-size');
  const memSize  = parseInt(memSizeInput.value);
  const pageSize = parseInt(pageSizeInput.value);
  const display  = document.getElementById('inp-frames-display');
  const breakdown = document.getElementById('inp-frames-breakdown');
  const errEl    = document.getElementById('inp-mem-error');

  errEl.hidden = true;

  if (!memSize || !pageSize || pageSize <= 0) {
    display.textContent = 'Frames: —';
    if (breakdown) breakdown.textContent = 'Selecciona una combinación válida';
    display.className   = 'inp-frames-display';
    return;
  }

  if (memSize < LIMITS.totalMem.min || memSize > LIMITS.totalMem.max) {
    display.textContent = 'Frames: — (fuera de rango)';
    if (breakdown) breakdown.textContent = 'Memoria fuera de rango';
    display.className   = 'inp-frames-display inp-frames-error';
    errEl.textContent   = `Memoria fuera de rango (${LIMITS.totalMem.min}–${LIMITS.totalMem.max} KB).`;
    errEl.hidden        = false;
    return;
  }

  if (pageSize < LIMITS.pageSize.min || pageSize > LIMITS.pageSize.max) {
    display.textContent = 'Frames: — (fuera de rango)';
    if (breakdown) breakdown.textContent = 'Página fuera de rango';
    display.className   = 'inp-frames-display inp-frames-error';
    errEl.textContent   = `Tamaño de página fuera de rango (${LIMITS.pageSize.min}–${LIMITS.pageSize.max} KB).`;
    errEl.hidden        = false;
    return;
  }

  if (memSize % pageSize !== 0) {
    display.textContent = 'Frames: — (no divisible)';
    if (breakdown) breakdown.textContent = `${memSize} KB no divide en páginas de ${pageSize} KB`;
    display.className   = 'inp-frames-display inp-frames-error';
    errEl.textContent   = 'La memoria total debe ser divisible entre el tamaño de página.';
    errEl.hidden        = false;
  } else {
    const frames = memSize / pageSize;
    display.textContent = `${frames} frame${frames !== 1 ? 's' : ''}`;
    if (breakdown) breakdown.textContent = `${memSize} KB / ${pageSize} KB por frame`;
    display.className   = 'inp-frames-display';
    if (frames > 256) {
      errEl.textContent = `Aviso: ${frames} frames podrían ralentizar la visualización. Reduce la memoria o aumenta la page size.`;
      errEl.hidden = false;
    }
  }
}

// ─── File upload ──────────────────────────────────────────────────────────────

function _detectProcessFileColumnCount(content) {
  const rows = content
    .trim()
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  if (rows.length === 0) return 0;
  const firstCell = rows[0].split(',')[0].trim().toLowerCase();
  const dataRows = firstCell === 'pid' ? rows.slice(1) : rows;
  return dataRows[0] ? dataRows[0].split(',').length : 0;
}

function _renderFileLoadError(errEl, err) {
  const message = err?.message || String(err);
  const lines = message
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('Línea ') || line.startsWith('... y '));

  errEl.innerHTML = '';
  const title = document.createElement('div');
  title.textContent = message.startsWith('Validación regex falló')
    ? 'Validación regex falló:'
    : `Error: ${message}`;
  errEl.appendChild(title);

  if (lines.length > 0) {
    const list = document.createElement('ul');
    for (const line of lines) {
      const item = document.createElement('li');
      item.textContent = line;
      list.appendChild(item);
    }
    errEl.appendChild(list);
  }

  errEl.hidden = false;
}

function _handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 1024 * 256) {
    toast('Archivo demasiado grande (>256 KB).', 'err');
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = evt => {
    const content = evt.target.result;
    const errEl   = document.getElementById('inp-file-error');

    try {
      const lines = content.trim().split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
      if (!lines.length) throw new Error('El archivo está vacío.');

      const colCount = _detectProcessFileColumnCount(content);
      if (colCount !== 5 && colCount !== 9) {
        throw new Error(`Se esperaban 5 o 9 columnas, se encontraron ${colCount}. Revisa el formato.`);
      }

      const parsedProcesses = parseProcessesFromFileValidated(content);
      const currentCount = _loadedFileCount === 0 ? 0 : _processRowCount();
      const totalCount = currentCount + parsedProcesses.length;

      if (totalCount > LIMITS.processes.max) {
        throw new Error(`La carga acumularía ${totalCount} procesos. Máximo permitido: ${LIMITS.processes.max}.`);
      }

      if (_loadedFileCount === 0) {
        document.getElementById('inp-tbody').innerHTML = '';
        _procMeta.clear();
        _forkMetaByPid.clear();
        _renderForkSummary();
      }

      const processes = _prepareImportedProcesses(parsedProcesses, _loadedFileCount > 0);
      _nextPid = Math.max(_nextPid, ...processes.map(p => p.pid)) + 1;
      const renderToken = ++_importRenderToken;
      _populateFromProcesses(processes, colCount === 9, { incremental: true, token: renderToken });

      _loadedFileCount += 1;
      _updateLoadedFilesUI(totalCount);
      errEl.hidden = true;
      errEl.innerHTML = '';
      toast(`Cargados ${processes.length} procesos desde "${file.name}".`, 'ok');
    } catch (err) {
      _renderFileLoadError(errEl, err);
      toast('No se pudo cargar el archivo. Revisa el panel de error.', 'err');
    }

    e.target.value = '';
  };
  reader.readAsText(file);
}

function _populateFromProcesses(processes, showThreads, { incremental = false, animate = false, token = null } = {}) {
  if (incremental) {
    const renderToken = token ?? ++_importRenderToken;
    processes.forEach((proc, index) => {
      setTimeout(() => {
        if (renderToken !== _importRenderToken) return;
        _populateFromProcesses([proc], showThreads, { animate: true, token: renderToken });
      }, index * IMPORT_ROW_DELAY_MS);
    });
    return;
  }

  const tbody = document.getElementById('inp-tbody');

  for (const proc of processes) {
    const hasThreads = showThreads && proc.threads.length > 0;
    _procMeta.set(proc.pid, { localTidCounter: hasThreads ? proc.threads.length : 0 });

    const tr = document.createElement('tr');
    tr.className  = `inp-proc-row${animate ? ' process-row-entering' : ''}`;
    tr.dataset.pid = proc.pid;
    tr.innerHTML = _processCells(proc, { hasThreads });
    tbody.appendChild(tr);

    const containerTr = _makeThreadContainer(proc.pid);
    containerTr.hidden = !hasThreads;
    tbody.appendChild(containerTr);

    tr.querySelector('.inp-del-proc').addEventListener('click', () => _deleteProcess(proc.pid));
    tr.querySelector('.inp-fork-proc').addEventListener('click', () => _forkProcess(proc.pid));
    tr.querySelector('.inp-add-thread').addEventListener('click', () => _addThreadRow(proc.pid));
    tr.querySelector('.inp-toggle-threads').addEventListener('click', () => _toggleThreads(proc.pid));

    _attachClamp(tr.querySelector('.inp-arrival'),  LIMITS.arrival);
    _attachClamp(tr.querySelector('.inp-burst'),    LIMITS.burst);
    _attachClamp(tr.querySelector('.inp-priority'), LIMITS.priority);
    _attachClamp(tr.querySelector('.inp-shared'),   LIMITS.shared);

    if (hasThreads) {
      const threadList = containerTr.querySelector('.inp-thread-list');
      proc.threads.forEach((t, idx) => {
        const localTid = idx + 1;
        const div = document.createElement('div');
        div.className        = 'inp-thread-row';
        div.dataset.pid      = proc.pid;
        div.dataset.localTid = localTid;
        div.innerHTML = _threadCells(localTid, t.arrivalTime, t.burstTime, t.stackPages);
        threadList.appendChild(div);

        div.querySelector('.inp-del-thread').addEventListener('click', () => {
          div.remove();
          _syncBurst(proc.pid);
          _syncToggle(proc.pid);
        });
        div.querySelector('.inp-t-burst').addEventListener('input', () => _syncBurst(proc.pid));

        _attachClamp(div.querySelector('.inp-t-arrival'), LIMITS.arrival);
        _attachClamp(div.querySelector('.inp-t-burst'),   LIMITS.burst);
        _attachClamp(div.querySelector('.inp-t-stack'),   LIMITS.stackPages);
      });
    }
  }
}

// ─── Templates download ──────────────────────────────────────────────────────

function _downloadTemplate(cols) {
  const tpl5 =
    `# Plantilla 5 columnas (single-threaded)\n` +
    `# pid,arrival,burst,priority,sharedPages\n` +
    `1,0,5,2,4\n` +
    `2,1,3,1,3\n` +
    `3,2,7,3,5\n`;

  const tpl9 =
    `# Plantilla 9 columnas (multi-threaded)\n` +
    `# pid,arrival,procBurst(ignorado),priority,sharedPages,tid(ignorado),tArrival,tBurst,stackPages\n` +
    `1,0,0,2,3,1,0,5,1\n` +
    `1,0,0,2,3,2,0,3,1\n` +
    `2,1,0,1,3,1,1,4,1\n`;

  const content = cols === 5 ? tpl5 : tpl9;
  const blob = new Blob([content], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `coreview-template-${cols}col.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Plantilla de ${cols} columnas descargada.`, 'ok', 2200);
}

// ─── Example loader ──────────────────────────────────────────────────────────

function _exampleById(id) {
  return EXAMPLE_PRESETS.find(preset => preset.id === id) || EXAMPLE_PRESETS[0];
}

function _cloneExampleProcesses(processes) {
  return JSON.parse(JSON.stringify(processes));
}

function _loadExample(exampleId = 'basic') {
  _importRenderToken += 1;
  const preset = _exampleById(exampleId);
  const example = _cloneExampleProcesses(preset.processes);

  document.getElementById('inp-tbody').innerHTML = '';
  _procMeta.clear();
  _forkMetaByPid.clear();
  _loadedFileCount = 0;
  _updateLoadedFilesUI(0);
  document.getElementById('inp-file-error').hidden = true;
  document.getElementById('inp-file-error').innerHTML = '';
  _nextPid = Math.max(...example.map(proc => proc.pid)) + 1;

  _populateFromProcesses(example, preset.showThreads);
  _setMemoryConfig(preset.memory.totalMemory, preset.memory.pageSize);

  for (const parentPid of preset.forks || []) {
    _forkProcess(parentPid, { silent: true });
  }

  _renderForkSummary();

  toast(`Ejemplo cargado: ${preset.title}.`, 'info');
}

// ─── Collect & run ────────────────────────────────────────────────────────────

function _collectRawProcesses() {
  return [...document.querySelectorAll('.inp-proc-row')].map(row => {
    const pid        = parseInt(row.dataset.pid);
    const arrival    = _clampInput(row.querySelector('.inp-arrival'),  LIMITS.arrival);
    const burst      = _clampInput(row.querySelector('.inp-burst'),    LIMITS.burst);
    const priority   = _clampInput(row.querySelector('.inp-priority'), LIMITS.priority);
    const sharedPages = _clampInput(row.querySelector('.inp-shared'),  LIMITS.shared);

    const threadList = document.querySelector(`.inp-thread-list[data-pid="${pid}"]`);
    const threadEls  = threadList ? [...threadList.querySelectorAll('.inp-thread-row')] : [];

    const threads = threadEls.map(el => ({
      arrival:    _clampInput(el.querySelector('.inp-t-arrival'), LIMITS.arrival),
      burst:      _clampInput(el.querySelector('.inp-t-burst'),   LIMITS.burst),
      stackPages: _clampInput(el.querySelector('.inp-t-stack'),   LIMITS.stackPages),
    }));

    return { pid, arrival, burst, priority, sharedPages, threads };
  });
}

function _handleRunSimulation() {
  const procErrEl = document.getElementById('inp-proc-errors');
  const memErrEl  = document.getElementById('inp-mem-error');

  procErrEl.hidden    = true;
  procErrEl.innerHTML = '';
  memErrEl.hidden     = true;
  memErrEl.textContent = '';

  const rawProcesses = _collectRawProcesses();
  if (rawProcesses.length === 0) {
    procErrEl.textContent = 'Agrega al menos un proceso antes de ejecutar.';
    procErrEl.hidden      = false;
    toast('No hay procesos para ejecutar.', 'warn');
    return;
  }

  if (rawProcesses.length > LIMITS.processes.max) {
    procErrEl.textContent = `Demasiados procesos (${rawProcesses.length}). Máximo: ${LIMITS.processes.max}.`;
    procErrEl.hidden      = false;
    toast('Demasiados procesos.', 'err');
    return;
  }

  const fd = new FormData();
  fd.set('processes', JSON.stringify(rawProcesses));

  let processes;
  try {
    processes = parseProcessesFromForm(fd);
    _applyForkMetadata(processes);
  } catch (err) {
    procErrEl.textContent = `Error de parseo: ${err.message}`;
    procErrEl.hidden      = false;
    toast('Datos inválidos en los procesos.', 'err');
    return;
  }

  const validation = validateProcesses(processes);
  if (!validation.valid) {
    procErrEl.innerHTML = validation.errors
      .map(e => `<div class="inp-error-item">${e}</div>`)
      .join('');
    procErrEl.hidden = false;
    toast(`${validation.errors.length} error${validation.errors.length !== 1 ? 'es' : ''} de validación.`, 'err');
    return;
  }

  const totalMemory = parseInt(document.getElementById('inp-mem-size').value);
  const pageSize    = parseInt(document.getElementById('inp-page-size').value);

  if (!totalMemory || totalMemory < LIMITS.totalMem.min || totalMemory > LIMITS.totalMem.max) {
    memErrEl.textContent = `Memoria total fuera de rango (${LIMITS.totalMem.min}–${LIMITS.totalMem.max} KB).`;
    memErrEl.hidden      = false;
    toast('Memoria total inválida.', 'err');
    return;
  }
  if (!pageSize || pageSize < LIMITS.pageSize.min || pageSize > LIMITS.pageSize.max) {
    memErrEl.textContent = `Tamaño de página fuera de rango (${LIMITS.pageSize.min}–${LIMITS.pageSize.max} KB).`;
    memErrEl.hidden      = false;
    toast('Tamaño de página inválido.', 'err');
    return;
  }
  if (totalMemory % pageSize !== 0) {
    memErrEl.textContent = 'La memoria total debe ser divisible entre el tamaño de página.';
    memErrEl.hidden      = false;
    toast('Memoria no divisible entre tamaño de página.', 'err');
    return;
  }

  const mfd = new FormData();
  mfd.set('totalMemory', totalMemory);
  mfd.set('pageSize', pageSize);

  AppState.processes       = processes;
  AppState.memoryConfig    = parseMemoryConfig(mfd);
  AppState.referenceString = generateReferenceString(processes, 20);
  // Invalidate any cached results from previous runs
  AppState.schedulingTrace = null;
  AppState.pageReplacementTrace = null;
  AppState.comparisonResult = null;
  AppState.currentAlgorithm = null;

  setAppStatus(`${processes.length} procesos · ${AppState.memoryConfig.numFrames} frames`, 'ok');
  toast(`Simulación lista — ${processes.length} procesos cargados.`, 'ok');

  navigateTo('scheduling');
}

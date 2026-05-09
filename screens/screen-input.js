// screen-input.js — Input screen glue. Wires process/memory form DOM to data.js parsers.
// Produces Process[] (with threads) and MemoryConfig, stores in AppState.

import {
  parseProcessesFromForm,
  parseProcessesFromFile,
  parseMemoryConfig,
  validateProcesses,
  generateReferenceString,
} from '../data.js';
import { AppState } from '../app.js';
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

// Auto-incrementing PID counter for the session; never resets on clear (keeps uniqueness).
let _nextPid = 1;
// Map<pid, { localTidCounter: number }>
const _procMeta = new Map();

export function initInputScreen() {
  const root = document.querySelector('[data-screen="input"]');
  if (!root) return;

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
        <label class="inp-btn" for="inp-file-upload" style="cursor:pointer">📂 Subir .txt</label>
        <input type="file" id="inp-file-upload" accept=".txt,.csv" style="display:none">
        <button id="inp-load-example" class="inp-btn">Cargar ejemplo</button>
        <button id="inp-clear-all" class="inp-btn inp-btn-outline-danger">Limpiar todo</button>
      </div>
      <div id="inp-file-error" class="inp-error" hidden></div>
      <table class="inp-table" id="inp-process-table">
        <thead>
          <tr>
            <th>PID <span class="help-hint" tabindex="0" data-tooltip="Identificador único del proceso. Se asigna automáticamente.">?</span></th>
            <th>Llegada <span class="help-hint" tabindex="0" data-tooltip="Instante en que el proceso entra al sistema. Tick ≥ 0. Rango: ${LIMITS.arrival.min}–${LIMITS.arrival.max}.">?</span></th>
            <th>Ráfaga <span class="help-hint" tabindex="0" data-tooltip="Tiempo total de CPU que requiere el proceso (en ticks). Si tiene threads, se calcula como la suma de sus ráfagas. Rango: ${LIMITS.burst.min}–${LIMITS.burst.max}.">?</span></th>
            <th>Prioridad <span class="help-hint" tabindex="0" data-tooltip="Menor número = mayor prioridad (1 = top). Usado por los algoritmos Priority, MLQ y MLFQ. Rango: ${LIMITS.priority.min}–${LIMITS.priority.max}.">?</span></th>
            <th>Pág. compartidas <span class="help-hint" tabindex="0" data-tooltip="Páginas de código y datos compartidas por todos los threads del proceso. El total de páginas será sharedPages + suma(stackPages). Rango: ${LIMITS.shared.min}–${LIMITS.shared.max}.">?</span></th>
            <th>Threads <span class="help-hint" tabindex="0" data-tooltip="Opcional: desglosa la ráfaga del proceso en threads independientes. Cada uno con su propio arrival y stackPages. Máximo ${LIMITS.threads.max} por proceso.">?</span></th>
            <th></th>
          </tr>
        </thead>
        <tbody id="inp-tbody"></tbody>
      </table>
      <div id="inp-proc-errors" class="inp-error" hidden></div>
    </section>

    <section class="inp-section">
      <h3>Configuración de memoria</h3>
      <div class="inp-mem-row">
        <label class="inp-mem-label">
          <span class="field-label">Memoria total (KB)</span>
          <input type="number" id="inp-mem-size" class="inp-num"
            min="${LIMITS.totalMem.min}" max="${LIMITS.totalMem.max}" value="256">
          <span class="field-help">Rango: ${LIMITS.totalMem.min}–${LIMITS.totalMem.max} KB</span>
        </label>
        <label class="inp-mem-label">
          <span class="field-label">Tamaño de página (KB)</span>
          <input type="number" id="inp-page-size" class="inp-num"
            min="${LIMITS.pageSize.min}" max="${LIMITS.pageSize.max}" value="32">
          <span class="field-help">Rango: ${LIMITS.pageSize.min}–${LIMITS.pageSize.max} KB</span>
        </label>
        <div class="field-stack">
          <span class="field-label">Marcos resultantes</span>
          <span id="inp-frames-display" class="inp-frames-display">Frames: 8</span>
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
  document.getElementById('inp-load-example').addEventListener('click', _loadExample);
  document.getElementById('inp-run-btn').addEventListener('click', _handleRunSimulation);

  document.getElementById('inp-help-toggle').addEventListener('click', () => {
    const p = document.getElementById('inp-help-panel');
    p.hidden = !p.hidden;
  });
  document.getElementById('inp-download-template-5')
    .addEventListener('click', () => _downloadTemplate(5));
  document.getElementById('inp-download-template-9')
    .addEventListener('click', () => _downloadTemplate(9));

  document.getElementById('inp-mem-size').addEventListener('input', _updateFramesDisplay);
  document.getElementById('inp-page-size').addEventListener('input', _updateFramesDisplay);

  // Hook hero buttons (from the home screen)
  document.getElementById('hero-start')?.addEventListener('click', () => navigateTo('input'));
  document.getElementById('hero-load-example')?.addEventListener('click', () => {
    navigateTo('input');
    setTimeout(_loadExample, 50);
  });

  _addProcessRow();
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
  tr.innerHTML = `
    <td class="inp-pid-cell">P${pid}</td>
    <td><input type="number" class="inp-num inp-arrival"
        min="${LIMITS.arrival.min}" max="${LIMITS.arrival.max}" value="0"></td>
    <td><input type="number" class="inp-num inp-burst"
        min="${LIMITS.burst.min}" max="${LIMITS.burst.max}" value="5"></td>
    <td><input type="number" class="inp-num inp-priority"
        min="${LIMITS.priority.min}" max="${LIMITS.priority.max}" value="1"></td>
    <td><input type="number" class="inp-num inp-shared"
        min="${LIMITS.shared.min}" max="${LIMITS.shared.max}" value="1"></td>
    <td class="inp-thread-cell">
      <button class="inp-btn-sm inp-toggle-threads" data-pid="${pid}" hidden>▼ 0 threads</button>
      <button class="inp-btn-sm inp-add-thread" data-pid="${pid}">+ Thread</button>
    </td>
    <td><button class="inp-btn-sm inp-btn-danger inp-del-proc" data-pid="${pid}" title="Eliminar proceso">×</button></td>
  `;
  tbody.appendChild(tr);

  const containerTr = _makeThreadContainer(pid);
  tbody.appendChild(containerTr);

  // Wire delete + thread buttons
  tr.querySelector('.inp-del-proc').addEventListener('click', () => _deleteProcess(pid));
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
        <span>Thread</span><span>Llegada</span><span>Ráfaga</span><span>Stack pages</span><span></span>
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
}

function _clearAll() {
  document.getElementById('inp-tbody').innerHTML = '';
  _procMeta.clear();
  document.getElementById('inp-proc-errors').hidden = true;
  document.getElementById('inp-file-error').hidden = true;
  _addProcessRow();
  toast('Procesos limpiados.', 'info', 1800);
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
  div.innerHTML = `
    <span class="inp-thread-label">T${localTid}</span>
    <input type="number" class="inp-num inp-t-arrival"
      min="${LIMITS.arrival.min}" max="${LIMITS.arrival.max}" value="${procArr}" title="Thread arrival">
    <input type="number" class="inp-num inp-t-burst"
      min="${LIMITS.burst.min}" max="${LIMITS.burst.max}" value="${defBurst}" title="Thread burst">
    <input type="number" class="inp-num inp-t-stack"
      min="${LIMITS.stackPages.min}" max="${LIMITS.stackPages.max}" value="1" title="Stack pages">
    <button class="inp-btn-sm inp-btn-danger inp-del-thread" title="Eliminar thread">×</button>
  `;
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

function _updateFramesDisplay() {
  const memSizeInput = document.getElementById('inp-mem-size');
  const pageSizeInput = document.getElementById('inp-page-size');
  const memSize  = parseInt(memSizeInput.value);
  const pageSize = parseInt(pageSizeInput.value);
  const display  = document.getElementById('inp-frames-display');
  const errEl    = document.getElementById('inp-mem-error');

  errEl.hidden = true;

  if (!memSize || !pageSize || pageSize <= 0) {
    display.textContent = 'Frames: —';
    display.className   = 'inp-frames-display';
    return;
  }

  if (memSize < LIMITS.totalMem.min || memSize > LIMITS.totalMem.max) {
    display.textContent = 'Frames: — (fuera de rango)';
    display.className   = 'inp-frames-display inp-frames-error';
    errEl.textContent   = `Memoria fuera de rango (${LIMITS.totalMem.min}–${LIMITS.totalMem.max} KB).`;
    errEl.hidden        = false;
    return;
  }

  if (pageSize < LIMITS.pageSize.min || pageSize > LIMITS.pageSize.max) {
    display.textContent = 'Frames: — (fuera de rango)';
    display.className   = 'inp-frames-display inp-frames-error';
    errEl.textContent   = `Tamaño de página fuera de rango (${LIMITS.pageSize.min}–${LIMITS.pageSize.max} KB).`;
    errEl.hidden        = false;
    return;
  }

  if (memSize % pageSize !== 0) {
    display.textContent = 'Frames: — (no divisible)';
    display.className   = 'inp-frames-display inp-frames-error';
    errEl.textContent   = 'La memoria total debe ser divisible entre el tamaño de página.';
    errEl.hidden        = false;
  } else {
    const frames = memSize / pageSize;
    display.textContent = `${frames}`;
    display.className   = 'inp-frames-display';
    if (frames > 256) {
      errEl.textContent = `Aviso: ${frames} marcos podrían ralentizar la visualización. Reduce la memoria o aumenta la página.`;
      errEl.hidden = false;
    }
  }
}

// ─── File upload ──────────────────────────────────────────────────────────────

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

      const colCount = lines[0].split(',').length;
      if (colCount !== 5 && colCount !== 9) {
        throw new Error(`Se esperaban 5 o 9 columnas, se encontraron ${colCount}. Revisa el formato.`);
      }

      const processes = parseProcessesFromFile(content);

      if (processes.length > LIMITS.processes.max) {
        throw new Error(`El archivo tiene ${processes.length} procesos. Máximo permitido: ${LIMITS.processes.max}.`);
      }

      document.getElementById('inp-tbody').innerHTML = '';
      _procMeta.clear();
      _nextPid = Math.max(...processes.map(p => p.pid)) + 1;

      _populateFromProcesses(processes, colCount === 9);

      errEl.hidden      = true;
      errEl.textContent = '';
      toast(`Cargados ${processes.length} procesos desde "${file.name}".`, 'ok');
    } catch (err) {
      errEl.textContent = `Error: ${err.message}`;
      errEl.hidden      = false;
      toast('No se pudo cargar el archivo. Revisa el panel de error.', 'err');
    }

    e.target.value = '';
  };
  reader.readAsText(file);
}

function _populateFromProcesses(processes, showThreads) {
  const tbody = document.getElementById('inp-tbody');

  for (const proc of processes) {
    const hasThreads = showThreads && proc.threads.length > 0;
    _procMeta.set(proc.pid, { localTidCounter: hasThreads ? proc.threads.length : 0 });

    const tr = document.createElement('tr');
    tr.className  = 'inp-proc-row';
    tr.dataset.pid = proc.pid;
    tr.innerHTML = `
      <td class="inp-pid-cell">P${proc.pid}</td>
      <td><input type="number" class="inp-num inp-arrival"
          min="${LIMITS.arrival.min}" max="${LIMITS.arrival.max}" value="${proc.arrivalTime}"></td>
      <td><input type="number" class="inp-num inp-burst${hasThreads ? ' inp-readonly' : ''}"
          min="${LIMITS.burst.min}" max="${LIMITS.burst.max}" value="${proc.burstTime}"${hasThreads ? ' readonly' : ''}></td>
      <td><input type="number" class="inp-num inp-priority"
          min="${LIMITS.priority.min}" max="${LIMITS.priority.max}" value="${proc.priority}"></td>
      <td><input type="number" class="inp-num inp-shared"
          min="${LIMITS.shared.min}" max="${LIMITS.shared.max}" value="${proc.sharedPages}"></td>
      <td class="inp-thread-cell">
        <button class="inp-btn-sm inp-toggle-threads" data-pid="${proc.pid}"${hasThreads ? '' : ' hidden'}>▼ ${proc.threads.length} thread${proc.threads.length !== 1 ? 's' : ''}</button>
        <button class="inp-btn-sm inp-add-thread" data-pid="${proc.pid}">+ Thread</button>
      </td>
      <td><button class="inp-btn-sm inp-btn-danger inp-del-proc" data-pid="${proc.pid}" title="Eliminar proceso">×</button></td>
    `;
    tbody.appendChild(tr);

    const containerTr = _makeThreadContainer(proc.pid);
    containerTr.hidden = !hasThreads;
    tbody.appendChild(containerTr);

    tr.querySelector('.inp-del-proc').addEventListener('click', () => _deleteProcess(proc.pid));
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
        div.innerHTML = `
          <span class="inp-thread-label">T${localTid}</span>
          <input type="number" class="inp-num inp-t-arrival"
            min="${LIMITS.arrival.min}" max="${LIMITS.arrival.max}" value="${t.arrivalTime}" title="Thread arrival">
          <input type="number" class="inp-num inp-t-burst"
            min="${LIMITS.burst.min}" max="${LIMITS.burst.max}" value="${t.burstTime}"   title="Thread burst">
          <input type="number" class="inp-num inp-t-stack"
            min="${LIMITS.stackPages.min}" max="${LIMITS.stackPages.max}" value="${t.stackPages}"  title="Stack pages">
          <button class="inp-btn-sm inp-btn-danger inp-del-thread" title="Eliminar thread">×</button>
        `;
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

function _loadExample() {
  const example = [
    { pid: 1, arrivalTime: 0, burstTime: 5, priority: 2, sharedPages: 4, threads: [] },
    { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1, sharedPages: 3, threads: [] },
    { pid: 3, arrivalTime: 2, burstTime: 7, priority: 3, sharedPages: 5, threads: [] },
  ];

  document.getElementById('inp-tbody').innerHTML = '';
  _procMeta.clear();
  _nextPid = 4;

  _populateFromProcesses(example, false);
  document.getElementById('inp-mem-size').value = '256';
  document.getElementById('inp-page-size').value = '32';
  _updateFramesDisplay();

  toast('Ejemplo cargado: 3 procesos, 256 KB / 32 KB página.', 'info');
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

  setAppStatus(`${processes.length} procesos · ${AppState.memoryConfig.numFrames} marcos`, 'ok');
  toast(`Simulación lista — ${processes.length} procesos cargados.`, 'ok');

  navigateTo('scheduling');
}

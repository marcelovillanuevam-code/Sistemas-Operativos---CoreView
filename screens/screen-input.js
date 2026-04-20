// screen-input.js — Input screen glue. Wires process/memory form DOM to data.js parsers.
// Produces Process[] (with threads) and MemoryConfig, stores in AppState.

import {
  parseProcessesFromForm,
  parseProcessesFromFile,
  parseMemoryConfig,
  validateProcesses,
} from '../data.js';
import { AppState } from '../app.js';

// Auto-incrementing PID counter for the session; never resets on clear (keeps uniqueness).
let _nextPid = 1;
// Map<pid, { localTidCounter: number }>
const _procMeta = new Map();

export function initInputScreen() {
  const root = document.querySelector('[data-screen="input"]');
  if (!root) return;

  root.innerHTML = `
    <h2>Process Input</h2>

    <section class="inp-section">
      <div class="inp-toolbar">
        <button id="inp-add-process" class="inp-btn">+ Add Process</button>
        <label class="inp-btn" for="inp-file-upload" style="cursor:pointer">Upload .txt</label>
        <input type="file" id="inp-file-upload" accept=".txt" style="display:none">
        <button id="inp-clear-all" class="inp-btn inp-btn-outline-danger">Clear All</button>
      </div>
      <div id="inp-file-error" class="inp-error" hidden></div>
      <table class="inp-table" id="inp-process-table">
        <thead>
          <tr>
            <th>PID</th>
            <th>Arrival</th>
            <th>Burst</th>
            <th>Priority</th>
            <th>Shared Pages</th>
            <th>Threads</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="inp-tbody"></tbody>
      </table>
      <div id="inp-proc-errors" class="inp-error" hidden></div>
    </section>

    <section class="inp-section">
      <h3>Memory Configuration</h3>
      <div class="inp-mem-row">
        <label class="inp-mem-label">Memory Size (KB)
          <input type="number" id="inp-mem-size" class="inp-num" min="1" value="256">
        </label>
        <label class="inp-mem-label">Page Size (KB)
          <input type="number" id="inp-page-size" class="inp-num" min="1" value="32">
        </label>
        <span id="inp-frames-display" class="inp-frames-display">Frames: 8</span>
      </div>
      <div id="inp-mem-error" class="inp-error" hidden></div>
    </section>

    <button id="inp-run-btn" class="inp-btn inp-btn-primary">Run Simulation \u2192</button>
  `;

  document.getElementById('inp-add-process').addEventListener('click', _addProcessRow);
  document.getElementById('inp-file-upload').addEventListener('change', _handleFileUpload);
  document.getElementById('inp-clear-all').addEventListener('click', _clearAll);
  document.getElementById('inp-run-btn').addEventListener('click', _handleRunSimulation);

  document.getElementById('inp-mem-size').addEventListener('input', _updateFramesDisplay);
  document.getElementById('inp-page-size').addEventListener('input', _updateFramesDisplay);

  _addProcessRow();
}

// ─── Process row ─────────────────────────────────────────────────────────────

function _addProcessRow() {
  const pid = _nextPid++;
  _procMeta.set(pid, { localTidCounter: 0 });

  const tbody = document.getElementById('inp-tbody');

  const tr = document.createElement('tr');
  tr.className = 'inp-proc-row';
  tr.dataset.pid = pid;
  tr.innerHTML = `
    <td class="inp-pid-cell">P${pid}</td>
    <td><input type="number" class="inp-num inp-arrival" min="0" value="0"></td>
    <td><input type="number" class="inp-num inp-burst" min="1" value="5"></td>
    <td><input type="number" class="inp-num inp-priority" min="1" value="1"></td>
    <td><input type="number" class="inp-num inp-shared" min="1" value="1"></td>
    <td class="inp-thread-cell">
      <button class="inp-btn-sm inp-toggle-threads" data-pid="${pid}" hidden>\u25bc 0 threads</button>
      <button class="inp-btn-sm inp-add-thread" data-pid="${pid}">+ Thread</button>
    </td>
    <td><button class="inp-btn-sm inp-btn-danger inp-del-proc" data-pid="${pid}">\u00d7</button></td>
  `;
  tbody.appendChild(tr);

  const containerTr = _makeThreadContainer(pid);
  tbody.appendChild(containerTr);

  tr.querySelector('.inp-del-proc').addEventListener('click', () => _deleteProcess(pid));
  tr.querySelector('.inp-add-thread').addEventListener('click', () => _addThreadRow(pid));
  tr.querySelector('.inp-toggle-threads').addEventListener('click', () => _toggleThreads(pid));
}

function _makeThreadContainer(pid) {
  const tr = document.createElement('tr');
  tr.className = 'inp-thread-container';
  tr.dataset.parentPid = pid;
  tr.hidden = true;
  tr.innerHTML = `
    <td colspan="7" class="inp-thread-td">
      <div class="inp-thread-header">
        <span>Thread</span><span>Arrival</span><span>Burst</span><span>Stack Pages</span><span></span>
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
  _addProcessRow();
}

// ─── Thread sub-rows ─────────────────────────────────────────────────────────

function _addThreadRow(pid) {
  const meta = _procMeta.get(pid);
  if (!meta) return;

  meta.localTidCounter++;
  const localTid = meta.localTidCounter;

  const procRow  = document.querySelector(`.inp-proc-row[data-pid="${pid}"]`);
  const procArr  = parseInt(procRow.querySelector('.inp-arrival').value) || 0;
  const threadList = document.querySelector(`.inp-thread-list[data-pid="${pid}"]`);

  // First thread inherits the current process burst; subsequent threads default to 3.
  const isFirst   = threadList.querySelectorAll('.inp-thread-row').length === 0;
  const defBurst  = isFirst ? (parseInt(procRow.querySelector('.inp-burst').value) || 3) : 3;

  const div = document.createElement('div');
  div.className = 'inp-thread-row';
  div.dataset.pid      = pid;
  div.dataset.localTid = localTid;
  div.innerHTML = `
    <span class="inp-thread-label">T${localTid}</span>
    <input type="number" class="inp-num inp-t-arrival" min="0" value="${procArr}" title="Thread Arrival">
    <input type="number" class="inp-num inp-t-burst"   min="1" value="${defBurst}" title="Thread Burst">
    <input type="number" class="inp-num inp-t-stack"   min="1" value="1" title="Stack Pages">
    <button class="inp-btn-sm inp-btn-danger inp-del-thread">\u00d7</button>
  `;
  threadList.appendChild(div);

  div.querySelector('.inp-del-thread').addEventListener('click', () => {
    div.remove();
    _syncBurst(pid);
    _syncToggle(pid);
  });
  div.querySelector('.inp-t-burst').addEventListener('input', () => _syncBurst(pid));

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
    const arrow = container.hidden ? '\u25ba' : '\u25bc';
    toggleBtn.textContent = `${arrow} ${count} thread${count !== 1 ? 's' : ''}`;
  }
}

function _toggleThreads(pid) {
  const container  = document.querySelector(`.inp-thread-container[data-parent-pid="${pid}"]`);
  const toggleBtn  = document.querySelector(`.inp-proc-row[data-pid="${pid}"] .inp-toggle-threads`);
  const threadList = document.querySelector(`.inp-thread-list[data-pid="${pid}"]`);
  const count      = threadList.querySelectorAll('.inp-thread-row').length;

  container.hidden = !container.hidden;
  const arrow = container.hidden ? '\u25ba' : '\u25bc';
  toggleBtn.textContent = `${arrow} ${count} thread${count !== 1 ? 's' : ''}`;
}

// ─── Memory config ────────────────────────────────────────────────────────────

function _updateFramesDisplay() {
  const memSize  = parseInt(document.getElementById('inp-mem-size').value);
  const pageSize = parseInt(document.getElementById('inp-page-size').value);
  const display  = document.getElementById('inp-frames-display');
  const errEl    = document.getElementById('inp-mem-error');

  if (!memSize || !pageSize || pageSize <= 0) {
    display.textContent = 'Frames: \u2014';
    display.className   = 'inp-frames-display';
    return;
  }

  if (memSize % pageSize !== 0) {
    display.textContent = 'Frames: \u2014 (not divisible)';
    display.className   = 'inp-frames-display inp-frames-error';
    errEl.textContent   = 'Memory size must be divisible by page size';
    errEl.hidden        = false;
  } else {
    display.textContent = `Frames: ${memSize / pageSize}`;
    display.className   = 'inp-frames-display';
    errEl.hidden        = true;
  }
}

// ─── File upload ──────────────────────────────────────────────────────────────

function _handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = evt => {
    const content = evt.target.result;
    const errEl   = document.getElementById('inp-file-error');

    try {
      const lines = content.trim().split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
      if (!lines.length) throw new Error('File is empty');

      const colCount = lines[0].split(',').length;
      if (colCount !== 5 && colCount !== 9) {
        throw new Error(`Expected 5 or 9 columns, got ${colCount}`);
      }

      const processes = parseProcessesFromFile(content);

      document.getElementById('inp-tbody').innerHTML = '';
      _procMeta.clear();
      _nextPid = Math.max(...processes.map(p => p.pid)) + 1;

      _populateFromProcesses(processes, colCount === 9);

      errEl.hidden      = true;
      errEl.textContent = '';
    } catch (err) {
      errEl.textContent = `Error: ${err.message}`;
      errEl.hidden      = false;
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
      <td><input type="number" class="inp-num inp-arrival" min="0" value="${proc.arrivalTime}"></td>
      <td><input type="number" class="inp-num inp-burst${hasThreads ? ' inp-readonly' : ''}" min="1" value="${proc.burstTime}"${hasThreads ? ' readonly' : ''}></td>
      <td><input type="number" class="inp-num inp-priority" min="1" value="${proc.priority}"></td>
      <td><input type="number" class="inp-num inp-shared"  min="1" value="${proc.sharedPages}"></td>
      <td class="inp-thread-cell">
        <button class="inp-btn-sm inp-toggle-threads" data-pid="${proc.pid}"${hasThreads ? '' : ' hidden'}>\u25bc ${proc.threads.length} thread${proc.threads.length !== 1 ? 's' : ''}</button>
        <button class="inp-btn-sm inp-add-thread" data-pid="${proc.pid}">+ Thread</button>
      </td>
      <td><button class="inp-btn-sm inp-btn-danger inp-del-proc" data-pid="${proc.pid}">\u00d7</button></td>
    `;
    tbody.appendChild(tr);

    const containerTr = _makeThreadContainer(proc.pid);
    containerTr.hidden = !hasThreads;
    tbody.appendChild(containerTr);

    tr.querySelector('.inp-del-proc').addEventListener('click', () => _deleteProcess(proc.pid));
    tr.querySelector('.inp-add-thread').addEventListener('click', () => _addThreadRow(proc.pid));
    tr.querySelector('.inp-toggle-threads').addEventListener('click', () => _toggleThreads(proc.pid));

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
          <input type="number" class="inp-num inp-t-arrival" min="0" value="${t.arrivalTime}" title="Thread Arrival">
          <input type="number" class="inp-num inp-t-burst"   min="1" value="${t.burstTime}"   title="Thread Burst">
          <input type="number" class="inp-num inp-t-stack"   min="1" value="${t.stackPages}"  title="Stack Pages">
          <button class="inp-btn-sm inp-btn-danger inp-del-thread">\u00d7</button>
        `;
        threadList.appendChild(div);

        div.querySelector('.inp-del-thread').addEventListener('click', () => {
          div.remove();
          _syncBurst(proc.pid);
          _syncToggle(proc.pid);
        });
        div.querySelector('.inp-t-burst').addEventListener('input', () => _syncBurst(proc.pid));
      });
    }
  }
}

// ─── Collect & run ────────────────────────────────────────────────────────────

function _collectRawProcesses() {
  return [...document.querySelectorAll('.inp-proc-row')].map(row => {
    const pid        = parseInt(row.dataset.pid);
    const arrival    = parseInt(row.querySelector('.inp-arrival').value)  || 0;
    const burst      = parseInt(row.querySelector('.inp-burst').value)    || 0;
    const priority   = parseInt(row.querySelector('.inp-priority').value) || 1;
    const sharedPages = parseInt(row.querySelector('.inp-shared').value)  || 1;

    const threadList = document.querySelector(`.inp-thread-list[data-pid="${pid}"]`);
    const threadEls  = threadList ? [...threadList.querySelectorAll('.inp-thread-row')] : [];

    const threads = threadEls.map(el => ({
      arrival:    parseInt(el.querySelector('.inp-t-arrival').value) || 0,
      burst:      parseInt(el.querySelector('.inp-t-burst').value)   || 1,
      stackPages: parseInt(el.querySelector('.inp-t-stack').value)   || 1,
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
    procErrEl.textContent = 'Add at least one process before running.';
    procErrEl.hidden      = false;
    return;
  }

  const fd = new FormData();
  fd.set('processes', JSON.stringify(rawProcesses));

  let processes;
  try {
    processes = parseProcessesFromForm(fd);
  } catch (err) {
    procErrEl.textContent = `Parse error: ${err.message}`;
    procErrEl.hidden      = false;
    return;
  }

  const validation = validateProcesses(processes);
  if (!validation.valid) {
    procErrEl.innerHTML = validation.errors
      .map(e => `<div class="inp-error-item">${e}</div>`)
      .join('');
    procErrEl.hidden = false;
    return;
  }

  const totalMemory = parseInt(document.getElementById('inp-mem-size').value);
  const pageSize    = parseInt(document.getElementById('inp-page-size').value);

  if (!totalMemory || totalMemory <= 0) {
    memErrEl.textContent = 'Memory size must be a positive integer.';
    memErrEl.hidden      = false;
    return;
  }
  if (!pageSize || pageSize <= 0) {
    memErrEl.textContent = 'Page size must be a positive integer.';
    memErrEl.hidden      = false;
    return;
  }
  if (totalMemory % pageSize !== 0) {
    memErrEl.textContent = 'Memory size must be divisible by page size.';
    memErrEl.hidden      = false;
    return;
  }

  const mfd = new FormData();
  mfd.set('totalMemory', totalMemory);
  mfd.set('pageSize', pageSize);

  AppState.processes    = processes;
  AppState.memoryConfig = parseMemoryConfig(mfd);

  document.querySelector('[data-tab="scheduling"]').click();
}

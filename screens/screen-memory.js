// screen-memory.js - Memory screen glue with copy-on-write fork visualization.

import { AppState } from '../app.js';
import { computeMemoryState, hasCowPage } from '../engine/memory-state.js';
import { writeProcessPage } from '../engine/process-model.js';
import { renderMemoryGrid } from '../render/memory-grid.js';
import { navigateTo, toast } from '../render/ui-feedback.js';

const A1_PROCESSES = [
  { pid: 1, arrivalTime: 0, burstTime: 5, priority: 2, sharedPages: 4, numPages: 5,
    threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 2, stackPages: 1 }] },
  { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1, sharedPages: 3, numPages: 4,
    threads: [{ tid: 2, parentPid: 2, arrivalTime: 1, burstTime: 3, priority: 1, stackPages: 1 }] },
  { pid: 3, arrivalTime: 2, burstTime: 7, priority: 3, sharedPages: 5, numPages: 6,
    threads: [{ tid: 3, parentPid: 3, arrivalTime: 2, burstTime: 7, priority: 3, stackPages: 1 }] },
];

const DEFAULT_CONFIG = { totalMemory: 160, pageSize: 8, numFrames: 20 };

let _lastHighlight = null;

function ensureCowStyles() {
  if (document.getElementById('memory-cow-styles')) return;

  const style = document.createElement('style');
  style.id = 'memory-cow-styles';
  style.textContent = `
    [data-screen="memory"] .mem-frame--cow {
      border: 3px double var(--text-primary);
      box-shadow: inset 0 0 0 1px var(--bg-surface);
    }

    [data-screen="memory"] .mem-fr-cow-lock {
      position: absolute;
      top: 6px;
      right: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      font-size: 12px;
      line-height: 1;
    }

    [data-screen="memory"] .mem-write-btn {
      margin-top: var(--space-1);
      max-width: calc(100% - 8px);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
      font-family: var(--font-ui);
      font-size: 10px;
      font-weight: 600;
      line-height: 1.1;
      padding: 3px 5px;
      white-space: normal;
    }

    [data-screen="memory"] .mem-write-btn:hover {
      background: var(--bg-elevated);
    }

    [data-screen="memory"] .mem-write-btn:disabled {
      opacity: 0.72;
      cursor: not-allowed;
      background: rgba(239, 68, 68, 0.12);
      color: var(--state-blocked);
      border-color: rgba(239, 68, 68, 0.28);
    }

    [data-screen="memory"] .mem-fr-ver {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.82);
      font-family: var(--font-mono);
      line-height: 1.1;
    }

    [data-screen="memory"] .mem-frame--cow-new {
      animation: memCowCopyIn 520ms var(--ease-out);
    }

    [data-screen="memory"] .mem-frame--written {
      animation: memPageWrite 420ms var(--ease-out);
    }

    [data-screen="memory"] .mem-legend-swatch--cow {
      background: var(--bg-elevated);
      border: 3px double var(--text-primary);
    }

    @keyframes memCowCopyIn {
      from { opacity: 0.25; transform: scale(0.92); }
      to { opacity: 1; transform: scale(1); }
    }

    @keyframes memPageWrite {
      0% { transform: scale(1); }
      45% { transform: scale(1.08); }
      100% { transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

export function initMemoryScreen() {
  const root = document.querySelector('[data-screen="memory"]');
  if (!root) return;

  ensureCowStyles();

  root.innerHTML = `
    <h2>Memoria física</h2>
    <p class="screen-desc">
      La memoria está dividida en <b>frames</b> de tamaño fijo. Las páginas COW
      creadas por fork() comparten el mismo frame físico hasta que una escritura
      materializa una copia privada.
    </p>

    <div id="mem-data-banner"></div>
    <div id="mem-warning"></div>
    <div class="concept-panel">
      <div class="concept-panel-title">Qué estás viendo</div>
      <div class="concept-panel-grid">
        <div><b>Frame</b>: espacio físico de memoria. Cada bloque del grid es un frame real disponible.</div>
        <div><b>Page</b>: porción lógica de un proceso cargada dentro de un frame físico.</div>
        <div><b>COW por fork()</b>: si ves candado, padre e hijo comparten ese frame; al escribir se materializa una copia privada.</div>
      </div>
    </div>
    <div id="mem-fork-summary" class="fork-summary" hidden></div>
    <div id="mem-container"></div>
  `;

  const container = root.querySelector('#mem-container');
  const bannerEl = root.querySelector('#mem-data-banner');
  const warnEl = root.querySelector('#mem-warning');
  const forkSummaryEl = root.querySelector('#mem-fork-summary');

  function renderDataBanner(usingDefaults, config, processes) {
    const cowCount = processes.reduce((sum, process) =>
      sum + (process.memory?.cowPages?.length || 0), 0);

    if (!usingDefaults) {
      bannerEl.innerHTML =
        `<div class="banner-info">` +
        `  <span class="banner-icon">i</span>` +
        `  Mostrando asignación de memoria para tus <b>${AppState.processes.length}</b> proceso(s) - ` +
        `  <b>${config.totalMemory} KB</b> totales · page size de <b>${config.pageSize} KB</b> · ` +
        `  <b>${config.numFrames}</b> frames` +
        (cowCount > 0 ? ` · <b>${cowCount}</b> enlaces COW` : '') +
        `</div>`;
    } else {
      bannerEl.innerHTML =
        `<div class="banner-info banner-warn">` +
        `  <span class="banner-icon">!</span>` +
        `  Mostrando datos de <b>ejemplo</b>. ` +
        `  <a href="#" id="mem-goto-input">Ir a Entrada para definir tus procesos y memoria</a>` +
        `</div>`;
      bannerEl.querySelector('#mem-goto-input')?.addEventListener('click', event => {
        event.preventDefault();
        navigateTo('input');
      });
    }
  }

  function renderCapacityWarning(memState, config) {
    const freeFrames = memState.frames.filter(frame => frame.ownerPid === null).length;
    const hasCowPages = memState.frames.some(frame => frame.cow?.isCow);
    const cowNoFreeFrame = hasCowPages && freeFrames === 0;
    const recommendedTotal = Math.max(memState.requiredPhysicalPages + 1, config.numFrames + 1) * config.pageSize;

    if (memState.requiredPhysicalPages > config.numFrames) {
      const overflow = memState.requiredPhysicalPages - config.numFrames;
      warnEl.innerHTML =
        `<div class="banner-info banner-warn">` +
        `  <span class="banner-icon">!</span>` +
        `  La asignación física requiere <b>${memState.requiredPhysicalPages}</b> páginas pero solo hay ` +
        `  <b>${config.numFrames}</b> frames disponibles (<b>${overflow}</b> páginas no caben).` +
        (cowNoFreeFrame
          ? ` Para demostrar una copia privada COW, vuelve a Entrada y sube Memoria total a <b>${recommendedTotal} KB</b> o más.`
          : '') +
        `</div>`;
    } else if (cowNoFreeFrame) {
      warnEl.innerHTML =
        `<div class="banner-info banner-warn">` +
        `  <span class="banner-icon">!</span>` +
        `  Hay páginas COW, pero <b>0 frames libres</b>. Para pulsar Escribir y crear una copia privada, agrega al menos un frame libre en Entrada.` +
        `</div>`;
    } else {
      warnEl.innerHTML = '';
    }
  }

  function processLabel(process) {
    if (!process) return '';
    return process?.forkLabel || `P${process?.pid}`;
  }

  function buildPidLabels(processes) {
    return new Map(processes.map(process => [process.pid, processLabel(process)]));
  }

  function renderForkSummary(processes, usingDefaults, memState) {
    if (!forkSummaryEl) return;

    const children = usingDefaults
      ? []
      : processes
        .filter(process => process.isForkChild && process.forkParentPid !== null && process.forkParentPid !== undefined)
        .sort((left, right) => left.pid - right.pid);

    if (children.length === 0) {
      forkSummaryEl.hidden = true;
      forkSummaryEl.innerHTML = '';
      return;
    }

    const rows = children.map(child => {
      const parent = processes.find(process => process.pid === child.forkParentPid);
      const sharedPages = child.memory?.cowPages?.length || 0;
      const privatePages = child.memory?.materializedCowPages?.length || 0;
      return (
        `<span class="fork-summary-row">` +
        `<span class="fork-chip fork-chip--parent">${processLabel(parent) || `P${child.forkParentPid}`}</span>` +
        `<span class="fork-arrow">-&gt;</span>` +
        `<span class="fork-chip fork-chip--child">${processLabel(child)}</span>` +
        `<span class="fork-summary-note">${sharedPages} COW compartida${sharedPages !== 1 ? 's' : ''}, ${privatePages} copia${privatePages !== 1 ? 's' : ''} privada${privatePages !== 1 ? 's' : ''}</span>` +
        `</span>`
      );
    }).join('');
    const freeFrames = memState
      ? memState.frames.filter(frame => frame.ownerPid === null).length
      : 0;
    const hasCowPages = children.some(child => (child.memory?.cowPages?.length || 0) > 0);
    const cowBlockedNote = hasCowPages && freeFrames === 0
      ? `<div class="fork-summary-help fork-summary-help--warn">Ahora hay 0 frames libres; por eso la escritura COW queda bloqueada. Sube la memoria total para dejar al menos 1 frame libre.</div>`
      : '';

    forkSummaryEl.hidden = false;
    forkSummaryEl.innerHTML =
      `<div class="fork-summary-title">Relaciones fork() en memoria</div>` +
      `<div class="fork-summary-list">${rows}</div>` +
      `<div class="fork-summary-help">Los frames con candado son páginas compartidas por Copy-on-Write; al pulsar Escribir se crea una copia privada si hay frames libres.</div>` +
      cowBlockedNote;
  }

  function activeData() {
    const usingDefaults = !(AppState.processes && AppState.processes.length > 0);
    return {
      usingDefaults,
      processes: usingDefaults ? A1_PROCESSES : AppState.processes,
      config: AppState.memoryConfig ?? DEFAULT_CONFIG,
    };
  }

  function handleWritePage({ pid, pageNumber }) {
    const { usingDefaults, processes, config } = activeData();
    if (usingDefaults) {
      toast('Carga procesos desde Entrada para simular escrituras COW.', 'warn');
      return;
    }

    const beforeState = computeMemoryState(processes, config);
    const isCow = hasCowPage(processes, pid, pageNumber);
    const freeFrames = beforeState.frames.filter(frame => frame.ownerPid === null).length;
    if (isCow && freeFrames <= 0) {
      toast('No hay frames libres para duplicar la página COW. Sube Memoria total en Entrada.', 'err');
      return;
    }

    try {
      const result = writeProcessPage(processes, pid, pageNumber);
      const writerLabel = processLabel(processes.find(process => process.pid === pid)) || `P${pid}`;
      _lastHighlight = {
        pid,
        pageNumber,
        kind: result.duplicated ? 'cow-copy' : 'write',
      };
      toast(result.duplicated
        ? `${writerLabel} duplicó página ${pageNumber} por COW.`
        : `${writerLabel} escribió página ${pageNumber}; ya era privada, no se crea frame nuevo.`, 'ok');
      render();
      setTimeout(() => {
        _lastHighlight = null;
        render();
      }, 650);
    } catch (error) {
      toast(error.message || 'No se pudo escribir la página.', 'err');
    }
  }

  function render() {
    const { usingDefaults, processes, config } = activeData();
    const memState = computeMemoryState(processes, config);

    renderDataBanner(usingDefaults, config, processes);
    renderCapacityWarning(memState, config);
    renderForkSummary(processes, usingDefaults, memState);
    renderMemoryGrid(container, memState, config, {
      highlight: _lastHighlight,
      pidLabels: buildPidLabels(processes),
      canMaterializeCow: memState.frames.some(frame => frame.ownerPid === null),
      onWritePage: handleWritePage,
    });
  }

  document.querySelector('[data-tab="memory"]')?.addEventListener('click', render);
  render();
}

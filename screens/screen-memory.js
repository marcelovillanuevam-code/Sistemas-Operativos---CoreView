// screen-memory.js — Memory screen glue. Reads AppState.processes + memoryConfig,
// renders MemoryGrid showing frame allocation per process. Sees total numPages only.

import { AppState }         from '../app.js';
import { renderMemoryGrid } from '../render/memory-grid.js';
import { navigateTo }       from '../render/ui-feedback.js';

// Default A1 processes (matches Appendix A.1 — single-threaded)
const A1_PROCESSES = [
  { pid: 1, arrivalTime: 0, burstTime: 5, priority: 2, sharedPages: 4, numPages: 5,
    threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 2, stackPages: 1 }] },
  { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1, sharedPages: 3, numPages: 4,
    threads: [{ tid: 2, parentPid: 2, arrivalTime: 1, burstTime: 3, priority: 1, stackPages: 1 }] },
  { pid: 3, arrivalTime: 2, burstTime: 7, priority: 3, sharedPages: 5, numPages: 6,
    threads: [{ tid: 3, parentPid: 3, arrivalTime: 2, burstTime: 7, priority: 3, stackPages: 1 }] },
];

const DEFAULT_CONFIG = { totalMemory: 160, pageSize: 8, numFrames: 20 };

/**
 * Computes MemoryState by allocating processes sequentially into frames.
 */
function _computeMemoryState(processes, config) {
  const { numFrames, pageSize } = config;

  const frames = Array.from({ length: numFrames }, (_, i) => ({
    frameIndex: i,
    ownerPid: null,
    pageNumber: null,
    loadedAt: 0,
  }));

  let framePtr  = 0;
  let totalFrag = 0;

  const sorted = [...processes].sort((a, b) => a.pid - b.pid);
  for (const proc of sorted) {
    for (let pg = 0; pg < proc.numPages && framePtr < numFrames; pg++, framePtr++) {
      frames[framePtr] = {
        frameIndex: framePtr,
        ownerPid:   proc.pid,
        pageNumber: pg,
        loadedAt:   0,
      };
    }
    const frag = (pageSize - (proc.burstTime % pageSize)) % pageSize;
    totalFrag += frag;
  }

  return { frames, internalFragmentation: totalFrag };
}

export function initMemoryScreen() {
  const root = document.querySelector('[data-screen="memory"]');
  if (!root) return;

  root.innerHTML = `
    <h2>Memoria física</h2>
    <p class="screen-desc">
      La memoria está dividida en <b>marcos</b> de tamaño fijo. Cada proceso
      recibe marcos contiguos según su número total de páginas (compartidas +
      stacks de threads). El último marco de cada proceso puede tener
      <b>fragmentación interna</b> si no llena el marco completo.
    </p>

    <div id="mem-data-banner"></div>
    <div id="mem-warning"></div>
    <div id="mem-container"></div>
  `;

  const container = root.querySelector('#mem-container');
  const bannerEl  = root.querySelector('#mem-data-banner');
  const warnEl    = root.querySelector('#mem-warning');

  function _renderDataBanner(usingDefaults, config) {
    if (!usingDefaults) {
      bannerEl.innerHTML =
        `<div class="banner-info">` +
        `  <span class="banner-icon">●</span>` +
        `  Mostrando asignación de memoria para tus <b>${AppState.processes.length}</b> proceso(s) — ` +
        `  <b>${config.totalMemory} KB</b> totales · página de <b>${config.pageSize} KB</b> · ` +
        `  <b>${config.numFrames}</b> marcos.` +
        `</div>`;
    } else {
      bannerEl.innerHTML =
        `<div class="banner-info banner-warn">` +
        `  <span class="banner-icon">⚠</span>` +
        `  Mostrando datos de <b>ejemplo</b>. ` +
        `  <a href="#" id="mem-goto-input">Ir a Entrada para definir tus procesos y memoria →</a>` +
        `</div>`;
      bannerEl.querySelector('#mem-goto-input')?.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo('input');
      });
    }
  }

  function _renderCapacityWarning(processes, config) {
    const totalRequiredPages = processes.reduce((s, p) => s + p.numPages, 0);
    if (totalRequiredPages > config.numFrames) {
      const overflow = totalRequiredPages - config.numFrames;
      warnEl.innerHTML =
        `<div class="banner-info banner-warn">` +
        `  <span class="banner-icon">⚠</span>` +
        `  Los procesos requieren <b>${totalRequiredPages}</b> páginas totales pero solo hay ` +
        `  <b>${config.numFrames}</b> marcos disponibles (<b>${overflow}</b> páginas no caben). ` +
        `  Esto causará fallos de página en el módulo de Paginación.` +
        `</div>`;
    } else {
      warnEl.innerHTML = '';
    }
  }

  function _render() {
    const usingDefaults = !(AppState.processes && AppState.processes.length > 0);
    const processes = usingDefaults ? A1_PROCESSES : AppState.processes;
    const config    = AppState.memoryConfig ?? DEFAULT_CONFIG;

    _renderDataBanner(usingDefaults, config);
    _renderCapacityWarning(processes, config);

    const memState = _computeMemoryState(processes, config);
    renderMemoryGrid(container, memState, config);
  }

  document.querySelector('[data-tab="memory"]')?.addEventListener('click', _render);
  _render();
}

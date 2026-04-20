// screen-memory.js — Memory screen glue. Reads AppState.processes + memoryConfig,
// renders MemoryGrid showing frame allocation per process. Sees total numPages only.

import { AppState }         from '../app.js';
import { renderMemoryGrid } from '../render/memory-grid.js';

// Default A1 processes (matches Appendix A.1 — single-threaded)
const A1_PROCESSES = [
  { pid: 1, arrivalTime: 0, burstTime: 5, priority: 2, sharedPages: 4, numPages: 5,
    threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 2, stackPages: 1 }] },
  { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1, sharedPages: 3, numPages: 4,
    threads: [{ tid: 2, parentPid: 2, arrivalTime: 1, burstTime: 3, priority: 1, stackPages: 1 }] },
  { pid: 3, arrivalTime: 2, burstTime: 7, priority: 3, sharedPages: 5, numPages: 6,
    threads: [{ tid: 3, parentPid: 3, arrivalTime: 2, burstTime: 7, priority: 3, stackPages: 1 }] },
];

// Default memory config: enough frames for all A1 processes (5+4+6=15) plus empties
const DEFAULT_CONFIG = { totalMemory: 160, pageSize: 8, numFrames: 20 };

/**
 * Computes MemoryState by allocating processes sequentially into frames.
 * @param {import('../types.js').Process[]} processes
 * @param {import('../types.js').MemoryConfig} config
 * @returns {import('../types.js').MemoryState}
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
    // Internal fragmentation: treat burstTime as process byte size proxy.
    // Last page is filled with (burstTime % pageSize) bytes; the rest is wasted.
    const frag = (pageSize - (proc.burstTime % pageSize)) % pageSize;
    totalFrag += frag;
  }

  return { frames, internalFragmentation: totalFrag };
}

export function initMemoryScreen() {
  const root = document.querySelector('[data-screen="memory"]');
  if (!root) return;

  root.innerHTML = `
    <h2>Memory</h2>
    <p class="mem-desc">
      Physical memory is divided into fixed-size <b>frames</b>.
      Each process is allocated contiguous frames equal to its total page count
      (shared pages + stack pages). The last frame of each process may contain
      <b>internal fragmentation</b> if the process does not fully fill it.
    </p>
    <div id="mem-container"></div>
  `;

  const container = root.querySelector('#mem-container');

  function _render() {
    const processes = (AppState.processes && AppState.processes.length > 0)
      ? AppState.processes
      : A1_PROCESSES;
    const config = AppState.memoryConfig ?? DEFAULT_CONFIG;

    const memState = _computeMemoryState(processes, config);
    renderMemoryGrid(container, memState, config);
  }

  document.querySelector('[data-tab="memory"]')?.addEventListener('click', _render);
  _render();
}

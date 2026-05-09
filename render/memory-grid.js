// memory-grid.js — DOM Grid renderer for memory frames. Hoverable cells. Sees total numPages only.

import { pidToColor } from './color-utils.js';

/**
 * @param {HTMLElement} container
 * @param {import('../types.js').MemoryState} memoryState
 * @param {import('../types.js').MemoryConfig} config
 */
export function renderMemoryGrid(container, memoryState, config) {
  const { frames, internalFragmentation } = memoryState;
  const { pageSize, numFrames, totalMemory } = config;

  // Deterministic per-PID color via pidToColor
  const pids = [...new Set(
    frames.filter(f => f.ownerPid !== null).map(f => f.ownerPid)
  )].sort((a, b) => a - b);
  const colorMap = new Map(pids.map(pid => [pid, pidToColor(pid)]));

  // Last frame index per process (for fragmentation indicator)
  const lastFrameByPid = new Map();
  for (const f of frames) {
    if (f.ownerPid !== null) {
      const prev = lastFrameByPid.get(f.ownerPid);
      if (prev === undefined || f.frameIndex > prev) {
        lastFrameByPid.set(f.ownerPid, f.frameIndex);
      }
    }
  }

  const usedFrames = frames.filter(f => f.ownerPid !== null).length;
  const freeFrames = numFrames - usedFrames;
  const usedPercent = ((usedFrames / numFrames) * 100).toFixed(1);

  container.innerHTML = '';

  // ── Summary bar (in Spanish, with extra metrics) ─────────────────────────
  const summary = document.createElement('div');
  summary.className = 'mem-summary';
  summary.innerHTML =
    `<span title="Memoria física total">Memoria total: <b>${totalMemory} KB</b></span>` +
    `<span title="Tamaño de cada página/marco">Tamaño página: <b>${pageSize} KB</b></span>` +
    `<span title="Número de marcos físicos = totalMemory / pageSize">Marcos: <b>${numFrames}</b></span>` +
    `<span title="Marcos asignados a algún proceso">Ocupados: <b>${usedFrames}</b> (${usedPercent}%)</span>` +
    `<span title="Marcos libres disponibles">Libres: <b>${freeFrames}</b></span>` +
    `<span class="mem-summary-frag" title="Bytes desperdiciados al final del último marco de cada proceso">Fragmentación interna: <b>${internalFragmentation} B</b></span>`;
  container.appendChild(summary);

  // ── Per-process pill list (so colors are immediately legible) ────────────
  if (pids.length > 0) {
    const pidsList = document.createElement('div');
    pidsList.className = 'mem-pid-list';
    for (const pid of pids) {
      const pageCount = frames.filter(f => f.ownerPid === pid).length;
      const pill = document.createElement('span');
      pill.className = 'mem-pid-pill';
      pill.title = `P${pid} ocupa ${pageCount} marco(s)`;
      pill.innerHTML =
        `<span class="mem-pid-pill-swatch" style="background:${colorMap.get(pid)}"></span>` +
        `P${pid} · ${pageCount} marcos`;
      pidsList.appendChild(pill);
    }
    container.appendChild(pidsList);
  }

  // ── Frame grid ────────────────────────────────────────────────────────────
  const grid = document.createElement('div');
  grid.className = 'mem-grid';

  for (const frame of frames) {
    const cell = document.createElement('div');
    cell.className = 'mem-frame';

    if (frame.ownerPid === null) {
      cell.classList.add('mem-frame--empty');
      cell.title = `Marco ${frame.frameIndex} — libre`;
      cell.innerHTML =
        `<span class="mem-fr-num">F${frame.frameIndex}</span>` +
        `<span class="mem-fr-label">libre</span>`;
    } else {
      const color = colorMap.get(frame.ownerPid) ?? '#888';
      cell.style.backgroundColor = color;
      const isLast = lastFrameByPid.get(frame.ownerPid) === frame.frameIndex;
      if (isLast) cell.classList.add('mem-frame--frag');
      cell.title =
        `Marco ${frame.frameIndex} → P${frame.ownerPid}, página ${frame.pageNumber}` +
        (isLast ? ' (último marco — posible fragmentación interna)' : '');
      cell.innerHTML =
        `<span class="mem-fr-num">F${frame.frameIndex}</span>` +
        `<span class="mem-fr-pid">P${frame.ownerPid}</span>` +
        `<span class="mem-fr-pg">pág ${frame.pageNumber}</span>` +
        (isLast ? `<span class="mem-fr-frag-badge">frag</span>` : '');
    }

    grid.appendChild(cell);
  }
  container.appendChild(grid);

  // ── Legend ────────────────────────────────────────────────────────────────
  const legend = document.createElement('div');
  legend.className = 'mem-legend';
  legend.innerHTML =
    `<span class="mem-legend-item"><span class="mem-legend-swatch" style="background:var(--bg-elevated);border:1px dashed var(--border-default);"></span>Marco libre</span>` +
    `<span class="mem-legend-item"><span class="mem-legend-swatch mem-legend-swatch--frag"></span>Frag. interna</span>`;
  container.appendChild(legend);
}

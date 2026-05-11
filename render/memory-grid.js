// memory-grid.js - DOM Grid renderer for memory frames, including COW pages.

import { pidToColor } from './color-utils.js';

function frameContainsPid(frame, pid) {
  if (frame.ownerPid === pid) return true;
  return Array.isArray(frame.cow?.sharedWithPids) && frame.cow.sharedWithPids.includes(pid);
}

/**
 * @param {HTMLElement} container
 * @param {import('../types.js').MemoryState} memoryState
 * @param {import('../types.js').MemoryConfig} config
 * @param {{ onWritePage?: Function, highlight?: { pid: number, pageNumber: number, kind: string }, pidLabels?: Map<number,string>, canMaterializeCow?: boolean }} [options]
 */
export function renderMemoryGrid(container, memoryState, config, options = {}) {
  const { frames, internalFragmentation } = memoryState;
  const { pageSize, numFrames, totalMemory } = config;
  const { onWritePage, highlight, pidLabels = new Map(), canMaterializeCow = true } = options;
  const labelForPid = pid => pidLabels.get(pid) || `P${pid}`;

  const pids = [...new Set(
    frames
      .filter(frame => frame.ownerPid !== null)
      .flatMap(frame => [frame.ownerPid, ...(frame.cow?.sharedWithPids || [])])
  )].sort((a, b) => a - b);
  const colorMap = new Map(pids.map(pid => [pid, pidToColor(pid)]));

  const lastFrameByPid = new Map();
  for (const frame of frames) {
    if (frame.ownerPid !== null) {
      const prev = lastFrameByPid.get(frame.ownerPid);
      if (prev === undefined || frame.frameIndex > prev) {
        lastFrameByPid.set(frame.ownerPid, frame.frameIndex);
      }
    }
  }

  const usedFrames = frames.filter(frame => frame.ownerPid !== null).length;
  const freeFrames = numFrames - usedFrames;
  const usedPercent = ((usedFrames / numFrames) * 100).toFixed(1);

  container.innerHTML = '';

  const summary = document.createElement('div');
  summary.className = 'mem-summary';
  summary.innerHTML =
    `<span title="Memoria fisica total">Memoria total: <b>${totalMemory} KB</b></span>` +
    `<span title="Tamano de cada pagina/marco">Tamano pagina: <b>${pageSize} KB</b></span>` +
    `<span title="Numero de marcos fisicos = totalMemory / pageSize">Marcos: <b>${numFrames}</b></span>` +
    `<span title="Marcos asignados a algun proceso">Ocupados: <b>${usedFrames}</b> (${usedPercent}%)</span>` +
    `<span title="Marcos libres disponibles">Libres: <b>${freeFrames}</b></span>` +
    `<span class="mem-summary-frag" title="Bytes desperdiciados al final del ultimo marco de cada proceso">Fragmentacion interna: <b>${internalFragmentation} B</b></span>`;
  container.appendChild(summary);

  if (pids.length > 0) {
    const pidsList = document.createElement('div');
    pidsList.className = 'mem-pid-list';
    for (const pid of pids) {
      const pageCount = frames.filter(frame => frameContainsPid(frame, pid)).length;
      const label = labelForPid(pid);
      const pill = document.createElement('span');
      pill.className = 'mem-pid-pill';
      pill.title = `${label} ocupa ${pageCount} marco(s) fisicos o COW`;
      pill.innerHTML =
        `<span class="mem-pid-pill-swatch" style="background:${colorMap.get(pid)}"></span>` +
        `${label} - ${pageCount} marco${pageCount !== 1 ? 's' : ''}`;
      pidsList.appendChild(pill);
    }
    container.appendChild(pidsList);
  }

  const grid = document.createElement('div');
  grid.className = 'mem-grid';

  for (const frame of frames) {
    const cell = document.createElement('div');
    cell.className = 'mem-frame';

    if (frame.ownerPid === null) {
      cell.classList.add('mem-frame--empty');
      cell.title = `Marco ${frame.frameIndex} - libre`;
      cell.innerHTML =
        `<span class="mem-fr-num">F${frame.frameIndex}</span>` +
        `<span class="mem-fr-label">libre</span>`;
    } else {
      const color = colorMap.get(frame.ownerPid) ?? 'var(--bg-elevated)';
      cell.style.backgroundColor = color;
      const isLast = lastFrameByPid.get(frame.ownerPid) === frame.frameIndex;
      if (isLast) cell.classList.add('mem-frame--frag');
      if (frame.cow?.isCow) cell.classList.add('mem-frame--cow');
      if (
        highlight &&
        highlight.pid === frame.ownerPid &&
        highlight.pageNumber === frame.pageNumber
      ) {
        cell.classList.add(highlight.kind === 'cow-copy' ? 'mem-frame--cow-new' : 'mem-frame--written');
      }

      const sharedWith = frame.cow?.sharedWithPids || [];
      const displayPids = frame.cow?.isCow
        ? [frame.ownerPid, ...sharedWith].sort((a, b) => a - b).map(labelForPid).join('/')
        : labelForPid(frame.ownerPid);
      const cowTitle = frame.cow?.isCow
        ? ` Pagina compartida COW con ${sharedWith.map(labelForPid).join(', ')}.`
        : '';
      const writerPid = frame.cow?.isCow
        ? (sharedWith[0] ?? frame.ownerPid)
        : frame.ownerPid;
      const version = Number(frame.contentVersion || 0);
      const cowWriteBlocked = frame.cow?.isCow && !canMaterializeCow;
      const writeTitle = cowWriteBlocked
        ? 'No hay marcos libres para crear una copia privada COW.'
        : `Escribir en pagina ${frame.pageNumber}`;

      cell.title =
        `Marco ${frame.frameIndex} -> ${displayPids}, pagina ${frame.pageNumber}.` +
        cowTitle +
        (isLast ? ' Ultimo marco, posible fragmentacion interna.' : '');
      cell.innerHTML =
        `<span class="mem-fr-num">F${frame.frameIndex}</span>` +
        `<span class="mem-fr-pid">${displayPids}</span>` +
        `<span class="mem-fr-pg">pagina #${frame.pageNumber}</span>` +
        (version > 0 ? `<span class="mem-fr-ver">v${version}</span>` : '') +
        (frame.cow?.isCow ? `<span class="mem-fr-cow-lock" aria-label="COW lock">&#128274;</span>` : '') +
        `<button class="mem-write-btn" type="button" data-pid="${writerPid}" data-page="${frame.pageNumber}" title="${writeTitle}"${cowWriteBlocked ? ' disabled' : ''}>${cowWriteBlocked ? 'Sin marco' : 'Escribir'}</button>` +
        (isLast ? `<span class="mem-fr-frag-badge">frag</span>` : '');
    }

    grid.appendChild(cell);
  }
  container.appendChild(grid);

  const legend = document.createElement('div');
  legend.className = 'mem-legend';
  legend.innerHTML =
    `<span class="mem-legend-item"><span class="mem-legend-swatch" style="background:var(--bg-elevated);border:1px dashed var(--border-default);"></span>Marco libre</span>` +
    `<span class="mem-legend-item"><span class="mem-legend-swatch mem-legend-swatch--frag"></span>Frag. interna</span>` +
    `<span class="mem-legend-item"><span class="mem-legend-swatch mem-legend-swatch--cow"></span>COW compartida</span>`;
  container.appendChild(legend);

  if (typeof onWritePage === 'function') {
    container.querySelectorAll('.mem-write-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        onWritePage({
          pid: Number(button.dataset.pid),
          pageNumber: Number(button.dataset.page),
        });
      });
    });
  }
}

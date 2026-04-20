// memory-grid.js — DOM Grid renderer for memory frames. Hoverable cells. Sees total numPages only.
// No shared/stack distinction at this layer.

const PALETTE = [
  '#5b9cf6', '#f07b5e', '#6abf85', '#f5c842',
  '#a78bf5', '#ef5d52', '#4db8c8', '#e8879b',
];

/**
 * @param {HTMLElement} container
 * @param {import('../types.js').MemoryState} memoryState
 * @param {import('../types.js').MemoryConfig} config
 */
export function renderMemoryGrid(container, memoryState, config) {
  const { frames, internalFragmentation } = memoryState;
  const { pageSize, numFrames, totalMemory } = config;

  // Collect unique pids and build color map
  const pids = [...new Set(
    frames.filter(f => f.ownerPid !== null).map(f => f.ownerPid)
  )].sort((a, b) => a - b);
  const colorMap = new Map(pids.map((pid, i) => [pid, PALETTE[i % PALETTE.length]]));

  // Find the last frame index for each process (for fragmentation indicator)
  const lastFrameByPid = new Map();
  for (const f of frames) {
    if (f.ownerPid !== null) {
      const prev = lastFrameByPid.get(f.ownerPid);
      if (prev === undefined || f.frameIndex > prev) {
        lastFrameByPid.set(f.ownerPid, f.frameIndex);
      }
    }
  }

  container.innerHTML = '';

  // Summary bar
  const summary = document.createElement('div');
  summary.className = 'mem-summary';
  summary.innerHTML =
    `<span>Total Memory: <b>${totalMemory} KB</b></span>` +
    `<span>Page Size: <b>${pageSize} KB</b></span>` +
    `<span>Frames: <b>${numFrames}</b></span>` +
    `<span class="mem-summary-frag">Internal Fragmentation: <b>${internalFragmentation} B</b></span>`;
  container.appendChild(summary);

  // Frame grid
  const grid = document.createElement('div');
  grid.className = 'mem-grid';

  for (const frame of frames) {
    const cell = document.createElement('div');
    cell.className = 'mem-frame';

    if (frame.ownerPid === null) {
      cell.classList.add('mem-frame--empty');
      cell.title = `Frame ${frame.frameIndex}: empty`;
      cell.innerHTML =
        `<span class="mem-fr-num">F${frame.frameIndex}</span>` +
        `<span class="mem-fr-label">—</span>`;
    } else {
      const color = colorMap.get(frame.ownerPid) ?? '#888';
      cell.style.backgroundColor = color;
      const isLast = lastFrameByPid.get(frame.ownerPid) === frame.frameIndex;
      if (isLast) cell.classList.add('mem-frame--frag');
      cell.title =
        `Frame ${frame.frameIndex}: P${frame.ownerPid}, page ${frame.pageNumber}` +
        (isLast ? ' — last page (internal fragmentation possible)' : '');
      cell.innerHTML =
        `<span class="mem-fr-num">F${frame.frameIndex}</span>` +
        `<span class="mem-fr-pid">P${frame.ownerPid}</span>` +
        `<span class="mem-fr-pg">pg ${frame.pageNumber}</span>` +
        (isLast ? `<span class="mem-fr-frag-badge">frag</span>` : '');
    }

    grid.appendChild(cell);
  }
  container.appendChild(grid);

  // Legend
  if (pids.length > 0) {
    const legend = document.createElement('div');
    legend.className = 'mem-legend';
    for (const pid of pids) {
      const item = document.createElement('span');
      item.className = 'mem-legend-item';
      item.innerHTML =
        `<span class="mem-legend-swatch" style="background:${colorMap.get(pid)}"></span>` +
        `P${pid}`;
      legend.appendChild(item);
    }
    container.appendChild(legend);
  }
}

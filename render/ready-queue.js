// ready-queue.js — DOM renderer for the ready queue. Entity cards with CSS transitions.
// Shows currently running entity (highlighted) and ready queue in order.

/**
 * @param {HTMLElement} container
 * @param {import('../types.js').TimelineEntry} entry
 * @param {Map<number, string>} labelMap  tid → display label
 * @param {Map<number, string>} colorMap  tid → hex color
 */
export function renderReadyQueue(container, entry, labelMap, colorMap) {
  container.innerHTML = '';

  // ── CPU row ──────────────────────────────────────────────────────────────
  const cpuRow = _makeRow('CPU');
  if (entry.runningTid !== null) {
    const label = labelMap.get(entry.runningTid) || `TID${entry.runningTid}`;
    const color = colorMap.get(entry.runningTid) || '#888';
    cpuRow.slot.appendChild(_makeChip(label, color, true, `running — t=${entry.time}`));
  } else {
    const idle = document.createElement('span');
    idle.className = 'rq-idle';
    idle.textContent = 'IDLE';
    cpuRow.slot.appendChild(idle);
  }
  container.appendChild(cpuRow.row);

  // ── Ready queue row ───────────────────────────────────────────────────────
  const qRow = _makeRow('Ready');
  if (entry.readyQueue.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'rq-empty';
    empty.textContent = '(empty)';
    qRow.slot.appendChild(empty);
  } else {
    for (const entity of entry.readyQueue) {
      const label = labelMap.get(entity.tid) || entity.label || `TID${entity.tid}`;
      const color = colorMap.get(entity.tid) || '#888';
      const tip   = `${label} · rem: ${entity.remainingTime}`;
      qRow.slot.appendChild(_makeChip(label, color, false, tip));
    }
  }
  container.appendChild(qRow.row);
}

function _makeRow(labelText) {
  const row = document.createElement('div');
  row.className = 'rq-row';

  const lbl = document.createElement('span');
  lbl.className = 'rq-row-label';
  lbl.textContent = labelText;
  row.appendChild(lbl);

  const slot = document.createElement('div');
  slot.className = 'rq-slot';
  row.appendChild(slot);

  return { row, slot };
}

function _makeChip(label, color, running, title) {
  const chip = document.createElement('div');
  chip.className = running ? 'rq-chip rq-chip--running' : 'rq-chip';
  chip.textContent = label;
  chip.style.backgroundColor = color;
  if (title) chip.title = title;
  return chip;
}

// page-table.js — DOM table renderer for page replacement steps. Highlights current step row.

import { pidToColor } from './color-utils.js';

/**
 * @param {HTMLElement} container
 * @param {import('../types.js').PageReplacementTrace} trace
 * @param {number} currentStep
 */
export function renderPageReplacementTable(container, trace, currentStep) {
  const { steps, referenceString } = trace;
  if (!steps || steps.length === 0) {
    container.innerHTML = '';
    return;
  }

  const numFrames = steps[0].frameState.length;
  const allSamePid = referenceString.every(r => r.pid === referenceString[0].pid);
  const pids = [...new Set(referenceString.map(r => r.pid))].sort((a, b) => a - b);
  const colorMap = new Map(pids.map(pid => [pid, pidToColor(pid)]));

  const fmtRef   = r => allSamePid ? `${r.pageNumber}` : `P${r.pid}:${r.pageNumber}`;
  const fmtFrame = f => {
    if (f.pageNumber === null) return null;
    return allSamePid ? `${f.pageNumber}` : `P${f.ownerPid}:${f.pageNumber}`;
  };

  const wrap = document.createElement('div');
  wrap.className = 'pg-table-scroll';

  const tbl = document.createElement('table');
  tbl.className = 'pg-table';

  const thead = tbl.createTHead();
  const hrow  = thead.insertRow();
  ['Step', 'Req', ...Array.from({ length: numFrames }, (_, i) => `F${i}`), 'Result', 'Faults'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    hrow.appendChild(th);
  });

  const tbody = tbl.createTBody();
  for (const step of steps) {
    const row = tbody.insertRow();
    if (step.stepIndex === currentStep) {
      row.className = 'pg-step--current';
    } else if (step.stepIndex < currentStep) {
      row.className = 'pg-step--past';
    } else {
      row.className = 'pg-step--future';
    }

    const numCell = row.insertCell();
    numCell.className = 'pg-cell-num';
    numCell.textContent = step.stepIndex + 1;

    const reqCell = row.insertCell();
    reqCell.className = 'pg-cell-req';
    const reqColor = colorMap.get(step.requested.pid) ?? '#888';
    reqCell.innerHTML = `<span class="pg-chip" style="background:${reqColor}">${fmtRef(step.requested)}</span>`;

    for (const f of step.frameState) {
      const fc = row.insertCell();
      fc.className = 'pg-cell-frame';
      const label = fmtFrame(f);
      if (label !== null) {
        const fColor = colorMap.get(f.ownerPid) ?? '#888';
        fc.innerHTML = `<span class="pg-chip" style="background:${fColor}">${label}</span>`;
      } else {
        fc.innerHTML = `<span class="pg-chip pg-chip--empty">—</span>`;
      }
    }

    const resultCell = row.insertCell();
    resultCell.className = 'pg-cell-result';
    resultCell.innerHTML = step.isHit
      ? `<span class="pg-badge pg-badge--hit">HIT</span>`
      : `<span class="pg-badge pg-badge--fault">FAULT</span>`;

    const faultCell = row.insertCell();
    faultCell.className = 'pg-cell-faults';
    faultCell.textContent = step.faultsSoFar;
  }

  container.innerHTML = '';
  wrap.appendChild(tbl);
  container.appendChild(wrap);

  const currentRow = wrap.querySelector('.pg-step--current');
  if (currentRow) currentRow.scrollIntoView({ block: 'nearest' });
}

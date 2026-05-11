// page-table.js — DOM table renderer for page replacement steps. Highlights current step row.

import { pidToColor, contrastTextColor } from './color-utils.js';

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

  const activeStep = steps[currentStep];
  const prevStep = currentStep > 0 ? steps[currentStep - 1] : null;
  const activeFrameIndex = _activeFrameIndex(activeStep);
  const changedFrameIndex = _changedFrameIndex(activeStep, prevStep);
  const highlightFrameIndex = changedFrameIndex !== -1 ? changedFrameIndex : activeFrameIndex;

  const snapshot = _renderFrameSnapshot({
    step: activeStep,
    prevStep,
    numFrames,
    fmtFrame,
    colorMap,
    highlightFrameIndex,
    isClockTrace: Boolean(activeStep.referenceBits),
  });

  const wrap = document.createElement('div');
  wrap.className = 'pg-table-scroll';

  const tbl = document.createElement('table');
  tbl.className = 'pg-table';

  const thead = tbl.createTHead();
  const hrow  = thead.insertRow();
  ['Paso', 'Req', ...Array.from({ length: numFrames }, (_, i) => `F${i}`), 'Resultado', 'Page faults'].forEach(h => {
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
    reqCell.innerHTML = _pageChip(fmtRef(step.requested), reqColor);

    for (const [frameIdx, f] of step.frameState.entries()) {
      const fc = row.insertCell();
      fc.className = 'pg-cell-frame';
      if (step.stepIndex === currentStep && frameIdx === highlightFrameIndex) {
        fc.classList.add(step.isHit ? 'pg-cell-frame--hit' : 'pg-cell-frame--fault');
      }
      const label = fmtFrame(f);
      if (label !== null) {
        const fColor = colorMap.get(f.ownerPid) ?? '#888';
        fc.innerHTML = _pageChip(label, fColor);
      } else {
        fc.innerHTML = `<span class="pg-chip pg-chip--empty">—</span>`;
      }
    }

    const resultCell = row.insertCell();
    resultCell.className = 'pg-cell-result';
    resultCell.innerHTML = step.isHit
      ? `<span class="pg-badge pg-badge--hit">HIT</span>`
      : `<span class="pg-badge pg-badge--fault">FALLO</span>`;

    const faultCell = row.insertCell();
    faultCell.className = 'pg-cell-faults';
    faultCell.textContent = step.faultsSoFar;
  }

  container.innerHTML = '';
  container.appendChild(snapshot);
  wrap.appendChild(tbl);
  container.appendChild(wrap);

  const currentRow = wrap.querySelector('.pg-step--current');
  if (currentRow) currentRow.scrollIntoView({ block: 'nearest' });
}

function _renderFrameSnapshot({ step, prevStep, numFrames, fmtFrame, colorMap, highlightFrameIndex, isClockTrace }) {
  const panel = document.createElement('div');
  panel.className = `pg-frame-panel ${step.isHit ? 'pg-frame-panel--hit' : 'pg-frame-panel--fault'}`;

  const title = document.createElement('div');
  title.className = 'pg-frame-panel-head';
  title.innerHTML =
    `<div>` +
    `  <span class="pg-frame-panel-kicker">Estado después del paso ${step.stepIndex + 1}</span>` +
    `  <strong>${step.isHit ? 'La page ya estaba cargada' : 'La memoria cambia en este paso'}</strong>` +
    `</div>` +
    `<span class="pg-frame-panel-note">${_framePanelNote(step, highlightFrameIndex)}</span>`;
  panel.appendChild(title);

  const board = document.createElement('div');
  board.className = 'pg-frame-board';
  board.style.setProperty('--pg-frame-count', String(Math.min(numFrames, 8)));

  for (const [idx, frame] of step.frameState.entries()) {
    const card = document.createElement('div');
    const wasChanged = prevStep ? !_sameFrame(frame, prevStep.frameState[idx]) : frame.pageNumber !== null;
    const isActive = idx === highlightFrameIndex;
    card.className = 'pg-frame-card';
    if (isActive) card.classList.add(step.isHit ? 'pg-frame-card--hit' : 'pg-frame-card--fault');
    if (wasChanged) card.classList.add('pg-frame-card--changed');
    if (frame.pageNumber === null) card.classList.add('pg-frame-card--empty');

    const label = fmtFrame(frame);
    const fill = frame.pageNumber === null ? null : (colorMap.get(frame.ownerPid) ?? '#888');
    const bit = step.referenceBits ? step.referenceBits[idx] : null;

    card.innerHTML =
      `<div class="pg-frame-card-top">` +
      `  <span>F${idx}</span>` +
      (isClockTrace ? `  <span class="pg-frame-bit ${bit ? 'pg-frame-bit--on' : 'pg-frame-bit--off'}">R=${bit ? '1' : '0'}</span>` : '') +
      `</div>` +
      `<div class="pg-frame-card-page">` +
      (label === null
        ? `<span class="pg-frame-empty">Libre</span>`
        : `<span class="pg-page-pill" style="background:${fill};color:${contrastTextColor(fill)}">${label}</span>`) +
      `</div>` +
      `<div class="pg-frame-card-meta">${_frameMeta(frame, step, isActive)}</div>`;
    board.appendChild(card);
  }

  panel.appendChild(board);
  return panel;
}

function _pageChip(label, fill) {
  return `<span class="pg-chip" style="background:${fill};color:${contrastTextColor(fill)}">${label}</span>`;
}

function _framePanelNote(step, frameIndex) {
  if (step.isHit) return frameIndex >= 0 ? `Hit en F${frameIndex}` : 'Hit';
  if (step.evicted) return `Sale P${step.evicted.pid}:${step.evicted.pageNumber}`;
  return frameIndex >= 0 ? `Entra en F${frameIndex}` : 'Entra en memoria';
}

function _frameMeta(frame, step, isActive) {
  if (frame.pageNumber === null) return 'Frame disponible';
  if (isActive && step.isHit) return 'Aquí estaba la referencia';
  if (isActive && step.evicted) return 'Frame reemplazado';
  if (isActive) return 'Frame usado';
  return `Cargada en t=${frame.loadedAt + 1}`;
}

function _activeFrameIndex(step) {
  return step.frameState.findIndex(f =>
    f.ownerPid === step.requested.pid && f.pageNumber === step.requested.pageNumber
  );
}

function _changedFrameIndex(step, prevStep) {
  if (!prevStep) return _activeFrameIndex(step);
  return step.frameState.findIndex((frame, idx) => !_sameFrameContent(frame, prevStep.frameState[idx]));
}

function _sameFrame(left, right) {
  if (!left || !right) return false;
  return left.ownerPid === right.ownerPid &&
    left.pageNumber === right.pageNumber &&
    left.referenceBit === right.referenceBit;
}

function _sameFrameContent(left, right) {
  if (!left || !right) return false;
  return left.ownerPid === right.ownerPid && left.pageNumber === right.pageNumber;
}

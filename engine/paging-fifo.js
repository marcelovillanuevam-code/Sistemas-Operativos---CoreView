// paging-fifo.js — First-In First-Out page replacement algorithm. Pure function, zero DOM.
// Evicts the page loaded earliest (circular pointer). Returns PageReplacementTrace.

/**
 * @param {number} numFrames
 * @param {Array<{pid:number,pageNumber:number}>} refs
 * @returns {import('../types.js').PageReplacementTrace}
 */
export function runFIFO(numFrames, refs) {
  const frames = Array.from({ length: numFrames }, (_, i) => ({
    frameIndex: i,
    ownerPid: null,
    pageNumber: null,
    loadedAt: -1,
  }));

  const steps = [];
  let faults = 0;
  let ptr = 0;

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const hitIdx = frames.findIndex(
      f => f.ownerPid === ref.pid && f.pageNumber === ref.pageNumber
    );

    if (hitIdx !== -1) {
      steps.push({
        stepIndex: i,
        requested: ref,
        isHit: true,
        evicted: null,
        frameState: frames.map(f => ({ ...f })),
        faultsSoFar: faults,
      });
    } else {
      faults++;
      let evicted = null;
      if (frames[ptr].pageNumber !== null) {
        evicted = { pid: frames[ptr].ownerPid, pageNumber: frames[ptr].pageNumber };
      }
      frames[ptr] = { frameIndex: ptr, ownerPid: ref.pid, pageNumber: ref.pageNumber, loadedAt: i };
      ptr = (ptr + 1) % numFrames;

      steps.push({
        stepIndex: i,
        requested: ref,
        isHit: false,
        evicted,
        frameState: frames.map(f => ({ ...f })),
        faultsSoFar: faults,
      });
    }
  }

  const hits = refs.length - faults;
  return {
    algorithm: 'FIFO',
    referenceString: refs,
    steps,
    totalFaults: faults,
    totalHits: hits,
    hitRate: hits / refs.length,
  };
}

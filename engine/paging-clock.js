// paging-clock.js — Clock (circular buffer) page replacement algorithm. Pure function, zero DOM.
// Pointer scans on fault: clears refBit=1 frames, evicts first refBit=0 frame. Cap: 32 frames.

/**
 * @param {number} numFrames
 * @param {Array<{pid:number,pageNumber:number}>} refs
 * @returns {import('../types.js').PageReplacementTrace}
 */
export function runClock(numFrames, refs) {
  const n = Math.min(numFrames, 32);
  const frames = Array.from({ length: n }, (_, i) => ({
    frameIndex: i,
    ownerPid: null,
    pageNumber: null,
    loadedAt: -1,
    referenceBit: false,
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
      frames[hitIdx].referenceBit = true;
      steps.push({
        stepIndex: i,
        requested: ref,
        isHit: true,
        evicted: null,
        frameState: frames.map(f => ({ ...f })),
        clockPointer: ptr,
        referenceBits: frames.map(f => f.referenceBit),
        faultsSoFar: faults,
      });
    } else {
      faults++;
      // Scan: clear refBit=1 frames until finding refBit=0 (or empty).
      while (frames[ptr].referenceBit) {
        frames[ptr].referenceBit = false;
        ptr = (ptr + 1) % n;
      }
      let evicted = null;
      if (frames[ptr].pageNumber !== null) {
        evicted = { pid: frames[ptr].ownerPid, pageNumber: frames[ptr].pageNumber };
      }
      frames[ptr] = { frameIndex: ptr, ownerPid: ref.pid, pageNumber: ref.pageNumber, loadedAt: i, referenceBit: true };
      ptr = (ptr + 1) % n;

      steps.push({
        stepIndex: i,
        requested: ref,
        isHit: false,
        evicted,
        frameState: frames.map(f => ({ ...f })),
        clockPointer: ptr,
        referenceBits: frames.map(f => f.referenceBit),
        faultsSoFar: faults,
      });
    }
  }

  const hits = refs.length - faults;
  return {
    algorithm: 'CLOCK',
    referenceString: refs,
    steps,
    totalFaults: faults,
    totalHits: hits,
    hitRate: hits / refs.length,
  };
}

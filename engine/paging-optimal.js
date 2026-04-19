// paging-optimal.js — Optimal (Bélády's) page replacement algorithm. Pure function, zero DOM.
// Evicts the page whose next use is furthest in the future; tie-break by earliest loadedAt.

/**
 * @param {number} numFrames
 * @param {Array<{pid:number,pageNumber:number}>} refs
 * @returns {import('../types.js').PageReplacementTrace}
 */
export function runOptimal(numFrames, refs) {
  const frames = Array.from({ length: numFrames }, (_, i) => ({
    frameIndex: i,
    ownerPid: null,
    pageNumber: null,
    loadedAt: -1,
  }));

  const steps = [];
  let faults = 0;

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

      const emptyIdx = frames.findIndex(f => f.pageNumber === null);
      let targetIdx;
      if (emptyIdx !== -1) {
        targetIdx = emptyIdx;
      } else {
        // Find the page whose next use after position i is furthest (or never).
        // Tie-break: prefer the frame with the earliest loadedAt (FIFO order).
        let maxNextUse = -1;
        targetIdx = 0;
        for (let j = 0; j < numFrames; j++) {
          const frame = frames[j];
          let nextUse = refs.length; // sentinel: never used again = refs.length (∞)
          for (let k = i + 1; k < refs.length; k++) {
            if (refs[k].pid === frame.ownerPid && refs[k].pageNumber === frame.pageNumber) {
              nextUse = k;
              break;
            }
          }
          if (nextUse > maxNextUse ||
              (nextUse === maxNextUse && frame.loadedAt < frames[targetIdx].loadedAt)) {
            maxNextUse = nextUse;
            targetIdx = j;
          }
        }
        evicted = { pid: frames[targetIdx].ownerPid, pageNumber: frames[targetIdx].pageNumber };
      }

      frames[targetIdx] = { frameIndex: targetIdx, ownerPid: ref.pid, pageNumber: ref.pageNumber, loadedAt: i };

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
    algorithm: 'OPTIMAL',
    referenceString: refs,
    steps,
    totalFaults: faults,
    totalHits: hits,
    hitRate: hits / refs.length,
  };
}

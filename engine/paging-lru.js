// paging-lru.js — Least Recently Used page replacement algorithm. Pure function, zero DOM.
// Evicts the page not accessed for the longest time. Returns PageReplacementTrace.

/**
 * @param {number} numFrames
 * @param {Array<{pid:number,pageNumber:number}>} refs
 * @returns {import('../types.js').PageReplacementTrace}
 */
export function runLRU(numFrames, refs) {
  // frames include internal lastUsed field (not emitted in frameState)
  const frames = Array.from({ length: numFrames }, (_, i) => ({
    frameIndex: i,
    ownerPid: null,
    pageNumber: null,
    loadedAt: -1,
    _lastUsed: -1,
  }));

  const toEntry = f => ({ frameIndex: f.frameIndex, ownerPid: f.ownerPid, pageNumber: f.pageNumber, loadedAt: f.loadedAt });

  const steps = [];
  let faults = 0;

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const hitIdx = frames.findIndex(
      f => f.ownerPid === ref.pid && f.pageNumber === ref.pageNumber
    );

    if (hitIdx !== -1) {
      frames[hitIdx]._lastUsed = i;
      steps.push({
        stepIndex: i,
        requested: ref,
        isHit: true,
        evicted: null,
        frameState: frames.map(toEntry),
        faultsSoFar: faults,
      });
    } else {
      faults++;
      let evicted = null;

      // Prefer empty frames; otherwise evict the least recently used.
      const emptyIdx = frames.findIndex(f => f.pageNumber === null);
      let targetIdx;
      if (emptyIdx !== -1) {
        targetIdx = emptyIdx;
      } else {
        targetIdx = 0;
        for (let j = 1; j < numFrames; j++) {
          if (frames[j]._lastUsed < frames[targetIdx]._lastUsed) targetIdx = j;
        }
        evicted = { pid: frames[targetIdx].ownerPid, pageNumber: frames[targetIdx].pageNumber };
      }

      frames[targetIdx] = { frameIndex: targetIdx, ownerPid: ref.pid, pageNumber: ref.pageNumber, loadedAt: i, _lastUsed: i };

      steps.push({
        stepIndex: i,
        requested: ref,
        isHit: false,
        evicted,
        frameState: frames.map(toEntry),
        faultsSoFar: faults,
      });
    }
  }

  const hits = refs.length - faults;
  return {
    algorithm: 'LRU',
    referenceString: refs,
    steps,
    totalFaults: faults,
    totalHits: hits,
    hitRate: hits / refs.length,
  };
}

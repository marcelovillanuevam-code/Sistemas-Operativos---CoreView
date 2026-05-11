// paging-second-chance.js — Second Chance page replacement algorithm. Pure function, zero DOM.
// FIFO queue with reference bits: pages with refBit=1 are moved to queue back before eviction.

/**
 * @param {number} numFrames
 * @param {Array<{pid:number,pageNumber:number}>} refs
 * @returns {import('../types.js').PageReplacementTrace}
 */
export function runSecondChance(numFrames, refs) {
  const frames = Array.from({ length: numFrames }, (_, i) => ({
    frameIndex: i,
    ownerPid: null,
    pageNumber: null,
    loadedAt: -1,
    referenceBit: false,
  }));

  const steps = [];
  let faults = 0;
  // Queue of frame indices in FIFO load order (oldest candidate at front).
  const queue = [];

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
        clockPointer: queue[0] ?? 0,
        referenceBits: frames.map(f => f.referenceBit),
        faultsSoFar: faults,
      });
    } else {
      faults++;
      let evicted = null;

      const emptyIdx = frames.findIndex(f => f.pageNumber === null);
      if (emptyIdx !== -1) {
        frames[emptyIdx] = { frameIndex: emptyIdx, ownerPid: ref.pid, pageNumber: ref.pageNumber, loadedAt: i, referenceBit: true };
        queue.push(emptyIdx);
      } else {
        // Give second chance to frames with refBit=1 (move to queue back with bit cleared).
        while (frames[queue[0]].referenceBit) {
          const frontIdx = queue.shift();
          frames[frontIdx].referenceBit = false;
          queue.push(frontIdx);
        }
        const victimIdx = queue.shift();
        evicted = { pid: frames[victimIdx].ownerPid, pageNumber: frames[victimIdx].pageNumber };
        frames[victimIdx] = { frameIndex: victimIdx, ownerPid: ref.pid, pageNumber: ref.pageNumber, loadedAt: i, referenceBit: true };
        queue.push(victimIdx);
      }

      steps.push({
        stepIndex: i,
        requested: ref,
        isHit: false,
        evicted,
        frameState: frames.map(f => ({ ...f })),
        clockPointer: queue[0] ?? 0,
        referenceBits: frames.map(f => f.referenceBit),
        faultsSoFar: faults,
      });
    }
  }

  const hits = refs.length - faults;
  return {
    algorithm: 'SECOND_CHANCE',
    referenceString: refs,
    steps,
    totalFaults: faults,
    totalHits: hits,
    hitRate: hits / refs.length,
  };
}

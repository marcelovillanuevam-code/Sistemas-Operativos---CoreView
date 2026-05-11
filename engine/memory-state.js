// memory-state.js - Pure memory layout helpers for physical frames and COW pages.

function ensureMemoryModel(process) {
  if (!process.memory) process.memory = {};
  if (!Array.isArray(process.memory.cowPages)) process.memory.cowPages = [];
  if (!process.memory.pageVersions) process.memory.pageVersions = {};
  if (!Array.isArray(process.memory.materializedCowPages)) {
    process.memory.materializedCowPages = [];
  }
  return process.memory;
}

function activeCowEntries(process, pageNumber, validPids) {
  const memory = ensureMemoryModel(process);
  return memory.cowPages.filter(entry => {
    if (entry.pageNumber !== pageNumber) return false;
    if (!validPids.has(entry.originalOwnerPid)) return false;
    return (entry.sharedWithPids || []).some(pid => validPids.has(pid));
  });
}

function pageVersion(process, pageNumber) {
  return Number(ensureMemoryModel(process).pageVersions[pageNumber] || 0);
}

function cowSharedPids(entries, validPids) {
  return [...new Set(entries.flatMap(entry => entry.sharedWithPids || []))]
    .filter(pid => validPids.has(pid))
    .sort((a, b) => a - b);
}

/**
 * Builds the physical frame layout. COW aliases share the original frame until
 * writeProcessPage removes their COW group, at which point the writer gets its
 * own physical frame if capacity allows it.
 *
 * @param {import('../types.js').Process[]} processes
 * @param {import('../types.js').MemoryConfig} config
 * @returns {import('../types.js').MemoryState & { requiredPhysicalPages: number }}
 */
export function computeMemoryState(processes, config) {
  const { numFrames, pageSize } = config;

  const frames = Array.from({ length: numFrames }, (_, index) => ({
    frameIndex: index,
    ownerPid: null,
    pageNumber: null,
    loadedAt: 0,
  }));

  const validPids = new Set(processes.map(process => process.pid));
  let framePtr = 0;
  let totalFrag = 0;
  let requiredPhysicalPages = 0;

  const sorted = [...processes].sort((left, right) => left.pid - right.pid);
  for (const process of sorted) {
    for (let pageNumber = 0; pageNumber < process.numPages; pageNumber += 1) {
      const cowEntries = activeCowEntries(process, pageNumber, validPids);
      const isCowAlias = cowEntries.length > 0 && process.pid !== cowEntries[0].originalOwnerPid;
      if (isCowAlias) continue;

      requiredPhysicalPages += 1;
      if (framePtr >= numFrames) continue;

      const sharedWithPids = cowSharedPids(cowEntries, validPids);
      frames[framePtr] = {
        frameIndex: framePtr,
        ownerPid: process.pid,
        pageNumber,
        loadedAt: 0,
        contentVersion: pageVersion(process, pageNumber),
        cow: cowEntries.length > 0 ? {
          isCow: true,
          originalOwnerPid: cowEntries[0].originalOwnerPid,
          groupIds: cowEntries.map(entry => entry.groupId),
          sharedWithPids,
        } : null,
      };
      framePtr += 1;
    }

    const frag = (pageSize - (process.burstTime % pageSize)) % pageSize;
    totalFrag += frag;
  }

  return {
    frames,
    internalFragmentation: totalFrag,
    requiredPhysicalPages,
  };
}

export function hasCowPage(processes, pid, pageNumber) {
  const process = processes.find(item => item.pid === pid);
  if (!process) return false;
  const validPids = new Set(processes.map(item => item.pid));
  return activeCowEntries(process, pageNumber, validPids).length > 0;
}

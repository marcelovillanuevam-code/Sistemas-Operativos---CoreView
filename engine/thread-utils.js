// thread-utils.js — Thread expansion and thread trace generation utilities. Zero DOM, zero side effects.
// expandToThreads(): Process[] → SchedulableEntity[], sorted by arrivalTime, pid, tid.
// generateThreadTrace(): runs full simulation, filters to targetPid, produces ThreadTrace.

/**
 * Expands Process[] into SchedulableEntity[] for scheduling algorithms.
 * Backward compat: processes with no threads array auto-generate 1 thread (stackPages=1).
 * Single-threaded label = 'P{pid}'. Multi-threaded label = 'P{pid}-T{n}' (n = local 1-based index).
 *
 * @param {import('../types.js').Process[]} processes
 * @returns {import('../types.js').SchedulableEntity[]}
 */
export function expandToThreads(processes) {
  // Find max existing tid across all processes for backward-compat auto-generation
  let maxTid = 0;
  for (const p of processes) {
    if (p.threads && p.threads.length > 0) {
      for (const t of p.threads) {
        if (t.tid > maxTid) maxTid = t.tid;
      }
    }
  }
  let nextTid = maxTid + 1;

  const entities = [];

  for (const p of processes) {
    let threads = p.threads;

    // Backward compat: no threads array → auto-generate 1 thread
    if (!threads || threads.length === 0) {
      threads = [{
        tid: nextTid++,
        parentPid: p.pid,
        arrivalTime: p.arrivalTime,
        burstTime: p.burstTime,
        priority: p.priority,
        state: 'NEW',
        remainingTime: p.burstTime,
        stackPages: 1,
      }];
    }

    const isMultiThreaded = threads.length > 1;

    for (let i = 0; i < threads.length; i++) {
      const t = threads[i];
      const label = isMultiThreaded ? `P${p.pid}-T${i + 1}` : `P${p.pid}`;
      entities.push({
        pid: p.pid,
        tid: t.tid,
        label,
        arrivalTime: t.arrivalTime,
        burstTime: t.burstTime,
        priority: t.priority,
        remainingTime: t.burstTime,
      });
    }
  }

  // Sort by arrivalTime, then pid, then tid (FCFS ordering within same arrival)
  entities.sort((a, b) => {
    if (a.arrivalTime !== b.arrivalTime) return a.arrivalTime - b.arrivalTime;
    if (a.pid !== b.pid) return a.pid - b.pid;
    return a.tid - b.tid;
  });

  return entities;
}

/**
 * @param {import('../types.js').Process[]} processes
 * @param {number} targetPid
 * @param {import('../types.js').SchedulingConfig} config
 * @returns {import('../types.js').ThreadTrace}
 */
export function generateThreadTrace(processes, targetPid, config) {
  throw new Error('Not implemented');
}

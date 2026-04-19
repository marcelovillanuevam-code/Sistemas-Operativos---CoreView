// scheduling-rr.js — Round Robin scheduling algorithm. Pure function, zero DOM.
// Calls expandToThreads() internally. quantum expiry order: arrivals → preempted to back → dispatch front.

/** @param {import('../types.js').Process[]} processes @param {number} quantum @returns {import('../types.js').SchedulingTrace} */
export function runRoundRobin(processes, quantum) {
  throw new Error('Not implemented');
}

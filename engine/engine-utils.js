// engine-utils.js — Shared helpers used by all scheduling algorithms.
// Zero DOM, zero side effects.

/**
 * Computes thread metrics, process metrics (join-barrier), and aggregate metrics
 * from a completed simulation. Called identically by all 8 scheduling algorithms.
 *
 * @param {object[]} entities - expandToThreads result (tid, pid, arrivalTime, burstTime)
 * @param {import('../types.js').Process[]} processes
 * @param {Map<number,number>} completionTime - tid → completion time
 * @param {Map<number,number>} firstRunTime   - tid → first tick it ran
 * @param {Map<number,object>} work           - tid → working copy (burstTime read here)
 * @param {Map<number,number[]>} pidToTids    - pid → tid[]
 * @param {number} contextSwitches
 * @returns {{ threadMetrics: object[], processMetrics: object[], aggregateMetrics: object }}
 */
export function computeMetrics(entities, processes, completionTime, firstRunTime, work, pidToTids, contextSwitches) {
  const threadMetrics = entities.map(e => {
    const ct  = completionTime.get(e.tid);
    const tat = ct - e.arrivalTime;
    const wt  = tat - e.burstTime;
    const rt  = firstRunTime.get(e.tid) - e.arrivalTime;
    return { tid: e.tid, pid: e.pid, completionTime: ct, turnaroundTime: tat, waitingTime: wt, responseTime: rt };
  });

  const processMetrics = processes.map(p => {
    const tids       = pidToTids.get(p.pid) || [];
    const threadCTs  = tids.map(tid => completionTime.get(tid));
    const threadFRTs = tids.map(tid => firstRunTime.get(tid));
    const burstSum   = tids.reduce((s, tid) => s + work.get(tid).burstTime, 0);
    const ct  = Math.max(...threadCTs);
    const tat = ct - p.arrivalTime;
    const wt  = tat - burstSum;
    const rt  = Math.min(...threadFRTs) - p.arrivalTime;
    return { pid: p.pid, completionTime: ct, turnaroundTime: tat, waitingTime: wt, responseTime: rt };
  });

  const n          = threadMetrics.length;
  const avgCT      = threadMetrics.reduce((s, m) => s + m.completionTime,  0) / n;
  const avgTAT     = threadMetrics.reduce((s, m) => s + m.turnaroundTime,  0) / n;
  const avgWT      = threadMetrics.reduce((s, m) => s + m.waitingTime,     0) / n;
  const avgRT      = threadMetrics.reduce((s, m) => s + m.responseTime,    0) / n;
  const totalTime  = Math.max(...completionTime.values());
  const busyTicks  = entities.reduce((s, e) => s + e.burstTime, 0);
  const cpuUtil    = totalTime > 0 ? (busyTicks / totalTime) * 100 : 0;
  const throughput = totalTime > 0 ? n / totalTime : 0;

  return {
    threadMetrics,
    processMetrics,
    aggregateMetrics: {
      avgCompletionTime:    avgCT,
      avgTurnaroundTime:    avgTAT,
      avgWaitingTime:       avgWT,
      avgResponseTime:      avgRT,
      cpuUtilization:       cpuUtil,
      totalContextSwitches: contextSwitches,
      throughput,
    },
  };
}

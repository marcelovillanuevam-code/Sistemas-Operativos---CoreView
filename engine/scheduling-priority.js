// scheduling-priority.js — Preemptive Priority scheduling. Pure function, zero DOM.
// Lower priority number = higher priority. Preempts on strictly better priority arrival.
// Ties broken by arrivalTime, then pid, then tid.

import { expandToThreads } from './thread-utils.js';

function buildProcessStates(processes, pidToTids, completed, runningTid, readyPool) {
  return processes.map(p => {
    const tids = pidToTids.get(p.pid) || [];
    const threadStates = tids.map(tid => {
      let state;
      if (completed.has(tid))           state = 'TERMINATED';
      else if (tid === runningTid)      state = 'RUNNING';
      else if (readyPool.includes(tid)) state = 'READY';
      else                              state = 'NEW';
      return { tid, state };
    });

    let state;
    if (threadStates.length > 0 && threadStates.every(ts => ts.state === 'TERMINATED')) {
      state = 'TERMINATED';
    } else if (threadStates.some(ts => ts.state === 'RUNNING')) {
      state = 'RUNNING';
    } else if (threadStates.some(ts => ts.state === 'READY')) {
      state = 'READY';
    } else {
      state = 'NEW';
    }

    return { pid: p.pid, state, threadStates };
  });
}

/** Pick tid with highest priority (lowest number); tie-break: arrivalTime, pid, tid. */
function pickHighestPriority(pool, work) {
  return pool.reduce((best, tid) => {
    const b = work.get(best);
    const c = work.get(tid);
    if (c.priority    < b.priority)    return tid;
    if (c.priority    > b.priority)    return best;
    if (c.arrivalTime < b.arrivalTime) return tid;
    if (c.arrivalTime > b.arrivalTime) return best;
    if (c.pid         < b.pid)         return tid;
    if (c.pid         > b.pid)         return best;
    return c.tid < b.tid ? tid : best;
  });
}

/**
 * @param {import('../types.js').Process[]} processes
 * @returns {import('../types.js').SchedulingTrace}
 */
export function runPriorityPreemptive(processes) {
  const entities = expandToThreads(processes);
  const work = new Map(entities.map(e => [e.tid, { ...e }]));

  const pidToTids = new Map();
  for (const e of entities) {
    if (!pidToTids.has(e.pid)) pidToTids.set(e.pid, []);
    pidToTids.get(e.pid).push(e.tid);
  }

  const firstRunTime = new Map();
  const completionTime = new Map();
  const completed = new Set();
  const readyPool = [];
  let running = null;
  let prevRunningTid = null;
  let contextSwitches = 0;
  const timeline = [];
  let time = 0;

  const maxTime = entities.reduce((s, e) => s + e.burstTime, 0) + 1;

  while (time <= maxTime) {
    // Step 1: completions from previous tick
    const completedThisTick = [];
    if (running !== null && work.get(running).remainingTime === 0) {
      completedThisTick.push(running);
      completionTime.set(running, time);
      completed.add(running);
      running = null;
    }

    // Step 2: arrivals
    const arrivedThisTick = [];
    for (const e of entities) {
      if (
        e.arrivalTime === time &&
        !completed.has(e.tid) &&
        running !== e.tid &&
        !readyPool.includes(e.tid)
      ) {
        arrivedThisTick.push(e.tid);
        readyPool.push(e.tid);
      }
    }

    // Step 3: preempt if pool has a strictly higher-priority entity
    if (running !== null && readyPool.length > 0) {
      const best = pickHighestPriority(readyPool, work);
      if (work.get(best).priority < work.get(running).priority) {
        readyPool.push(running);
        running = null;
      }
    }

    // Step 4: dispatch highest priority from pool
    let contextSwitch = false;
    if (running === null && readyPool.length > 0) {
      const next = pickHighestPriority(readyPool, work);
      readyPool.splice(readyPool.indexOf(next), 1);
      if (!firstRunTime.has(next)) firstRunTime.set(next, time);
      if (prevRunningTid !== null && prevRunningTid !== next) {
        contextSwitch = true;
        contextSwitches++;
      }
      running = next;
    }

    const processStates = buildProcessStates(processes, pidToTids, completed, running, readyPool);

    timeline.push({
      time,
      runningPid: running !== null ? work.get(running).pid : null,
      runningTid: running,
      readyQueue: readyPool.map(tid => ({ ...work.get(tid) })),
      arrivedThisTick,
      completedThisTick,
      contextSwitch,
      processStates,
    });

    prevRunningTid = running;

    if (completed.size === entities.length && running === null) break;

    if (running !== null) work.get(running).remainingTime--;

    time++;
  }

  // Thread Metrics
  const threadMetrics = entities.map(e => {
    const ct  = completionTime.get(e.tid);
    const tat = ct - e.arrivalTime;
    const wt  = tat - e.burstTime;
    const rt  = firstRunTime.get(e.tid) - e.arrivalTime;
    return { tid: e.tid, pid: e.pid, completionTime: ct, turnaroundTime: tat, waitingTime: wt, responseTime: rt };
  });

  // Process Metrics (join-barrier)
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

  const n      = threadMetrics.length;
  const avgCT  = threadMetrics.reduce((s, m) => s + m.completionTime,  0) / n;
  const avgTAT = threadMetrics.reduce((s, m) => s + m.turnaroundTime,  0) / n;
  const avgWT  = threadMetrics.reduce((s, m) => s + m.waitingTime,     0) / n;
  const avgRT  = threadMetrics.reduce((s, m) => s + m.responseTime,    0) / n;

  const totalTime  = Math.max(...completionTime.values());
  const busyTicks  = entities.reduce((s, e) => s + e.burstTime, 0);
  const cpuUtil    = totalTime > 0 ? (busyTicks / totalTime) * 100 : 0;
  const throughput = totalTime > 0 ? n / totalTime : 0;

  return {
    algorithm: 'PRIORITY_PREEMPTIVE',
    config: { algorithm: 'PRIORITY_PREEMPTIVE' },
    timeline,
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

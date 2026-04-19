// scheduling-rr.js — Round Robin scheduling algorithm. Pure function, zero DOM.
// Quantum expiry order: (1) arrivals → ready queue, (2) preempted entity → BACK, (3) dispatch front.

import { expandToThreads } from './thread-utils.js';

function buildProcessStates(processes, pidToTids, completed, runningTid, readyQueue) {
  return processes.map(p => {
    const tids = pidToTids.get(p.pid) || [];
    const threadStates = tids.map(tid => {
      let state;
      if (completed.has(tid))            state = 'TERMINATED';
      else if (tid === runningTid)       state = 'RUNNING';
      else if (readyQueue.includes(tid)) state = 'READY';
      else                               state = 'NEW';
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

/**
 * @param {import('../types.js').Process[]} processes
 * @param {number} quantum
 * @returns {import('../types.js').SchedulingTrace}
 */
export function runRoundRobin(processes, quantum = 2) {
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
  const readyQueue = [];   // tids in FCFS order
  let running = null;
  let quantumLeft = 0;
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

    // Step 2: check quantum expiry (only if entity is still running after completion check)
    const quantumExpired = running !== null && quantumLeft === 0;

    // Step 3: arrivals enter ready queue (before preempted entity)
    const arrivedThisTick = [];
    for (const e of entities) {
      if (
        e.arrivalTime === time &&
        !completed.has(e.tid) &&
        running !== e.tid &&
        !readyQueue.includes(e.tid)
      ) {
        arrivedThisTick.push(e.tid);
        readyQueue.push(e.tid);
      }
    }

    // Step 4: if quantum expired, preempted entity goes to BACK of ready queue
    if (quantumExpired) {
      readyQueue.push(running);
      running = null;
    }

    // Step 5: dispatch from front
    let contextSwitch = false;
    if (running === null && readyQueue.length > 0) {
      const next = readyQueue.shift();
      if (!firstRunTime.has(next)) firstRunTime.set(next, time);
      if (prevRunningTid !== null && prevRunningTid !== next) {
        contextSwitch = true;
        contextSwitches++;
      }
      running = next;
      quantumLeft = quantum;
    }

    const processStates = buildProcessStates(processes, pidToTids, completed, running, readyQueue);

    timeline.push({
      time,
      runningPid: running !== null ? work.get(running).pid : null,
      runningTid: running,
      readyQueue: readyQueue.map(tid => ({ ...work.get(tid) })),
      arrivedThisTick,
      completedThisTick,
      contextSwitch,
      processStates,
    });

    prevRunningTid = running;

    if (completed.size === entities.length && running === null) break;

    if (running !== null) {
      work.get(running).remainingTime--;
      quantumLeft--;
    }

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
    algorithm: 'RR',
    config: { algorithm: 'RR', quantum },
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

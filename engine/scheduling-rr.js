// scheduling-rr.js — Round Robin scheduling algorithm. Pure function, zero DOM.
// Quantum expiry order: (1) arrivals → ready queue, (2) preempted entity → BACK, (3) dispatch front.

import { expandToThreads } from './thread-utils.js';
import { computeMetrics }  from './engine-utils.js';

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

  // Upper bound: last arrival + total burst + 1 — covers idle gaps between arrivals
  const totalBurst = entities.reduce((s, e) => s + e.burstTime, 0);
  const maxArrival = Math.max(0, ...entities.map(e => e.arrivalTime));
  const maxTime    = maxArrival + totalBurst + 1;

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

  const { threadMetrics, processMetrics, aggregateMetrics } = computeMetrics(
    entities, processes, completionTime, firstRunTime, work, pidToTids, contextSwitches
  );

  return {
    algorithm: 'RR',
    config: { algorithm: 'RR', quantum },
    timeline,
    threadMetrics,
    processMetrics,
    aggregateMetrics,
  };
}

// scheduling-srtf.js — Shortest Remaining Time First (preemptive SJF). Pure function, zero DOM.
// Preempts running entity when a newly arrived entity has strictly shorter remainingTime.
// Ties on dispatch (running=null) broken by arrivalTime, then pid, then tid.

import { expandToThreads } from './thread-utils.js';
import { computeMetrics }  from './engine-utils.js';

function buildProcessStates(processes, pidToTids, completed, runningTid, readyPool) {
  return processes.map(p => {
    const tids = pidToTids.get(p.pid) || [];
    const threadStates = tids.map(tid => {
      let state;
      if (completed.has(tid))            state = 'TERMINATED';
      else if (tid === runningTid)       state = 'RUNNING';
      else if (readyPool.includes(tid))  state = 'READY';
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

/** Pick the tid with the shortest remainingTime; tie-break: arrivalTime, pid, tid. */
function pickShortest(pool, work) {
  return pool.reduce((best, tid) => {
    const b = work.get(best);
    const c = work.get(tid);
    if (c.remainingTime < b.remainingTime) return tid;
    if (c.remainingTime > b.remainingTime) return best;
    if (c.arrivalTime   < b.arrivalTime)   return tid;
    if (c.arrivalTime   > b.arrivalTime)   return best;
    if (c.pid           < b.pid)           return tid;
    if (c.pid           > b.pid)           return best;
    return c.tid < b.tid ? tid : best;
  });
}

/**
 * @param {import('../types.js').Process[]} processes
 * @returns {import('../types.js').SchedulingTrace}
 */
export function runSRTF(processes) {
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
  const readyPool = [];   // tids waiting (unordered — always pick shortest)
  let running = null;
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

    // Step 3: preempt if any pool entity has strictly shorter remainingTime
    if (running !== null && readyPool.length > 0) {
      const best = pickShortest(readyPool, work);
      if (work.get(best).remainingTime < work.get(running).remainingTime) {
        readyPool.push(running);
        running = null;
      }
    }

    // Step 4: dispatch shortest from pool
    let contextSwitch = false;
    if (running === null && readyPool.length > 0) {
      const next = pickShortest(readyPool, work);
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

  const { threadMetrics, processMetrics, aggregateMetrics } = computeMetrics(
    entities, processes, completionTime, firstRunTime, work, pidToTids, contextSwitches
  );

  return {
    algorithm: 'SRTF',
    config: { algorithm: 'SRTF' },
    timeline,
    threadMetrics,
    processMetrics,
    aggregateMetrics,
  };
}

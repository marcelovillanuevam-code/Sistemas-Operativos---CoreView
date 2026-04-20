// scheduling-mlq.js — Multilevel Queue scheduling algorithm. Pure function, zero DOM.
// Fixed queues by priority range. Higher queues preempt lower. Calls expandToThreads() internally.

import { expandToThreads } from './thread-utils.js';
import { computeMetrics }  from './engine-utils.js';

function buildProcessStates(processes, pidToTids, completed, running, allReadyTids) {
  return processes.map(p => {
    const tids = pidToTids.get(p.pid) || [];
    const threadStates = tids.map(tid => {
      let state;
      if (completed.has(tid))              state = 'TERMINATED';
      else if (tid === running)            state = 'RUNNING';
      else if (allReadyTids.includes(tid)) state = 'READY';
      else                                 state = 'NEW';
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

/** @param {import('../types.js').Process[]} processes @param {import('../types.js').SchedulingConfig} config @returns {import('../types.js').SchedulingTrace} */
export function runMLQ(processes, config) {
  const entities = expandToThreads(processes);
  const work = new Map(entities.map(e => [e.tid, { ...e }]));

  const pidToTids = new Map();
  for (const e of entities) {
    if (!pidToTids.has(e.pid)) pidToTids.set(e.pid, []);
    pidToTids.get(e.pid).push(e.tid);
  }

  const queueConfigs = config.mlqQueues || [];

  // Map each entity to its permanent queue level by priority
  const tidToLevel = new Map();
  for (const e of entities) {
    let level = queueConfigs.length - 1;
    for (let i = 0; i < queueConfigs.length; i++) {
      const [lo, hi] = queueConfigs[i].priorityRange;
      if (e.priority >= lo && e.priority <= hi) { level = i; break; }
    }
    tidToLevel.set(e.tid, level);
  }

  // Per-level ready queues (arrays of tids)
  const queues = queueConfigs.map(() => []);

  const firstRunTime  = new Map();
  const completionTime = new Map();
  const completed     = new Set();

  let running          = null;
  let runnerLevel      = -1;
  let runnerQuantumLeft = 0;
  let prevRunningTid   = null;
  let contextSwitches  = 0;
  const timeline       = [];
  let time             = 0;

  // Upper bound: last arrival + total burst + 1 — covers idle gaps between arrivals
  const totalBurst = entities.reduce((s, e) => s + e.burstTime, 0);
  const maxArrival = Math.max(0, ...entities.map(e => e.arrivalTime));
  const maxTime    = maxArrival + totalBurst + 1;

  while (time <= maxTime) {
    // Step 1: completion from previous tick's execution
    const completedThisTick = [];
    if (running !== null && work.get(running).remainingTime === 0) {
      completedThisTick.push(running);
      completionTime.set(running, time);
      completed.add(running);
      running = null;
      runnerLevel = -1;
      runnerQuantumLeft = 0;
    }

    // Step 2: arrivals enter their permanent queues
    const arrivedThisTick = [];
    for (const e of entities) {
      const inQueue = queues.some(q => q.includes(e.tid));
      if (e.arrivalTime === time && !completed.has(e.tid) && running !== e.tid && !inQueue) {
        arrivedThisTick.push(e.tid);
        queues[tidToLevel.get(e.tid)].push(e.tid);
      }
    }

    // Step 3: preemption — a higher-priority queue now has entities
    if (running !== null) {
      const higherExists = queues.some((q, i) => i < runnerLevel && q.length > 0);
      if (higherExists) {
        // Preempted entity returns to the front of its own queue
        queues[runnerLevel].unshift(running);
        running = null;
        runnerLevel = -1;
        runnerQuantumLeft = 0;
      }
    }

    // Step 4: quantum expiry within an RR queue
    if (running !== null && queueConfigs[runnerLevel].algorithm === 'RR' && runnerQuantumLeft === 0) {
      queues[runnerLevel].push(running);
      running = null;
      runnerLevel = -1;
      runnerQuantumLeft = 0;
    }

    // Step 5: dispatch from highest-priority non-empty queue
    let contextSwitch = false;
    if (running === null) {
      for (let i = 0; i < queues.length; i++) {
        if (queues[i].length > 0) {
          const next = queues[i].shift();
          if (!firstRunTime.has(next)) firstRunTime.set(next, time);
          if (prevRunningTid !== null && prevRunningTid !== next) {
            contextSwitch = true;
            contextSwitches++;
          }
          running = next;
          runnerLevel = i;
          runnerQuantumLeft = queueConfigs[i].algorithm === 'RR' ? queueConfigs[i].quantum : -1;
          break;
        }
      }
    }

    const allReadyTids = queues.flat();

    const queueLevels = queues.map((q, i) => ({
      level: i + 1,
      entities: q.map(tid => ({ ...work.get(tid) })),
      algorithm: queueConfigs[i].algorithm,
    }));

    const processStates = buildProcessStates(processes, pidToTids, completed, running, allReadyTids);

    timeline.push({
      time,
      runningPid: running !== null ? work.get(running).pid : null,
      runningTid: running,
      readyQueue: allReadyTids.map(tid => ({ ...work.get(tid) })),
      arrivedThisTick,
      completedThisTick,
      contextSwitch,
      queueLevels,
      processStates,
    });

    prevRunningTid = running;

    if (completed.size === entities.length && running === null) break;

    // Execute 1 tick
    if (running !== null) {
      work.get(running).remainingTime--;
      if (queueConfigs[runnerLevel].algorithm === 'RR') runnerQuantumLeft--;
    }

    time++;
  }

  const { threadMetrics, processMetrics, aggregateMetrics } = computeMetrics(
    entities, processes, completionTime, firstRunTime, work, pidToTids, contextSwitches
  );

  return {
    algorithm: 'MLQ',
    config,
    timeline,
    threadMetrics,
    processMetrics,
    aggregateMetrics,
  };
}

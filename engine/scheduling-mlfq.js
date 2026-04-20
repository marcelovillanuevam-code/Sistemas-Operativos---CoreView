// scheduling-mlfq.js — Multilevel Feedback Queue scheduling algorithm. Pure function, zero DOM.
// All entities enter Q0. Quantum expiry → demote. Higher-queue arrival → preempt (stay in level).
// Aging: 15+ ticks waiting in lowest queue → promote to Q0. Calls expandToThreads() first.

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

/**
 * @param {import('../types.js').Process[]} processes
 * @param {import('../types.js').SchedulingConfig} config
 * @returns {import('../types.js').SchedulingTrace}
 */
export function runMLFQ(processes, config) {
  const entities = expandToThreads(processes);
  const work = new Map(entities.map(e => [e.tid, { ...e }]));

  const pidToTids = new Map();
  for (const e of entities) {
    if (!pidToTids.has(e.pid)) pidToTids.set(e.pid, []);
    pidToTids.get(e.pid).push(e.tid);
  }

  const levels = config.mlfqLevels || [];
  const numLevels = levels.length;
  const lastLevel = numLevels - 1;
  const agingThreshold = 15; // ticks waiting in lowest queue before promotion to Q0

  const queues = levels.map(() => []); // per-level tid arrays
  const tidToLevel = new Map();        // current queue level per entity (changes on demotion/promotion)
  const ageInLowest = new Map();       // ticks each tid has been waiting in the lowest queue

  const firstRunTime = new Map();
  const completionTime = new Map();
  const completed = new Set();

  let running = null;
  let runnerLevel = -1;
  let runnerQuantumLeft = 0;
  let prevRunningTid = null;
  let contextSwitches = 0;
  const timeline = [];
  let time = 0;

  const totalBurst = entities.reduce((s, e) => s + e.burstTime, 0);
  const maxArrival = Math.max(...entities.map(e => e.arrivalTime));
  const maxTime    = maxArrival + totalBurst + 1; // covers idle gaps between last arrival and completion

  while (time <= maxTime) {
    const tickDemotions = [];
    const tickPromotions = [];

    // Step 1: record completions (remainingTime hit 0 at end of last tick)
    const completedThisTick = [];
    if (running !== null && work.get(running).remainingTime === 0) {
      completedThisTick.push(running);
      completionTime.set(running, time);
      completed.add(running);
      running = null;
      runnerLevel = -1;
    }

    // Step 2: quantum expiry → demote to next lower level (only for RR queues)
    if (running !== null && levels[runnerLevel].algorithm === 'RR' && runnerQuantumLeft === 0) {
      const from = runnerLevel;
      const to   = Math.min(from + 1, lastLevel);
      if (to !== from) tickDemotions.push({ tid: running, from, to });
      tidToLevel.set(running, to);
      queues[to].push(running); // end of target queue (FCFS ordering within level)
      running = null;
      runnerLevel = -1;
    }

    // Step 3: arrivals → always enter Q0
    const arrivedThisTick = [];
    for (const e of entities) {
      const inQueue = queues.some(q => q.includes(e.tid));
      if (e.arrivalTime === time && !completed.has(e.tid) && e.tid !== running && !inQueue) {
        arrivedThisTick.push(e.tid);
        queues[0].push(e.tid);
        tidToLevel.set(e.tid, 0);
      }
    }

    // Step 4: aging — entities waiting 15+ ticks in lowest queue → promote to Q0
    // Iterate in reverse so splice indices stay valid
    const lowestQ = queues[lastLevel];
    for (let i = lowestQ.length - 1; i >= 0; i--) {
      const tid = lowestQ[i];
      if ((ageInLowest.get(tid) || 0) >= agingThreshold) {
        lowestQ.splice(i, 1);
        queues[0].push(tid);
        tidToLevel.set(tid, 0);
        ageInLowest.delete(tid);
        tickPromotions.push({ tid, from: lastLevel, to: 0 });
      }
    }

    // Step 5: higher-priority preemption — a queue above the runner's level has entities.
    // Preempted entity stays in its current level (goes to front to preserve work).
    if (running !== null) {
      for (let i = 0; i < runnerLevel; i++) {
        if (queues[i].length > 0) {
          queues[runnerLevel].unshift(running); // front of current level, not demoted
          running = null;
          runnerLevel = -1;
          break;
        }
      }
    }

    // Step 6: dispatch from highest non-empty level
    let contextSwitch = false;
    if (running === null) {
      for (let i = 0; i < numLevels; i++) {
        if (queues[i].length > 0) {
          const next = queues[i].shift();
          if (!firstRunTime.has(next)) firstRunTime.set(next, time);
          if (prevRunningTid !== null && prevRunningTid !== next) {
            contextSwitch = true;
            contextSwitches++;
          }
          running = next;
          runnerLevel = i;
          // FCFS levels have no quantum — use Infinity so expiry check never fires
          runnerQuantumLeft = levels[i].algorithm === 'RR' ? levels[i].quantum : Infinity;
          break;
        }
      }
    }

    const allReadyTids = queues.flat();
    const queueLevels = queues.map((q, i) => ({
      level: i,
      entities: q.map(tid => ({ ...work.get(tid) })),
      algorithm: levels[i].algorithm,
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
      promotions: tickPromotions,
      demotions:  tickDemotions,
      processStates,
    });

    prevRunningTid = running;

    if (completed.size === entities.length && running === null) break;

    // Execute one tick
    if (running !== null) {
      work.get(running).remainingTime--;
      if (levels[runnerLevel].algorithm === 'RR') runnerQuantumLeft--;
    }

    // Increment wait age for entities sitting in the lowest queue (not running)
    for (const tid of queues[lastLevel]) {
      ageInLowest.set(tid, (ageInLowest.get(tid) || 0) + 1);
    }

    time++;
  }

  const { threadMetrics, processMetrics, aggregateMetrics } = computeMetrics(
    entities, processes, completionTime, firstRunTime, work, pidToTids, contextSwitches
  );

  return {
    algorithm: 'MLFQ',
    config,
    timeline,
    threadMetrics,
    processMetrics,
    aggregateMetrics,
  };
}

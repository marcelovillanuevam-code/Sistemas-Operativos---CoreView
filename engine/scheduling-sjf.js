// scheduling-sjf.js — Shortest Job First (non-preemptive) scheduling algorithm. Pure function, zero DOM.
// Calls expandToThreads() internally. Returns SchedulingTrace.

import { expandToThreads } from './thread-utils.js';
import { computeMetrics }  from './engine-utils.js';

/**
 * @param {import('../types.js').Process[]} processes
 * @param {Map<number, object>} pidToTids
 * @param {Set<number>} completed
 * @param {number|null} runningTid
 * @param {number[]} readyQueue
 */
function buildProcessStates(processes, pidToTids, completed, runningTid, readyQueue) {
  return processes.map(p => {
    const tids = pidToTids.get(p.pid) || [];
    const threadStates = tids.map(tid => {
      let state;
      if (completed.has(tid))            state = 'TERMINATED';
      else if (tid === runningTid)        state = 'RUNNING';
      else if (readyQueue.includes(tid))  state = 'READY';
      else                                state = 'NEW';
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
 * Selects the tid from readyQueue with the shortest burstTime.
 * Ties broken by arrivalTime, then pid, then tid.
 *
 * @param {number[]} readyQueue
 * @param {Map<number, object>} work
 * @returns {number}
 */
function selectShortest(readyQueue, work) {
  let bestIdx = 0;
  for (let i = 1; i < readyQueue.length; i++) {
    const best = work.get(readyQueue[bestIdx]);
    const cand = work.get(readyQueue[i]);
    if (
      cand.burstTime < best.burstTime ||
      (cand.burstTime === best.burstTime && cand.arrivalTime < best.arrivalTime) ||
      (cand.burstTime === best.burstTime && cand.arrivalTime === best.arrivalTime && cand.pid < best.pid) ||
      (cand.burstTime === best.burstTime && cand.arrivalTime === best.arrivalTime && cand.pid === best.pid && cand.tid < best.tid)
    ) {
      bestIdx = i;
    }
  }
  return readyQueue.splice(bestIdx, 1)[0];
}

/**
 * @param {import('../types.js').Process[]} processes
 * @returns {import('../types.js').SchedulingTrace}
 */
export function runSJF(processes) {
  const entities = expandToThreads(processes);
  const work = new Map(entities.map(e => [e.tid, { ...e }]));

  const pidToTids = new Map();
  for (const e of entities) {
    if (!pidToTids.has(e.pid)) pidToTids.set(e.pid, []);
    pidToTids.get(e.pid).push(e.tid);
  }

  const firstRunTime  = new Map();
  const completionTime = new Map();
  const completed     = new Set();
  const readyQueue    = [];
  let running         = null;
  let prevRunningTid  = null;
  let contextSwitches = 0;
  const timeline      = [];
  let time            = 0;

  // Upper bound: last arrival + total burst + 1 — covers idle gaps between arrivals
  const totalBurst = entities.reduce((s, e) => s + e.burstTime, 0);
  const maxArrival = Math.max(0, ...entities.map(e => e.arrivalTime));
  const maxTime    = maxArrival + totalBurst + 1;

  while (time <= maxTime) {
    // ── Step 1: completions ───────────────────────────────────────────────────
    const completedThisTick = [];
    if (running !== null && work.get(running).remainingTime === 0) {
      completedThisTick.push(running);
      completionTime.set(running, time);
      completed.add(running);
      running = null;
    }

    // ── Step 2: arrivals ──────────────────────────────────────────────────────
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

    // ── Step 3: dispatch (shortest burst from ready pool) ─────────────────────
    let contextSwitch = false;
    if (running === null && readyQueue.length > 0) {
      const next = selectShortest(readyQueue, work);
      if (!firstRunTime.has(next)) firstRunTime.set(next, time);
      if (prevRunningTid !== null && prevRunningTid !== next) {
        contextSwitch = true;
        contextSwitches++;
      }
      running = next;
    }

    // ── Step 4: build processStates ───────────────────────────────────────────
    const processStates = buildProcessStates(
      processes, pidToTids, completed, running, readyQueue
    );

    // ── Step 5: record timeline entry ─────────────────────────────────────────
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

    // ── Step 6: execute 1 tick ────────────────────────────────────────────────
    if (running !== null) work.get(running).remainingTime--;

    time++;
  }

  const { threadMetrics, processMetrics, aggregateMetrics } = computeMetrics(
    entities, processes, completionTime, firstRunTime, work, pidToTids, contextSwitches
  );

  return {
    algorithm: 'SJF',
    config: { algorithm: 'SJF' },
    timeline,
    threadMetrics,
    processMetrics,
    aggregateMetrics,
  };
}

// scheduling-fcfs.js — First-Come First-Served scheduling algorithm. Pure function, zero DOM.
// Calls expandToThreads() internally. Returns SchedulingTrace.

import { expandToThreads } from './thread-utils.js';
import { computeMetrics }  from './engine-utils.js';

/**
 * Builds processStates snapshot for a single timeline tick.
 *
 * @param {import('../types.js').Process[]} processes
 * @param {Map<number, object>} pidToTids  - pid → tid[]
 * @param {Set<number>} completed
 * @param {number|null} runningTid
 * @param {number[]} readyQueue  - tids in queue order
 */
function buildProcessStates(processes, pidToTids, completed, runningTid, readyQueue) {
  return processes.map(p => {
    const tids = pidToTids.get(p.pid) || [];
    const threadStates = tids.map(tid => {
      let state;
      if (completed.has(tid))       state = 'TERMINATED';
      else if (tid === runningTid)   state = 'RUNNING';
      else if (readyQueue.includes(tid)) state = 'READY';
      else                           state = 'NEW';
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
 * @returns {import('../types.js').SchedulingTrace}
 */
export function runFCFS(processes) {
  const entities = expandToThreads(processes);

  // Mutable working copies keyed by tid — only remainingTime changes
  const work = new Map(entities.map(e => [e.tid, { ...e }]));

  // Group tids by pid for processStates and join-barrier metrics
  const pidToTids = new Map();
  for (const e of entities) {
    if (!pidToTids.has(e.pid)) pidToTids.set(e.pid, []);
    pidToTids.get(e.pid).push(e.tid);
  }

  // Scheduling state
  const firstRunTime = new Map();   // tid → first tick it ran
  const completionTime = new Map(); // tid → CT
  const completed = new Set();
  const readyQueue = [];            // tids in FCFS arrival order
  let running = null;               // tid | null
  let prevRunningTid = null;
  let contextSwitches = 0;
  const timeline = [];
  let time = 0;

  // Upper bound: last arrival + total burst + 1 — covers idle gaps between arrivals
  const totalBurst = entities.reduce((s, e) => s + e.burstTime, 0);
  const maxArrival = Math.max(0, ...entities.map(e => e.arrivalTime));
  const maxTime    = maxArrival + totalBurst + 1;

  while (time <= maxTime) {
    // ── Step 1: completions from previous tick's execution ──────────────────
    const completedThisTick = [];
    if (running !== null && work.get(running).remainingTime === 0) {
      completedThisTick.push(running);
      completionTime.set(running, time);
      completed.add(running);
      running = null;
    }

    // ── Step 2: arrivals at this tick ───────────────────────────────────────
    // entities is sorted by arrivalTime,pid,tid → preserves FCFS tie-break
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

    // ── Step 3: dispatch ────────────────────────────────────────────────────
    let contextSwitch = false;
    if (running === null && readyQueue.length > 0) {
      const next = readyQueue.shift();
      if (!firstRunTime.has(next)) firstRunTime.set(next, time);
      if (prevRunningTid !== null && prevRunningTid !== next) {
        contextSwitch = true;
        contextSwitches++;
      }
      running = next;
    }

    // ── Step 4: build processStates ─────────────────────────────────────────
    const processStates = buildProcessStates(
      processes, pidToTids, completed, running, readyQueue
    );

    // ── Step 5: record timeline entry ───────────────────────────────────────
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

    // ── Step 6: termination check ───────────────────────────────────────────
    if (completed.size === entities.length && running === null) break;

    // ── Step 7: execute 1 tick ──────────────────────────────────────────────
    if (running !== null) work.get(running).remainingTime--;

    time++;
  }

  const { threadMetrics, processMetrics, aggregateMetrics } = computeMetrics(
    entities, processes, completionTime, firstRunTime, work, pidToTids, contextSwitches
  );

  return {
    algorithm: 'FCFS',
    config: { algorithm: 'FCFS' },
    timeline,
    threadMetrics,
    processMetrics,
    aggregateMetrics,
  };
}

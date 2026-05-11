// gil-scheduler.js - CPython-style GIL execution model for CPU-bound threads.

import { expandToThreads } from './thread-utils.js';
import { computeMetrics } from './engine-utils.js';

export const GIL_SWITCH_INTERVAL = 5;

const ALLOWED_CORE_COUNTS = new Set([1, 2, 4, 8]);

function cloneMetric(metric) {
  return metric ? { ...metric } : metric;
}

function buildPidToTids(entities) {
  const pidToTids = new Map();
  for (const entity of entities) {
    if (!pidToTids.has(entity.pid)) pidToTids.set(entity.pid, []);
    pidToTids.get(entity.pid).push(entity.tid);
  }
  return pidToTids;
}

function sortRunnable(tids, work) {
  return tids.slice().sort((leftTid, rightTid) => {
    const left = work.get(leftTid);
    const right = work.get(rightTid);
    if (left.arrivalTime !== right.arrivalTime) return left.arrivalTime - right.arrivalTime;
    if (left.pid !== right.pid) return left.pid - right.pid;
    return left.tid - right.tid;
  });
}

function nextRunnableAfter(runnableTids, afterTid, work) {
  if (runnableTids.length === 0) return null;
  const ordered = sortRunnable(runnableTids, work);
  if (afterTid === null || afterTid === undefined) return ordered[0];

  const currentIndex = ordered.indexOf(afterTid);
  if (currentIndex === -1) return ordered[0];
  return ordered[(currentIndex + 1) % ordered.length];
}

function buildThreadStates(entities, completed, runningTid, runnableTids) {
  const runnable = new Set(runnableTids);
  return entities.map(entity => {
    let state;
    if (completed.has(entity.tid)) state = 'TERMINATED';
    else if (runningTid === entity.tid) state = 'RUNNING';
    else if (runnable.has(entity.tid)) state = 'WAITING_GIL';
    else state = 'NEW';
    return { tid: entity.tid, pid: entity.pid, state };
  });
}

function buildProcessStates(processes, pidToTids, threadStates) {
  const byTid = new Map(threadStates.map(state => [state.tid, state]));

  return processes.map(process => {
    const tids = pidToTids.get(process.pid) || [];
    const states = tids.map(tid => {
      const state = byTid.get(tid)?.state || 'NEW';
      return { tid, state };
    });

    let state;
    if (states.length > 0 && states.every(item => item.state === 'TERMINATED')) {
      state = 'TERMINATED';
    } else if (states.some(item => item.state === 'RUNNING')) {
      state = 'RUNNING';
    } else if (states.some(item => item.state === 'WAITING_GIL')) {
      state = 'WAITING_GIL';
    } else {
      state = 'NEW';
    }

    return { pid: process.pid, state, threadStates: states };
  });
}

function coreStatesFromRunning(runningTid, runningCoreIndex, work, numCores) {
  const coreStates = Array(numCores).fill(null);
  if (runningTid !== null && runningCoreIndex >= 0 && runningCoreIndex < numCores) {
    const entity = work.get(runningTid);
    coreStates[runningCoreIndex] = {
      tid: runningTid,
      pid: entity ? entity.pid : null,
      state: 'RUNNING',
    };
  }
  return coreStates;
}

function usageFromCoreStates(coreStates) {
  return coreStates.map(state => state ? 100 : 0);
}

function perCoreUsageFromTimeline(timeline, numCores) {
  if (timeline.length === 0) return Array(numCores).fill(0);

  const activeTicks = Array(numCores).fill(0);
  for (const entry of timeline) {
    const usage = entry.coreUsage || [];
    for (let index = 0; index < numCores; index += 1) {
      if ((usage[index] || 0) > 0) activeTicks[index] += 1;
    }
  }

  return activeTicks.map(count => (count / timeline.length) * 100);
}

/**
 * Builds a deterministic trace for CPU-bound Python threads under the CPython
 * Global Interpreter Lock. This intentionally models only CPU-bound bytecode:
 * CPython can release the GIL while blocked on I/O, and multiprocessing or
 * worker processes can use multiple cores. Those cases are outside this screen.
 *
 * @param {object} options
 * @param {import('../types.js').Process[]} options.processes
 * @param {number} [options.numCores]
 * @param {number} [options.switchInterval]
 * @returns {object}
 */
export function runGILScheduler({
  processes,
  numCores = 1,
  switchInterval = GIL_SWITCH_INTERVAL,
} = {}) {
  const requestedNumCores = Number(numCores ?? 1);
  if (!Number.isInteger(requestedNumCores) || !ALLOWED_CORE_COUNTS.has(requestedNumCores)) {
    throw new Error('GIL scheduler numCores must be one of: 1, 2, 4, 8.');
  }

  const normalizedSwitchInterval = Number(switchInterval ?? GIL_SWITCH_INTERVAL);
  if (!Number.isInteger(normalizedSwitchInterval) || normalizedSwitchInterval <= 0) {
    throw new Error('GIL switchInterval must be a positive integer.');
  }

  const safeProcesses = Array.isArray(processes) ? processes : [];
  const entities = expandToThreads(safeProcesses);
  if (entities.length === 0) {
    throw new Error('GIL scheduler requires at least one schedulable thread.');
  }

  const work = new Map(entities.map(entity => [entity.tid, { ...entity }]));
  const pidToTids = buildPidToTids(entities);
  const firstRunTime = new Map();
  const completionTime = new Map();
  const completed = new Set();
  const timeline = [];

  const totalBurst = entities.reduce((sum, entity) => sum + entity.burstTime, 0);
  const maxArrival = Math.max(0, ...entities.map(entity => entity.arrivalTime));
  const maxTime = maxArrival + totalBurst + 1;

  let time = 0;
  let gilHolderTid = null;
  let sliceTicks = 0;
  let activeCoreIndex = -1;
  let lastAssignedCoreIndex = -1;
  let previousRunningTid = null;
  let contextSwitches = 0;

  while (time <= maxTime) {
    const arrivedThisTick = entities
      .filter(entity => entity.arrivalTime === time)
      .map(entity => entity.tid);

    const runnableTids = entities
      .filter(entity => {
        const state = work.get(entity.tid);
        return entity.arrivalTime <= time && !completed.has(entity.tid) && state.remainingTime > 0;
      })
      .map(entity => entity.tid);

    if (!runnableTids.includes(gilHolderTid)) {
      const next = nextRunnableAfter(runnableTids, gilHolderTid, work);
      if (next !== gilHolderTid) sliceTicks = 0;
      gilHolderTid = next;
    } else if (runnableTids.length > 1 && sliceTicks >= normalizedSwitchInterval) {
      const next = nextRunnableAfter(runnableTids, gilHolderTid, work);
      if (next !== gilHolderTid) sliceTicks = 0;
      gilHolderTid = next;
    }

    if (gilHolderTid !== null && gilHolderTid !== previousRunningTid) {
      lastAssignedCoreIndex = (lastAssignedCoreIndex + 1) % requestedNumCores;
      activeCoreIndex = lastAssignedCoreIndex;
    } else if (gilHolderTid === null) {
      activeCoreIndex = -1;
    }

    if (gilHolderTid !== null && !firstRunTime.has(gilHolderTid)) {
      firstRunTime.set(gilHolderTid, time);
    }

    const coreStates = coreStatesFromRunning(gilHolderTid, activeCoreIndex, work, requestedNumCores);
    const coreUsage = usageFromCoreStates(coreStates);
    const runningTids = coreStates.map(state => state ? state.tid : null);
    const waitingForGilTids = runnableTids.filter(tid => tid !== gilHolderTid);
    const threadStates = buildThreadStates(entities, completed, gilHolderTid, runnableTids);
    const processStates = buildProcessStates(safeProcesses, pidToTids, threadStates);
    const contextSwitch = previousRunningTid !== null &&
      gilHolderTid !== null &&
      previousRunningTid !== gilHolderTid;
    if (contextSwitch) contextSwitches += 1;

    const entry = {
      time,
      runningPid: gilHolderTid === null ? null : work.get(gilHolderTid).pid,
      runningTid: gilHolderTid,
      runningTids,
      coreStates,
      coreUsage,
      totalUsage: coreUsage.reduce((sum, value) => sum + value, 0) / requestedNumCores,
      runnableTids: runnableTids.slice(),
      waitingForGilTids,
      readyQueue: waitingForGilTids.map(tid => ({ ...work.get(tid), gilState: 'WAITING_GIL' })),
      threadStates,
      processStates,
      arrivedThisTick,
      completedThisTick: [],
      contextSwitch,
      gil: {
        holderTid: gilHolderTid,
        switchInterval: normalizedSwitchInterval,
        sliceTicks,
        activeCoreIndex,
      },
    };

    if (completed.size === entities.length && gilHolderTid === null) {
      break;
    }

    if (gilHolderTid !== null) {
      const state = work.get(gilHolderTid);
      state.remainingTime -= 1;
      sliceTicks += 1;

      if (state.remainingTime === 0) {
        completed.add(gilHolderTid);
        completionTime.set(gilHolderTid, time + 1);
        entry.completedThisTick.push(gilHolderTid);
        previousRunningTid = gilHolderTid;
        gilHolderTid = null;
        sliceTicks = 0;
      } else {
        previousRunningTid = gilHolderTid;
      }
    } else {
      previousRunningTid = null;
    }

    timeline.push(entry);

    if (completed.size === entities.length) {
      break;
    }

    time += 1;
  }

  if (completed.size !== entities.length) {
    throw new Error(`Unable to complete GIL scheduler trace within ${maxTime} ticks.`);
  }

  const metrics = computeMetrics(
    entities,
    safeProcesses,
    completionTime,
    firstRunTime,
    work,
    pidToTids,
    contextSwitches
  );
  const totalTime = Math.max(0, ...completionTime.values());
  const busyTicks = entities.reduce((sum, entity) => sum + entity.burstTime, 0);
  const totalProcessUsage = totalTime > 0
    ? busyTicks / (totalTime * requestedNumCores)
    : 0;

  metrics.aggregateMetrics = {
    ...metrics.aggregateMetrics,
    cpuUtilization: totalProcessUsage * 100,
    totalProcessUsage,
    totalProcessUsagePct: totalProcessUsage * 100,
    perCoreUsage: perCoreUsageFromTimeline(timeline, requestedNumCores),
    totalContextSwitches: contextSwitches,
    throughput: totalTime > 0 ? entities.length / totalTime : 0,
  };

  return {
    algorithm: 'PYTHON_GIL',
    config: {
      environment: 'Python (Bloqueo GIL)',
      numCores: requestedNumCores,
      requestedNumCores,
      switchInterval: normalizedSwitchInterval,
      cpuBoundOnly: true,
    },
    timeline,
    threadMetrics: metrics.threadMetrics.map(cloneMetric),
    processMetrics: metrics.processMetrics.map(cloneMetric),
    aggregateMetrics: { ...metrics.aggregateMetrics },
  };
}

export default runGILScheduler;

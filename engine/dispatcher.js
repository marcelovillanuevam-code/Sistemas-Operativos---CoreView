// dispatcher.js - Orchestrates thread workers from a scheduling trace.

import { expandToThreads } from './thread-utils.js';
import { computeMetrics } from './engine-utils.js';
import { runFCFS } from './scheduling-fcfs.js';
import { runSJF } from './scheduling-sjf.js';
import { runRoundRobin } from './scheduling-rr.js';
import { runSRTF } from './scheduling-srtf.js';
import { runHRRN } from './scheduling-hrrn.js';
import { runPriorityPreemptive } from './scheduling-priority.js';
import { runMLQ } from './scheduling-mlq.js';
import { runMLFQ } from './scheduling-mlfq.js';

const ALLOWED_CORE_COUNTS = new Set([1, 2, 4, 8]);

const SUPPORTED_ALGORITHMS = new Set([
  'FCFS',
  'SJF',
  'RR',
  'SRTF',
  'HRRN',
  'PRIORITY',
  'PRIORITY_NON_PREEMPTIVE',
  'PRIORITY_PREEMPTIVE',
  'MLQ',
  'MLFQ',
]);

const SINGLE_CORE_ONLY_REASON =
  'MLFQ y MLQ requieren coordinación de queues entre cores que está fuera del alcance educativo de esta entrega. ' +
  'Estos algoritmos se ejecutan en single-core para preservar la corrección de su lógica de promoción/degradación entre niveles.';

const DEFAULT_MLQ_CONFIG = {
  algorithm: 'MLQ',
  mlqQueues: [
    { algorithm: 'RR', priorityRange: [1, 1], quantum: 2 },
    { algorithm: 'RR', priorityRange: [2, 2], quantum: 4 },
    { algorithm: 'FCFS', priorityRange: [3, 99] },
  ],
};

const DEFAULT_MLFQ_CONFIG = {
  algorithm: 'MLFQ',
  mlfqLevels: [
    { algorithm: 'RR', quantum: 2 },
    { algorithm: 'RR', quantum: 4 },
    { algorithm: 'FCFS', quantum: Infinity },
  ],
};

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function makeWorkerUrl() {
  return new URL('./thread-worker.js', import.meta.url);
}

function cloneMetric(metric) {
  return metric ? { ...metric } : metric;
}

/**
 * Dispatcher executes the scheduling decisions made by the pure algorithms.
 * For multi-core runs it derives a dispatcher-local N-core trace and leaves
 * the pure single-core algorithm implementations untouched.
 */
export class Dispatcher {
  /**
   * @param {object} options
   * @param {import('../types.js').Process[]} options.processes
   * @param {number} [options.numCores]
   * @param {'FCFS'|'SJF'|'RR'|'SRTF'|'HRRN'|'PRIORITY'|'PRIORITY_NON_PREEMPTIVE'|'PRIORITY_PREEMPTIVE'|'MLQ'|'MLFQ'} options.algorithm
   * @param {number} [options.quantum]
   * @param {number} [options.simSpeedMs]
   * @param {import('../types.js').SchedulingConfig} [options.config]
   * @param {import('../types.js').MLQQueueConfig[]} [options.mlqQueues]
   * @param {import('../types.js').MLFQLevelConfig[]} [options.mlfqLevels]
   */
  constructor({
    processes,
    numCores = 1,
    algorithm,
    quantum,
    simSpeedMs = 100,
    config,
    mlqQueues,
    mlfqLevels,
  }) {
    if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
      throw new Error(`Unsupported scheduling algorithm: ${algorithm}`);
    }

    const requestedNumCores = Number(numCores ?? 1);
    if (!Number.isInteger(requestedNumCores) || !ALLOWED_CORE_COUNTS.has(requestedNumCores)) {
      throw new Error('Dispatcher numCores must be one of: 1, 2, 4, 8.');
    }

    this.processes = Array.isArray(processes) ? processes : [];
    this.requestedNumCores = requestedNumCores;
    this.algorithm = algorithm;
    this.normalizedAlgorithm = algorithm === 'PRIORITY'
      ? 'PRIORITY_NON_PREEMPTIVE'
      : algorithm;
    this.quantum = Number(quantum ?? config?.quantum ?? 2);
    this.simSpeedMs = Number(simSpeedMs ?? 100);
    if (!Number.isFinite(this.quantum) || this.quantum <= 0) {
      throw new Error('Dispatcher quantum must be a positive number.');
    }
    if (!Number.isFinite(this.simSpeedMs) || this.simSpeedMs <= 0) {
      throw new Error('Dispatcher simSpeedMs must be a positive number.');
    }

    this.schedulingConfig = this._buildSchedulingConfig(config, mlqQueues, mlfqLevels);
    this.numCores = requestedNumCores;
    if ((this.normalizedAlgorithm === 'MLQ' || this.normalizedAlgorithm === 'MLFQ') && requestedNumCores !== 1) {
      console.warn(SINGLE_CORE_ONLY_REASON);
      this.numCores = 1;
    }

    this.threads = expandToThreads(this.processes);
    if (this.threads.length === 0) {
      throw new Error('Dispatcher requires at least one schedulable thread.');
    }

    this.singleCoreTrace = this._computeSingleCoreTrace();
    this.trace = this._computeExecutionTrace();
    this.timelineByTime = new Map(this.trace.timeline.map(entry => [entry.time, entry]));
    this.threadByTid = new Map(this.threads.map(thread => [thread.tid, thread]));
    this.traceMetricsByTid = new Map(this.trace.threadMetrics.map(metric => [metric.tid, metric]));

    this.workerPool = new Map();
    this.finishedTids = new Set();
    this.executedByTid = new Map(this.threads.map(thread => [thread.tid, 0]));
    this.firstRunTimeByTid = new Map();
    this.metricsByTid = new Map();

    this.coreUpdateCallbacks = new Set();
    this.threadDoneCallbacks = new Set();
    this.completeCallbacks = new Set();
    this.errorCallbacks = new Set();

    this.tickTimer = null;
    this.currentRunningTidsByCore = Array(this.numCores).fill(null);
    this.waitingForWorkerTids = new Set();
    this.simTime = 0;
    this.started = false;
    this.paused = false;
    this.stopped = false;
    this.completed = false;

    this.startedAtWallMs = 0;
    this.pausedAtWallMs = 0;
    this.totalPausedWallMs = 0;
    this.intervalMs = this.simSpeedMs;
  }

  onCoreUpdate(cb) {
    if (typeof cb === 'function') this.coreUpdateCallbacks.add(cb);
    return this;
  }

  onThreadDone(cb) {
    if (typeof cb === 'function') this.threadDoneCallbacks.add(cb);
    return this;
  }

  onComplete(cb) {
    if (typeof cb === 'function') this.completeCallbacks.add(cb);
    return this;
  }

  onError(cb) {
    if (typeof cb === 'function') this.errorCallbacks.add(cb);
    return this;
  }

  async start() {
    if (this.started) return this;
    if (this.stopped) {
      throw new Error('Cannot start a stopped Dispatcher. Create a new Dispatcher instance.');
    }
    if (typeof Worker === 'undefined') {
      throw new Error('Dispatcher requires Web Worker support.');
    }

    this.started = true;
    this.startedAtWallMs = nowMs();

    try {
      await this._createAndInitializeWorkers();
      if (this.stopped || this.completed) return this;

      this._dispatchForCurrentTime();
      this._startTickTimer();
    } catch (error) {
      this._handleError(error);
    }

    return this;
  }

  pause() {
    if (!this.started || this.paused || this.stopped || this.completed) return;

    this.paused = true;
    this.pausedAtWallMs = nowMs();
    this._clearTickTimer();

    for (const tid of this._activeRunningTids()) {
      this._postToThread(tid, { type: 'preempt' });
    }
    this.currentRunningTidsByCore = Array(this.numCores).fill(null);
    this.waitingForWorkerTids.clear();
    this._emitCoreUpdate(this._coreStatesFromTids(this.currentRunningTidsByCore));
  }

  resume() {
    if (!this.started || !this.paused || this.stopped || this.completed) return;

    this.paused = false;
    if (this.pausedAtWallMs > 0) {
      this.totalPausedWallMs += nowMs() - this.pausedAtWallMs;
      this.pausedAtWallMs = 0;
    }

    this._dispatchForCurrentTime();
    this._startTickTimer();
  }

  stop() {
    if (this.stopped || this.completed) return;

    this.stopped = true;
    this._clearTickTimer();

    if (this.paused && this.pausedAtWallMs > 0) {
      this.totalPausedWallMs += nowMs() - this.pausedAtWallMs;
      this.pausedAtWallMs = 0;
    }

    this.currentRunningTidsByCore = Array(this.numCores).fill(null);
    this.waitingForWorkerTids.clear();
    this._terminateWorkers();
    this._emitCoreUpdate(this._coreStatesFromTids(this.currentRunningTidsByCore));
    const metrics = this._collectMetrics();
    this._emitComplete(metrics, this._totalSimElapsedMs(metrics));
  }

  _buildSchedulingConfig(config, mlqQueues, mlfqLevels) {
    if (this.normalizedAlgorithm === 'MLQ') {
      return {
        ...DEFAULT_MLQ_CONFIG,
        ...(config || {}),
        algorithm: 'MLQ',
        mlqQueues: mlqQueues || config?.mlqQueues || DEFAULT_MLQ_CONFIG.mlqQueues,
      };
    }

    if (this.normalizedAlgorithm === 'MLFQ') {
      return {
        ...DEFAULT_MLFQ_CONFIG,
        ...(config || {}),
        algorithm: 'MLFQ',
        mlfqLevels: mlfqLevels || config?.mlfqLevels || DEFAULT_MLFQ_CONFIG.mlfqLevels,
      };
    }

    return {
      ...(config || {}),
      algorithm: this.algorithm,
      quantum: this.quantum,
    };
  }

  _computeSingleCoreTrace() {
    switch (this.normalizedAlgorithm) {
      case 'FCFS':
        return runFCFS(this.processes);
      case 'SJF':
        return runSJF(this.processes);
      case 'RR':
        return runRoundRobin(this.processes, this.quantum);
      case 'SRTF':
        return runSRTF(this.processes);
      case 'HRRN':
        return runHRRN(this.processes);
      case 'PRIORITY_PREEMPTIVE':
        return runPriorityPreemptive(this.processes);
      case 'PRIORITY_NON_PREEMPTIVE':
        return this._buildNativeTrace(1, 'PRIORITY_NON_PREEMPTIVE');
      case 'MLQ':
        return runMLQ(this.processes, this.schedulingConfig);
      case 'MLFQ':
        return runMLFQ(this.processes, this.schedulingConfig);
      default:
        throw new Error(`Unsupported scheduling algorithm: ${this.algorithm}`);
    }
  }

  _computeExecutionTrace() {
    if (this.numCores === 1 || this.normalizedAlgorithm === 'MLQ' || this.normalizedAlgorithm === 'MLFQ') {
      return this._augmentSingleCoreTrace(this.singleCoreTrace);
    }

    return this._buildNativeTrace(this.numCores, this.normalizedAlgorithm);
  }

  _augmentSingleCoreTrace(trace) {
    const timeline = trace.timeline.map(entry => {
      const coreStates = [entry.runningTid === null ? null : {
        tid: entry.runningTid,
        pid: entry.runningPid,
      }];

      return {
        ...entry,
        runningTids: [entry.runningTid],
        coreStates,
      };
    });

    return {
      ...trace,
      config: {
        ...(trace.config || {}),
        requestedNumCores: this.requestedNumCores,
        numCores: 1,
      },
      timeline,
      threadMetrics: trace.threadMetrics.map(cloneMetric),
      processMetrics: trace.processMetrics.map(cloneMetric),
      aggregateMetrics: { ...trace.aggregateMetrics },
    };
  }

  _buildNativeTrace(numCores, algorithm) {
    switch (algorithm) {
      case 'FCFS':
      case 'SJF':
      case 'HRRN':
      case 'PRIORITY_NON_PREEMPTIVE':
        return this._buildNonPreemptiveTrace(numCores, algorithm);
      case 'RR':
        return this._buildRoundRobinTrace(numCores);
      case 'SRTF':
      case 'PRIORITY_PREEMPTIVE':
        return this._buildPreemptiveTopNTrace(numCores, algorithm);
      default:
        throw new Error(`Unsupported multi-core scheduling algorithm: ${algorithm}`);
    }
  }

  _buildNonPreemptiveTrace(numCores, algorithm) {
    return this._simulateNativeTrace(numCores, algorithm, {
      kind: 'nonpreemptive',
      selectReady: (readyQueue, work, time) => this._selectNonPreemptiveReady(readyQueue, work, time, algorithm),
    });
  }

  _buildRoundRobinTrace(numCores) {
    return this._simulateNativeTrace(numCores, 'RR', { kind: 'rr' });
  }

  _buildPreemptiveTopNTrace(numCores, algorithm) {
    return this._simulateNativeTrace(numCores, algorithm, { kind: 'topN' });
  }

  _simulateNativeTrace(numCores, algorithm, scheduler) {
    const entities = expandToThreads(this.processes);
    const work = new Map(entities.map(entity => [entity.tid, { ...entity }]));
    const pidToTids = this._buildPidToTids(entities);
    const firstRunTime = new Map();
    const completionTime = new Map();
    const completed = new Set();
    const readyQueue = [];
    let coreTids = Array(numCores).fill(null);
    let prevCoreTids = Array(numCores).fill(null);
    let quantumLeftByCore = Array(numCores).fill(0);
    let contextSwitches = 0;
    const timeline = [];
    let time = 0;

    const totalBurst = entities.reduce((sum, entity) => sum + entity.burstTime, 0);
    const maxArrival = Math.max(0, ...entities.map(entity => entity.arrivalTime));
    const maxTime = maxArrival + totalBurst + 1;

    while (time <= maxTime) {
      const completedThisTick = [];
      for (let coreIndex = 0; coreIndex < numCores; coreIndex += 1) {
        const tid = coreTids[coreIndex];
        if (tid !== null && work.get(tid).remainingTime === 0) {
          completedThisTick.push(tid);
          completionTime.set(tid, time);
          completed.add(tid);
          coreTids[coreIndex] = null;
          quantumLeftByCore[coreIndex] = 0;
        }
      }

      const runningSetBeforeArrivals = new Set(coreTids.filter(tid => tid !== null));
      const expiredCoreIndexes = [];
      if (scheduler.kind === 'rr') {
        for (let coreIndex = 0; coreIndex < numCores; coreIndex += 1) {
          if (coreTids[coreIndex] !== null && quantumLeftByCore[coreIndex] === 0) {
            expiredCoreIndexes.push(coreIndex);
          }
        }
      }

      const arrivedThisTick = [];
      for (const entity of entities) {
        if (
          entity.arrivalTime === time &&
          !completed.has(entity.tid) &&
          !runningSetBeforeArrivals.has(entity.tid) &&
          !readyQueue.includes(entity.tid)
        ) {
          arrivedThisTick.push(entity.tid);
          readyQueue.push(entity.tid);
        }
      }

      if (scheduler.kind === 'rr') {
        for (const coreIndex of expiredCoreIndexes) {
          const tid = coreTids[coreIndex];
          if (tid !== null && !completed.has(tid)) {
            readyQueue.push(tid);
            coreTids[coreIndex] = null;
            quantumLeftByCore[coreIndex] = 0;
          }
        }

        for (let coreIndex = 0; coreIndex < numCores; coreIndex += 1) {
          if (coreTids[coreIndex] === null && readyQueue.length > 0) {
            const next = readyQueue.shift();
            coreTids[coreIndex] = next;
            quantumLeftByCore[coreIndex] = this.quantum;
            if (!firstRunTime.has(next)) firstRunTime.set(next, time);
          }
        }
      } else if (scheduler.kind === 'topN') {
        const candidates = [
          ...coreTids.filter(tid => tid !== null),
          ...readyQueue,
        ].filter((tid, index, all) => !completed.has(tid) && all.indexOf(tid) === index);
        const selected = this._selectTopN(candidates, work, numCores, algorithm);
        const selectedSet = new Set(selected);
        const nextCoreTids = Array(numCores).fill(null);

        for (let coreIndex = 0; coreIndex < numCores; coreIndex += 1) {
          const tid = coreTids[coreIndex];
          if (tid !== null && selectedSet.has(tid)) {
            nextCoreTids[coreIndex] = tid;
            selectedSet.delete(tid);
          }
        }

        const remainingSelected = selected.filter(tid => selectedSet.has(tid));
        for (let coreIndex = 0; coreIndex < numCores && remainingSelected.length > 0; coreIndex += 1) {
          if (nextCoreTids[coreIndex] === null) {
            nextCoreTids[coreIndex] = remainingSelected.shift();
          }
        }

        coreTids = nextCoreTids;
        readyQueue.length = 0;
        for (const tid of candidates) {
          if (!selected.includes(tid)) readyQueue.push(tid);
        }

        for (const tid of coreTids) {
          if (tid !== null && !firstRunTime.has(tid)) firstRunTime.set(tid, time);
        }
      } else {
        for (let coreIndex = 0; coreIndex < numCores; coreIndex += 1) {
          if (coreTids[coreIndex] === null && readyQueue.length > 0) {
            const next = scheduler.selectReady(readyQueue, work, time);
            coreTids[coreIndex] = next;
            if (!firstRunTime.has(next)) firstRunTime.set(next, time);
          }
        }
      }

      const contextSwitchCount = this._countContextSwitches(prevCoreTids, coreTids);
      const contextSwitch = contextSwitchCount > 0;
      contextSwitches += contextSwitchCount;

      const runningTids = coreTids.slice();
      const coreStates = this._coreStatesFromTids(runningTids);
      const processStates = this._buildProcessStates(pidToTids, completed, runningTids, readyQueue);

      timeline.push({
        time,
        runningPid: coreStates.find(Boolean)?.pid ?? null,
        runningTid: runningTids.find(tid => tid !== null) ?? null,
        runningTids,
        coreStates,
        readyQueue: readyQueue.map(tid => ({ ...work.get(tid) })),
        arrivedThisTick,
        completedThisTick,
        contextSwitch,
        processStates,
      });

      prevCoreTids = coreTids.slice();

      if (completed.size === entities.length && coreTids.every(tid => tid === null)) {
        break;
      }

      for (let coreIndex = 0; coreIndex < numCores; coreIndex += 1) {
        const tid = coreTids[coreIndex];
        if (tid !== null) {
          work.get(tid).remainingTime -= 1;
          if (scheduler.kind === 'rr') {
            quantumLeftByCore[coreIndex] -= 1;
          }
        }
      }

      time += 1;
    }

    if (completed.size !== entities.length) {
      throw new Error(`Unable to complete ${algorithm} dispatcher trace within ${maxTime} ticks.`);
    }

    const metrics = computeMetrics(
      entities,
      this.processes,
      completionTime,
      firstRunTime,
      work,
      pidToTids,
      contextSwitches
    );
    const totalTime = Math.max(0, ...completionTime.values());
    const busyTicks = entities.reduce((sum, entity) => sum + entity.burstTime, 0);
    metrics.aggregateMetrics = {
      ...metrics.aggregateMetrics,
      cpuUtilization: totalTime > 0 ? (busyTicks / (totalTime * numCores)) * 100 : 0,
      throughput: totalTime > 0 ? entities.length / totalTime : 0,
      totalContextSwitches: contextSwitches,
    };

    return {
      algorithm: this.algorithm,
      config: {
        ...this.schedulingConfig,
        algorithm: this.algorithm,
        normalizedAlgorithm: algorithm,
        requestedNumCores: this.requestedNumCores,
        numCores,
      },
      timeline,
      threadMetrics: metrics.threadMetrics,
      processMetrics: metrics.processMetrics,
      aggregateMetrics: metrics.aggregateMetrics,
    };
  }

  _buildPidToTids(entities) {
    const pidToTids = new Map();
    for (const entity of entities) {
      if (!pidToTids.has(entity.pid)) pidToTids.set(entity.pid, []);
      pidToTids.get(entity.pid).push(entity.tid);
    }
    return pidToTids;
  }

  _selectNonPreemptiveReady(readyQueue, work, time, algorithm) {
    if (algorithm === 'FCFS') {
      return readyQueue.shift();
    }

    let bestIndex = 0;
    for (let index = 1; index < readyQueue.length; index += 1) {
      const best = work.get(readyQueue[bestIndex]);
      const candidate = work.get(readyQueue[index]);
      if (this._compareNonPreemptive(candidate, best, time, algorithm) < 0) {
        bestIndex = index;
      }
    }
    return readyQueue.splice(bestIndex, 1)[0];
  }

  _compareNonPreemptive(candidate, best, time, algorithm) {
    if (algorithm === 'SJF') {
      if (candidate.burstTime !== best.burstTime) return candidate.burstTime - best.burstTime;
    } else if (algorithm === 'HRRN') {
      const candidateRatio = (time - candidate.arrivalTime + candidate.burstTime) / candidate.burstTime;
      const bestRatio = (time - best.arrivalTime + best.burstTime) / best.burstTime;
      if (candidateRatio !== bestRatio) return bestRatio - candidateRatio;
    } else if (algorithm === 'PRIORITY_NON_PREEMPTIVE') {
      if (candidate.priority !== best.priority) return candidate.priority - best.priority;
    }

    return this._compareStable(candidate, best);
  }

  _selectTopN(candidates, work, numCores, algorithm) {
    return candidates
      .slice()
      .sort((leftTid, rightTid) => {
        const left = work.get(leftTid);
        const right = work.get(rightTid);
        if (algorithm === 'SRTF' && left.remainingTime !== right.remainingTime) {
          return left.remainingTime - right.remainingTime;
        }
        if (algorithm === 'PRIORITY_PREEMPTIVE' && left.priority !== right.priority) {
          return left.priority - right.priority;
        }
        return this._compareStable(left, right);
      })
      .slice(0, numCores);
  }

  _compareStable(left, right) {
    if (left.arrivalTime !== right.arrivalTime) return left.arrivalTime - right.arrivalTime;
    if (left.pid !== right.pid) return left.pid - right.pid;
    return left.tid - right.tid;
  }

  _buildProcessStates(pidToTids, completed, runningTids, readyQueue) {
    const runningSet = new Set(runningTids.filter(tid => tid !== null));
    const readySet = new Set(readyQueue);

    return this.processes.map(process => {
      const tids = pidToTids.get(process.pid) || [];
      const threadStates = tids.map(tid => {
        let state;
        if (completed.has(tid)) state = 'TERMINATED';
        else if (runningSet.has(tid)) state = 'RUNNING';
        else if (readySet.has(tid)) state = 'READY';
        else state = 'NEW';
        return { tid, state };
      });

      let state;
      if (threadStates.length > 0 && threadStates.every(threadState => threadState.state === 'TERMINATED')) {
        state = 'TERMINATED';
      } else if (threadStates.some(threadState => threadState.state === 'RUNNING')) {
        state = 'RUNNING';
      } else if (threadStates.some(threadState => threadState.state === 'READY')) {
        state = 'READY';
      } else {
        state = 'NEW';
      }

      return { pid: process.pid, state, threadStates };
    });
  }

  _countContextSwitches(previousCoreTids, currentCoreTids) {
    let count = 0;
    for (let index = 0; index < currentCoreTids.length; index += 1) {
      const previous = previousCoreTids[index] ?? null;
      const current = currentCoreTids[index] ?? null;
      if (previous !== null && current !== null && previous !== current) count += 1;
    }
    return count;
  }

  async _createAndInitializeWorkers() {
    const readyPromises = this.threads.map(thread => this._createWorkerForThread(thread));
    await Promise.all(readyPromises);
  }

  _createWorkerForThread(thread) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(makeWorkerUrl());
      let ready = false;

      worker.onmessage = event => {
        const message = event.data || {};

        if (message.type === 'ready' && message.tid === thread.tid) {
          ready = true;
          resolve();
          return;
        }

        if (!ready && message.type === 'error') {
          reject(new Error(message.error || `Worker initialization failed for tid ${thread.tid}`));
          return;
        }

        this._handleWorkerMessage(message);
      };

      worker.onerror = error => {
        const workerError = new Error(error.message || `Worker error for tid ${thread.tid}`);
        if (!ready) {
          reject(workerError);
          return;
        }
        this._handleError(workerError);
      };

      this.workerPool.set(thread.tid, worker);
      worker.postMessage({
        type: 'init',
        tid: thread.tid,
        pid: thread.pid,
        totalBurst: thread.burstTime,
        simSpeedMs: this.simSpeedMs,
      });
    });
  }

  _handleWorkerMessage(message) {
    switch (message.type) {
      case 'tick':
        this.executedByTid.set(message.tid, message.executedSoFar);
        this._maybeResumeDispatchAfterProgress(message.tid);
        break;
      case 'done':
        this._handleThreadDone(message);
        break;
      case 'preempted':
        break;
      case 'error':
        this._handleError(new Error(message.error || `Worker error for tid ${message.tid}`));
        break;
      default:
        break;
    }
  }

  _handleThreadDone(message) {
    const tid = message.tid;
    if (this.finishedTids.has(tid)) return;

    const wasWaitingForWorker = this.waitingForWorkerTids.has(tid);
    this.finishedTids.add(tid);
    this.executedByTid.set(tid, message.executedSoFar);
    this.waitingForWorkerTids.delete(tid);
    this.currentRunningTidsByCore = this.currentRunningTidsByCore.map(currentTid => currentTid === tid ? null : currentTid);

    const metric = this._buildMetric(tid, true);
    this.metricsByTid.set(tid, metric);
    this._emitThreadDone(tid, metric);
    this._maybeComplete();
    if (!this.completed && !this.stopped) {
      if (wasWaitingForWorker) this._startTickTimer();
      this._dispatchForCurrentTime(true);
    }
  }

  _startTickTimer() {
    this._clearTickTimer();
    this.tickTimer = setInterval(() => {
      if (this.paused || this.stopped || this.completed) return;
      if (this.waitingForWorkerTids.size > 0) return;
      this.simTime += 1;
      this._dispatchForCurrentTime();
      this._maybeComplete();
    }, this.intervalMs);
  }

  _clearTickTimer() {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  _maybeResumeDispatchAfterProgress(tid) {
    if (!this.waitingForWorkerTids.has(tid) || this.paused || this.stopped || this.completed) {
      return;
    }

    if (this._refreshWaitingForCurrentTime()) return;

    this._startTickTimer();
    this._dispatchForCurrentTime();
    this._maybeComplete();
  }

  _refreshWaitingForCurrentTime() {
    const entry = this.timelineByTime.get(this.simTime);
    const waiting = new Set();

    for (const tid of this._activeRunningTids()) {
      const expectedExecuted = this._expectedExecutedBeforeTime(tid, this.simTime);
      const actualExecuted = this.executedByTid.get(tid) ?? 0;
      if (actualExecuted < expectedExecuted) {
        waiting.add(tid);
        continue;
      }

      if (
        entry &&
        this._entryCompletedTids(entry).includes(tid) &&
        !this.finishedTids.has(tid)
      ) {
        waiting.add(tid);
      }
    }

    this.waitingForWorkerTids = waiting;
    return waiting.size > 0;
  }

  _expectedExecutedBeforeTime(tid, time) {
    let count = 0;
    for (const entry of this.trace.timeline) {
      if (entry.time >= time) break;
      if (this._entryRunningTids(entry).includes(tid)) count += 1;
    }
    return count;
  }

  _dispatchForCurrentTime(forceIdleUpdate = false) {
    if (this.paused || this.stopped || this.completed) return;

    if (this._refreshWaitingForCurrentTime()) return;

    const entry = this.timelineByTime.get(this.simTime);
    const targetTids = entry
      ? this._entryRunningTids(entry).map(tid => this.finishedTids.has(tid) ? null : tid)
      : Array(this.numCores).fill(null);

    while (targetTids.length < this.numCores) targetTids.push(null);
    if (targetTids.length > this.numCores) targetTids.length = this.numCores;

    const changed = !this._sameCoreTids(targetTids, this.currentRunningTidsByCore);
    if (!changed) {
      if (forceIdleUpdate && targetTids.every(tid => tid === null)) {
        this._emitCoreUpdate(this._coreStatesFromTids(targetTids));
      }
      return;
    }

    const currentTids = this.currentRunningTidsByCore.slice();
    for (let coreIndex = 0; coreIndex < this.numCores; coreIndex += 1) {
      const currentTid = currentTids[coreIndex];
      const targetTid = targetTids[coreIndex];
      if (currentTid !== null && currentTid !== targetTid && !this.finishedTids.has(currentTid)) {
        this._postToThread(currentTid, { type: 'preempt' });
      }
    }

    this.currentRunningTidsByCore = targetTids.slice();

    for (let coreIndex = 0; coreIndex < this.numCores; coreIndex += 1) {
      const currentTid = currentTids[coreIndex];
      const targetTid = targetTids[coreIndex];
      if (targetTid !== null && currentTid !== targetTid) {
        if (!this.firstRunTimeByTid.has(targetTid)) {
          this.firstRunTimeByTid.set(targetTid, this.simTime);
        }
        this._postToThread(targetTid, { type: 'run' });
      }
    }

    this._emitCoreUpdate(this._coreStatesFromTids(this.currentRunningTidsByCore));
  }

  _entryRunningTids(entry) {
    if (Array.isArray(entry.runningTids)) {
      return entry.runningTids.slice();
    }
    return [entry.runningTid ?? null];
  }

  _entryCompletedTids(entry) {
    return Array.isArray(entry.completedThisTick) ? entry.completedThisTick : [];
  }

  _sameCoreTids(left, right) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if ((left[index] ?? null) !== (right[index] ?? null)) return false;
    }
    return true;
  }

  _activeRunningTids() {
    return Array.from(new Set(this.currentRunningTidsByCore.filter(tid => tid !== null)));
  }

  _coreStatesFromTids(tids) {
    return tids.map(tid => {
      if (tid === null || tid === undefined) return null;
      const thread = this.threadByTid?.get(tid) || this.threads.find(item => item.tid === tid);
      return { tid, pid: thread ? thread.pid : null };
    });
  }

  _postToThread(tid, message) {
    const worker = this.workerPool.get(tid);
    if (!worker) return;

    try {
      worker.postMessage(message);
    } catch (error) {
      this._handleError(error);
    }
  }

  _maybeComplete() {
    if (this.completed || this.stopped) return;
    if (this.finishedTids.size !== this.threads.length) return;

    this.completed = true;
    this._clearTickTimer();
    this.currentRunningTidsByCore = Array(this.numCores).fill(null);
    this.waitingForWorkerTids.clear();
    this._terminateWorkers();
    this._emitCoreUpdate(this._coreStatesFromTids(this.currentRunningTidsByCore));
    const metrics = this._collectMetrics();
    this._emitComplete(metrics, this._totalSimElapsedMs(metrics));
  }

  _terminateWorkers() {
    for (const worker of this.workerPool.values()) {
      try {
        worker.postMessage({ type: 'terminate' });
      } catch (_) {
        // Worker may already be gone.
      }
      try {
        worker.terminate();
      } catch (_) {
        // Worker may already be gone.
      }
    }
    this.workerPool.clear();
  }

  _handleError(error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this._emitError(normalized);
    if (!this.stopped && !this.completed) {
      this.stop();
    }
  }

  _buildMetric(tid, isDone) {
    const thread = this.threadByTid.get(tid);
    const traceMetric = this.traceMetricsByTid.get(tid);
    const executedSoFar = this.executedByTid.get(tid) ?? 0;
    const firstRunTime = this.firstRunTimeByTid.get(tid);
    const completionTime = isDone
      ? traceMetric?.completionTime ?? this._inferCompletionTime(tid, executedSoFar)
      : null;
    const turnaroundTime = completionTime === null || !thread
      ? null
      : completionTime - thread.arrivalTime;
    const waitingTime = turnaroundTime === null || !thread
      ? null
      : turnaroundTime - thread.burstTime;
    const responseTime = firstRunTime === undefined || !thread
      ? null
      : firstRunTime - thread.arrivalTime;

    return {
      tid,
      pid: thread ? thread.pid : traceMetric?.pid ?? null,
      arrivalTime: thread ? thread.arrivalTime : null,
      burstTime: thread ? thread.burstTime : null,
      executedSoFar,
      firstRunTime: firstRunTime ?? null,
      completionTime,
      turnaroundTime,
      waitingTime,
      responseTime,
      finishedAtSimMs: completionTime === null ? null : completionTime * this.simSpeedMs,
      finishedAtWallMs: isDone ? this._elapsedActiveWallMs() : null,
    };
  }

  _inferCompletionTime(tid, executedSoFar) {
    let count = 0;
    for (const entry of this.trace.timeline) {
      if (this._entryRunningTids(entry).includes(tid)) {
        count += 1;
        if (count >= executedSoFar) return entry.time + 1;
      }
    }
    return this.simTime;
  }

  _collectMetrics() {
    return this.threads.map(thread => {
      if (this.metricsByTid.has(thread.tid)) {
        return this.metricsByTid.get(thread.tid);
      }
      return this._buildMetric(thread.tid, this.finishedTids.has(thread.tid));
    });
  }

  _totalSimElapsedMs(metrics) {
    const completionTimes = metrics
      .map(metric => metric.completionTime)
      .filter(value => typeof value === 'number' && Number.isFinite(value));
    const totalTicks = completionTimes.length > 0
      ? Math.max(...completionTimes)
      : this.simTime;
    return totalTicks * this.simSpeedMs;
  }

  _elapsedActiveWallMs() {
    if (this.startedAtWallMs === 0) return 0;
    const pausedNow = this.paused && this.pausedAtWallMs > 0
      ? nowMs() - this.pausedAtWallMs
      : 0;
    return nowMs() - this.startedAtWallMs - this.totalPausedWallMs - pausedNow;
  }

  _emitCoreUpdate(coreStates) {
    const snapshot = coreStates.map(state => state ? { ...state } : null);
    for (const cb of this.coreUpdateCallbacks) {
      try {
        cb(snapshot.map(state => state ? { ...state } : null));
      } catch (error) {
        this._emitError(error);
      }
    }
  }

  _emitThreadDone(tid, metrics) {
    for (const cb of this.threadDoneCallbacks) {
      try {
        cb(tid, metrics);
      } catch (error) {
        this._emitError(error);
      }
    }
  }

  _emitComplete(allMetrics, totalSimMs) {
    for (const cb of this.completeCallbacks) {
      try {
        cb(allMetrics, totalSimMs);
      } catch (error) {
        this._emitError(error);
      }
    }
  }

  _emitError(error) {
    for (const cb of this.errorCallbacks) {
      try {
        cb(error);
      } catch (_) {
        // Avoid recursive callback failures.
      }
    }
  }
}

export default Dispatcher;

// threads-execution.test.js - Dispatcher integration coverage for Threads.
// Run with: node tests/integration/threads-execution.test.js

import { Dispatcher } from '../../engine/dispatcher.js';
import { runFCFS } from '../../engine/scheduling-fcfs.js';
import { runSJF } from '../../engine/scheduling-sjf.js';
import { runHRRN } from '../../engine/scheduling-hrrn.js';
import { runRoundRobin } from '../../engine/scheduling-rr.js';
import { runSRTF } from '../../engine/scheduling-srtf.js';
import { runPriorityPreemptive } from '../../engine/scheduling-priority.js';
import { runMLQ } from '../../engine/scheduling-mlq.js';
import { runMLFQ } from '../../engine/scheduling-mlfq.js';
import { expandToThreads, generateThreadTrace } from '../../engine/thread-utils.js';
import {
  getProcessTable,
  setProcessTable,
  simulatedFork,
  writeProcessPage,
} from '../../engine/process-model.js';

const SIM_SPEED_MS = 2;
const METRIC_TOLERANCE_PCT = 10;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed += 1;
  } else {
    console.log(`  pass: ${message}`);
    passed += 1;
  }
}

function assertEq(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

function assertLessThan(actual, expected, message) {
  assert(actual < expected, `${message} (expected ${actual} < ${expected})`);
}

function pctDiff(actual, expected) {
  if (expected === 0) return actual === 0 ? 0 : Infinity;
  return Math.abs(actual - expected) / Math.abs(expected) * 100;
}

function assertMetricWithin(actual, expected, field, label) {
  const diff = pctDiff(actual[field], expected[field]);
  assert(
    diff <= METRIC_TOLERANCE_PCT,
    `${label} ${field} within ${METRIC_TOLERANCE_PCT}% (expected ${expected[field]}, got ${actual[field]}, diff ${diff.toFixed(2)}%)`
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function totalTimeFromMetrics(metrics) {
  return Math.max(0, ...metrics.map(metric => metric.completionTime || 0));
}

function metricMap(metrics) {
  return new Map(metrics.map(metric => [metric.tid, metric]));
}

function cowEntries(process, pageNumber) {
  return (process.memory?.cowPages || []).filter(entry => entry.pageNumber === pageNumber);
}

class TestWorker {
  static activeCount = 0;
  static createdCount = 0;
  static terminatedCount = 0;
  static maxActiveCount = 0;

  static resetStats() {
    TestWorker.activeCount = 0;
    TestWorker.createdCount = 0;
    TestWorker.terminatedCount = 0;
    TestWorker.maxActiveCount = 0;
  }

  constructor() {
    TestWorker.activeCount += 1;
    TestWorker.createdCount += 1;
    TestWorker.maxActiveCount = Math.max(TestWorker.maxActiveCount, TestWorker.activeCount);

    this.onmessage = null;
    this.onerror = null;
    this.tid = null;
    this.pid = null;
    this.remainingBurst = 0;
    this.executedSoFar = 0;
    this.simSpeedMs = SIM_SPEED_MS;
    this.isRunning = false;
    this.timerId = null;
    this.terminated = false;
  }

  postMessage(message) {
    if (this.terminated) return;

    switch (message?.type) {
      case 'init':
        this._handleInit(message);
        break;
      case 'run':
        this._handleRun();
        break;
      case 'preempt':
        this._handlePreempt();
        break;
      case 'terminate':
        this.terminate();
        break;
      default:
        this._emit({ type: 'error', tid: this.tid, error: 'unknown message type' });
        break;
    }
  }

  terminate() {
    if (this.terminated) return;
    this.terminated = true;
    this.isRunning = false;
    this._clearTimer();
    TestWorker.activeCount -= 1;
    TestWorker.terminatedCount += 1;
  }

  _handleInit(message) {
    this._clearTimer();
    this.tid = message.tid;
    this.pid = message.pid;
    this.remainingBurst = Number(message.totalBurst);
    this.executedSoFar = 0;
    this.simSpeedMs = Math.max(0, Number(message.simSpeedMs) || SIM_SPEED_MS);
    this.isRunning = false;
    this._emit({ type: 'ready', tid: this.tid });
  }

  _handleRun() {
    if (this.isRunning || this.remainingBurst <= 0) return;
    this.isRunning = true;
    this._scheduleNextTick();
  }

  _handlePreempt() {
    this.isRunning = false;
    this._clearTimer();
    this._emit({ type: 'preempted', tid: this.tid, remainingBurst: this.remainingBurst });
  }

  _scheduleNextTick() {
    this._clearTimer();
    if (!this.isRunning || this.remainingBurst <= 0 || this.terminated) return;

    this.timerId = setTimeout(() => {
      this.timerId = null;
      if (!this.isRunning || this.remainingBurst <= 0 || this.terminated) return;

      this.remainingBurst -= 1;
      this.executedSoFar += 1;
      this._emit({
        type: 'tick',
        tid: this.tid,
        remainingBurst: this.remainingBurst,
        executedSoFar: this.executedSoFar,
      });

      if (this.remainingBurst === 0) {
        this.isRunning = false;
        this._emit({ type: 'done', tid: this.tid, executedSoFar: this.executedSoFar });
        return;
      }

      this._scheduleNextTick();
    }, this.simSpeedMs);
  }

  _clearTimer() {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  _emit(message) {
    queueMicrotask(() => {
      if (!this.terminated && typeof this.onmessage === 'function') {
        this.onmessage({ data: message });
      }
    });
  }
}

globalThis.Worker = TestWorker;

const C1 = [
  {
    pid: 1, arrivalTime: 0, burstTime: 8, priority: 2,
    sharedPages: 3, numPages: 5,
    threads: [
      { tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 2, state: 'NEW', remainingTime: 5, stackPages: 1 },
      { tid: 2, parentPid: 1, arrivalTime: 0, burstTime: 3, priority: 2, state: 'NEW', remainingTime: 3, stackPages: 1 },
    ],
  },
  {
    pid: 2, arrivalTime: 1, burstTime: 4, priority: 1,
    sharedPages: 3, numPages: 4,
    threads: [
      { tid: 3, parentPid: 2, arrivalTime: 1, burstTime: 4, priority: 1, state: 'NEW', remainingTime: 4, stackPages: 1 },
    ],
  },
  {
    pid: 3, arrivalTime: 3, burstTime: 7, priority: 3,
    sharedPages: 4, numPages: 8,
    threads: [
      { tid: 4, parentPid: 3, arrivalTime: 3, burstTime: 2, priority: 3, state: 'NEW', remainingTime: 2, stackPages: 1 },
      { tid: 5, parentPid: 3, arrivalTime: 4, burstTime: 3, priority: 3, state: 'NEW', remainingTime: 3, stackPages: 2 },
      { tid: 6, parentPid: 3, arrivalTime: 5, burstTime: 2, priority: 3, state: 'NEW', remainingTime: 2, stackPages: 1 },
    ],
  },
];

const APPENDIX_C_CASES = [
  {
    name: 'Appendix C.2 FCFS',
    algorithm: 'FCFS',
    quantum: 2,
    expectedTrace: processes => runFCFS(processes),
  },
  {
    name: 'Appendix C.3 RR q=2',
    algorithm: 'RR',
    quantum: 2,
    expectedTrace: processes => runRoundRobin(processes, 2),
  },
];

const MULTICORE_ALGORITHMS = [
  { name: 'FCFS', algorithm: 'FCFS', quantum: 2, expectedTrace: processes => runFCFS(processes) },
  { name: 'SJF', algorithm: 'SJF', quantum: 2, expectedTrace: processes => runSJF(processes) },
  { name: 'HRRN', algorithm: 'HRRN', quantum: 2, expectedTrace: processes => runHRRN(processes) },
  { name: 'RR q=2', algorithm: 'RR', quantum: 2, expectedTrace: processes => runRoundRobin(processes, 2) },
  { name: 'SRTF', algorithm: 'SRTF', quantum: 2, expectedTrace: processes => runSRTF(processes) },
  {
    name: 'Priority preemptive',
    algorithm: 'PRIORITY_PREEMPTIVE',
    quantum: 2,
    expectedTrace: processes => runPriorityPreemptive(processes),
  },
];

async function executeDispatcher(processes, {
  algorithm,
  numCores,
  quantum = 2,
  timeoutMs = 5000,
} = {}) {
  TestWorker.resetStats();

  const dispatcher = new Dispatcher({
    processes: clone(processes),
    numCores,
    algorithm,
    quantum,
    simSpeedMs: SIM_SPEED_MS,
  });

  const coreUpdates = [];
  const doneEvents = [];

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      dispatcher.stop();
      reject(new Error(`${algorithm}/${numCores} cores timed out`));
    }, timeoutMs);

    dispatcher
      .onCoreUpdate(coreStates => {
        coreUpdates.push(coreStates.map(state => state ? { ...state } : null));
      })
      .onThreadDone((tid, metrics) => {
        doneEvents.push({ tid, metrics: { ...metrics } });
      })
      .onComplete((metrics, totalSimMs) => {
        clearTimeout(timeout);
        resolve({
          metrics: metrics.map(metric => ({ ...metric })),
          totalSimMs,
          coreUpdates,
          doneEvents,
          trace: dispatcher.trace,
          effectiveNumCores: dispatcher.numCores,
          workerPoolSize: dispatcher.workerPool.size,
          workerStats: {
            active: TestWorker.activeCount,
            created: TestWorker.createdCount,
            terminated: TestWorker.terminatedCount,
            maxActive: TestWorker.maxActiveCount,
          },
        });
      })
      .onError(error => {
        clearTimeout(timeout);
        reject(error);
      });

    dispatcher.start();
  });
}

function assertNoLostThreads(result, processes, label) {
  const expectedTids = expandToThreads(processes).map(entity => entity.tid).sort((a, b) => a - b);
  const observedTids = result.metrics.map(metric => metric.tid).sort((a, b) => a - b);
  const doneTids = result.doneEvents.map(event => event.tid).sort((a, b) => a - b);
  const validTidSet = new Set(expectedTids);

  assertEq(observedTids.join(','), expectedTids.join(','), `${label}: all thread metrics present`);
  assertEq(doneTids.join(','), expectedTids.join(','), `${label}: exactly one done event per thread`);
  assert(
    result.metrics.every(metric => Number.isFinite(metric.completionTime)),
    `${label}: all threads have finite completionTime`
  );

  const invalidCoreState = result.coreUpdates
    .flat()
    .filter(Boolean)
    .find(state => !validTidSet.has(state.tid));
  assert(!invalidCoreState, `${label}: no invalid tid in core updates`);

  const expectedPids = new Set(processes.map(process => process.pid));
  const observedPids = new Set(result.metrics.map(metric => metric.pid));
  assertEq(observedPids.size, expectedPids.size, `${label}: no process lost`);
  for (const pid of expectedPids) {
    assert(observedPids.has(pid), `${label}: P${pid} completed`);
  }
}

function compareThreadMetrics(observedMetrics, expectedMetrics, label) {
  const observedByTid = metricMap(observedMetrics);
  for (const expected of expectedMetrics) {
    const observed = observedByTid.get(expected.tid);
    assert(Boolean(observed), `${label}: observed metrics include tid=${expected.tid}`);
    if (!observed) continue;

    assertMetricWithin(observed, expected, 'completionTime', `${label} tid=${expected.tid}`);
    assertMetricWithin(observed, expected, 'turnaroundTime', `${label} tid=${expected.tid}`);
    assertMetricWithin(observed, expected, 'waitingTime', `${label} tid=${expected.tid}`);
    assertMetricWithin(observed, expected, 'responseTime', `${label} tid=${expected.tid}`);
  }
}

async function testAppendixCSingleCore() {
  console.log('\n=== Appendix C on Threads/Dispatcher, numCores=1 ===');

  for (const testCase of APPENDIX_C_CASES) {
    const expected = testCase.expectedTrace(clone(C1));
    const observed = await executeDispatcher(C1, {
      algorithm: testCase.algorithm,
      numCores: 1,
      quantum: testCase.quantum,
    });

    compareThreadMetrics(observed.metrics, expected.threadMetrics, testCase.name);
    assertNoLostThreads(observed, C1, testCase.name);
    assertEq(observed.workerPoolSize, 0, `${testCase.name}: worker pool cleaned after completion`);
    assertEq(observed.workerStats.active, 0, `${testCase.name}: no active worker leaks`);
  }

  const expectedP3 = generateThreadTrace(clone(C1), 3, { algorithm: 'FCFS' });
  const observedFcfs = await executeDispatcher(C1, {
    algorithm: 'FCFS',
    numCores: 1,
    quantum: 2,
  });
  compareThreadMetrics(
    observedFcfs.metrics.filter(metric => metric.pid === 3),
    expectedP3.threadMetrics,
    'Appendix C.4 P3 FCFS thread trace'
  );
}

async function testAppendixCMultiCore() {
  console.log('\n=== Appendix C, numCores=2 and numCores=4 ===');

  for (const testCase of APPENDIX_C_CASES) {
    const singleCore = await executeDispatcher(C1, {
      algorithm: testCase.algorithm,
      numCores: 1,
      quantum: testCase.quantum,
    });
    const singleTime = totalTimeFromMetrics(singleCore.metrics);

    for (const numCores of [2, 4]) {
      const observed = await executeDispatcher(C1, {
        algorithm: testCase.algorithm,
        numCores,
        quantum: testCase.quantum,
      });
      const totalTime = totalTimeFromMetrics(observed.metrics);

      assertNoLostThreads(observed, C1, `${testCase.name}/${numCores} cores`);
      assertLessThan(totalTime, singleTime, `${testCase.name}: total time improves with ${numCores} cores`);
      assertEq(observed.workerStats.active, 0, `${testCase.name}/${numCores}: no active worker leaks`);
      assertEq(observed.workerPoolSize, 0, `${testCase.name}/${numCores}: worker pool cleaned`);
    }
  }
}

async function testMultiCoreAlgorithms() {
  console.log('\n=== Multi-core algorithm coverage ===');

  for (const item of MULTICORE_ALGORITHMS) {
    const expected = item.expectedTrace(clone(C1));
    const observedOneCore = await executeDispatcher(C1, {
      algorithm: item.algorithm,
      numCores: 1,
      quantum: item.quantum,
    });
    compareThreadMetrics(observedOneCore.metrics, expected.threadMetrics, `${item.name}/1 core`);

    const singleTime = totalTimeFromMetrics(observedOneCore.metrics);
    for (const numCores of [2, 4]) {
      const observed = await executeDispatcher(C1, {
        algorithm: item.algorithm,
        numCores,
        quantum: item.quantum,
      });
      assertNoLostThreads(observed, C1, `${item.name}/${numCores} cores`);
      assertLessThan(totalTimeFromMetrics(observed.metrics), singleTime, `${item.name}: ${numCores} cores faster than 1 core`);
      assertEq(observed.effectiveNumCores, numCores, `${item.name}: Dispatcher uses requested ${numCores} cores`);
      assertEq(observed.workerStats.active, 0, `${item.name}/${numCores}: no active worker leaks`);
    }
  }
}

async function testForkAndCow() {
  console.log('\n=== Fork + COW integration ===');

  const parent = [{
    pid: 1,
    arrivalTime: 0,
    burstTime: 5,
    priority: 1,
    sharedPages: 2,
    numPages: 3,
    threads: [
      { tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 1, state: 'NEW', remainingTime: 5, stackPages: 1 },
    ],
  }];

  setProcessTable(clone(parent));
  const child = simulatedFork(1);
  const processes = getProcessTable();

  assertEq(processes.length, 2, 'fork creates child process');
  assertEq(child.forkParentPid, 1, 'child records parent pid');
  assertEq(child.burstTime, 5, 'child inherits burst');
  assertEq(child.priority, 1, 'child inherits priority');
  assertEq(child.threads.length, 1, 'child is schedulable with one thread');
  assertEq(child.threads[0].parentPid, child.pid, 'child thread parentPid points to child');
  assertEq(cowEntries(processes[0], 0).length, 1, 'parent page 0 is COW');
  assertEq(cowEntries(child, 0).length, 1, 'child page 0 is COW');

  const observed = await executeDispatcher(processes, {
    algorithm: 'FCFS',
    numCores: 2,
    quantum: 2,
  });
  assertNoLostThreads(observed, processes, 'fork FCFS/2 cores');
  assertLessThan(totalTimeFromMetrics(observed.metrics), 10, 'parent and child run in parallel on 2 cores');

  const parallelUpdate = observed.coreUpdates.find(coreStates => {
    const pids = coreStates.filter(Boolean).map(state => state.pid);
    return pids.includes(1) && pids.includes(child.pid);
  });
  assert(Boolean(parallelUpdate), 'parent and child appear RUNNING simultaneously');

  const cowWrite = writeProcessPage(processes, child.pid, 0);
  assertEq(cowWrite.duplicated, true, 'writing child COW page duplicates the page');
  assertEq(cowEntries(processes[0], 0).length, 0, 'parent page 0 loses COW indicator after copy');
  assertEq(cowEntries(child, 0).length, 0, 'child page 0 loses COW indicator after copy');
  assertEq(cowEntries(processes[0], 1).length, 1, 'unwritten parent page remains COW');
  assertEq(cowEntries(child, 1).length, 1, 'unwritten child page remains COW');

  const normalWrite = writeProcessPage(processes, child.pid, 0);
  assertEq(normalWrite.duplicated, false, 'writing non-COW page does not duplicate');
  assertEq(child.memory.pageVersions[0], 2, 'non-COW write updates page content version');
}

async function testStressRoundRobin() {
  console.log('\n=== Stress RR(q=1), 10 processes, 4 cores ===');

  const bursts = [5, 1, 8, 3, 7, 2, 6, 4, 9, 5];
  const processes = bursts.map((burst, index) => {
    const pid = index + 1;
    return {
      pid,
      arrivalTime: index % 4,
      burstTime: burst,
      priority: (index % 3) + 1,
      sharedPages: 2,
      numPages: 3,
      threads: [
        {
          tid: pid,
          parentPid: pid,
          arrivalTime: index % 4,
          burstTime: burst,
          priority: (index % 3) + 1,
          state: 'NEW',
          remainingTime: burst,
          stackPages: 1,
        },
      ],
    };
  });

  const observed = await executeDispatcher(processes, {
    algorithm: 'RR',
    numCores: 4,
    quantum: 1,
    timeoutMs: 8000,
  });
  const expectedThreads = expandToThreads(processes);

  assertNoLostThreads(observed, processes, 'stress RR/4 cores');
  assertEq(observed.workerStats.created, expectedThreads.length, 'stress: one worker per thread');
  assertEq(observed.workerStats.terminated, expectedThreads.length, 'stress: all workers terminated');
  assertEq(observed.workerStats.active, 0, 'stress: no active worker leaks');
  assertEq(observed.workerPoolSize, 0, 'stress: dispatcher worker pool empty');
}

function testSingleCoreOnlyWarnings() {
  console.log('\n=== MLQ/MLFQ single-core fallback ===');

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = message => warnings.push(String(message));
  try {
    const mlq = new Dispatcher({
      processes: clone(C1),
      algorithm: 'MLQ',
      numCores: 4,
      simSpeedMs: SIM_SPEED_MS,
    });
    const mlfq = new Dispatcher({
      processes: clone(C1),
      algorithm: 'MLFQ',
      numCores: 4,
      simSpeedMs: SIM_SPEED_MS,
    });

    assertEq(mlq.numCores, 1, 'MLQ requested with 4 cores falls back to single-core');
    assertEq(mlq.trace.config.numCores, 1, 'MLQ trace records effective single-core');
    assertEq(mlfq.numCores, 1, 'MLFQ requested with 4 cores falls back to single-core');
    assertEq(mlfq.trace.config.numCores, 1, 'MLFQ trace records effective single-core');
    assert(warnings.length >= 2, 'MLQ/MLFQ emit warning when multi-core is requested');
    assert(
      warnings.every(message => message.includes('single-core') || message.includes('single')),
      'MLQ/MLFQ warning declares single-core execution'
    );

    const mlqTrace = runMLQ(clone(C1), mlq.schedulingConfig);
    const mlfqTrace = runMLFQ(clone(C1), mlfq.schedulingConfig);
    assertEq(mlq.trace.threadMetrics.length, mlqTrace.threadMetrics.length, 'MLQ trace still completes all threads');
    assertEq(mlfq.trace.threadMetrics.length, mlfqTrace.threadMetrics.length, 'MLFQ trace still completes all threads');
  } finally {
    console.warn = originalWarn;
  }
}

async function main() {
  await testAppendixCSingleCore();
  await testAppendixCMultiCore();
  await testMultiCoreAlgorithms();
  await testForkAndCow();
  await testStressRoundRobin();
  testSingleCoreOnlyWarnings();

  console.log(`\n${'-'.repeat(50)}`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

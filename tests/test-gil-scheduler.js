// test-gil-scheduler.js - GIL serialization vs. real multi-core trace coverage.
// Run with: node tests/test-gil-scheduler.js

import { Dispatcher } from '../engine/dispatcher.js';
import { GIL_SWITCH_INTERVAL, runGILScheduler } from '../engine/gil-scheduler.js';

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

function assertApprox(actual, expected, tolerance, message) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message} (expected approx ${expected}, got ${actual})`
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeCpuBoundProcess(threadCount, burstTime = 50) {
  const threads = Array.from({ length: threadCount }, (_, index) => ({
    tid: index + 1,
    parentPid: 1,
    arrivalTime: 0,
    burstTime,
    priority: 1,
    state: 'NEW',
    remainingTime: burstTime,
    stackPages: 1,
  }));

  return [{
    pid: 1,
    arrivalTime: 0,
    burstTime: threads.reduce((sum, thread) => sum + thread.burstTime, 0),
    priority: 1,
    sharedPages: 1,
    numPages: 1 + threadCount,
    threads,
  }];
}

function countThreadStates(entry, state) {
  return (entry.threadStates || []).filter(threadState => threadState.state === state).length;
}

console.log('\n=== Python GIL: serialized CPU-bound threads ===');
{
  const processes = makeCpuBoundProcess(4, 50);
  const trace = runGILScheduler({ processes, numCores: 4 });
  const saturatedWindow = trace.timeline.slice(0, GIL_SWITCH_INTERVAL * 4);

  assertEq(saturatedWindow.length, GIL_SWITCH_INTERVAL * 4, 'saturated window has one full GIL rotation');

  for (const entry of saturatedWindow) {
    assertEq(countThreadStates(entry, 'RUNNING'), 1, `t=${entry.time}: exactly one thread RUNNING`);
    assertEq(countThreadStates(entry, 'WAITING_GIL'), 3, `t=${entry.time}: three threads WAITING_GIL`);
    assertEq(entry.coreUsage.filter(value => value > 0).length, 1, `t=${entry.time}: exactly one core active`);
  }
}

console.log('\n=== Python GIL: switch interval rotates token ===');
{
  const processes = makeCpuBoundProcess(4, 50);
  const trace = runGILScheduler({ processes, numCores: 4 });

  assertEq(trace.timeline[0].runningTid, 1, 't=0 starts with T1');
  assert(
    trace.timeline[GIL_SWITCH_INTERVAL].runningTid !== trace.timeline[0].runningTid,
    `t=${GIL_SWITCH_INTERVAL}: running thread changes after switch interval`
  );
  assertEq(trace.timeline[GIL_SWITCH_INTERVAL].runningTid, 2, `t=${GIL_SWITCH_INTERVAL}: token rotates to T2`);
}

console.log('\n=== Python GIL: total process usage is 1 / N cores ===');
{
  for (const numCores of [2, 4, 8]) {
    const processes = makeCpuBoundProcess(4, 40);
    const trace = runGILScheduler({ processes, numCores });
    assertApprox(
      trace.aggregateMetrics.totalProcessUsage,
      1 / numCores,
      0.05,
      `GIL totalProcessUsage approx 1/${numCores}`
    );
  }
}

console.log('\n=== JavaScript Workers mode: real multi-core trace can fill 4 cores ===');
{
  const processes = makeCpuBoundProcess(4, 20);
  const dispatcher = new Dispatcher({
    processes: clone(processes),
    numCores: 4,
    algorithm: 'FCFS',
    simSpeedMs: 1,
  });

  const fullParallelEntry = dispatcher.trace.timeline.find(entry => {
    const running = Array.isArray(entry.runningTids)
      ? entry.runningTids.filter(tid => tid !== null && tid !== undefined).length
      : 0;
    return running === 4;
  });

  assert(Boolean(fullParallelEntry), 'parallel trace has a tick with all 4 cores active');
  assertEq(
    dispatcher.trace.aggregateMetrics.cpuUtilization,
    100,
    'parallel 4 threads / 4 cores aggregate utilization is 100%'
  );
}

console.log(`\n${'-'.repeat(50)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

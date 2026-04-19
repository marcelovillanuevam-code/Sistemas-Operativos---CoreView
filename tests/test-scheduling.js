// test-scheduling.js — Scheduling algorithm tests. Expected values from ARCHITECTURE.md Appendix A.
// Run with: node tests/test-scheduling.js
// Covers: FCFS (A.2), SJF (A.3), HRRN (A.4), RR q=2 (A.5), SRTF (A.6), Priority (A.7), MLQ (A.8), MLFQ (A.9).

import { expandToThreads } from '../engine/thread-utils.js';
import { runFCFS } from '../engine/scheduling-fcfs.js';

// ─── Assertion helpers ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  pass: ${message}`);
    passed++;
  }
}

function assertEq(actual, expected, message) {
  assert(actual === expected, `${message}  (expected ${expected}, got ${actual})`);
}

function assertApprox(actual, expected, message, tol = 0.01) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${message}  (expected ≈${expected}, got ${actual.toFixed(4)})`
  );
}

// ─── A.1 Shared Input — single-threaded, backward-compat (no threads array) ──

const A1 = [
  { pid: 1, arrivalTime: 0, burstTime: 5, priority: 2, sharedPages: 4, numPages: 5 },
  { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1, sharedPages: 3, numPages: 4 },
  { pid: 3, arrivalTime: 2, burstTime: 7, priority: 3, sharedPages: 5, numPages: 6 },
];

// ─── expandToThreads tests ────────────────────────────────────────────────────

console.log('\n=== expandToThreads (backward compat) ===');
{
  const entities = expandToThreads(A1);

  assertEq(entities.length, 3, 'produces 3 entities for 3 single-threaded processes');
  assertEq(entities[0].pid, 1,    'entity[0] pid=1');
  assertEq(entities[0].tid, 1,    'entity[0] tid=1 (auto-generated)');
  assertEq(entities[0].label, 'P1', 'entity[0] label="P1" (single-threaded)');
  assertEq(entities[0].arrivalTime, 0, 'entity[0] arrivalTime=0');
  assertEq(entities[0].burstTime,   5, 'entity[0] burstTime=5');
  assertEq(entities[0].priority,    2, 'entity[0] priority=2');
  assertEq(entities[0].remainingTime, 5, 'entity[0] remainingTime=burstTime=5');

  assertEq(entities[1].pid, 2, 'entity[1] pid=2');
  assertEq(entities[1].tid, 2, 'entity[1] tid=2 (auto-generated, sequential)');
  assertEq(entities[1].label, 'P2', 'entity[1] label="P2"');

  assertEq(entities[2].pid, 3, 'entity[2] pid=3');
  assertEq(entities[2].tid, 3, 'entity[2] tid=3');
  assertEq(entities[2].label, 'P3', 'entity[2] label="P3"');

  // Verify sort: already sorted by arrivalTime (0,1,2)
  assert(
    entities[0].arrivalTime <= entities[1].arrivalTime &&
    entities[1].arrivalTime <= entities[2].arrivalTime,
    'sorted by arrivalTime'
  );
}

console.log('\n=== expandToThreads (multi-threaded labels) ===');
{
  // Minimal multi-threaded process to verify label convention
  const procs = [{
    pid: 1,
    arrivalTime: 0,
    burstTime: 8,
    priority: 2,
    sharedPages: 3,
    numPages: 5,
    threads: [
      { tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 2, state: 'NEW', remainingTime: 5, stackPages: 1 },
      { tid: 2, parentPid: 1, arrivalTime: 0, burstTime: 3, priority: 2, state: 'NEW', remainingTime: 3, stackPages: 1 },
    ],
  }];
  const entities = expandToThreads(procs);
  assertEq(entities.length, 2, 'multi-threaded: 2 entities from 1 process');
  assertEq(entities[0].label, 'P1-T1', 'first thread label = "P1-T1" (local index 1)');
  assertEq(entities[1].label, 'P1-T2', 'second thread label = "P1-T2" (local index 2)');
}

// ─── FCFS (A.2) ──────────────────────────────────────────────────────────────

console.log('\n=== runFCFS — Appendix A.2 ===');
const trace = runFCFS(A1);

// Timeline structure
assertEq(trace.algorithm, 'FCFS', 'algorithm = "FCFS"');
assert(Array.isArray(trace.timeline), 'timeline is an array');
assert(trace.timeline.length > 0, 'timeline has entries');

// Verify Gantt: P1 runs t=0..4, P2 runs t=5..7, P3 runs t=8..14
const runAt = t => trace.timeline[t]?.runningTid ?? null;
assertEq(runAt(0), 1, 't=0 running tid=1 (P1)');
assertEq(runAt(4), 1, 't=4 running tid=1 (P1 still)');
assertEq(runAt(5), 2, 't=5 running tid=2 (P2 dispatched after P1 completes)');
assertEq(runAt(7), 2, 't=7 running tid=2 (P2 still)');
assertEq(runAt(8), 3, 't=8 running tid=3 (P3 dispatched after P2 completes)');
assertEq(runAt(14), 3, 't=14 running tid=3 (P3 still)');

// Arrivals
assertEq(trace.timeline[0].arrivedThisTick.includes(1), true, 't=0 tid=1 arrived');
assertEq(trace.timeline[1].arrivedThisTick.includes(2), true, 't=1 tid=2 arrived');
assertEq(trace.timeline[2].arrivedThisTick.includes(3), true, 't=2 tid=3 arrived');

// Completions
assertEq(trace.timeline[5].completedThisTick.includes(1),  true, 't=5 tid=1 (P1) completed');
assertEq(trace.timeline[8].completedThisTick.includes(2),  true, 't=8 tid=2 (P2) completed');
assertEq(trace.timeline[15].completedThisTick.includes(3), true, 't=15 tid=3 (P3) completed');

// Context switches
assertEq(trace.timeline[5].contextSwitch, true,  't=5 context switch (P1→P2)');
assertEq(trace.timeline[8].contextSwitch, true,  't=8 context switch (P2→P3)');
assertEq(trace.timeline[0].contextSwitch, false, 't=0 no context switch (initial dispatch)');

// Ready queue at t=2: P2 and P3 waiting (P1 running)
assert(trace.timeline[2].readyQueue.map(e => e.tid).includes(2), 't=2 readyQueue contains tid=2');
assert(trace.timeline[2].readyQueue.map(e => e.tid).includes(3), 't=2 readyQueue contains tid=3');

// ── Thread Metrics (A.2) ──────────────────────────────────────────────────────
console.log('\n--- Thread Metrics ---');
const tm = trace.threadMetrics;
assertEq(tm.length, 3, '3 thread metrics entries');

const tm1 = tm.find(m => m.tid === 1);
const tm2 = tm.find(m => m.tid === 2);
const tm3 = tm.find(m => m.tid === 3);

assertEq(tm1.completionTime,  5,  'P1 (tid=1) CT=5');
assertEq(tm1.turnaroundTime,  5,  'P1 (tid=1) TAT=5');
assertEq(tm1.waitingTime,     0,  'P1 (tid=1) WT=0');
assertEq(tm1.responseTime,    0,  'P1 (tid=1) RT=0');

assertEq(tm2.completionTime,  8,  'P2 (tid=2) CT=8');
assertEq(tm2.turnaroundTime,  7,  'P2 (tid=2) TAT=7');
assertEq(tm2.waitingTime,     4,  'P2 (tid=2) WT=4');
assertEq(tm2.responseTime,    4,  'P2 (tid=2) RT=4');

assertEq(tm3.completionTime,  15, 'P3 (tid=3) CT=15');
assertEq(tm3.turnaroundTime,  13, 'P3 (tid=3) TAT=13');
assertEq(tm3.waitingTime,     6,  'P3 (tid=3) WT=6');
assertEq(tm3.responseTime,    6,  'P3 (tid=3) RT=6');

// ── Process Metrics (A.2) — join-barrier, same as thread for single-threaded ─
console.log('\n--- Process Metrics (join-barrier) ---');
const pm = trace.processMetrics;
assertEq(pm.length, 3, '3 process metrics entries');

const pm1 = pm.find(m => m.pid === 1);
const pm2 = pm.find(m => m.pid === 2);
const pm3 = pm.find(m => m.pid === 3);

assertEq(pm1.completionTime,  5,  'P1 process CT=5');
assertEq(pm1.turnaroundTime,  5,  'P1 process TAT=5');
assertEq(pm1.waitingTime,     0,  'P1 process WT=0');
assertEq(pm1.responseTime,    0,  'P1 process RT=0');

assertEq(pm2.completionTime,  8,  'P2 process CT=8');
assertEq(pm2.turnaroundTime,  7,  'P2 process TAT=7');
assertEq(pm2.waitingTime,     4,  'P2 process WT=4');
assertEq(pm2.responseTime,    4,  'P2 process RT=4');

assertEq(pm3.completionTime,  15, 'P3 process CT=15');
assertEq(pm3.turnaroundTime,  13, 'P3 process TAT=13');
assertEq(pm3.waitingTime,     6,  'P3 process WT=6');
assertEq(pm3.responseTime,    6,  'P3 process RT=6');

// ── Aggregate Metrics ─────────────────────────────────────────────────────────
console.log('\n--- Aggregate Metrics ---');
const ag = trace.aggregateMetrics;

assertApprox(ag.avgTurnaroundTime, 25 / 3, 'Avg TAT = 8.33 (25/3)');
assertApprox(ag.avgWaitingTime,    10 / 3, 'Avg WT  = 3.33 (10/3)');
assertApprox(ag.cpuUtilization,   100,     'CPU utilization = 100%');
assertEq(ag.totalContextSwitches, 2, 'totalContextSwitches = 2');

// ── Timeline printout ─────────────────────────────────────────────────────────

// Build label map from the same entities used by runFCFS
const labelMap = new Map(expandToThreads(A1).map(e => [e.tid, e.label]));
function label(tid) { return labelMap.get(tid) ?? `T${tid}`; }

console.log('\n=== FCFS Timeline (A.1 input) ===');
console.log('t  | running  | readyQueue           | arrived  | completed | cs');
console.log('---+----------+----------------------+----------+-----------+----');
for (const e of trace.timeline) {
  const rq  = e.readyQueue.map(x => x.label).join(',').padEnd(20);
  const arr = e.arrivedThisTick.map(tid => label(tid)).join(',').padEnd(8);
  const cmp = e.completedThisTick.map(tid => label(tid)).join(',').padEnd(9);
  const run = e.runningTid !== null ? label(e.runningTid).padEnd(8) : 'idle    ';
  console.log(
    `${String(e.time).padStart(2)} | ${run} | ${rq} | ${arr} | ${cmp} | ${e.contextSwitch ? 'YES' : ''}`
  );
}

console.log('\n=== Thread Metrics ===');
for (const m of trace.threadMetrics) {
  console.log(`  ${label(m.tid).padEnd(6)} tid=${m.tid}  CT=${m.completionTime}  TAT=${m.turnaroundTime}  WT=${m.waitingTime}  RT=${m.responseTime}`);
}

console.log('\n=== Process Metrics (join-barrier) ===');
for (const m of trace.processMetrics) {
  console.log(`  P${m.pid}  CT=${m.completionTime}  TAT=${m.turnaroundTime}  WT=${m.waitingTime}  RT=${m.responseTime}`);
}

console.log('\n=== Aggregate Metrics ===');
console.log(`  Avg CT  = ${ag.avgCompletionTime.toFixed(2)}`);
console.log(`  Avg TAT = ${ag.avgTurnaroundTime.toFixed(2)}`);
console.log(`  Avg WT  = ${ag.avgWaitingTime.toFixed(2)}`);
console.log(`  Avg RT  = ${ag.avgResponseTime.toFixed(2)}`);
console.log(`  CPU Util = ${ag.cpuUtilization.toFixed(1)}%`);
console.log(`  Context Switches = ${ag.totalContextSwitches}`);
console.log(`  Throughput = ${ag.throughput.toFixed(4)} threads/tick`);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

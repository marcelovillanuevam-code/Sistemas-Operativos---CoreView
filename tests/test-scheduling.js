// test-scheduling.js — Scheduling algorithm tests. Expected values from ARCHITECTURE.md Appendix A.
// Run with: node tests/test-scheduling.js
// Covers: FCFS (A.2), SJF (A.3), HRRN (A.4), RR q=2 (A.5), SRTF (A.6), Priority (A.7), MLQ (A.8), MLFQ (A.9).

import { expandToThreads } from '../engine/thread-utils.js';
import { runFCFS } from '../engine/scheduling-fcfs.js';
import { runSJF }  from '../engine/scheduling-sjf.js';
import { runHRRN } from '../engine/scheduling-hrrn.js';
import { runRoundRobin } from '../engine/scheduling-rr.js';
import { runSRTF } from '../engine/scheduling-srtf.js';
import { runPriorityPreemptive } from '../engine/scheduling-priority.js';
import { runMLQ }  from '../engine/scheduling-mlq.js';
import { runMLFQ } from '../engine/scheduling-mlfq.js';

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

// ─── SJF (A.3) — same Gantt as FCFS for A.1 input ────────────────────────────

console.log('\n=== runSJF — Appendix A.3 (A.1 input) ===');
{
  const t = runSJF(A1);

  assertEq(t.algorithm, 'SJF', 'algorithm = "SJF"');

  // Gantt: P1(0-5), P2(5-8), P3(8-15) — same as FCFS (P2 burst=3 < P3 burst=7)
  const runAt = i => t.timeline[i]?.runningTid ?? null;
  assertEq(runAt(0), 1, 'SJF A.3 t=0 running tid=1 (P1)');
  assertEq(runAt(4), 1, 'SJF A.3 t=4 running tid=1 (P1)');
  assertEq(runAt(5), 2, 'SJF A.3 t=5 running tid=2 (P2, burst=3 < P3 burst=7)');
  assertEq(runAt(7), 2, 'SJF A.3 t=7 running tid=2 (P2)');
  assertEq(runAt(8), 3, 'SJF A.3 t=8 running tid=3 (P3)');
  assertEq(runAt(14), 3, 'SJF A.3 t=14 running tid=3 (P3)');

  // Thread Metrics
  console.log('\n--- SJF Thread Metrics ---');
  const tm = t.threadMetrics;
  assertEq(tm.length, 3, 'SJF 3 thread metric entries');
  const tm1 = tm.find(m => m.tid === 1);
  const tm2 = tm.find(m => m.tid === 2);
  const tm3 = tm.find(m => m.tid === 3);
  assertEq(tm1.completionTime,  5,  'SJF P1 (tid=1) CT=5');
  assertEq(tm1.turnaroundTime,  5,  'SJF P1 (tid=1) TAT=5');
  assertEq(tm1.waitingTime,     0,  'SJF P1 (tid=1) WT=0');
  assertEq(tm1.responseTime,    0,  'SJF P1 (tid=1) RT=0');
  assertEq(tm2.completionTime,  8,  'SJF P2 (tid=2) CT=8');
  assertEq(tm2.turnaroundTime,  7,  'SJF P2 (tid=2) TAT=7');
  assertEq(tm2.waitingTime,     4,  'SJF P2 (tid=2) WT=4');
  assertEq(tm2.responseTime,    4,  'SJF P2 (tid=2) RT=4');
  assertEq(tm3.completionTime,  15, 'SJF P3 (tid=3) CT=15');
  assertEq(tm3.turnaroundTime,  13, 'SJF P3 (tid=3) TAT=13');
  assertEq(tm3.waitingTime,     6,  'SJF P3 (tid=3) WT=6');
  assertEq(tm3.responseTime,    6,  'SJF P3 (tid=3) RT=6');

  // Process Metrics (join-barrier, same as thread for single-threaded)
  console.log('\n--- SJF Process Metrics ---');
  const pm = t.processMetrics;
  assertEq(pm.length, 3, 'SJF 3 process metric entries');
  const pm1 = pm.find(m => m.pid === 1);
  const pm2 = pm.find(m => m.pid === 2);
  const pm3 = pm.find(m => m.pid === 3);
  assertEq(pm1.completionTime,  5,  'SJF P1 process CT=5');
  assertEq(pm1.turnaroundTime,  5,  'SJF P1 process TAT=5');
  assertEq(pm1.waitingTime,     0,  'SJF P1 process WT=0');
  assertEq(pm1.responseTime,    0,  'SJF P1 process RT=0');
  assertEq(pm2.completionTime,  8,  'SJF P2 process CT=8');
  assertEq(pm2.turnaroundTime,  7,  'SJF P2 process TAT=7');
  assertEq(pm2.waitingTime,     4,  'SJF P2 process WT=4');
  assertEq(pm2.responseTime,    4,  'SJF P2 process RT=4');
  assertEq(pm3.completionTime,  15, 'SJF P3 process CT=15');
  assertEq(pm3.turnaroundTime,  13, 'SJF P3 process TAT=13');
  assertEq(pm3.waitingTime,     6,  'SJF P3 process WT=6');
  assertEq(pm3.responseTime,    6,  'SJF P3 process RT=6');

  // Aggregate
  console.log('\n--- SJF Aggregate Metrics ---');
  assertApprox(t.aggregateMetrics.avgTurnaroundTime, 25 / 3, 'SJF Avg TAT = 8.33');
  assertApprox(t.aggregateMetrics.avgWaitingTime,    10 / 3, 'SJF Avg WT  = 3.33');
  assertApprox(t.aggregateMetrics.cpuUtilization,   100,     'SJF CPU util = 100%');
}

// ─── HRRN (A.4) — same Gantt as FCFS for A.1 input ──────────────────────────

console.log('\n=== runHRRN — Appendix A.4 (A.1 input) ===');
{
  const t = runHRRN(A1);

  assertEq(t.algorithm, 'HRRN', 'algorithm = "HRRN"');

  // At t=5: P2 RR=(4+3)/3=2.33, P3 RR=(3+7)/7=1.43 → P2 wins → same Gantt
  const runAt = i => t.timeline[i]?.runningTid ?? null;
  assertEq(runAt(0), 1, 'HRRN A.4 t=0 running tid=1 (P1)');
  assertEq(runAt(5), 2, 'HRRN A.4 t=5 running tid=2 (P2, RR=2.33 > P3 RR=1.43)');
  assertEq(runAt(8), 3, 'HRRN A.4 t=8 running tid=3 (P3)');

  // Thread Metrics
  console.log('\n--- HRRN Thread Metrics ---');
  const tm = t.threadMetrics;
  assertEq(tm.length, 3, 'HRRN 3 thread metric entries');
  const tm1 = tm.find(m => m.tid === 1);
  const tm2 = tm.find(m => m.tid === 2);
  const tm3 = tm.find(m => m.tid === 3);
  assertEq(tm1.completionTime,  5,  'HRRN P1 (tid=1) CT=5');
  assertEq(tm1.turnaroundTime,  5,  'HRRN P1 (tid=1) TAT=5');
  assertEq(tm1.waitingTime,     0,  'HRRN P1 (tid=1) WT=0');
  assertEq(tm1.responseTime,    0,  'HRRN P1 (tid=1) RT=0');
  assertEq(tm2.completionTime,  8,  'HRRN P2 (tid=2) CT=8');
  assertEq(tm2.turnaroundTime,  7,  'HRRN P2 (tid=2) TAT=7');
  assertEq(tm2.waitingTime,     4,  'HRRN P2 (tid=2) WT=4');
  assertEq(tm2.responseTime,    4,  'HRRN P2 (tid=2) RT=4');
  assertEq(tm3.completionTime,  15, 'HRRN P3 (tid=3) CT=15');
  assertEq(tm3.turnaroundTime,  13, 'HRRN P3 (tid=3) TAT=13');
  assertEq(tm3.waitingTime,     6,  'HRRN P3 (tid=3) WT=6');
  assertEq(tm3.responseTime,    6,  'HRRN P3 (tid=3) RT=6');

  // Process Metrics
  console.log('\n--- HRRN Process Metrics ---');
  const pm = t.processMetrics;
  assertEq(pm.length, 3, 'HRRN 3 process metric entries');
  const pm1 = pm.find(m => m.pid === 1);
  const pm2 = pm.find(m => m.pid === 2);
  const pm3 = pm.find(m => m.pid === 3);
  assertEq(pm1.completionTime,  5,  'HRRN P1 process CT=5');
  assertEq(pm1.turnaroundTime,  5,  'HRRN P1 process TAT=5');
  assertEq(pm1.waitingTime,     0,  'HRRN P1 process WT=0');
  assertEq(pm2.completionTime,  8,  'HRRN P2 process CT=8');
  assertEq(pm2.turnaroundTime,  7,  'HRRN P2 process TAT=7');
  assertEq(pm2.waitingTime,     4,  'HRRN P2 process WT=4');
  assertEq(pm3.completionTime,  15, 'HRRN P3 process CT=15');
  assertEq(pm3.turnaroundTime,  13, 'HRRN P3 process TAT=13');
  assertEq(pm3.waitingTime,     6,  'HRRN P3 process WT=6');

  // Aggregate
  console.log('\n--- HRRN Aggregate Metrics ---');
  assertApprox(t.aggregateMetrics.avgTurnaroundTime, 25 / 3, 'HRRN Avg TAT = 8.33');
  assertApprox(t.aggregateMetrics.avgWaitingTime,    10 / 3, 'HRRN Avg WT  = 3.33');
  assertApprox(t.aggregateMetrics.cpuUtilization,   100,     'HRRN CPU util = 100%');
}

// ─── SJF vs FCFS Differentiating Test Case ───────────────────────────────────
// P1: Arr=0, Burst=7 | P2: Arr=1, Burst=3 | P3: Arr=2, Burst=2
// SJF:  P1(0-7) → P3(7-9) → P2(9-12)   (P3 burst=2 < P2 burst=3)
// FCFS: P1(0-7) → P2(7-10) → P3(10-12) (FCFS picks earlier arrival P2)

const A_DIFF = [
  { pid: 1, arrivalTime: 0, burstTime: 7, priority: 2, sharedPages: 3, numPages: 4 },
  { pid: 2, arrivalTime: 1, burstTime: 3, priority: 2, sharedPages: 2, numPages: 3 },
  { pid: 3, arrivalTime: 2, burstTime: 2, priority: 2, sharedPages: 2, numPages: 3 },
];

console.log('\n=== SJF vs FCFS — Differentiating Input ===');
{
  const sjf  = runSJF(A_DIFF);
  const fcfs = runFCFS(A_DIFF);

  // SJF Gantt: P1(0-7), P3(7-9), P2(9-12)
  const sjfAt  = i => sjf.timeline[i]?.runningTid ?? null;
  // FCFS Gantt: P1(0-7), P2(7-10), P3(10-12)
  const fcfsAt = i => fcfs.timeline[i]?.runningTid ?? null;

  // Tids: auto-generated as 1=P1, 2=P2, 3=P3
  assertEq(sjfAt(7),  3, 'SJF  t=7  running P3 (tid=3, burst=2 < P2 burst=3)');
  assertEq(sjfAt(8),  3, 'SJF  t=8  running P3');
  assertEq(sjfAt(9),  2, 'SJF  t=9  running P2 (tid=2)');
  assertEq(sjfAt(11), 2, 'SJF  t=11 running P2');
  assertEq(fcfsAt(7),  2, 'FCFS t=7  running P2 (tid=2, arrived earlier)');
  assertEq(fcfsAt(9),  2, 'FCFS t=9  running P2');
  assertEq(fcfsAt(10), 3, 'FCFS t=10 running P3 (tid=3)');
  assertEq(fcfsAt(11), 3, 'FCFS t=11 running P3');

  // SJF Thread Metrics: P1 CT=7, P3 CT=9, P2 CT=12
  console.log('\n--- SJF Diff Thread Metrics ---');
  const stjm = sjf.threadMetrics;
  const stm1 = stjm.find(m => m.pid === 1);
  const stm2 = stjm.find(m => m.pid === 2);
  const stm3 = stjm.find(m => m.pid === 3);
  assertEq(stm1.completionTime,  7,  'SJF diff P1 CT=7');
  assertEq(stm1.turnaroundTime,  7,  'SJF diff P1 TAT=7');
  assertEq(stm1.waitingTime,     0,  'SJF diff P1 WT=0');
  assertEq(stm1.responseTime,    0,  'SJF diff P1 RT=0');
  assertEq(stm3.completionTime,  9,  'SJF diff P3 CT=9');
  assertEq(stm3.turnaroundTime,  7,  'SJF diff P3 TAT=9-2=7');
  assertEq(stm3.waitingTime,     5,  'SJF diff P3 WT=7-2=5');
  assertEq(stm3.responseTime,    5,  'SJF diff P3 RT=7-2=5');
  assertEq(stm2.completionTime,  12, 'SJF diff P2 CT=12');
  assertEq(stm2.turnaroundTime,  11, 'SJF diff P2 TAT=12-1=11');
  assertEq(stm2.waitingTime,     8,  'SJF diff P2 WT=11-3=8');
  assertEq(stm2.responseTime,    8,  'SJF diff P2 RT=9-1=8');

  // SJF Process Metrics = Thread Metrics (single-threaded)
  console.log('\n--- SJF Diff Process Metrics ---');
  const spm = sjf.processMetrics;
  const spm1 = spm.find(m => m.pid === 1);
  const spm2 = spm.find(m => m.pid === 2);
  const spm3 = spm.find(m => m.pid === 3);
  assertEq(spm1.completionTime, stm1.completionTime, 'SJF diff P1 process CT = thread CT');
  assertEq(spm1.turnaroundTime, stm1.turnaroundTime, 'SJF diff P1 process TAT = thread TAT');
  assertEq(spm1.waitingTime,    stm1.waitingTime,    'SJF diff P1 process WT = thread WT');
  assertEq(spm1.responseTime,   stm1.responseTime,   'SJF diff P1 process RT = thread RT');
  assertEq(spm2.completionTime, stm2.completionTime, 'SJF diff P2 process CT = thread CT');
  assertEq(spm2.turnaroundTime, stm2.turnaroundTime, 'SJF diff P2 process TAT = thread TAT');
  assertEq(spm2.waitingTime,    stm2.waitingTime,    'SJF diff P2 process WT = thread WT');
  assertEq(spm3.completionTime, stm3.completionTime, 'SJF diff P3 process CT = thread CT');
  assertEq(spm3.turnaroundTime, stm3.turnaroundTime, 'SJF diff P3 process TAT = thread TAT');
  assertEq(spm3.waitingTime,    stm3.waitingTime,    'SJF diff P3 process WT = thread WT');

  // FCFS Thread Metrics: P1 CT=7, P2 CT=10, P3 CT=12
  console.log('\n--- FCFS Diff Thread Metrics ---');
  const ftm = fcfs.threadMetrics;
  const ftm1 = ftm.find(m => m.pid === 1);
  const ftm2 = ftm.find(m => m.pid === 2);
  const ftm3 = ftm.find(m => m.pid === 3);
  assertEq(ftm1.completionTime,  7,  'FCFS diff P1 CT=7');
  assertEq(ftm2.completionTime,  10, 'FCFS diff P2 CT=10');
  assertEq(ftm2.turnaroundTime,  9,  'FCFS diff P2 TAT=10-1=9');
  assertEq(ftm2.waitingTime,     6,  'FCFS diff P2 WT=9-3=6');
  assertEq(ftm3.completionTime,  12, 'FCFS diff P3 CT=12');
  assertEq(ftm3.turnaroundTime,  10, 'FCFS diff P3 TAT=12-2=10');
  assertEq(ftm3.waitingTime,     8,  'FCFS diff P3 WT=10-2=8');

  // Verify the key difference: P2 and P3 swap order between algorithms
  assert(sjfAt(7) !== fcfsAt(7), 'SJF and FCFS pick different entities at t=7');
}

// ─── Round Robin q=2 (A.5) ───────────────────────────────────────────────────

console.log('\n=== runRoundRobin q=2 — Appendix A.5 ===');
{
  const t = runRoundRobin(A1, 2);

  assertEq(t.algorithm, 'RR', 'RR algorithm field');
  assertEq(t.config.quantum, 2, 'RR config.quantum=2');

  // Gantt: P1(0-2) | P2(2-4) | P3(4-6) | P1(6-8) | P2(8-9) | P3(9-11) | P1(11-12) | P3(12-15)
  const runAt = i => t.timeline[i]?.runningTid ?? null;
  assertEq(runAt(0),  1, 'RR q=2 t=0  running P1 (tid=1)');
  assertEq(runAt(1),  1, 'RR q=2 t=1  running P1 (still in quantum)');
  assertEq(runAt(2),  2, 'RR q=2 t=2  running P2 (P1 quantum expired)');
  assertEq(runAt(3),  2, 'RR q=2 t=3  running P2');
  assertEq(runAt(4),  3, 'RR q=2 t=4  running P3 (P2 quantum expired)');
  assertEq(runAt(5),  3, 'RR q=2 t=5  running P3');
  assertEq(runAt(6),  1, 'RR q=2 t=6  running P1 (P3 quantum expired)');
  assertEq(runAt(7),  1, 'RR q=2 t=7  running P1');
  assertEq(runAt(8),  2, 'RR q=2 t=8  running P2 (P1 quantum expired)');
  assertEq(runAt(9),  3, 'RR q=2 t=9  running P3 (P2 completed at t=9)');
  assertEq(runAt(10), 3, 'RR q=2 t=10 running P3');
  assertEq(runAt(11), 1, 'RR q=2 t=11 running P1 (P3 quantum expired)');
  assertEq(runAt(12), 3, 'RR q=2 t=12 running P3 (P1 completed at t=12)');

  // Completions
  assertEq(t.timeline[9].completedThisTick.includes(2),  true, 'RR q=2 t=9  P2 (tid=2) completed');
  assertEq(t.timeline[12].completedThisTick.includes(1), true, 'RR q=2 t=12 P1 (tid=1) completed');
  assertEq(t.timeline[15].completedThisTick.includes(3), true, 'RR q=2 t=15 P3 (tid=3) completed');

  // Context switches at quantum boundaries
  assertEq(t.timeline[2].contextSwitch,  true,  'RR q=2 t=2  cs (P1→P2)');
  assertEq(t.timeline[4].contextSwitch,  true,  'RR q=2 t=4  cs (P2→P3)');
  assertEq(t.timeline[6].contextSwitch,  true,  'RR q=2 t=6  cs (P3→P1)');
  assertEq(t.timeline[8].contextSwitch,  true,  'RR q=2 t=8  cs (P1→P2)');
  assertEq(t.timeline[9].contextSwitch,  true,  'RR q=2 t=9  cs (P2 done→P3)');
  assertEq(t.timeline[11].contextSwitch, true,  'RR q=2 t=11 cs (P3→P1)');
  assertEq(t.timeline[12].contextSwitch, true,  'RR q=2 t=12 cs (P1 done→P3)');
  assertEq(t.timeline[0].contextSwitch,  false, 'RR q=2 t=0  no cs (initial dispatch)');

  // Ready queue at t=2: P3 and P1 (P2 dispatched, P3 arrived, P1 preempted)
  const rq2 = t.timeline[2].readyQueue.map(e => e.tid);
  assert(rq2.includes(3), 'RR q=2 t=2 readyQueue contains P3 (tid=3)');
  assert(rq2.includes(1), 'RR q=2 t=2 readyQueue contains P1 (tid=1)');
  assertEq(rq2[0], 3, 'RR q=2 t=2 P3 is ahead of P1 in ready queue (arrived before preempted)');
  assertEq(rq2[1], 1, 'RR q=2 t=2 P1 is at back of ready queue (preempted)');

  // Thread Metrics (A.5)
  console.log('\n--- RR q=2 Thread Metrics ---');
  const tm = t.threadMetrics;
  assertEq(tm.length, 3, 'RR q=2 3 thread metrics');
  const tm1 = tm.find(m => m.tid === 1);
  const tm2 = tm.find(m => m.tid === 2);
  const tm3 = tm.find(m => m.tid === 3);
  assertEq(tm1.completionTime,  12, 'RR q=2 P1 CT=12');
  assertEq(tm1.turnaroundTime,  12, 'RR q=2 P1 TAT=12');
  assertEq(tm1.waitingTime,      7, 'RR q=2 P1 WT=7');
  assertEq(tm1.responseTime,     0, 'RR q=2 P1 RT=0');
  assertEq(tm2.completionTime,   9, 'RR q=2 P2 CT=9');
  assertEq(tm2.turnaroundTime,   8, 'RR q=2 P2 TAT=8');
  assertEq(tm2.waitingTime,      5, 'RR q=2 P2 WT=5');
  assertEq(tm2.responseTime,     1, 'RR q=2 P2 RT=1');
  assertEq(tm3.completionTime,  15, 'RR q=2 P3 CT=15');
  assertEq(tm3.turnaroundTime,  13, 'RR q=2 P3 TAT=13');
  assertEq(tm3.waitingTime,      6, 'RR q=2 P3 WT=6');
  assertEq(tm3.responseTime,     2, 'RR q=2 P3 RT=2');

  // Process Metrics (join-barrier, same as thread for single-threaded)
  console.log('\n--- RR q=2 Process Metrics ---');
  const pm = t.processMetrics;
  assertEq(pm.length, 3, 'RR q=2 3 process metrics');
  const pm1 = pm.find(m => m.pid === 1);
  const pm2 = pm.find(m => m.pid === 2);
  const pm3 = pm.find(m => m.pid === 3);
  assertEq(pm1.completionTime,  12, 'RR q=2 P1 process CT=12');
  assertEq(pm1.turnaroundTime,  12, 'RR q=2 P1 process TAT=12');
  assertEq(pm1.waitingTime,      7, 'RR q=2 P1 process WT=7');
  assertEq(pm1.responseTime,     0, 'RR q=2 P1 process RT=0');
  assertEq(pm2.completionTime,   9, 'RR q=2 P2 process CT=9');
  assertEq(pm2.turnaroundTime,   8, 'RR q=2 P2 process TAT=8');
  assertEq(pm2.waitingTime,      5, 'RR q=2 P2 process WT=5');
  assertEq(pm2.responseTime,     1, 'RR q=2 P2 process RT=1');
  assertEq(pm3.completionTime,  15, 'RR q=2 P3 process CT=15');
  assertEq(pm3.turnaroundTime,  13, 'RR q=2 P3 process TAT=13');
  assertEq(pm3.waitingTime,      6, 'RR q=2 P3 process WT=6');
  assertEq(pm3.responseTime,     2, 'RR q=2 P3 process RT=2');

  // Timeline printout
  const lm = new Map(expandToThreads(A1).map(e => [e.tid, e.label]));
  const lbl = tid => lm.get(tid) ?? `T${tid}`;
  console.log('\n=== RR q=2 Timeline ===');
  for (const e of t.timeline) {
    const rq  = e.readyQueue.map(x => x.label).join(',').padEnd(20);
    const run = e.runningTid !== null ? lbl(e.runningTid).padEnd(8) : 'idle    ';
    const arr = e.arrivedThisTick.map(tid => lbl(tid)).join(',').padEnd(6);
    const cmp = e.completedThisTick.map(tid => lbl(tid)).join(',').padEnd(6);
    console.log(`${String(e.time).padStart(2)} | ${run} | ${rq} | arr:${arr} | cmp:${cmp} | ${e.contextSwitch ? 'CS' : ''}`);
  }
}

// ─── Round Robin q=1 — sanity checks ─────────────────────────────────────────

console.log('\n=== runRoundRobin q=1 — sanity checks ===');
{
  const t = runRoundRobin(A1, 1);

  assertEq(t.algorithm, 'RR', 'RR q=1 algorithm field');
  assertEq(t.config.quantum, 1, 'RR q=1 config.quantum=1');
  assertEq(t.threadMetrics.length, 3, 'RR q=1 3 thread metrics');
  assertEq(t.processMetrics.length, 3, 'RR q=1 3 process metrics');

  // All entities must complete
  const allComplete = t.threadMetrics.every(m => m.completionTime > 0 && m.turnaroundTime > 0);
  assert(allComplete, 'RR q=1 all threads complete with positive CT/TAT');

  // CT of last completing entity must be 15 (same total work, no idle gaps)
  const maxCT = Math.max(...t.threadMetrics.map(m => m.completionTime));
  assertEq(maxCT, 15, 'RR q=1 last completion at t=15 (total burst=15)');

  // q=1 produces more context switches than q=2 (more preemptions)
  const rrQ2 = runRoundRobin(A1, 2);
  assert(
    t.aggregateMetrics.totalContextSwitches > rrQ2.aggregateMetrics.totalContextSwitches,
    'RR q=1 has more context switches than q=2'
  );

  // Verify metrics are self-consistent: WT = TAT - burstTime for each thread
  for (const m of t.threadMetrics) {
    const e = expandToThreads(A1).find(x => x.tid === m.tid);
    assertEq(m.waitingTime, m.turnaroundTime - e.burstTime, `RR q=1 WT=TAT-burst for tid=${m.tid}`);
  }

  // Known expected values for q=1 (manually verified):
  // P1: CT=11, TAT=11, WT=6, RT=0
  // P2: CT=8,  TAT=7,  WT=4, RT=0
  // P3: CT=15, TAT=13, WT=6, RT=1
  const tm1 = t.threadMetrics.find(m => m.tid === 1);
  const tm2 = t.threadMetrics.find(m => m.tid === 2);
  const tm3 = t.threadMetrics.find(m => m.tid === 3);
  assertEq(tm1.completionTime, 11, 'RR q=1 P1 CT=11');
  assertEq(tm1.waitingTime,     6, 'RR q=1 P1 WT=6');
  assertEq(tm1.responseTime,    0, 'RR q=1 P1 RT=0');
  assertEq(tm2.completionTime,  8, 'RR q=1 P2 CT=8');
  assertEq(tm2.waitingTime,     4, 'RR q=1 P2 WT=4');
  assertEq(tm2.responseTime,    0, 'RR q=1 P2 RT=0 (first ran at t=1, arr=1)');
  assertEq(tm3.completionTime, 15, 'RR q=1 P3 CT=15');
  assertEq(tm3.waitingTime,     6, 'RR q=1 P3 WT=6');
  assertEq(tm3.responseTime,    1, 'RR q=1 P3 RT=1 (first ran at t=3, arr=2)');
}

// ─── Round Robin q=4 — sanity checks ─────────────────────────────────────────

console.log('\n=== runRoundRobin q=4 — sanity checks ===');
{
  const t = runRoundRobin(A1, 4);

  assertEq(t.algorithm, 'RR', 'RR q=4 algorithm field');
  assertEq(t.config.quantum, 4, 'RR q=4 config.quantum=4');
  assertEq(t.threadMetrics.length, 3, 'RR q=4 3 thread metrics');

  // All must complete
  const maxCT = Math.max(...t.threadMetrics.map(m => m.completionTime));
  assertEq(maxCT, 15, 'RR q=4 last completion at t=15');

  // q=4 produces fewer context switches than q=2
  const rrQ2 = runRoundRobin(A1, 2);
  assert(
    t.aggregateMetrics.totalContextSwitches < rrQ2.aggregateMetrics.totalContextSwitches,
    'RR q=4 has fewer context switches than q=2'
  );

  // Self-consistency
  for (const m of t.threadMetrics) {
    const e = expandToThreads(A1).find(x => x.tid === m.tid);
    assertEq(m.waitingTime, m.turnaroundTime - e.burstTime, `RR q=4 WT=TAT-burst for tid=${m.tid}`);
  }

  // Known expected values for q=4:
  // P1: CT=12, TAT=12, WT=7, RT=0
  // P2: CT=7,  TAT=6,  WT=3, RT=1
  // P3: CT=15, TAT=13, WT=6, RT=2
  const tm1 = t.threadMetrics.find(m => m.tid === 1);
  const tm2 = t.threadMetrics.find(m => m.tid === 2);
  const tm3 = t.threadMetrics.find(m => m.tid === 3);
  assertEq(tm1.completionTime, 12, 'RR q=4 P1 CT=12');
  assertEq(tm1.waitingTime,     7, 'RR q=4 P1 WT=7');
  assertEq(tm1.responseTime,    0, 'RR q=4 P1 RT=0');
  assertEq(tm2.completionTime,  7, 'RR q=4 P2 CT=7');
  assertEq(tm2.waitingTime,     3, 'RR q=4 P2 WT=3');
  assertEq(tm2.responseTime,    3, 'RR q=4 P2 RT=3 (P1 held CPU until t=4 before P2 ran)');
  assertEq(tm3.completionTime, 15, 'RR q=4 P3 CT=15');
  assertEq(tm3.waitingTime,     6, 'RR q=4 P3 WT=6');
  assertEq(tm3.responseTime,    5, 'RR q=4 P3 RT=5 (first ran at t=7 after P2 completed)');
}

// ─── SRTF (A.6) ──────────────────────────────────────────────────────────────

console.log('\n=== runSRTF — Appendix A.6 ===');
{
  const t = runSRTF(A1);

  assertEq(t.algorithm, 'SRTF', 'SRTF algorithm field');

  // Gantt: P1(0-1) | P2(1-4) | P1(4-8) | P3(8-15)
  const runAt = i => t.timeline[i]?.runningTid ?? null;
  assertEq(runAt(0), 1, 'SRTF t=0  running P1 (tid=1)');
  assertEq(runAt(1), 2, 'SRTF t=1  running P2 (tid=2, burst=3 preempts P1 rem=4)');
  assertEq(runAt(2), 2, 'SRTF t=2  running P2 (P3 arrives but rem=7 > P2 rem=2)');
  assertEq(runAt(3), 2, 'SRTF t=3  running P2');
  assertEq(runAt(4), 1, 'SRTF t=4  running P1 (P2 completed, P1 rem=4 < P3 rem=7)');
  assertEq(runAt(5), 1, 'SRTF t=5  running P1');
  assertEq(runAt(6), 1, 'SRTF t=6  running P1');
  assertEq(runAt(7), 1, 'SRTF t=7  running P1');
  assertEq(runAt(8), 3, 'SRTF t=8  running P3 (tid=3, P1 completed)');
  assertEq(runAt(14), 3, 'SRTF t=14 running P3');

  // Preemption at t=1: context switch P1→P2
  assertEq(t.timeline[1].contextSwitch, true,  'SRTF t=1  cs (P2 preempts P1)');
  assertEq(t.timeline[0].contextSwitch, false, 'SRTF t=0  no cs (initial dispatch)');
  assertEq(t.timeline[4].contextSwitch, true,  'SRTF t=4  cs (P1 resumes after P2 completes)');
  assertEq(t.timeline[8].contextSwitch, true,  'SRTF t=8  cs (P3 starts after P1 completes)');

  // P3 arrives at t=2 but does NOT preempt P2 (rem=7 > P2 rem=2)
  assertEq(t.timeline[2].runningTid, 2, 'SRTF t=2  P2 still running (P3 no preempt)');

  // Completions
  assertEq(t.timeline[4].completedThisTick.includes(2),  true, 'SRTF t=4  P2 (tid=2) completed');
  assertEq(t.timeline[8].completedThisTick.includes(1),  true, 'SRTF t=8  P1 (tid=1) completed');
  assertEq(t.timeline[15].completedThisTick.includes(3), true, 'SRTF t=15 P3 (tid=3) completed');

  // P1 is in ready queue at t=1 (preempted, waiting)
  assert(t.timeline[1].readyQueue.map(e => e.tid).includes(1), 'SRTF t=1 readyQueue contains P1');

  // Thread Metrics (A.6)
  console.log('\n--- SRTF Thread Metrics ---');
  const tm = t.threadMetrics;
  assertEq(tm.length, 3, 'SRTF 3 thread metrics');
  const tm1 = tm.find(m => m.tid === 1);
  const tm2 = tm.find(m => m.tid === 2);
  const tm3 = tm.find(m => m.tid === 3);
  assertEq(tm1.completionTime,  8,  'SRTF P1 CT=8');
  assertEq(tm1.turnaroundTime,  8,  'SRTF P1 TAT=8');
  assertEq(tm1.waitingTime,     3,  'SRTF P1 WT=3');
  assertEq(tm1.responseTime,    0,  'SRTF P1 RT=0');
  assertEq(tm2.completionTime,  4,  'SRTF P2 CT=4');
  assertEq(tm2.turnaroundTime,  3,  'SRTF P2 TAT=3');
  assertEq(tm2.waitingTime,     0,  'SRTF P2 WT=0');
  assertEq(tm2.responseTime,    0,  'SRTF P2 RT=0');
  assertEq(tm3.completionTime,  15, 'SRTF P3 CT=15');
  assertEq(tm3.turnaroundTime,  13, 'SRTF P3 TAT=13');
  assertEq(tm3.waitingTime,     6,  'SRTF P3 WT=6');
  assertEq(tm3.responseTime,    6,  'SRTF P3 RT=6');

  // Process Metrics (join-barrier, same as thread for single-threaded)
  console.log('\n--- SRTF Process Metrics ---');
  const pm = t.processMetrics;
  assertEq(pm.length, 3, 'SRTF 3 process metrics');
  const pm1 = pm.find(m => m.pid === 1);
  const pm2 = pm.find(m => m.pid === 2);
  const pm3 = pm.find(m => m.pid === 3);
  assertEq(pm1.completionTime,  8,  'SRTF P1 process CT=8');
  assertEq(pm1.turnaroundTime,  8,  'SRTF P1 process TAT=8');
  assertEq(pm1.waitingTime,     3,  'SRTF P1 process WT=3');
  assertEq(pm1.responseTime,    0,  'SRTF P1 process RT=0');
  assertEq(pm2.completionTime,  4,  'SRTF P2 process CT=4');
  assertEq(pm2.turnaroundTime,  3,  'SRTF P2 process TAT=3');
  assertEq(pm2.waitingTime,     0,  'SRTF P2 process WT=0');
  assertEq(pm2.responseTime,    0,  'SRTF P2 process RT=0');
  assertEq(pm3.completionTime,  15, 'SRTF P3 process CT=15');
  assertEq(pm3.turnaroundTime,  13, 'SRTF P3 process TAT=13');
  assertEq(pm3.waitingTime,     6,  'SRTF P3 process WT=6');
  assertEq(pm3.responseTime,    6,  'SRTF P3 process RT=6');

  // Aggregate
  console.log('\n--- SRTF Aggregate Metrics ---');
  assertApprox(t.aggregateMetrics.avgTurnaroundTime, (8 + 3 + 13) / 3, 'SRTF Avg TAT = 8.0');
  assertApprox(t.aggregateMetrics.avgWaitingTime,    (3 + 0 + 6)  / 3, 'SRTF Avg WT  = 3.0');
  assertApprox(t.aggregateMetrics.cpuUtilization,    100,               'SRTF CPU util = 100%');
  assertEq(t.aggregateMetrics.totalContextSwitches, 3, 'SRTF totalContextSwitches=3');

  // Timeline printout
  const lm = new Map(expandToThreads(A1).map(e => [e.tid, e.label]));
  const lbl = tid => lm.get(tid) ?? `T${tid}`;
  console.log('\n=== SRTF Timeline ===');
  for (const e of t.timeline) {
    const rq  = e.readyQueue.map(x => x.label).join(',').padEnd(16);
    const run = e.runningTid !== null ? lbl(e.runningTid).padEnd(6) : 'idle  ';
    const arr = e.arrivedThisTick.map(tid => lbl(tid)).join(',').padEnd(4);
    const cmp = e.completedThisTick.map(tid => lbl(tid)).join(',').padEnd(4);
    console.log(`${String(e.time).padStart(2)} | ${run} | rq:[${rq}] | arr:${arr} | cmp:${cmp} | ${e.contextSwitch ? 'CS' : ''}`);
  }
}

// ─── Priority Preemptive (A.7) — A.1 input, same Gantt as SRTF ───────────────

console.log('\n=== runPriorityPreemptive — Appendix A.7 (A.1 input) ===');
{
  const t = runPriorityPreemptive(A1);

  assertEq(t.algorithm, 'PRIORITY_PREEMPTIVE', 'algorithm = "PRIORITY_PREEMPTIVE"');

  // Gantt: P1(0-1) | P2(1-4) | P1(4-8) | P3(8-15)
  // P2 (pri=1) preempts P1 (pri=2) at t=1; P3 (pri=3) waits until both finish.
  const runAt = i => t.timeline[i]?.runningTid ?? null;
  assertEq(runAt(0),  1, 'PRI t=0  running P1 (tid=1, only arrival)');
  assertEq(runAt(1),  2, 'PRI t=1  running P2 (tid=2, pri=1 preempts P1 pri=2)');
  assertEq(runAt(2),  2, 'PRI t=2  running P2 (P3 arrives but pri=3 < pri=1)');
  assertEq(runAt(3),  2, 'PRI t=3  running P2');
  assertEq(runAt(4),  1, 'PRI t=4  running P1 (P2 done, P1 pri=2 beats P3 pri=3)');
  assertEq(runAt(7),  1, 'PRI t=7  running P1');
  assertEq(runAt(8),  3, 'PRI t=8  running P3 (tid=3, P1 done)');
  assertEq(runAt(14), 3, 'PRI t=14 running P3');

  // Preemption at t=1
  assertEq(t.timeline[1].contextSwitch, true,  'PRI t=1  cs (P2 preempts P1)');
  assertEq(t.timeline[0].contextSwitch, false,  'PRI t=0  no cs (initial dispatch)');
  assertEq(t.timeline[4].contextSwitch, true,  'PRI t=4  cs (P1 resumes)');
  assertEq(t.timeline[8].contextSwitch, true,  'PRI t=8  cs (P3 starts)');

  // P1 in ready queue at t=1
  assert(t.timeline[1].readyQueue.map(e => e.tid).includes(1), 'PRI t=1 readyQueue contains P1');

  // Completions
  assertEq(t.timeline[4].completedThisTick.includes(2),  true, 'PRI t=4  P2 completed');
  assertEq(t.timeline[8].completedThisTick.includes(1),  true, 'PRI t=8  P1 completed');
  assertEq(t.timeline[15].completedThisTick.includes(3), true, 'PRI t=15 P3 completed');

  // Thread Metrics (A.7)
  console.log('\n--- PRI Thread Metrics ---');
  const tm = t.threadMetrics;
  assertEq(tm.length, 3, 'PRI 3 thread metrics');
  const tm1 = tm.find(m => m.tid === 1);
  const tm2 = tm.find(m => m.tid === 2);
  const tm3 = tm.find(m => m.tid === 3);
  assertEq(tm1.completionTime,  8,  'PRI P1 CT=8');
  assertEq(tm1.turnaroundTime,  8,  'PRI P1 TAT=8');
  assertEq(tm1.waitingTime,     3,  'PRI P1 WT=3');
  assertEq(tm1.responseTime,    0,  'PRI P1 RT=0');
  assertEq(tm2.completionTime,  4,  'PRI P2 CT=4');
  assertEq(tm2.turnaroundTime,  3,  'PRI P2 TAT=3');
  assertEq(tm2.waitingTime,     0,  'PRI P2 WT=0');
  assertEq(tm2.responseTime,    0,  'PRI P2 RT=0');
  assertEq(tm3.completionTime,  15, 'PRI P3 CT=15');
  assertEq(tm3.turnaroundTime,  13, 'PRI P3 TAT=13');
  assertEq(tm3.waitingTime,     6,  'PRI P3 WT=6');
  assertEq(tm3.responseTime,    6,  'PRI P3 RT=6');

  // Process Metrics (join-barrier, same as thread for single-threaded)
  console.log('\n--- PRI Process Metrics ---');
  const pm = t.processMetrics;
  assertEq(pm.length, 3, 'PRI 3 process metrics');
  const pm1 = pm.find(m => m.pid === 1);
  const pm2 = pm.find(m => m.pid === 2);
  const pm3 = pm.find(m => m.pid === 3);
  assertEq(pm1.completionTime,  8,  'PRI P1 process CT=8');
  assertEq(pm1.turnaroundTime,  8,  'PRI P1 process TAT=8');
  assertEq(pm1.waitingTime,     3,  'PRI P1 process WT=3');
  assertEq(pm1.responseTime,    0,  'PRI P1 process RT=0');
  assertEq(pm2.completionTime,  4,  'PRI P2 process CT=4');
  assertEq(pm2.turnaroundTime,  3,  'PRI P2 process TAT=3');
  assertEq(pm2.waitingTime,     0,  'PRI P2 process WT=0');
  assertEq(pm2.responseTime,    0,  'PRI P2 process RT=0');
  assertEq(pm3.completionTime,  15, 'PRI P3 process CT=15');
  assertEq(pm3.turnaroundTime,  13, 'PRI P3 process TAT=13');
  assertEq(pm3.waitingTime,     6,  'PRI P3 process WT=6');
  assertEq(pm3.responseTime,    6,  'PRI P3 process RT=6');

  // Aggregate
  console.log('\n--- PRI Aggregate Metrics ---');
  assertApprox(t.aggregateMetrics.avgTurnaroundTime, (8 + 3 + 13) / 3, 'PRI Avg TAT = 8.0');
  assertApprox(t.aggregateMetrics.avgWaitingTime,    (3 + 0 + 6)  / 3, 'PRI Avg WT  = 3.0');
  assertApprox(t.aggregateMetrics.cpuUtilization,    100,               'PRI CPU util = 100%');
  assertEq(t.aggregateMetrics.totalContextSwitches, 3, 'PRI totalContextSwitches=3');

  // Timeline printout
  const lm = new Map(expandToThreads(A1).map(e => [e.tid, e.label]));
  const lbl = tid => lm.get(tid) ?? `T${tid}`;
  console.log('\n=== Priority Timeline ===');
  for (const e of t.timeline) {
    const rq  = e.readyQueue.map(x => x.label).join(',').padEnd(16);
    const run = e.runningTid !== null ? lbl(e.runningTid).padEnd(6) : 'idle  ';
    const arr = e.arrivedThisTick.map(tid => lbl(tid)).join(',').padEnd(4);
    const cmp = e.completedThisTick.map(tid => lbl(tid)).join(',').padEnd(4);
    console.log(`${String(e.time).padStart(2)} | ${run} | rq:[${rq}] | arr:${arr} | cmp:${cmp} | ${e.contextSwitch ? 'CS' : ''}`);
  }
}

// ─── Priority vs SRTF — Differentiating Test Case ────────────────────────────
// P1: Arr=0, Burst=3, Pri=3  |  P2: Arr=1, Burst=5, Pri=1  |  P3: Arr=3, Burst=2, Pri=2
//
// Priority: P1(0-1), P2 preempts (1-6), P3(6-8), P1 resumes(8-10)
//   → P2 (pri=1) preempts P1 (pri=3) immediately at t=1
//   → After P2 finishes, P3 (pri=2) beats P1 (pri=3)
//
// SRTF:     P1(0-3), P3(3-5), P2(5-10)
//   → P2 arrives at t=1 with rem=5 > P1 rem=2, so P1 is NOT preempted
//   → P1 finishes at t=3; P3 (rem=2) beats P2 (rem=5)

const A_PRI_DIFF = [
  { pid: 1, arrivalTime: 0, burstTime: 3, priority: 3, sharedPages: 2, numPages: 3 },
  { pid: 2, arrivalTime: 1, burstTime: 5, priority: 1, sharedPages: 2, numPages: 3 },
  { pid: 3, arrivalTime: 3, burstTime: 2, priority: 2, sharedPages: 2, numPages: 3 },
];

console.log('\n=== Priority vs SRTF — Differentiating Input ===');
{
  const pri  = runPriorityPreemptive(A_PRI_DIFF);
  const srtf = runSRTF(A_PRI_DIFF);

  const priAt  = i => pri.timeline[i]?.runningTid ?? null;
  const srtfAt = i => srtf.timeline[i]?.runningTid ?? null;

  // tids: auto-generated 1=P1, 2=P2, 3=P3
  // Key divergence at t=1: Priority preempts, SRTF does not
  assertEq(priAt(0),  1, 'PRI_DIFF  t=0  P1 running (only arrival)');
  assertEq(priAt(1),  2, 'PRI_DIFF  t=1  P2 preempts P1 (pri=1 < pri=3)');
  assertEq(priAt(5),  2, 'PRI_DIFF  t=5  P2 still running');
  assertEq(priAt(6),  3, 'PRI_DIFF  t=6  P3 runs (pri=2 beats P1 pri=3)');
  assertEq(priAt(7),  3, 'PRI_DIFF  t=7  P3 still running');
  assertEq(priAt(8),  1, 'PRI_DIFF  t=8  P1 resumes (only one left)');
  assertEq(priAt(9),  1, 'PRI_DIFF  t=9  P1 still running');

  assertEq(srtfAt(0), 1, 'SRTF_DIFF t=0  P1 running');
  assertEq(srtfAt(1), 1, 'SRTF_DIFF t=1  P1 still runs (rem=2 < P2 rem=5, no preempt)');
  assertEq(srtfAt(2), 1, 'SRTF_DIFF t=2  P1 still running');
  assertEq(srtfAt(3), 3, 'SRTF_DIFF t=3  P3 runs (rem=2 < P2 rem=5)');
  assertEq(srtfAt(4), 3, 'SRTF_DIFF t=4  P3 still running');
  assertEq(srtfAt(5), 2, 'SRTF_DIFF t=5  P2 runs (only one left)');
  assertEq(srtfAt(9), 2, 'SRTF_DIFF t=9  P2 still running');

  // Confirm divergence
  assert(priAt(1) !== srtfAt(1), 'Priority and SRTF differ at t=1 (key preemption decision)');

  // Priority Thread Metrics
  // P1: CT=10, TAT=10, WT=7, RT=0
  // P2: CT=6,  TAT=5,  WT=0, RT=0
  // P3: CT=8,  TAT=5,  WT=3, RT=3
  console.log('\n--- PRI_DIFF Thread Metrics ---');
  const ptm = pri.threadMetrics;
  const ptm1 = ptm.find(m => m.pid === 1);
  const ptm2 = ptm.find(m => m.pid === 2);
  const ptm3 = ptm.find(m => m.pid === 3);
  assertEq(ptm1.completionTime,  10, 'PRI_DIFF P1 CT=10');
  assertEq(ptm1.turnaroundTime,  10, 'PRI_DIFF P1 TAT=10');
  assertEq(ptm1.waitingTime,      7, 'PRI_DIFF P1 WT=7');
  assertEq(ptm1.responseTime,     0, 'PRI_DIFF P1 RT=0');
  assertEq(ptm2.completionTime,   6, 'PRI_DIFF P2 CT=6');
  assertEq(ptm2.turnaroundTime,   5, 'PRI_DIFF P2 TAT=5');
  assertEq(ptm2.waitingTime,      0, 'PRI_DIFF P2 WT=0');
  assertEq(ptm2.responseTime,     0, 'PRI_DIFF P2 RT=0');
  assertEq(ptm3.completionTime,   8, 'PRI_DIFF P3 CT=8');
  assertEq(ptm3.turnaroundTime,   5, 'PRI_DIFF P3 TAT=5');
  assertEq(ptm3.waitingTime,      3, 'PRI_DIFF P3 WT=3');
  assertEq(ptm3.responseTime,     3, 'PRI_DIFF P3 RT=3');

  // SRTF Thread Metrics
  // P1: CT=3,  TAT=3,  WT=0, RT=0
  // P2: CT=10, TAT=9,  WT=4, RT=4
  // P3: CT=5,  TAT=2,  WT=0, RT=0
  console.log('\n--- SRTF_DIFF Thread Metrics ---');
  const stm = srtf.threadMetrics;
  const stm1 = stm.find(m => m.pid === 1);
  const stm2 = stm.find(m => m.pid === 2);
  const stm3 = stm.find(m => m.pid === 3);
  assertEq(stm1.completionTime,   3, 'SRTF_DIFF P1 CT=3');
  assertEq(stm1.turnaroundTime,   3, 'SRTF_DIFF P1 TAT=3');
  assertEq(stm1.waitingTime,      0, 'SRTF_DIFF P1 WT=0');
  assertEq(stm1.responseTime,     0, 'SRTF_DIFF P1 RT=0');
  assertEq(stm2.completionTime,  10, 'SRTF_DIFF P2 CT=10');
  assertEq(stm2.turnaroundTime,   9, 'SRTF_DIFF P2 TAT=9');
  assertEq(stm2.waitingTime,      4, 'SRTF_DIFF P2 WT=4');
  assertEq(stm2.responseTime,     4, 'SRTF_DIFF P2 RT=4');
  assertEq(stm3.completionTime,   5, 'SRTF_DIFF P3 CT=5');
  assertEq(stm3.turnaroundTime,   2, 'SRTF_DIFF P3 TAT=2');
  assertEq(stm3.waitingTime,      0, 'SRTF_DIFF P3 WT=0');
  assertEq(stm3.responseTime,     0, 'SRTF_DIFF P3 RT=0');

  // Confirm metrics differ: P2 has very different CT under the two algorithms
  assert(ptm2.completionTime !== stm2.completionTime, 'Priority and SRTF produce different P2 CT');
  assert(ptm1.completionTime !== stm1.completionTime, 'Priority and SRTF produce different P1 CT');
}

// ─── MLQ (A.8) ───────────────────────────────────────────────────────────────
// Q1(RR q=2): priority 1. Q2(RR q=4): priority 2. Q3(FCFS): priority 3.
// P1: Arr=0, Burst=4, Pri=3 → Q3  |  P2: Arr=1, Burst=3, Pri=1 → Q1
// P3: Arr=2, Burst=5, Pri=2 → Q2  |  P4: Arr=3, Burst=2, Pri=1 → Q1
// Gantt: P1(0-1) | P2(1-3) | P4(3-5) | P2(5-6) | P3(6-11) | P1(11-14)

console.log('\n=== runMLQ — Appendix A.8 ===');
{
  const A8 = [
    { pid: 1, arrivalTime: 0, burstTime: 4, priority: 3, sharedPages: 3, numPages: 4 },
    { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1, sharedPages: 2, numPages: 3 },
    { pid: 3, arrivalTime: 2, burstTime: 5, priority: 2, sharedPages: 3, numPages: 4 },
    { pid: 4, arrivalTime: 3, burstTime: 2, priority: 1, sharedPages: 2, numPages: 3 },
  ];

  const mlqConfig = {
    algorithm: 'MLQ',
    mlqQueues: [
      { algorithm: 'RR',   priorityRange: [1, 1], quantum: 2 },
      { algorithm: 'RR',   priorityRange: [2, 2], quantum: 4 },
      { algorithm: 'FCFS', priorityRange: [3, 3] },
    ],
  };

  const t = runMLQ(A8, mlqConfig);

  assertEq(t.algorithm, 'MLQ', 'MLQ algorithm field');

  // ── Gantt ───────────────────────────────────────────────────────────────────
  // tids: P1→1, P2→2, P3→3, P4→4 (auto-generated, single-threaded)
  const runAt = i => t.timeline[i]?.runningTid ?? null;
  assertEq(runAt(0),  1, 'MLQ t=0  running P1 (Q3, only arrival)');
  assertEq(runAt(1),  2, 'MLQ t=1  running P2 (Q1 preempts Q3)');
  assertEq(runAt(2),  2, 'MLQ t=2  running P2 (P3 arrives Q2, Q1 still highest)');
  assertEq(runAt(3),  4, 'MLQ t=3  running P4 (P2 quantum expired, P4 arrived Q1 first)');
  assertEq(runAt(4),  4, 'MLQ t=4  running P4');
  assertEq(runAt(5),  2, 'MLQ t=5  running P2 (P4 done, P2 rem=1 in Q1)');
  assertEq(runAt(6),  3, 'MLQ t=6  running P3 (P2 done, Q1 empty → Q2)');
  assertEq(runAt(7),  3, 'MLQ t=7  running P3');
  assertEq(runAt(8),  3, 'MLQ t=8  running P3');
  assertEq(runAt(9),  3, 'MLQ t=9  running P3');
  assertEq(runAt(10), 3, 'MLQ t=10 running P3 (Q2 quantum expired, re-dispatched, rem=1)');
  assertEq(runAt(11), 1, 'MLQ t=11 running P1 (P3 done, Q1/Q2 empty → Q3)');
  assertEq(runAt(12), 1, 'MLQ t=12 running P1');
  assertEq(runAt(13), 1, 'MLQ t=13 running P1');

  // ── Completions ─────────────────────────────────────────────────────────────
  assertEq(t.timeline[5].completedThisTick.includes(4),  true, 'MLQ t=5  P4 (tid=4) completed');
  assertEq(t.timeline[6].completedThisTick.includes(2),  true, 'MLQ t=6  P2 (tid=2) completed');
  assertEq(t.timeline[11].completedThisTick.includes(3), true, 'MLQ t=11 P3 (tid=3) completed');
  assertEq(t.timeline[14].completedThisTick.includes(1), true, 'MLQ t=14 P1 (tid=1) completed');

  // ── Arrivals ────────────────────────────────────────────────────────────────
  assertEq(t.timeline[0].arrivedThisTick.includes(1), true, 'MLQ t=0 tid=1 (P1) arrived');
  assertEq(t.timeline[1].arrivedThisTick.includes(2), true, 'MLQ t=1 tid=2 (P2) arrived');
  assertEq(t.timeline[2].arrivedThisTick.includes(3), true, 'MLQ t=2 tid=3 (P3) arrived');
  assertEq(t.timeline[3].arrivedThisTick.includes(4), true, 'MLQ t=3 tid=4 (P4) arrived');

  // ── Context switches ─────────────────────────────────────────────────────────
  assertEq(t.timeline[0].contextSwitch,  false, 'MLQ t=0  no CS (initial dispatch)');
  assertEq(t.timeline[1].contextSwitch,  true,  'MLQ t=1  CS (P2 preempts P1)');
  assertEq(t.timeline[3].contextSwitch,  true,  'MLQ t=3  CS (P4 dispatched after P2 quantum)');
  assertEq(t.timeline[5].contextSwitch,  true,  'MLQ t=5  CS (P2 dispatched after P4 done)');
  assertEq(t.timeline[6].contextSwitch,  true,  'MLQ t=6  CS (P3 dispatched after P2 done)');
  assertEq(t.timeline[10].contextSwitch, false, 'MLQ t=10 no CS (P3 re-dispatched to itself)');
  assertEq(t.timeline[11].contextSwitch, true,  'MLQ t=11 CS (P1 dispatched after P3 done)');

  // ── queueLevels: verify correct queue assignment ────────────────────────────
  // At t=2: P2 running (Q1), P3 just arrived (Q2), P1 preempted (Q3)
  const ql2 = t.timeline[2].queueLevels;
  assertEq(ql2[0].level, 1, 'MLQ queueLevels[0] is level 1 (Q1)');
  assertEq(ql2[0].algorithm, 'RR', 'MLQ Q1 algorithm=RR');
  assertEq(ql2[0].entities.length, 0, 'MLQ t=2 Q1 empty (P2 is running)');
  assertEq(ql2[1].level, 2, 'MLQ queueLevels[1] is level 2 (Q2)');
  assertEq(ql2[1].algorithm, 'RR', 'MLQ Q2 algorithm=RR');
  assertEq(ql2[1].entities.length, 1, 'MLQ t=2 Q2 has P3');
  assertEq(ql2[1].entities[0].tid, 3, 'MLQ t=2 Q2 contains tid=3 (P3)');
  assertEq(ql2[2].level, 3, 'MLQ queueLevels[2] is level 3 (Q3)');
  assertEq(ql2[2].algorithm, 'FCFS', 'MLQ Q3 algorithm=FCFS');
  assertEq(ql2[2].entities.length, 1, 'MLQ t=2 Q3 has P1 (preempted)');
  assertEq(ql2[2].entities[0].tid, 1, 'MLQ t=2 Q3 contains tid=1 (P1)');

  // At t=3: P4 running (Q1), P2 preempted back to Q1, P3 in Q2, P1 in Q3
  const ql3 = t.timeline[3].queueLevels;
  assertEq(ql3[0].entities.length, 1, 'MLQ t=3 Q1 has P2 (quantum-preempted, behind P4)');
  assertEq(ql3[0].entities[0].tid, 2, 'MLQ t=3 Q1 contains tid=2 (P2)');
  assertEq(ql3[1].entities.length, 1, 'MLQ t=3 Q2 has P3');
  assertEq(ql3[2].entities.length, 1, 'MLQ t=3 Q3 has P1');

  // At t=6: P3 running (Q2), Q1 empty, Q3 has P1
  const ql6 = t.timeline[6].queueLevels;
  assertEq(ql6[0].entities.length, 0, 'MLQ t=6 Q1 empty (P2 just completed)');
  assertEq(ql6[1].entities.length, 0, 'MLQ t=6 Q2 empty (P3 is running)');
  assertEq(ql6[2].entities.length, 1, 'MLQ t=6 Q3 has P1');
  assertEq(ql6[2].entities[0].tid, 1, 'MLQ t=6 Q3 contains tid=1 (P1)');

  // ── Thread Metrics (A.8) ────────────────────────────────────────────────────
  console.log('\n--- MLQ Thread Metrics ---');
  const tm = t.threadMetrics;
  assertEq(tm.length, 4, 'MLQ 4 thread metrics entries');

  const tm1 = tm.find(m => m.tid === 1);
  const tm2 = tm.find(m => m.tid === 2);
  const tm3 = tm.find(m => m.tid === 3);
  const tm4 = tm.find(m => m.tid === 4);

  assertEq(tm1.completionTime,  14, 'MLQ P1 CT=14');
  assertEq(tm1.turnaroundTime,  14, 'MLQ P1 TAT=14');
  assertEq(tm1.waitingTime,     10, 'MLQ P1 WT=10');
  assertEq(tm1.responseTime,     0, 'MLQ P1 RT=0');

  assertEq(tm2.completionTime,   6, 'MLQ P2 CT=6');
  assertEq(tm2.turnaroundTime,   5, 'MLQ P2 TAT=5');
  assertEq(tm2.waitingTime,      2, 'MLQ P2 WT=2');
  assertEq(tm2.responseTime,     0, 'MLQ P2 RT=0');

  assertEq(tm3.completionTime,  11, 'MLQ P3 CT=11');
  assertEq(tm3.turnaroundTime,   9, 'MLQ P3 TAT=9');
  assertEq(tm3.waitingTime,      4, 'MLQ P3 WT=4');
  assertEq(tm3.responseTime,     4, 'MLQ P3 RT=4');

  assertEq(tm4.completionTime,   5, 'MLQ P4 CT=5');
  assertEq(tm4.turnaroundTime,   2, 'MLQ P4 TAT=2');
  assertEq(tm4.waitingTime,      0, 'MLQ P4 WT=0');
  assertEq(tm4.responseTime,     0, 'MLQ P4 RT=0');

  // ── Process Metrics (join-barrier, same as thread for single-threaded) ───────
  console.log('\n--- MLQ Process Metrics ---');
  const pm = t.processMetrics;
  assertEq(pm.length, 4, 'MLQ 4 process metrics entries');

  const pm1 = pm.find(m => m.pid === 1);
  const pm2 = pm.find(m => m.pid === 2);
  const pm3 = pm.find(m => m.pid === 3);
  const pm4 = pm.find(m => m.pid === 4);

  assertEq(pm1.completionTime,  14, 'MLQ P1 process CT=14');
  assertEq(pm1.turnaroundTime,  14, 'MLQ P1 process TAT=14');
  assertEq(pm1.waitingTime,     10, 'MLQ P1 process WT=10');
  assertEq(pm1.responseTime,     0, 'MLQ P1 process RT=0');

  assertEq(pm2.completionTime,   6, 'MLQ P2 process CT=6');
  assertEq(pm2.turnaroundTime,   5, 'MLQ P2 process TAT=5');
  assertEq(pm2.waitingTime,      2, 'MLQ P2 process WT=2');
  assertEq(pm2.responseTime,     0, 'MLQ P2 process RT=0');

  assertEq(pm3.completionTime,  11, 'MLQ P3 process CT=11');
  assertEq(pm3.turnaroundTime,   9, 'MLQ P3 process TAT=9');
  assertEq(pm3.waitingTime,      4, 'MLQ P3 process WT=4');
  assertEq(pm3.responseTime,     4, 'MLQ P3 process RT=4');

  assertEq(pm4.completionTime,   5, 'MLQ P4 process CT=5');
  assertEq(pm4.turnaroundTime,   2, 'MLQ P4 process TAT=2');
  assertEq(pm4.waitingTime,      0, 'MLQ P4 process WT=0');
  assertEq(pm4.responseTime,     0, 'MLQ P4 process RT=0');

  // ── Aggregate self-consistency ───────────────────────────────────────────────
  console.log('\n--- MLQ Aggregate Metrics ---');
  const ag = t.aggregateMetrics;
  assertApprox(ag.avgTurnaroundTime, (14 + 5 + 9 + 2) / 4, 'MLQ Avg TAT = 7.5');
  assertApprox(ag.avgWaitingTime,    (10 + 2 + 4 + 0) / 4, 'MLQ Avg WT  = 4.0');
  assertApprox(ag.cpuUtilization,    100,                    'MLQ CPU util = 100%');

  // Timeline printout
  const lm8 = new Map(expandToThreads(A8).map(e => [e.tid, e.label]));
  const lbl8 = tid => lm8.get(tid) ?? `T${tid}`;
  console.log('\n=== MLQ Timeline (A.8 input) ===');
  console.log('t  | running | Q1                   | Q2                   | Q3                   | arr | cmp | cs');
  console.log('---+---------+----------------------+----------------------+----------------------+-----+-----+----');
  for (const e of t.timeline) {
    const run = e.runningTid !== null ? lbl8(e.runningTid).padEnd(7) : 'idle   ';
    const q1  = (e.queueLevels[0].entities.map(x => x.label).join(',') || '-').padEnd(20);
    const q2  = (e.queueLevels[1].entities.map(x => x.label).join(',') || '-').padEnd(20);
    const q3  = (e.queueLevels[2].entities.map(x => x.label).join(',') || '-').padEnd(20);
    const arr = e.arrivedThisTick.map(tid => lbl8(tid)).join(',').padEnd(3);
    const cmp = e.completedThisTick.map(tid => lbl8(tid)).join(',').padEnd(3);
    console.log(
      `${String(e.time).padStart(2)} | ${run} | ${q1} | ${q2} | ${q3} | ${arr} | ${cmp} | ${e.contextSwitch ? 'CS' : ''}`
    );
  }
}

// ─── MLFQ (A.9) ──────────────────────────────────────────────────────────────
// Q0(RR q=2), Q1(RR q=4), Q2(FCFS). All entities enter Q0.
// Demotion on full quantum use. Preempted-by-higher stays in current level.
// Aging: 15+ ticks waiting in Q2 → promote to Q0.
//
// Input (different from A.1):
//   P1: Arrival=0,  Burst=10, Priority=2, SharedPages=3  → auto tid=1
//   P2: Arrival=1,  Burst=3,  Priority=2, SharedPages=2  → auto tid=2
//   P3: Arrival=15, Burst=5,  Priority=2, SharedPages=3  → auto tid=3
//
// ─── Hand-traced timeline ─────────────────────────────────────────────────────
//
// t=0:  P1 arrives → Q0:[1]. Dispatch P1 (Q0, ql=2). Q0:[], Q1:[], Q2:[].
//       Run P1: rem=10→9, ql=2→1.
//
// t=1:  rem=9≠0. ql=1≠0. P2 arrives → Q0:[2]. No preemption (same level).
//       Run P1: rem=9→8, ql=1→0.
//
// t=2:  rem=8≠0. ql=0, RR → QUANTUM EXPIRED. Demote P1: Q0→Q1. Q1:[1].
//       Arrivals: none. Dispatch P2 from Q0. CS (prev=1, next=2). Q0:[], Q1:[1], Q2:[].
//       Run P2: rem=3→2, ql=2→1.
//
// t=3:  rem=2≠0. ql=1≠0. No arrivals.
//       Run P2: rem=2→1, ql=1→0.
//
// t=4:  rem=1≠0. ql=0, RR → QUANTUM EXPIRED. Demote P2: Q0→Q1. Q1:[1,2].
//       Arrivals: none. Dispatch P1 from Q1 (front). CS (prev=2, next=1). Q0:[], Q1:[2], Q2:[].
//       Run P1: rem=8→7, ql=4→3.
//
// t=5:  Run P1: rem=7→6, ql=3→2.
// t=6:  Run P1: rem=6→5, ql=2→1.
// t=7:  Run P1: rem=5→4, ql=1→0.
//
// t=8:  rem=4≠0. ql=0, RR → QUANTUM EXPIRED. Demote P1: Q1→Q2. Q2:[1].
//       Arrivals: none. Dispatch P2 from Q1. CS (prev=1, next=2). Q0:[], Q1:[], Q2:[1].
//       Run P2: rem=1→0, ql=4→3.
//       Aging tick: P1 in Q2 → ageInLowest[1]=1.
//
// t=9:  rem=0 → P2 COMPLETED. CT[2]=9. running=null.
//       Arrivals: none. Dispatch P1 from Q2 (FCFS). CS (prev=2, next=1). Q0:[], Q1:[], Q2:[].
//       Run P1: rem=4→3.
//       (P1 left Q2 so no aging increment.)
//
// t=10: Run P1: rem=3→2.
// t=11: Run P1: rem=2→1.
// t=12: Run P1: rem=1→0.
//
// t=13: rem=0 → P1 COMPLETED. CT[1]=13. All queues empty → IDLE. prevRunningTid=null.
// t=14: IDLE (no arrivals, no ready entities). prevRunningTid=null.
//
// t=15: P3 arrives → Q0:[3]. Dispatch P3 from Q0 (ql=2). No CS (prev=null). Q0:[], Q1:[], Q2:[].
//       Run P3: rem=5→4, ql=2→1.
//
// t=16: Run P3: rem=4→3, ql=1→0.
//
// t=17: rem=3≠0. ql=0, RR → QUANTUM EXPIRED. Demote P3: Q0→Q1. Q1:[3].
//       Arrivals: none. Dispatch P3 from Q1. NO CS (prev=3, next=3 same entity). Q0:[], Q1:[], Q2:[].
//       Run P3: rem=3→2, ql=4→3.
//
// t=18: Run P3: rem=2→1, ql=3→2.
// t=19: Run P3: rem=1→0, ql=2→1.
//
// t=20: rem=0 → P3 COMPLETED. CT[3]=20. All done → BREAK.
//
// ─── Final metrics ────────────────────────────────────────────────────────────
//   P1: CT=13, TAT=13-0=13, WT=13-10=3,  RT=0-0=0   (Q0→Q1→Q2)
//   P2: CT=9,  TAT=9-1=8,   WT=8-3=5,    RT=2-1=1   (Q0→Q1)
//   P3: CT=20, TAT=20-15=5, WT=5-5=0,    RT=15-15=0 (Q0→Q1)
//   Demotions: t=2: {1,0→1}, t=4: {2,0→1}, t=8: {1,1→2}, t=17: {3,0→1}
//   Context switches: t=2, t=4, t=8, t=9 → 4 total
//   CPU util: 18 busy / 20 total = 90%

console.log('\n=== runMLFQ — Appendix A.9 ===');
{
  const A9 = [
    { pid: 1, arrivalTime: 0,  burstTime: 10, priority: 2, sharedPages: 3, numPages: 4 },
    { pid: 2, arrivalTime: 1,  burstTime: 3,  priority: 2, sharedPages: 2, numPages: 3 },
    { pid: 3, arrivalTime: 15, burstTime: 5,  priority: 2, sharedPages: 3, numPages: 4 },
  ];

  const mlfqConfig = {
    algorithm: 'MLFQ',
    mlfqLevels: [
      { algorithm: 'RR',   quantum: 2 }, // Q0 — highest priority
      { algorithm: 'RR',   quantum: 4 }, // Q1 — middle
      { algorithm: 'FCFS', quantum: 0 }, // Q2 — lowest (quantum unused for FCFS)
    ],
  };

  const t = runMLFQ(A9, mlfqConfig);

  assertEq(t.algorithm, 'MLFQ', 'MLFQ algorithm field');
  assertEq(t.config.mlfqLevels.length, 3, 'MLFQ config has 3 levels');

  // ── Gantt assertions (Appendix A.9 trace) ────────────────────────────────────
  // tid=1→P1, tid=2→P2, tid=3→P3 (auto-generated single-threaded)
  console.log('\n--- MLFQ Gantt ---');
  const runAt = i => t.timeline[i]?.runningTid ?? null;

  // t=0-1: P1 runs in Q0 (first 2-tick quantum)
  assertEq(runAt(0),  1,    'MLFQ t=0  P1 running in Q0');
  assertEq(runAt(1),  1,    'MLFQ t=1  P1 still running in Q0 (ql=1)');

  // t=2: P1 demoted Q0→Q1, P2 dispatched from Q0
  assertEq(runAt(2),  2,    'MLFQ t=2  P2 running in Q0 (P1 quantum expired → demoted)');

  // t=3: P2 still running in Q0 (ql=1 remaining)
  assertEq(runAt(3),  2,    'MLFQ t=3  P2 still running in Q0');

  // t=4: P2 quantum expired → demoted Q0→Q1. P1 at front of Q1 → dispatched
  assertEq(runAt(4),  1,    'MLFQ t=4  P1 running in Q1 (P2 demoted, P1 was first in Q1)');
  assertEq(runAt(5),  1,    'MLFQ t=5  P1 still running in Q1 (ql=3)');
  assertEq(runAt(6),  1,    'MLFQ t=6  P1 still running in Q1 (ql=2)');
  assertEq(runAt(7),  1,    'MLFQ t=7  P1 still running in Q1 (ql=1)');

  // t=8: P1 quantum expired → demoted Q1→Q2. P2 dispatched from Q1 (rem=1)
  assertEq(runAt(8),  2,    'MLFQ t=8  P2 running in Q1 (P1 demoted Q1→Q2, P2 rem=1)');

  // t=9: P2 completes. P1 dispatched from Q2 (FCFS, rem=4)
  assertEq(runAt(9),  1,    'MLFQ t=9  P1 running in Q2 (P2 done, FCFS dispatch)');
  assertEq(runAt(10), 1,    'MLFQ t=10 P1 still running in Q2');
  assertEq(runAt(11), 1,    'MLFQ t=11 P1 still running in Q2');
  assertEq(runAt(12), 1,    'MLFQ t=12 P1 still running in Q2 (last tick, rem=1→0)');

  // t=13-14: IDLE (P1 done, P3 not yet arrived)
  assertEq(runAt(13), null, 'MLFQ t=13 IDLE (P1 completed)');
  assertEq(runAt(14), null, 'MLFQ t=14 IDLE (P3 arrives at t=15)');

  // t=15-16: P3 arrives Q0, runs 2 ticks
  assertEq(runAt(15), 3,    'MLFQ t=15 P3 running in Q0 (just arrived)');
  assertEq(runAt(16), 3,    'MLFQ t=16 P3 still running in Q0 (ql=1)');

  // t=17: P3 quantum expired → demoted Q0→Q1, immediately re-dispatched (only entity)
  assertEq(runAt(17), 3,    'MLFQ t=17 P3 running in Q1 (demoted then re-dispatched)');
  assertEq(runAt(18), 3,    'MLFQ t=18 P3 still running in Q1 (rem=2)');
  assertEq(runAt(19), 3,    'MLFQ t=19 P3 still running in Q1 (rem=1)');

  // t=20: P3 completes
  assertEq(runAt(20), null, 'MLFQ t=20 P3 completed (timeline ends)');

  // ── Completions ───────────────────────────────────────────────────────────────
  console.log('\n--- MLFQ Completions ---');
  assertEq(t.timeline[9].completedThisTick.includes(2),  true, 'MLFQ t=9  P2 (tid=2) completed');
  assertEq(t.timeline[13].completedThisTick.includes(1), true, 'MLFQ t=13 P1 (tid=1) completed');
  assertEq(t.timeline[20].completedThisTick.includes(3), true, 'MLFQ t=20 P3 (tid=3) completed');

  // ── Arrivals ──────────────────────────────────────────────────────────────────
  console.log('\n--- MLFQ Arrivals ---');
  assertEq(t.timeline[0].arrivedThisTick.includes(1),  true, 'MLFQ t=0  P1 (tid=1) arrived');
  assertEq(t.timeline[1].arrivedThisTick.includes(2),  true, 'MLFQ t=1  P2 (tid=2) arrived');
  assertEq(t.timeline[15].arrivedThisTick.includes(3), true, 'MLFQ t=15 P3 (tid=3) arrived');

  // ── Demotions ─────────────────────────────────────────────────────────────────
  // Each demotion fires when quantum expires; recorded in that tick's entry.
  console.log('\n--- MLFQ Demotions ---');

  // t=2: P1 uses full Q0 quantum (2 ticks) → demoted Q0→Q1
  const dem2 = t.timeline[2].demotions;
  assertEq(dem2.length, 1,   'MLFQ t=2  exactly 1 demotion');
  assertEq(dem2[0].tid,  1,  'MLFQ t=2  demotion tid=1 (P1)');
  assertEq(dem2[0].from, 0,  'MLFQ t=2  demotion from Q0');
  assertEq(dem2[0].to,   1,  'MLFQ t=2  demotion to Q1');

  // t=4: P2 uses full Q0 quantum (2 ticks) → demoted Q0→Q1
  const dem4 = t.timeline[4].demotions;
  assertEq(dem4.length, 1,   'MLFQ t=4  exactly 1 demotion');
  assertEq(dem4[0].tid,  2,  'MLFQ t=4  demotion tid=2 (P2)');
  assertEq(dem4[0].from, 0,  'MLFQ t=4  demotion from Q0');
  assertEq(dem4[0].to,   1,  'MLFQ t=4  demotion to Q1');

  // t=8: P1 uses full Q1 quantum (4 ticks) → demoted Q1→Q2
  const dem8 = t.timeline[8].demotions;
  assertEq(dem8.length, 1,   'MLFQ t=8  exactly 1 demotion');
  assertEq(dem8[0].tid,  1,  'MLFQ t=8  demotion tid=1 (P1)');
  assertEq(dem8[0].from, 1,  'MLFQ t=8  demotion from Q1');
  assertEq(dem8[0].to,   2,  'MLFQ t=8  demotion to Q2');

  // t=17: P3 uses full Q0 quantum (2 ticks) → demoted Q0→Q1
  const dem17 = t.timeline[17].demotions;
  assertEq(dem17.length, 1,  'MLFQ t=17 exactly 1 demotion');
  assertEq(dem17[0].tid,  3, 'MLFQ t=17 demotion tid=3 (P3)');
  assertEq(dem17[0].from, 0, 'MLFQ t=17 demotion from Q0');
  assertEq(dem17[0].to,   1, 'MLFQ t=17 demotion to Q1');

  // All other ticks have no demotions (spot-check)
  assertEq(t.timeline[0].demotions.length,  0, 'MLFQ t=0  no demotions');
  assertEq(t.timeline[9].demotions.length,  0, 'MLFQ t=9  no demotions (P2 completed, not demoted)');
  assertEq(t.timeline[15].demotions.length, 0, 'MLFQ t=15 no demotions (P3 just arrived)');

  // No promotions in this trace (P1 is only in Q2 for 4 ticks, threshold is 15)
  console.log('\n--- MLFQ Promotions ---');
  const allPromotions = t.timeline.flatMap(e => e.promotions);
  assertEq(allPromotions.length, 0, 'MLFQ no aging promotions (P1 waits only 1 tick in Q2 before running)');

  // ── Context switches ──────────────────────────────────────────────────────────
  console.log('\n--- MLFQ Context Switches ---');
  assertEq(t.timeline[0].contextSwitch,  false, 'MLFQ t=0  no CS (initial dispatch from idle)');
  assertEq(t.timeline[1].contextSwitch,  false, 'MLFQ t=1  no CS (P1 continues)');
  assertEq(t.timeline[2].contextSwitch,  true,  'MLFQ t=2  CS (P1 demoted, P2 dispatched)');
  assertEq(t.timeline[3].contextSwitch,  false, 'MLFQ t=3  no CS (P2 continues)');
  assertEq(t.timeline[4].contextSwitch,  true,  'MLFQ t=4  CS (P2 demoted, P1 from Q1)');
  assertEq(t.timeline[8].contextSwitch,  true,  'MLFQ t=8  CS (P1 demoted Q1→Q2, P2 from Q1)');
  assertEq(t.timeline[9].contextSwitch,  true,  'MLFQ t=9  CS (P2 done, P1 from Q2)');
  assertEq(t.timeline[15].contextSwitch, false, 'MLFQ t=15 no CS (dispatch from idle, prev=null)');
  assertEq(t.timeline[17].contextSwitch, false, 'MLFQ t=17 no CS (P3 demoted then re-dispatched as same entity)');
  assertEq(t.aggregateMetrics.totalContextSwitches, 4, 'MLFQ total CS = 4');

  // ── queueLevels snapshots ─────────────────────────────────────────────────────
  console.log('\n--- MLFQ Queue Level Snapshots ---');

  // t=1: P2 arrived into Q0, P1 is running (removed from Q0 on dispatch)
  const ql1 = t.timeline[1].queueLevels;
  assertEq(ql1[0].level,     0,    'MLFQ t=1 queueLevels[0].level=0 (Q0)');
  assertEq(ql1[0].algorithm, 'RR', 'MLFQ t=1 Q0 algorithm=RR');
  assertEq(ql1[0].entities.length, 1,   'MLFQ t=1 Q0 has 1 entity (P2 waiting)');
  assertEq(ql1[0].entities[0].tid,  2,  'MLFQ t=1 Q0 contains tid=2 (P2)');
  assertEq(ql1[1].entities.length,  0,  'MLFQ t=1 Q1 empty');
  assertEq(ql1[2].entities.length,  0,  'MLFQ t=1 Q2 empty');

  // t=2: P1 demoted to Q1, P2 dispatched. Q0:[], Q1:[P1], Q2:[]
  const ql2 = t.timeline[2].queueLevels;
  assertEq(ql2[0].entities.length, 0,   'MLFQ t=2 Q0 empty (P2 dispatched)');
  assertEq(ql2[1].entities.length, 1,   'MLFQ t=2 Q1 has P1 (just demoted)');
  assertEq(ql2[1].entities[0].tid,  1,  'MLFQ t=2 Q1 contains tid=1 (P1)');
  assertEq(ql2[1].algorithm, 'RR',      'MLFQ t=2 Q1 algorithm=RR');
  assertEq(ql2[2].entities.length, 0,   'MLFQ t=2 Q2 empty');

  // t=4: P2 demoted to Q1 (behind P1 which was already there); P1 dispatched from Q1.
  // After dispatch: Q1 has only P2.
  const ql4 = t.timeline[4].queueLevels;
  assertEq(ql4[0].entities.length, 0,   'MLFQ t=4 Q0 empty');
  assertEq(ql4[1].entities.length, 1,   'MLFQ t=4 Q1 has P2 (P1 dispatched)');
  assertEq(ql4[1].entities[0].tid,  2,  'MLFQ t=4 Q1 contains tid=2 (P2)');
  assertEq(ql4[2].entities.length, 0,   'MLFQ t=4 Q2 empty');

  // t=8: P1 demoted to Q2, P2 dispatched from Q1. Q0:[], Q1:[], Q2:[P1]
  const ql8 = t.timeline[8].queueLevels;
  assertEq(ql8[0].entities.length, 0,   'MLFQ t=8 Q0 empty');
  assertEq(ql8[1].entities.length, 0,   'MLFQ t=8 Q1 empty (P2 dispatched)');
  assertEq(ql8[2].entities.length, 1,   'MLFQ t=8 Q2 has P1 (just demoted)');
  assertEq(ql8[2].entities[0].tid,  1,  'MLFQ t=8 Q2 contains tid=1 (P1)');
  assertEq(ql8[2].algorithm, 'FCFS',    'MLFQ Q2 algorithm=FCFS');

  // t=9: P2 completed, P1 dispatched from Q2. All queues empty.
  const ql9 = t.timeline[9].queueLevels;
  assertEq(ql9[0].entities.length, 0,   'MLFQ t=9 Q0 empty');
  assertEq(ql9[1].entities.length, 0,   'MLFQ t=9 Q1 empty');
  assertEq(ql9[2].entities.length, 0,   'MLFQ t=9 Q2 empty (P1 dispatched)');

  // t=13: IDLE — all queues empty after P1 completes
  const ql13 = t.timeline[13].queueLevels;
  assertEq(ql13[0].entities.length, 0,  'MLFQ t=13 Q0 empty (idle)');
  assertEq(ql13[1].entities.length, 0,  'MLFQ t=13 Q1 empty (idle)');
  assertEq(ql13[2].entities.length, 0,  'MLFQ t=13 Q2 empty (idle)');

  // t=17: P3 demoted Q0→Q1 then immediately re-dispatched → Q1 empty after dispatch
  const ql17 = t.timeline[17].queueLevels;
  assertEq(ql17[0].entities.length, 0,  'MLFQ t=17 Q0 empty');
  assertEq(ql17[1].entities.length, 0,  'MLFQ t=17 Q1 empty (P3 dispatched after demotion)');
  assertEq(ql17[2].entities.length, 0,  'MLFQ t=17 Q2 empty');

  // ── readyQueue cross-check (flat view of all waiting entities) ─────────────────
  console.log('\n--- MLFQ readyQueue ---');
  assertEq(t.timeline[0].readyQueue.length,  0, 'MLFQ t=0  readyQueue empty (P1 dispatched)');
  assertEq(t.timeline[1].readyQueue.length,  1, 'MLFQ t=1  readyQueue has 1 (P2 in Q0)');
  assertEq(t.timeline[1].readyQueue[0].tid,  2, 'MLFQ t=1  readyQueue[0] = tid=2 (P2)');
  assertEq(t.timeline[2].readyQueue.length,  1, 'MLFQ t=2  readyQueue has 1 (P1 in Q1)');
  assertEq(t.timeline[2].readyQueue[0].tid,  1, 'MLFQ t=2  readyQueue[0] = tid=1 (P1)');
  assertEq(t.timeline[8].readyQueue.length,  1, 'MLFQ t=8  readyQueue has 1 (P1 in Q2)');
  assertEq(t.timeline[8].readyQueue[0].tid,  1, 'MLFQ t=8  readyQueue[0] = tid=1 (P1 in Q2)');
  assertEq(t.timeline[9].readyQueue.length,  0, 'MLFQ t=9  readyQueue empty (P1 dispatched from Q2)');
  assertEq(t.timeline[13].readyQueue.length, 0, 'MLFQ t=13 readyQueue empty (idle)');
  assertEq(t.timeline[15].readyQueue.length, 0, 'MLFQ t=15 readyQueue empty (P3 dispatched)');

  // ── Thread Metrics (A.9) ──────────────────────────────────────────────────────
  console.log('\n--- MLFQ Thread Metrics ---');
  const tm = t.threadMetrics;
  assertEq(tm.length, 3, 'MLFQ 3 thread metrics entries');

  const tm1 = tm.find(m => m.tid === 1);
  const tm2 = tm.find(m => m.tid === 2);
  const tm3 = tm.find(m => m.tid === 3);

  // P1: CT=13, TAT=13-0=13, WT=13-10=3, RT=0-0=0  (Q0→Q1→Q2)
  assertEq(tm1.completionTime,  13, 'MLFQ P1 CT=13');
  assertEq(tm1.turnaroundTime,  13, 'MLFQ P1 TAT=13 (CT=13, arr=0)');
  assertEq(tm1.waitingTime,      3, 'MLFQ P1 WT=3   (TAT=13, burst=10)');
  assertEq(tm1.responseTime,     0, 'MLFQ P1 RT=0   (first ran at t=0)');

  // P2: CT=9, TAT=9-1=8, WT=8-3=5, RT=2-1=1  (Q0→Q1)
  assertEq(tm2.completionTime,   9, 'MLFQ P2 CT=9');
  assertEq(tm2.turnaroundTime,   8, 'MLFQ P2 TAT=8  (CT=9,  arr=1)');
  assertEq(tm2.waitingTime,      5, 'MLFQ P2 WT=5   (TAT=8,  burst=3)');
  assertEq(tm2.responseTime,     1, 'MLFQ P2 RT=1   (first ran at t=2, arr=1)');

  // P3: CT=20, TAT=20-15=5, WT=5-5=0, RT=15-15=0  (Q0→Q1)
  assertEq(tm3.completionTime,  20, 'MLFQ P3 CT=20');
  assertEq(tm3.turnaroundTime,   5, 'MLFQ P3 TAT=5  (CT=20, arr=15)');
  assertEq(tm3.waitingTime,      0, 'MLFQ P3 WT=0   (TAT=5,  burst=5)');
  assertEq(tm3.responseTime,     0, 'MLFQ P3 RT=0   (first ran at t=15, arr=15)');

  // WT = TAT - burst self-consistency check
  assertEq(tm1.waitingTime, tm1.turnaroundTime - 10, 'MLFQ P1 WT = TAT - burst self-consistent');
  assertEq(tm2.waitingTime, tm2.turnaroundTime -  3, 'MLFQ P2 WT = TAT - burst self-consistent');
  assertEq(tm3.waitingTime, tm3.turnaroundTime -  5, 'MLFQ P3 WT = TAT - burst self-consistent');

  // ── Process Metrics (join-barrier, same as thread for single-threaded) ─────────
  console.log('\n--- MLFQ Process Metrics ---');
  const pm = t.processMetrics;
  assertEq(pm.length, 3, 'MLFQ 3 process metrics entries');

  const pm1 = pm.find(m => m.pid === 1);
  const pm2 = pm.find(m => m.pid === 2);
  const pm3 = pm.find(m => m.pid === 3);

  assertEq(pm1.completionTime,  13, 'MLFQ P1 process CT=13');
  assertEq(pm1.turnaroundTime,  13, 'MLFQ P1 process TAT=13');
  assertEq(pm1.waitingTime,      3, 'MLFQ P1 process WT=3');
  assertEq(pm1.responseTime,     0, 'MLFQ P1 process RT=0');

  assertEq(pm2.completionTime,   9, 'MLFQ P2 process CT=9');
  assertEq(pm2.turnaroundTime,   8, 'MLFQ P2 process TAT=8');
  assertEq(pm2.waitingTime,      5, 'MLFQ P2 process WT=5');
  assertEq(pm2.responseTime,     1, 'MLFQ P2 process RT=1');

  assertEq(pm3.completionTime,  20, 'MLFQ P3 process CT=20');
  assertEq(pm3.turnaroundTime,   5, 'MLFQ P3 process TAT=5');
  assertEq(pm3.waitingTime,      0, 'MLFQ P3 process WT=0');
  assertEq(pm3.responseTime,     0, 'MLFQ P3 process RT=0');

  // ── Aggregate Metrics ─────────────────────────────────────────────────────────
  console.log('\n--- MLFQ Aggregate Metrics ---');
  // Thread-level averages: CT avg=(13+9+20)/3=14, TAT avg=(13+8+5)/3≈8.667
  // WT avg=(3+5+0)/3≈2.667, RT avg=(0+1+0)/3≈0.333
  // CPU util: 18 busy ticks / 20 total ticks = 90%
  assertApprox(t.aggregateMetrics.avgCompletionTime,  (13 + 9 + 20) / 3, 'MLFQ Avg CT  ≈14.0');
  assertApprox(t.aggregateMetrics.avgTurnaroundTime,  (13 + 8 +  5) / 3, 'MLFQ Avg TAT ≈8.667');
  assertApprox(t.aggregateMetrics.avgWaitingTime,     ( 3 + 5 +  0) / 3, 'MLFQ Avg WT  ≈2.667');
  assertApprox(t.aggregateMetrics.avgResponseTime,    ( 0 + 1 +  0) / 3, 'MLFQ Avg RT  ≈0.333');
  assertApprox(t.aggregateMetrics.cpuUtilization,     90,                 'MLFQ CPU util=90%');
  assertEq(t.aggregateMetrics.totalContextSwitches,   4,                  'MLFQ totalCS=4');

  // ── Timeline printout ─────────────────────────────────────────────────────────
  const lm9 = new Map(expandToThreads(A9).map(e => [e.tid, e.label]));
  const lbl9 = tid => lm9.get(tid) ?? `T${tid}`;
  console.log('\n=== MLFQ Timeline (A.9 input) ===');
  console.log('t  | running | Q0(RR,q=2)           | Q1(RR,q=4)           | Q2(FCFS)             | arr | cmp | CS | dem          | pro');
  console.log('---+---------+----------------------+----------------------+----------------------+-----+-----+----+--------------+---');
  for (const e of t.timeline) {
    const run  = e.runningTid !== null ? lbl9(e.runningTid).padEnd(7) : 'idle   ';
    const q0   = (e.queueLevels[0].entities.map(x => x.label).join(',') || '-').padEnd(20);
    const q1   = (e.queueLevels[1].entities.map(x => x.label).join(',') || '-').padEnd(20);
    const q2   = (e.queueLevels[2].entities.map(x => x.label).join(',') || '-').padEnd(20);
    const arr  = e.arrivedThisTick.map(tid => lbl9(tid)).join(',').padEnd(3);
    const cmp  = e.completedThisTick.map(tid => lbl9(tid)).join(',').padEnd(3);
    const dem  = (e.demotions.map(d => `${lbl9(d.tid)}:Q${d.from}→Q${d.to}`).join(',') || '').padEnd(12);
    const pro  = e.promotions.map(p => `${lbl9(p.tid)}:Q${p.from}→Q${p.to}`).join(',') || '';
    console.log(
      `${String(e.time).padStart(2)} | ${run} | ${q0} | ${q1} | ${q2} | ${arr} | ${cmp} | ${e.contextSwitch ? 'CS' : '  '} | ${dem} | ${pro}`
    );
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

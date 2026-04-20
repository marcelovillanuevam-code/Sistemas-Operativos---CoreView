// test-threads.js — Thread-aware scheduling tests. Expected values from ARCHITECTURE.md Appendix C.
// Run with: node tests/test-threads.js
// Covers: expandToThreads (C.1 extra), generateThreadTrace P3/FCFS (C.4), single-thread case.

import { expandToThreads, generateThreadTrace } from '../engine/thread-utils.js';

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

// ─── C.1 Multi-Threaded Input ─────────────────────────────────────────────────

const C1 = [
  {
    pid: 1, arrivalTime: 0, burstTime: 8, priority: 2, sharedPages: 3, numPages: 5,
    threads: [
      { tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 2, state: 'NEW', remainingTime: 5, stackPages: 1 },
      { tid: 2, parentPid: 1, arrivalTime: 0, burstTime: 3, priority: 2, state: 'NEW', remainingTime: 3, stackPages: 1 },
    ],
  },
  {
    pid: 2, arrivalTime: 1, burstTime: 4, priority: 1, sharedPages: 3, numPages: 4,
    threads: [
      { tid: 3, parentPid: 2, arrivalTime: 1, burstTime: 4, priority: 1, state: 'NEW', remainingTime: 4, stackPages: 1 },
    ],
  },
  {
    pid: 3, arrivalTime: 3, burstTime: 7, priority: 3, sharedPages: 4, numPages: 8,
    threads: [
      { tid: 4, parentPid: 3, arrivalTime: 3, burstTime: 2, priority: 3, state: 'NEW', remainingTime: 2, stackPages: 1 },
      { tid: 5, parentPid: 3, arrivalTime: 4, burstTime: 3, priority: 3, state: 'NEW', remainingTime: 3, stackPages: 2 },
      { tid: 6, parentPid: 3, arrivalTime: 5, burstTime: 2, priority: 3, state: 'NEW', remainingTime: 2, stackPages: 1 },
    ],
  },
];

// ─── expandToThreads — additional C.1 checks ─────────────────────────────────

console.log('\n=== expandToThreads — C.1 sort order & remainingTime ===');
{
  const entities = expandToThreads(C1);

  assertEq(entities.length, 6, 'C.1 expandToThreads produces 6 entities');

  // Sort order: arrivalTime asc, then pid asc, then tid asc
  assertEq(entities[0].tid, 1, 'sorted[0] = tid=1 (arr=0, pid=1)');
  assertEq(entities[1].tid, 2, 'sorted[1] = tid=2 (arr=0, pid=1)');
  assertEq(entities[2].tid, 3, 'sorted[2] = tid=3 (arr=1, pid=2)');
  assertEq(entities[3].tid, 4, 'sorted[3] = tid=4 (arr=3, pid=3)');
  assertEq(entities[4].tid, 5, 'sorted[4] = tid=5 (arr=4, pid=3)');
  assertEq(entities[5].tid, 6, 'sorted[5] = tid=6 (arr=5, pid=3)');

  // remainingTime starts at burstTime
  assertEq(entities[0].remainingTime, 5, 'tid=1 remainingTime=5 (=burstTime)');
  assertEq(entities[4].remainingTime, 3, 'tid=5 remainingTime=3 (=burstTime)');

  // burstTime from thread, not process
  assertEq(entities[0].burstTime, 5, 'tid=1 burstTime=5 (thread burst, not process burst 8)');
  assertEq(entities[1].burstTime, 3, 'tid=2 burstTime=3');

  // priority inherited from process
  assertEq(entities[0].priority, 2, 'tid=1 priority=2 (from P1)');
  assertEq(entities[2].priority, 1, 'tid=3 priority=1 (from P2)');
  assertEq(entities[3].priority, 3, 'tid=4 priority=3 (from P3)');
}

console.log('\n=== expandToThreads — single-threaded auto-expand ===');
{
  // Process with no threads array → auto-generate 1 thread
  const singleProc = [{ pid: 7, arrivalTime: 2, burstTime: 4, priority: 1, sharedPages: 2, numPages: 3 }];
  const entities = expandToThreads(singleProc);

  assertEq(entities.length, 1, 'auto-expand: 1 entity for single-threaded process');
  assertEq(entities[0].pid, 7, 'auto-expand: pid preserved');
  assertEq(entities[0].label, 'P7', 'auto-expand: label = "P7" (no T suffix)');
  assertEq(entities[0].burstTime, 4, 'auto-expand: burstTime = process burstTime');
  assertEq(entities[0].arrivalTime, 2, 'auto-expand: arrivalTime = process arrivalTime');
}

console.log('\n=== expandToThreads — TID assignment from existing threads ===');
{
  // If processes already have explicit TIDs, maxTid is respected
  const procs = [
    {
      pid: 1, arrivalTime: 0, burstTime: 5, priority: 1, sharedPages: 1, numPages: 2,
      threads: [{ tid: 10, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 1, stackPages: 1 }],
    },
    // P2 has no threads — auto-generated TID should be 11 (maxTid+1)
    { pid: 2, arrivalTime: 1, burstTime: 3, priority: 1, sharedPages: 1, numPages: 2 },
  ];
  const entities = expandToThreads(procs);
  assertEq(entities.length, 2, 'TID assignment: 2 entities');
  assertEq(entities[0].tid, 10, 'explicit TID=10 preserved');
  assertEq(entities[1].tid, 11, 'auto-generated TID=11 (maxTid+1=10+1)');
  assertEq(entities[1].label, 'P2', 'auto-generated single-thread label = "P2"');
}

// ─── C.4 generateThreadTrace — P3 under FCFS ─────────────────────────────────

console.log('\n=== generateThreadTrace — C.4 P3 under FCFS ===');
{
  const trace = generateThreadTrace(C1, 3, { algorithm: 'FCFS' });

  // Top-level structure
  assertEq(trace.pid, 3, 'C.4 trace.pid = 3');
  assertEq(trace.processArrivalTime, 3, 'C.4 processArrivalTime = 3');
  assertEq(trace.threads.length, 3, 'C.4 trace.threads has 3 threads');
  assert(Array.isArray(trace.timeline), 'C.4 trace.timeline is an array');
  assert(trace.timeline.length > 0, 'C.4 trace.timeline is non-empty');
  assert(Array.isArray(trace.allEvents), 'C.4 trace.allEvents is an array');

  // Thread TIDs
  const tids = trace.threads.map(t => t.tid).sort((a, b) => a - b);
  assertEq(tids[0], 4, 'C.4 P3 thread[0] tid=4');
  assertEq(tids[1], 5, 'C.4 P3 thread[1] tid=5');
  assertEq(tids[2], 6, 'C.4 P3 thread[2] tid=6');

  // Timeline covers t=0 (global sim start) to t=19 (P3 last thread done)
  const firstEntry = trace.timeline[0];
  const lastEntry  = trace.timeline[trace.timeline.length - 1];
  assertEq(firstEntry.time, 0,  'C.4 timeline starts at t=0 (global simulation start)');
  assertEq(lastEntry.time,  19, 'C.4 timeline ends at t=19 (all threads done)');

  // ── Thread metrics (C.4 = same as C.2 for P3 threads) ────────────────────
  console.log('\n--- C.4 Thread Metrics ---');
  const tm = trace.threadMetrics;
  assertEq(tm.length, 3, 'C.4 3 threadMetrics entries (P3 threads only)');

  const tm4 = tm.find(m => m.tid === 4);
  const tm5 = tm.find(m => m.tid === 5);
  const tm6 = tm.find(m => m.tid === 6);

  assert(tm4 !== undefined, 'C.4 threadMetrics has entry for tid=4');
  assert(tm5 !== undefined, 'C.4 threadMetrics has entry for tid=5');
  assert(tm6 !== undefined, 'C.4 threadMetrics has entry for tid=6');

  assertEq(tm4.completionTime, 14, 'C.4 tid=4 P3-T1 CT=14');
  assertEq(tm4.turnaroundTime, 11, 'C.4 tid=4 P3-T1 TAT=11 (14-3)');
  assertEq(tm4.waitingTime,     9, 'C.4 tid=4 P3-T1 WT=9  (11-2)');

  assertEq(tm5.completionTime, 17, 'C.4 tid=5 P3-T2 CT=17');
  assertEq(tm5.turnaroundTime, 13, 'C.4 tid=5 P3-T2 TAT=13 (17-4)');
  assertEq(tm5.waitingTime,    10, 'C.4 tid=5 P3-T2 WT=10 (13-3)');

  assertEq(tm6.completionTime, 19, 'C.4 tid=6 P3-T3 CT=19');
  assertEq(tm6.turnaroundTime, 14, 'C.4 tid=6 P3-T3 TAT=14 (19-5)');
  assertEq(tm6.waitingTime,    12, 'C.4 tid=6 P3-T3 WT=12 (14-2)');

  // ── Events (C.4 Appendix) ─────────────────────────────────────────────────
  console.log('\n--- C.4 Events ---');
  const events = trace.allEvents;

  // CREATED events
  const created = events.filter(e => e.type === 'CREATED');
  assertEq(created.length, 3, 'C.4 3 CREATED events (one per thread)');
  assert(created.some(e => e.tid === 4 && e.time === 3), 'C.4 T1 CREATED at t=3');
  assert(created.some(e => e.tid === 5 && e.time === 4), 'C.4 T2 CREATED at t=4');
  assert(created.some(e => e.tid === 6 && e.time === 5), 'C.4 T3 CREATED at t=5');

  // DISPATCHED events (first run of each thread)
  const dispatched = events.filter(e => e.type === 'DISPATCHED');
  assert(dispatched.some(e => e.tid === 4 && e.time === 12), 'C.4 T1 DISPATCHED at t=12');
  assert(dispatched.some(e => e.tid === 5 && e.time === 14), 'C.4 T2 DISPATCHED at t=14');
  assert(dispatched.some(e => e.tid === 6 && e.time === 17), 'C.4 T3 DISPATCHED at t=17');

  // COMPLETED events
  const completed = events.filter(e => e.type === 'COMPLETED');
  assertEq(completed.length, 3, 'C.4 3 COMPLETED events');
  assert(completed.some(e => e.tid === 4 && e.time === 14), 'C.4 T1 COMPLETED at t=14');
  assert(completed.some(e => e.tid === 5 && e.time === 17), 'C.4 T2 COMPLETED at t=17');
  assert(completed.some(e => e.tid === 6 && e.time === 19), 'C.4 T3 COMPLETED at t=19');

  // JOINED event (process join barrier)
  const joined = events.filter(e => e.type === 'JOINED');
  assertEq(joined.length, 1, 'C.4 exactly 1 JOINED event');
  assertEq(joined[0].time, 19, 'C.4 JOINED at t=19 (last thread completion)');

  // ── SharedResources (C.4) ─────────────────────────────────────────────────
  console.log('\n--- C.4 SharedResources ---');
  const sr = trace.sharedResources;

  assert(Array.isArray(sr.sharedPageNumbers), 'C.4 sharedPageNumbers is an array');
  assertEq(sr.sharedPageNumbers.length, 4, 'C.4 4 shared pages (sharedPages=4)');
  assertEq(sr.sharedPageNumbers[0], 0, 'C.4 shared pages start at 0');
  assertEq(sr.sharedPageNumbers[1], 1, 'C.4 shared page 1');
  assertEq(sr.sharedPageNumbers[2], 2, 'C.4 shared page 2');
  assertEq(sr.sharedPageNumbers[3], 3, 'C.4 shared page 3');

  assertEq(sr.threadStacks.length, 3, 'C.4 3 threadStack entries');

  const stack4 = sr.threadStacks.find(s => s.tid === 4);
  const stack5 = sr.threadStacks.find(s => s.tid === 5);
  const stack6 = sr.threadStacks.find(s => s.tid === 6);

  assert(stack4 !== undefined, 'C.4 threadStacks has entry for tid=4');
  assert(stack5 !== undefined, 'C.4 threadStacks has entry for tid=5');
  assert(stack6 !== undefined, 'C.4 threadStacks has entry for tid=6');

  // P3: sharedPages=[0,1,2,3], T1 stack=[4], T2 stack=[5,6], T3 stack=[7]
  assertEq(stack4.localIndex, 1, 'C.4 T1 localIndex=1');
  assertEq(stack4.stackPageNumbers.length, 1, 'C.4 T1 has 1 stack page (stackPages=1)');
  assertEq(stack4.stackPageNumbers[0], 4, 'C.4 T1 stack page = 4 (after 4 shared pages)');

  assertEq(stack5.localIndex, 2, 'C.4 T2 localIndex=2');
  assertEq(stack5.stackPageNumbers.length, 2, 'C.4 T2 has 2 stack pages (stackPages=2)');
  assertEq(stack5.stackPageNumbers[0], 5, 'C.4 T2 stack page[0] = 5');
  assertEq(stack5.stackPageNumbers[1], 6, 'C.4 T2 stack page[1] = 6');

  assertEq(stack6.localIndex, 3, 'C.4 T3 localIndex=3');
  assertEq(stack6.stackPageNumbers.length, 1, 'C.4 T3 has 1 stack page (stackPages=1)');
  assertEq(stack6.stackPageNumbers[0], 7, 'C.4 T3 stack page = 7');

  // ── Timeline thread states ────────────────────────────────────────────────
  console.log('\n--- C.4 Timeline thread states ---');

  // At t=3: T1 just arrived → READY, T2/T3 not yet (NEW)
  const entry3 = trace.timeline.find(e => e.time === 3);
  assert(entry3 !== undefined, 'C.4 timeline has entry for t=3');
  const s3 = Object.fromEntries(entry3.threadStates.map(ts => [ts.tid, ts.state]));
  assertEq(s3[4], 'READY', 'C.4 t=3 T1 state=READY (just arrived)');
  assertEq(s3[5], 'NEW',   'C.4 t=3 T2 state=NEW  (arrives at t=4)');
  assertEq(s3[6], 'NEW',   'C.4 t=3 T3 state=NEW  (arrives at t=5)');

  // At t=12: T1 dispatched (RUNNING), T2 READY, T3 READY
  const entry12 = trace.timeline.find(e => e.time === 12);
  assert(entry12 !== undefined, 'C.4 timeline has entry for t=12');
  assertEq(entry12.runningTid, 4, 'C.4 t=12 runningTid=4 (T1)');
  const s12 = Object.fromEntries(entry12.threadStates.map(ts => [ts.tid, ts.state]));
  assertEq(s12[4], 'RUNNING', 'C.4 t=12 T1 state=RUNNING');
  assertEq(s12[5], 'READY',   'C.4 t=12 T2 state=READY');
  assertEq(s12[6], 'READY',   'C.4 t=12 T3 state=READY');

  // At t=19: all TERMINATED
  const entry19 = trace.timeline.find(e => e.time === 19);
  assert(entry19 !== undefined, 'C.4 timeline has entry for t=19');
  const s19 = Object.fromEntries(entry19.threadStates.map(ts => [ts.tid, ts.state]));
  assertEq(s19[4], 'TERMINATED', 'C.4 t=19 T1 state=TERMINATED');
  assertEq(s19[5], 'TERMINATED', 'C.4 t=19 T2 state=TERMINATED');
  assertEq(s19[6], 'TERMINATED', 'C.4 t=19 T3 state=TERMINATED');
}

// ─── generateThreadTrace — single-threaded process (P2) ──────────────────────

console.log('\n=== generateThreadTrace — single-thread P2 under FCFS ===');
{
  const trace = generateThreadTrace(C1, 2, { algorithm: 'FCFS' });

  assertEq(trace.pid, 2, 'P2 trace.pid = 2');
  assertEq(trace.processArrivalTime, 1, 'P2 processArrivalTime = 1');
  assertEq(trace.threads.length, 1, 'P2 has 1 thread');
  assertEq(trace.threads[0].tid, 3, 'P2 thread tid=3');

  // SharedResources: sharedPages=3 → [0,1,2], 1 stack=[3]
  const sr = trace.sharedResources;
  assertEq(sr.sharedPageNumbers.length, 3, 'P2 sharedPageNumbers.length=3');
  assertEq(sr.sharedPageNumbers[0], 0, 'P2 shared[0]=0');
  assertEq(sr.threadStacks.length, 1, 'P2 1 thread stack');
  assertEq(sr.threadStacks[0].stackPageNumbers[0], 3, 'P2 stack page = 3 (after 3 shared)');
  assertEq(sr.threadStacks[0].localIndex, 1, 'P2 T1 localIndex=1');

  // Single thread — no multi-thread suffix
  const tm = trace.threadMetrics;
  assertEq(tm.length, 1, 'P2 1 threadMetrics entry');
  assertEq(tm[0].tid, 3, 'P2 threadMetrics tid=3');
  assertEq(tm[0].completionTime, 12, 'P2 CT=12 (runs t=8-12 under FCFS)');
  assertEq(tm[0].turnaroundTime, 11, 'P2 TAT=11 (12-1)');
  assertEq(tm[0].waitingTime,     7, 'P2 WT=7 (11-4)');

  // Events: 1 CREATED, 1 DISPATCHED, 1 COMPLETED, 1 JOINED
  const events = trace.allEvents;
  const created   = events.filter(e => e.type === 'CREATED');
  const dispatched = events.filter(e => e.type === 'DISPATCHED');
  const completed  = events.filter(e => e.type === 'COMPLETED');
  const joined     = events.filter(e => e.type === 'JOINED');

  assertEq(created.length,    1, 'P2 1 CREATED event');
  assertEq(dispatched.length, 1, 'P2 1 DISPATCHED event');
  assertEq(completed.length,  1, 'P2 1 COMPLETED event');
  assertEq(joined.length,     1, 'P2 1 JOINED event');

  assertEq(created[0].time,    1,  'P2 CREATED at t=1 (thread arrival)');
  assertEq(dispatched[0].time, 8,  'P2 DISPATCHED at t=8');
  assertEq(completed[0].time,  12, 'P2 COMPLETED at t=12');
  assertEq(joined[0].time,     12, 'P2 JOINED at t=12');
}

// ─── generateThreadTrace — respects config algorithm ─────────────────────────

console.log('\n=== generateThreadTrace — algorithm field propagated ===');
{
  // generateThreadTrace uses internal FCFS regardless of config, but it should
  // accept any config object without crashing
  const trace = generateThreadTrace(C1, 1, { algorithm: 'RR' });
  assertEq(trace.pid, 1, 'config.algorithm=RR does not crash; trace.pid=1');
  assertEq(trace.threads.length, 2, 'P1 trace has 2 threads');
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

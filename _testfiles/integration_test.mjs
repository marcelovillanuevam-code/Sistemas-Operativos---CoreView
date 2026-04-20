// integration_test.mjs — Comprehensive Part A/B/C integration test. Run: node _testfiles/integration_test.mjs
import { parseProcessesFromFile, validateProcesses, generateReferenceString } from '../data.js';
import { runFCFS } from '../engine/scheduling-fcfs.js';
import { runSJF }  from '../engine/scheduling-sjf.js';
import { runHRRN } from '../engine/scheduling-hrrn.js';
import { runRoundRobin } from '../engine/scheduling-rr.js';
import { runSRTF } from '../engine/scheduling-srtf.js';
import { runPriorityPreemptive } from '../engine/scheduling-priority.js';
import { runMLQ }  from '../engine/scheduling-mlq.js';
import { runMLFQ } from '../engine/scheduling-mlfq.js';
import { runFIFO } from '../engine/paging-fifo.js';
import { runLRU }  from '../engine/paging-lru.js';
import { runOptimal } from '../engine/paging-optimal.js';
import { runClock } from '../engine/paging-clock.js';
import { runSecondChance } from '../engine/paging-second-chance.js';
import { expandToThreads, generateThreadTrace } from '../engine/thread-utils.js';
import { compareScheduling, comparePageReplacement } from '../engine/comparison.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);

const MLQ_CFG  = { algorithm:'MLQ', mlqQueues:[
  { algorithm:'RR', priorityRange:[1,1], quantum:2 },
  { algorithm:'RR', priorityRange:[2,2], quantum:4 },
  { algorithm:'FCFS', priorityRange:[3,99] },
]};
const MLFQ_CFG = { algorithm:'MLFQ', mlfqLevels:[
  { algorithm:'RR', quantum:2 },
  { algorithm:'RR', quantum:4 },
  { algorithm:'FCFS', quantum:Infinity },
]};

let passed = 0, failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; fails.push(msg); console.error('FAIL:', msg); }
}

function validateSchedTrace(label, trace, procs) {
  ok(trace, `${label}: trace exists`);
  ok(Array.isArray(trace.timeline), `${label}: timeline is array`);
  ok(trace.timeline.length > 0, `${label}: timeline non-empty`);
  ok(Array.isArray(trace.threadMetrics), `${label}: threadMetrics array`);
  ok(Array.isArray(trace.processMetrics), `${label}: processMetrics array`);
  ok(trace.processMetrics.length === procs.length, `${label}: 1 processMetrics per process`);
  const totalThreads = procs.reduce((s,p)=>s+p.threads.length,0);
  ok(trace.threadMetrics.length === totalThreads, `${label}: 1 threadMetrics per thread (expect ${totalThreads}, got ${trace.threadMetrics.length})`);
  ok(trace.aggregateMetrics, `${label}: aggregateMetrics present`);
  ok(typeof trace.aggregateMetrics.cpuUtilization === 'number', `${label}: cpuUtilization is number`);
  ok(typeof trace.aggregateMetrics.totalContextSwitches === 'number', `${label}: totalContextSwitches is number`);
  // Completion time invariant: each process CT = max(threads' CT)
  for (const pm of trace.processMetrics) {
    const threadCTs = trace.threadMetrics.filter(t=>t.pid===pm.pid).map(t=>t.completionTime);
    const maxCT = Math.max(...threadCTs);
    ok(pm.completionTime === maxCT, `${label}: P${pm.pid} CT=${pm.completionTime} should be max(thread CTs)=${maxCT}`);
    // TAT = CT - arrival. Find process arrival
    const proc = procs.find(p=>p.pid===pm.pid);
    ok(pm.turnaroundTime === maxCT - proc.arrivalTime, `${label}: P${pm.pid} TAT=${pm.turnaroundTime} should be ${maxCT - proc.arrivalTime}`);
    // WT = TAT - sum(threads bursts)
    const sumBursts = proc.threads.reduce((s,t)=>s+t.burstTime,0);
    ok(pm.waitingTime === pm.turnaroundTime - sumBursts, `${label}: P${pm.pid} WT=${pm.waitingTime} should be ${pm.turnaroundTime - sumBursts}`);
  }
  // Timeline structural checks
  for (const entry of trace.timeline) {
    ok(typeof entry.time === 'number', `${label}: timeline entry has numeric time`);
    ok(Array.isArray(entry.readyQueue), `${label}: readyQueue is array`);
    ok(Array.isArray(entry.arrivedThisTick), `${label}: arrivedThisTick is array`);
    ok(Array.isArray(entry.completedThisTick), `${label}: completedThisTick is array`);
    ok(Array.isArray(entry.processStates), `${label}: processStates is array`);
  }
  // CPU busy time equals sum of thread bursts (for non-preemption-losing algorithms)
  const runningTicks = trace.timeline.filter(e=>e.runningTid!==null).length;
  const totalBurst = procs.reduce((s,p)=>s+p.threads.reduce((s2,t)=>s2+t.burstTime,0),0);
  ok(runningTicks === totalBurst, `${label}: running ticks (${runningTicks}) should equal total burst (${totalBurst})`);
}

function validatePagingTrace(label, trace, refs) {
  ok(trace, `${label}: trace exists`);
  ok(Array.isArray(trace.steps), `${label}: steps is array`);
  ok(trace.steps.length === refs.length, `${label}: steps length matches refs`);
  ok(typeof trace.totalFaults === 'number', `${label}: totalFaults numeric`);
  ok(trace.totalFaults + trace.totalHits === refs.length, `${label}: faults+hits=refs`);
  // Monotone fault count
  let prev = 0;
  for (const s of trace.steps) {
    ok(s.faultsSoFar >= prev, `${label}: faultsSoFar monotone at step ${s.stepIndex}`);
    prev = s.faultsSoFar;
    ok(Array.isArray(s.frameState), `${label}: step ${s.stepIndex} has frameState`);
    ok(typeof s.isHit === 'boolean', `${label}: step ${s.stepIndex} has isHit`);
  }
  if (label.includes('CLOCK')) {
    // Clock pointer must be present and within range
    for (const s of trace.steps) {
      ok(typeof s.clockPointer === 'number', `${label}: step ${s.stepIndex} has clockPointer`);
    }
  }
}

// ─── PART A: single-threaded ───────────────────────────────────────────────
console.log('\n=== PART A: Single-threaded ===');
const singleTxt = readFileSync(join(root, '_testfiles', 'test_single.txt'), 'utf8');
const singleProcs = parseProcessesFromFile(singleTxt);
ok(singleProcs.length === 5, 'Part A: 5 processes parsed');
ok(singleProcs.every(p=>p.threads.length===1), 'Part A: all single-threaded');
ok(validateProcesses(singleProcs).valid, 'Part A: validation passes');

// Expected numPages: shared + 1 auto-stack
const expectedPages = {1:5, 2:4, 3:6, 4:3, 5:5};
for (const p of singleProcs) ok(p.numPages === expectedPages[p.pid], `Part A: P${p.pid} numPages=${p.numPages} exp ${expectedPages[p.pid]}`);

const expand = expandToThreads(singleProcs);
ok(expand.length === 5, 'Part A: expandToThreads returns 5 SchedulableEntities');
ok(expand.every(e=>e.label.match(/^P\d+$/)), 'Part A: all labels match /^P\\d+$/ (single-thread format)');

// Run every scheduler
validateSchedTrace('A.FCFS',   runFCFS(singleProcs),   singleProcs);
validateSchedTrace('A.SJF',    runSJF(singleProcs),    singleProcs);
validateSchedTrace('A.HRRN',   runHRRN(singleProcs),   singleProcs);
validateSchedTrace('A.RR(2)',  runRoundRobin(singleProcs, 2), singleProcs);
validateSchedTrace('A.SRTF',   runSRTF(singleProcs),   singleProcs);
validateSchedTrace('A.PRIO',   runPriorityPreemptive(singleProcs), singleProcs);
validateSchedTrace('A.MLQ',    runMLQ(singleProcs, MLQ_CFG),   singleProcs);
validateSchedTrace('A.MLFQ',   runMLFQ(singleProcs, MLFQ_CFG), singleProcs);

// Run every paging algorithm (16 frames, auto-gen refs)
const refsA = generateReferenceString(singleProcs, 20);
ok(refsA.length === 20, 'Part A: 20 refs generated');
ok(refsA.every(r=>'pid' in r && 'pageNumber' in r), 'Part A: refs are PageRef shape');
validatePagingTrace('A.FIFO', runFIFO(16, refsA),  refsA);
validatePagingTrace('A.LRU',  runLRU(16, refsA),   refsA);
validatePagingTrace('A.OPT',  runOptimal(16, refsA), refsA);
validatePagingTrace('A.CLOCK', runClock(16, refsA), refsA);
validatePagingTrace('A.SC',   runSecondChance(16, refsA), refsA);

// Part A comparison
const cmpA = compareScheduling(singleProcs, [
  { algorithm:'FCFS' },{ algorithm:'SJF' },{ algorithm:'HRRN' },
  { algorithm:'RR', quantum:2 },{ algorithm:'SRTF' },{ algorithm:'PRIORITY_PREEMPTIVE' },
  MLQ_CFG, MLFQ_CFG,
]);
ok(cmpA.schedulingComparisons.length === 8, `Part A: comparison has 8 algos (got ${cmpA.schedulingComparisons.length})`);
const cmpPageA = comparePageReplacement(16, refsA, ['FIFO','LRU','OPTIMAL','CLOCK','SECOND_CHANCE']);
ok(cmpPageA.pageReplacementComparisons.length === 5, `Part A: page comparison has 5 algos`);

// ─── PART B: multi-threaded ─────────────────────────────────────────────────
console.log('\n=== PART B: Multi-threaded ===');
const multiTxt = readFileSync(join(root, '_testfiles', 'test_multi.txt'), 'utf8');
const multiProcs = parseProcessesFromFile(multiTxt);
ok(multiProcs.length === 3, `Part B: 3 processes parsed (got ${multiProcs.length})`);
ok(multiProcs[0].threads.length === 2, 'Part B: P1 has 2 threads');
ok(multiProcs[1].threads.length === 1, 'Part B: P2 has 1 thread');
ok(multiProcs[2].threads.length === 3, 'Part B: P3 has 3 threads');
ok(multiProcs[0].numPages === 5, `Part B: P1 numPages=5 (3+1+1) (got ${multiProcs[0].numPages})`);
ok(multiProcs[1].numPages === 4, `Part B: P2 numPages=4 (3+1) (got ${multiProcs[1].numPages})`);
ok(multiProcs[2].numPages === 8, `Part B: P3 numPages=8 (4+1+2+1) (got ${multiProcs[2].numPages})`);
ok(validateProcesses(multiProcs).valid, 'Part B: validation passes');

// Labels
const expandB = expandToThreads(multiProcs);
ok(expandB.length === 6, 'Part B: 6 threads total');
const labelsB = expandB.map(e=>e.label).sort();
const expectedLabels = ['P1-T1','P1-T2','P2','P3-T1','P3-T2','P3-T3'].sort();
ok(JSON.stringify(labelsB) === JSON.stringify(expectedLabels), `Part B: labels match: got ${labelsB.join(',')}`);

validateSchedTrace('B.FCFS',  runFCFS(multiProcs),    multiProcs);
validateSchedTrace('B.RR(2)', runRoundRobin(multiProcs, 2), multiProcs);
validateSchedTrace('B.PRIO',  runPriorityPreemptive(multiProcs), multiProcs);
validateSchedTrace('B.MLFQ',  runMLFQ(multiProcs, MLFQ_CFG), multiProcs);

// Thread trace for P3 under FCFS
const p3Trace = generateThreadTrace(multiProcs, 3, { algorithm:'FCFS' });
ok(p3Trace.pid === 3, 'Part B: P3 trace pid=3');
ok(p3Trace.threads.length === 3, 'Part B: P3 trace has 3 threads');
ok(p3Trace.sharedResources.sharedPageNumbers.length === 4, `Part B: P3 has 4 shared pages (got ${p3Trace.sharedResources.sharedPageNumbers.length})`);
ok(JSON.stringify(p3Trace.sharedResources.sharedPageNumbers) === '[0,1,2,3]', `Part B: P3 shared=[0,1,2,3] (got ${JSON.stringify(p3Trace.sharedResources.sharedPageNumbers)})`);
ok(p3Trace.sharedResources.threadStacks.length === 3, 'Part B: 3 thread stacks');
// T1 stack [4] (1 page), T2 stack [5,6] (2 pages), T3 stack [7] (1 page)
const stacks = p3Trace.sharedResources.threadStacks;
ok(JSON.stringify(stacks[0].stackPageNumbers) === '[4]', `Part B: P3-T1 stack=[4] (got ${JSON.stringify(stacks[0].stackPageNumbers)})`);
ok(JSON.stringify(stacks[1].stackPageNumbers) === '[5,6]', `Part B: P3-T2 stack=[5,6] (got ${JSON.stringify(stacks[1].stackPageNumbers)})`);
ok(JSON.stringify(stacks[2].stackPageNumbers) === '[7]', `Part B: P3-T3 stack=[7] (got ${JSON.stringify(stacks[2].stackPageNumbers)})`);

// Events: CREATED, DISPATCHED, COMPLETED, JOINED present in allEvents flat log
const eventTypes = new Set(p3Trace.allEvents.map(e => e.type));
for (const type of ['CREATED','DISPATCHED','COMPLETED','JOINED']) {
  ok(eventTypes.has(type), `Part B: P3 thread trace has ${type} event (types: ${[...eventTypes]})`);
}

// Single-threaded proc also has trace
const p2Trace = generateThreadTrace(multiProcs, 2, { algorithm:'FCFS' });
ok(p2Trace.threads.length === 1, 'Part B: P2 single thread trace');

// ─── PART C: Edge cases ─────────────────────────────────────────────────────
console.log('\n=== PART C: Edge cases ===');

// C1: Single process with 1 thread (minimum viable input)
const c1 = parseProcessesFromFile('1,0,5,1,1');
ok(c1.length === 1 && c1[0].threads.length === 1, 'C1: 1 proc, 1 thread');
validateSchedTrace('C1.FCFS', runFCFS(c1), c1);
validateSchedTrace('C1.RR1', runRoundRobin(c1, 1), c1);

// C2: Single process with 8 threads (max)
const c2txt = [
  'PID,Arrival,Burst,Priority,SharedPages,ThreadID,ThreadArrival,ThreadBurst,StackPages',
  ...[1,2,3,4,5,6,7,8].map(i=>`1,0,24,1,2,${i},0,3,1`),
].join('\n');
const c2 = parseProcessesFromFile(c2txt);
ok(c2.length === 1, 'C2: 1 proc');
ok(c2[0].threads.length === 8, 'C2: 8 threads');
ok(validateProcesses(c2).valid, 'C2: 8 threads validates OK');
validateSchedTrace('C2.FCFS', runFCFS(c2), c2);
validateSchedTrace('C2.RR2', runRoundRobin(c2, 2), c2);
validateSchedTrace('C2.MLFQ', runMLFQ(c2, MLFQ_CFG), c2);

// C2b: 9 threads should FAIL validation
const c2b_txt = [
  'PID,Arrival,Burst,Priority,SharedPages,ThreadID,ThreadArrival,ThreadBurst,StackPages',
  ...[1,2,3,4,5,6,7,8,9].map(i=>`1,0,27,1,2,${i},0,3,1`),
].join('\n');
const c2b = parseProcessesFromFile(c2b_txt);
const c2bval = validateProcesses(c2b);
ok(!c2bval.valid, `C2b: 9 threads rejected (errors: ${c2bval.errors.join('; ')})`);

// C3: All arrive at t=0
const c3txt = ['PID,Arrival,Burst,Priority,SharedPages',
  '1,0,4,2,2','2,0,6,1,2','3,0,3,3,2','4,0,5,2,2'].join('\n');
const c3 = parseProcessesFromFile(c3txt);
ok(c3.every(p=>p.arrivalTime===0), 'C3: all arrive at 0');
validateSchedTrace('C3.FCFS', runFCFS(c3), c3);
validateSchedTrace('C3.SJF', runSJF(c3), c3);
validateSchedTrace('C3.PRIO', runPriorityPreemptive(c3), c3);
validateSchedTrace('C3.MLQ', runMLQ(c3, MLQ_CFG), c3);

// C4: All same burst
const c4txt = ['PID,Arrival,Burst,Priority,SharedPages',
  '1,0,5,2,2','2,1,5,1,2','3,2,5,3,2'].join('\n');
const c4 = parseProcessesFromFile(c4txt);
ok(c4.every(p=>p.burstTime===5), 'C4: all burst=5');
validateSchedTrace('C4.SJF', runSJF(c4), c4);
validateSchedTrace('C4.SRTF', runSRTF(c4), c4);
validateSchedTrace('C4.HRRN', runHRRN(c4), c4);

// C5: All same priority
const c5txt = ['PID,Arrival,Burst,Priority,SharedPages',
  '1,0,4,2,2','2,1,3,2,2','3,2,5,2,2'].join('\n');
const c5 = parseProcessesFromFile(c5txt);
ok(c5.every(p=>p.priority===2), 'C5: all priority=2');
validateSchedTrace('C5.PRIO', runPriorityPreemptive(c5), c5);
validateSchedTrace('C5.MLQ', runMLQ(c5, MLQ_CFG), c5);

// C6: Idle CPU periods (gap before first arrival, big gap mid-schedule)
const c6txt = ['PID,Arrival,Burst,Priority,SharedPages',
  '1,5,3,1,2','2,20,4,1,2'].join('\n');
const c6 = parseProcessesFromFile(c6txt);
const c6trace = runFCFS(c6);
validateSchedTrace('C6.FCFS', c6trace, c6);
const idleTicks = c6trace.timeline.filter(e=>e.runningTid===null).length;
ok(idleTicks > 0, `C6: has idle ticks (got ${idleTicks})`);

// C7: RR with quantum=1 (max context switches)
const c7 = singleProcs; // reuse
const c7trace = runRoundRobin(c7, 1);
validateSchedTrace('C7.RR1', c7trace, c7);
// Each running tick is potentially a context switch for RR q=1, context switches should be substantial
ok(c7trace.aggregateMetrics.totalContextSwitches > 0, `C7: RR q=1 context switches > 0 (got ${c7trace.aggregateMetrics.totalContextSwitches})`);

console.log(`\n────────────────`);
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  console.log('Failures:');
  for (const f of fails) console.log('  -', f);
  process.exit(1);
}

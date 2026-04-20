// test-data.js — Data layer tests. Validates parseProcessesFromForm, parseProcessesFromFile,
// parseMemoryConfig, parseMemoryConfigFromFile, validateProcesses, and generateReferenceString.
// Run with: node tests/test-data.js

import {
  parseProcessesFromFile,
  parseProcessesFromForm,
  parseMemoryConfig,
  parseMemoryConfigFromFile,
  validateProcesses,
  generateReferenceString,
} from '../data.js';

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

function assertThrows(fn, message) {
  try {
    fn();
    console.error(`  FAIL: ${message}  (expected throw, got nothing)`);
    failed++;
  } catch (_) {
    console.log(`  pass: ${message}`);
    passed++;
  }
}

// ─── FormData mock (Node has no native FormData) ─────────────────────────────

function makeFormData(entries) {
  return { get: (k) => (k in entries ? String(entries[k]) : null) };
}

// ─── parseProcessesFromFile — 5-column ───────────────────────────────────────

console.log('\n=== parseProcessesFromFile — 5-col, no header ===');
{
  const content = `1,0,5,2,4
2,1,3,1,3
3,2,7,3,5`;

  const procs = parseProcessesFromFile(content);
  assertEq(procs.length, 3, '5-col: 3 processes parsed');

  const p1 = procs.find(p => p.pid === 1);
  const p2 = procs.find(p => p.pid === 2);
  const p3 = procs.find(p => p.pid === 3);

  assertEq(p1.arrivalTime, 0, 'P1 arrivalTime=0');
  assertEq(p1.burstTime,   5, 'P1 burstTime=5');
  assertEq(p1.priority,    2, 'P1 priority=2');
  assertEq(p1.sharedPages, 4, 'P1 sharedPages=4');
  assertEq(p1.numPages,    5, 'P1 numPages=5 (4 shared + 1 auto stack)');
  assertEq(p1.threads.length, 1, 'P1 auto-generated 1 thread');
  assertEq(p1.threads[0].stackPages, 1, 'P1 auto thread stackPages=1');
  assertEq(p1.threads[0].burstTime, 5, 'P1 auto thread burstTime=5');

  assertEq(p2.arrivalTime, 1,  'P2 arrivalTime=1');
  assertEq(p2.numPages,    4,  'P2 numPages=4 (3 shared + 1 auto stack)');

  assertEq(p3.arrivalTime, 2,  'P3 arrivalTime=2');
  assertEq(p3.numPages,    6,  'P3 numPages=6 (5 shared + 1 auto stack)');
}

console.log('\n=== parseProcessesFromFile — 5-col, with header line ===');
{
  const content = `PID,Arrival,Burst,Priority,SharedPages
1,0,8,2,4
2,1,4,1,3
3,3,9,3,5
4,5,5,2,2
5,6,2,1,4`;

  const procs = parseProcessesFromFile(content);
  assertEq(procs.length, 5, '5-col+header: 5 processes (header skipped)');
  assertEq(procs[0].pid, 1, 'first PID=1 (not "PID")');
  assertEq(procs[1].pid, 2, 'second PID=2');
  assertEq(procs[4].pid, 5, 'last PID=5');

  const p1 = procs.find(p => p.pid === 1);
  assertEq(p1.burstTime,   8, '5-col+header: P1 burstTime=8');
  assertEq(p1.sharedPages, 4, '5-col+header: P1 sharedPages=4');
  assertEq(p1.numPages,    5, '5-col+header: P1 numPages=5');
}

console.log('\n=== parseProcessesFromFile — 5-col, comment lines skipped ===');
{
  const content = `# This is a comment
1,0,5,2,4
# Another comment
2,1,3,1,3`;

  const procs = parseProcessesFromFile(content);
  assertEq(procs.length, 2, '5-col+comments: 2 processes (comments skipped)');
  assertEq(procs[0].pid, 1, 'first pid=1');
  assertEq(procs[1].pid, 2, 'second pid=2');
}

console.log('\n=== parseProcessesFromFile — 5-col, sorted by PID ===');
{
  // Processes in non-PID order: should be sorted by PID
  const content = `3,0,7,3,5
1,0,5,2,4
2,1,3,1,3`;

  const procs = parseProcessesFromFile(content);
  assertEq(procs[0].pid, 1, 'sorted: procs[0].pid=1');
  assertEq(procs[1].pid, 2, 'sorted: procs[1].pid=2');
  assertEq(procs[2].pid, 3, 'sorted: procs[2].pid=3');
}

// ─── parseProcessesFromFile — 9-column ───────────────────────────────────────

console.log('\n=== parseProcessesFromFile — 9-col, no header ===');
{
  const content = `1,0,8,2,3,1,0,5,1
1,0,8,2,3,2,0,3,1
2,1,4,1,3,3,1,4,1
3,3,7,3,4,4,3,2,1
3,3,7,3,4,5,4,3,2
3,3,7,3,4,6,5,2,1`;

  const procs = parseProcessesFromFile(content);
  assertEq(procs.length, 3, '9-col: 3 processes');

  const p1 = procs.find(p => p.pid === 1);
  const p2 = procs.find(p => p.pid === 2);
  const p3 = procs.find(p => p.pid === 3);

  // P1: sharedPages=3, 2 threads (stackPages=1 each) → numPages=5
  assertEq(p1.threads.length, 2, 'P1 has 2 threads');
  assertEq(p1.numPages,       5, 'P1 numPages=5 (3+1+1)');
  assertEq(p1.sharedPages,    3, 'P1 sharedPages=3');
  assertEq(p1.burstTime,      8, 'P1 burstTime=8 (sum of thread bursts 5+3)');

  const t1 = p1.threads[0];
  const t2 = p1.threads[1];
  assertEq(t1.burstTime,   5, 'P1-T1 burstTime=5');
  assertEq(t1.stackPages,  1, 'P1-T1 stackPages=1');
  assertEq(t2.burstTime,   3, 'P1-T2 burstTime=3');
  assertEq(t2.stackPages,  1, 'P1-T2 stackPages=1');

  // P2: sharedPages=3, 1 thread (stackPages=1) → numPages=4
  assertEq(p2.threads.length, 1, 'P2 has 1 thread');
  assertEq(p2.numPages,       4, 'P2 numPages=4 (3+1)');

  // P3: sharedPages=4, 3 threads (stackPages 1+2+1=4) → numPages=8
  assertEq(p3.threads.length, 3, 'P3 has 3 threads');
  assertEq(p3.numPages,       8, 'P3 numPages=8 (4+1+2+1)');
  assertEq(p3.burstTime,      7, 'P3 burstTime=7 (2+3+2)');

  const t3threads = p3.threads;
  assertEq(t3threads[0].burstTime,  2, 'P3-T1 burstTime=2');
  assertEq(t3threads[0].stackPages, 1, 'P3-T1 stackPages=1');
  assertEq(t3threads[1].burstTime,  3, 'P3-T2 burstTime=3');
  assertEq(t3threads[1].stackPages, 2, 'P3-T2 stackPages=2');
  assertEq(t3threads[2].burstTime,  2, 'P3-T3 burstTime=2');
  assertEq(t3threads[2].stackPages, 1, 'P3-T3 stackPages=1');
}

console.log('\n=== parseProcessesFromFile — 9-col, with header line ===');
{
  const content = `PID,Arrival,Burst,Priority,SharedPages,ThreadID,ThreadArrival,ThreadBurst,StackPages
1,0,8,2,3,1,0,5,1
1,0,8,2,3,2,0,3,1
2,1,4,1,3,3,1,4,1`;

  const procs = parseProcessesFromFile(content);
  assertEq(procs.length, 2, '9-col+header: 2 processes (header skipped)');

  const p1 = procs.find(p => p.pid === 1);
  assertEq(p1.threads.length, 2, '9-col+header: P1 has 2 threads');
}

console.log('\n=== parseProcessesFromFile — 9-col, TIDs globally sequential ===');
{
  const content = `1,0,8,2,3,1,0,5,1
1,0,8,2,3,2,0,3,1
2,1,4,1,3,3,1,4,1`;

  const procs = parseProcessesFromFile(content);
  const allTids = procs.flatMap(p => p.threads.map(t => t.tid));
  assertEq(allTids.length, 3, '9-col TIDs: 3 threads total');
  // TIDs should be sequential: 1, 2, 3
  assert(allTids.includes(1), 'TID 1 assigned');
  assert(allTids.includes(2), 'TID 2 assigned');
  assert(allTids.includes(3), 'TID 3 assigned');
  // All unique
  assertEq(new Set(allTids).size, 3, 'all TIDs are globally unique');
}

// ─── parseProcessesFromFile — error cases ─────────────────────────────────────

console.log('\n=== parseProcessesFromFile — error cases ===');
{
  assertThrows(
    () => parseProcessesFromFile(''),
    'empty content throws'
  );

  assertThrows(
    () => parseProcessesFromFile('# only comment'),
    'only-comment file throws'
  );

  assertThrows(
    () => parseProcessesFromFile('1,0,5'),
    '3-column file throws (expected 5 or 9)'
  );

  assertThrows(
    () => parseProcessesFromFile('1,0,5,2,4,extra,col,here,more,yep'),
    '10-column file throws (expected 5 or 9)'
  );

  assertThrows(
    () => parseProcessesFromFile('1,0,X,2,4'),
    'non-numeric data column throws'
  );
}

// ─── parseMemoryConfigFromFile ────────────────────────────────────────────────

console.log('\n=== parseMemoryConfigFromFile ===');
{
  const cfg = parseMemoryConfigFromFile('64,4');
  assertEq(cfg.totalMemory, 64, 'totalMemory=64');
  assertEq(cfg.pageSize,     4, 'pageSize=4');
  assertEq(cfg.numFrames,   16, 'numFrames=64/4=16');

  const cfg2 = parseMemoryConfigFromFile('256,32');
  assertEq(cfg2.numFrames, 8, 'numFrames=256/32=8');

  // With a comment line
  const cfg3 = parseMemoryConfigFromFile('# memory config\n128,16');
  assertEq(cfg3.totalMemory, 128, 'comment + config: totalMemory=128');
  assertEq(cfg3.numFrames,     8, 'comment + config: numFrames=8');

  assertThrows(
    () => parseMemoryConfigFromFile(''),
    'empty memory config throws'
  );

  assertThrows(
    () => parseMemoryConfigFromFile('# just a comment'),
    'only-comment memory config throws'
  );

  assertThrows(
    () => parseMemoryConfigFromFile('notanumber,8'),
    'non-numeric memory config throws'
  );
}

// ─── parseProcessesFromForm ───────────────────────────────────────────────────

console.log('\n=== parseProcessesFromForm ===');
{
  // Single-threaded via form (threads array empty)
  const rawProcs = [
    { pid: 1, arrival: 0, burst: 5, priority: 2, sharedPages: 4, threads: [] },
    { pid: 2, arrival: 1, burst: 3, priority: 1, sharedPages: 3, threads: [] },
  ];
  const fd = makeFormData({ processes: JSON.stringify(rawProcs) });
  const procs = parseProcessesFromForm(fd);

  assertEq(procs.length, 2, 'parseProcessesFromForm: 2 processes');
  const p1 = procs.find(p => p.pid === 1);
  assertEq(p1.burstTime,  5, 'form P1 burstTime=5');
  assertEq(p1.numPages,   5, 'form P1 numPages=5 (4 shared + 1 auto stack)');
  assertEq(p1.threads.length, 1, 'form P1 auto-generates 1 thread');

  // Multi-threaded via form (explicit threads array)
  const rawMulti = [
    {
      pid: 1, arrival: 0, burst: 8, priority: 2, sharedPages: 3,
      threads: [
        { arrival: 0, burst: 5, stackPages: 1 },
        { arrival: 0, burst: 3, stackPages: 1 },
      ],
    },
  ];
  const fd2 = makeFormData({ processes: JSON.stringify(rawMulti) });
  const procs2 = parseProcessesFromForm(fd2);
  assertEq(procs2.length, 1, 'form multi-threaded: 1 process');
  assertEq(procs2[0].threads.length, 2, 'form multi-threaded: 2 threads');
  assertEq(procs2[0].numPages, 5, 'form multi-threaded: numPages=5 (3+1+1)');

  // Empty form data returns []
  const fdEmpty = makeFormData({});
  const procsEmpty = parseProcessesFromForm(fdEmpty);
  assertEq(procsEmpty.length, 0, 'form with no "processes" key returns []');
}

// ─── parseMemoryConfig (form) ─────────────────────────────────────────────────

console.log('\n=== parseMemoryConfig (form) ===');
{
  const fd = makeFormData({ totalMemory: 64, pageSize: 4 });
  const cfg = parseMemoryConfig(fd);
  assertEq(cfg.totalMemory, 64, 'form memCfg totalMemory=64');
  assertEq(cfg.pageSize,     4, 'form memCfg pageSize=4');
  assertEq(cfg.numFrames,   16, 'form memCfg numFrames=16');
}

// ─── validateProcesses ────────────────────────────────────────────────────────

console.log('\n=== validateProcesses — valid cases ===');
{
  // Valid single-threaded
  const singleProcs = [
    { pid: 1, arrivalTime: 0, burstTime: 5, priority: 1, sharedPages: 2, numPages: 3,
      threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 1, stackPages: 1 }] },
  ];
  const r1 = validateProcesses(singleProcs);
  assertEq(r1.valid, true, 'valid single-threaded: valid=true');
  assertEq(r1.errors.length, 0, 'valid single-threaded: no errors');

  // Valid multi-threaded
  const multiProcs = [
    {
      pid: 1, arrivalTime: 0, burstTime: 8, priority: 2, sharedPages: 3, numPages: 5,
      threads: [
        { tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 2, stackPages: 1 },
        { tid: 2, parentPid: 1, arrivalTime: 0, burstTime: 3, priority: 2, stackPages: 1 },
      ],
    },
    {
      pid: 2, arrivalTime: 1, burstTime: 4, priority: 1, sharedPages: 3, numPages: 4,
      threads: [{ tid: 3, parentPid: 2, arrivalTime: 1, burstTime: 4, priority: 1, stackPages: 1 }],
    },
  ];
  const r2 = validateProcesses(multiProcs);
  assertEq(r2.valid, true,  'valid multi-threaded: valid=true');
  assertEq(r2.errors.length, 0, 'valid multi-threaded: no errors');
}

console.log('\n=== validateProcesses — sharedPages < 1 ===');
{
  const procs = [
    { pid: 1, arrivalTime: 0, burstTime: 5, priority: 1, sharedPages: 0, numPages: 1,
      threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 1, stackPages: 1 }] },
  ];
  const r = validateProcesses(procs);
  assertEq(r.valid, false, 'sharedPages=0: valid=false');
  assert(r.errors.some(e => e.includes('sharedPages')), 'sharedPages error message includes "sharedPages"');
}

console.log('\n=== validateProcesses — too many threads (> 8) ===');
{
  const threads9 = Array.from({ length: 9 }, (_, i) => ({
    tid: i + 1, parentPid: 1, arrivalTime: 0, burstTime: 1, priority: 1, stackPages: 1,
  }));
  const procs = [
    { pid: 1, arrivalTime: 0, burstTime: 9, priority: 1, sharedPages: 1, numPages: 10, threads: threads9 },
  ];
  const r = validateProcesses(procs);
  assertEq(r.valid, false, '9 threads: valid=false');
  assert(r.errors.some(e => e.includes('8')), 'error message mentions "8" (system cap)');
}

console.log('\n=== validateProcesses — 8 threads (at system cap) ===');
{
  const threads8 = Array.from({ length: 8 }, (_, i) => ({
    tid: i + 1, parentPid: 1, arrivalTime: 0, burstTime: 1, priority: 1, stackPages: 1,
  }));
  const procs = [
    { pid: 1, arrivalTime: 0, burstTime: 8, priority: 1, sharedPages: 1, numPages: 9, threads: threads8 },
  ];
  const r = validateProcesses(procs);
  assertEq(r.valid, true, '8 threads (at cap): valid=true');
}

console.log('\n=== validateProcesses — thread burst <= 0 ===');
{
  const procs = [
    { pid: 1, arrivalTime: 0, burstTime: 0, priority: 1, sharedPages: 1, numPages: 2,
      threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 0, priority: 1, stackPages: 1 }] },
  ];
  const r = validateProcesses(procs);
  assertEq(r.valid, false, 'burst=0: valid=false');
  assert(r.errors.some(e => e.includes('burst')), 'error message includes "burst"');
}

console.log('\n=== validateProcesses — thread arrival < process arrival ===');
{
  const procs = [
    { pid: 1, arrivalTime: 5, burstTime: 3, priority: 1, sharedPages: 1, numPages: 2,
      threads: [{ tid: 1, parentPid: 1, arrivalTime: 3, burstTime: 3, priority: 1, stackPages: 1 }] },
  ];
  const r = validateProcesses(procs);
  assertEq(r.valid, false, 'thread arrival < process arrival: valid=false');
  assert(r.errors.some(e => e.includes('arrival')), 'error message includes "arrival"');
}

console.log('\n=== validateProcesses — stackPages < 1 ===');
{
  const procs = [
    { pid: 1, arrivalTime: 0, burstTime: 3, priority: 1, sharedPages: 1, numPages: 1,
      threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 3, priority: 1, stackPages: 0 }] },
  ];
  const r = validateProcesses(procs);
  assertEq(r.valid, false, 'stackPages=0: valid=false');
  assert(r.errors.some(e => e.includes('stackPages')), 'error message includes "stackPages"');
}

console.log('\n=== validateProcesses — numPages mismatch ===');
{
  const procs = [
    { pid: 1, arrivalTime: 0, burstTime: 3, priority: 1, sharedPages: 2, numPages: 99,
      threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 3, priority: 1, stackPages: 1 }] },
  ];
  // numPages should be 2+1=3, but we set 99 → mismatch
  const r = validateProcesses(procs);
  assertEq(r.valid, false, 'numPages mismatch: valid=false');
  assert(r.errors.some(e => e.includes('numPages')), 'error message includes "numPages"');
}

console.log('\n=== validateProcesses — no threads ===');
{
  const procs = [
    { pid: 1, arrivalTime: 0, burstTime: 5, priority: 1, sharedPages: 1, numPages: 2, threads: [] },
  ];
  const r = validateProcesses(procs);
  assertEq(r.valid, false, 'zero threads: valid=false');
}

console.log('\n=== validateProcesses — multiple errors reported ===');
{
  const procs = [
    { pid: 1, arrivalTime: 0, burstTime: 0, priority: 1, sharedPages: 0, numPages: 0,
      threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 0, priority: 1, stackPages: 0 }] },
  ];
  const r = validateProcesses(procs);
  assertEq(r.valid, false, 'multiple errors: valid=false');
  assert(r.errors.length >= 3, `multiple errors: at least 3 errors reported (got ${r.errors.length})`);
}

// ─── generateReferenceString ──────────────────────────────────────────────────

console.log('\n=== generateReferenceString — basic ===');
{
  const procs = [
    { pid: 1, arrivalTime: 0, burstTime: 5, priority: 1, sharedPages: 2, numPages: 3,
      threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 5, priority: 1, stackPages: 1 }] },
  ];
  const refs = generateReferenceString(procs, 9);
  assertEq(refs.length, 9, 'length=9 produces 9 refs');

  // All refs should have pid=1 and pageNumber in range [0, numPages-1]
  for (const ref of refs) {
    assertEq(ref.pid, 1, `ref.pid=1`);
    assert(ref.pageNumber >= 0 && ref.pageNumber < 3, `ref.pageNumber in [0,2] (got ${ref.pageNumber})`);
  }

  // Pages should cycle: 0,1,2,0,1,2,...
  assertEq(refs[0].pageNumber, 0, 'refs[0].pageNumber=0');
  assertEq(refs[1].pageNumber, 1, 'refs[1].pageNumber=1');
  assertEq(refs[2].pageNumber, 2, 'refs[2].pageNumber=2');
  assertEq(refs[3].pageNumber, 0, 'refs[3].pageNumber=0 (wraps)');
}

console.log('\n=== generateReferenceString — multiple processes interleaved ===');
{
  const procs = [
    { pid: 1, arrivalTime: 0, numPages: 2,
      threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 3, priority: 1, stackPages: 1 }] },
    { pid: 2, arrivalTime: 1, numPages: 3,
      threads: [{ tid: 2, parentPid: 2, arrivalTime: 1, burstTime: 3, priority: 1, stackPages: 1 }] },
  ];
  const refs = generateReferenceString(procs, 6);
  assertEq(refs.length, 6, 'multi-process: length=6');
  // Interleaved: P1, P2, P1, P2, P1, P2
  assertEq(refs[0].pid, 1, 'refs[0].pid=1');
  assertEq(refs[1].pid, 2, 'refs[1].pid=2');
  assertEq(refs[2].pid, 1, 'refs[2].pid=1 (interleaved)');
  assertEq(refs[3].pid, 2, 'refs[3].pid=2');
}

console.log('\n=== generateReferenceString — edge cases ===');
{
  const procs = [
    { pid: 1, arrivalTime: 0, numPages: 3,
      threads: [{ tid: 1, parentPid: 1, arrivalTime: 0, burstTime: 3, priority: 1, stackPages: 1 }] },
  ];

  // length=0 → empty
  const r0 = generateReferenceString(procs, 0);
  assertEq(r0.length, 0, 'length=0 → empty array');

  // empty processes → empty
  const rEmpty = generateReferenceString([], 10);
  assertEq(rEmpty.length, 0, 'empty processes → empty array');

  // All refs are PageRef objects with pid and pageNumber
  const r = generateReferenceString(procs, 5);
  for (const ref of r) {
    assert(typeof ref.pid === 'number',        'PageRef has numeric pid');
    assert(typeof ref.pageNumber === 'number', 'PageRef has numeric pageNumber');
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

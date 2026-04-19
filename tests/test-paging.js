// test-paging.js — Page replacement algorithm tests. Expected values from ARCHITECTURE.md Appendix B.
// Run with: node tests/test-paging.js
// Covers: FIFO (B.1), LRU (B.2), Optimal (B.3), Clock (B.4), Second Chance.

import { runFIFO }         from '../engine/paging-fifo.js';
import { runLRU }          from '../engine/paging-lru.js';
import { runOptimal }      from '../engine/paging-optimal.js';
import { runClock }        from '../engine/paging-clock.js';
import { runSecondChance } from '../engine/paging-second-chance.js';

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
  assert(actual === expected, `${message} — expected ${expected}, got ${actual}`);
}

// ─── Standard test case (Appendix B) ─────────────────────────────────────────

// Reference string: [1,2,3,4,1,2,5,1,2,3,4,5], all pid=1, 3 frames.
const refNums = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5];
const refs = refNums.map(n => ({ pid: 1, pageNumber: n }));
const FRAMES = 3;

function frameStr(frameState) {
  return '[' + frameState.map(f => f.pageNumber === null ? '-' : f.pageNumber).join(',') + ']';
}

function refBitStr(bits) {
  if (!bits) return '';
  return ' RefBits=[' + bits.map(b => b ? '1' : '0').join(',') + ']';
}

function printTrace(trace) {
  for (const s of trace.steps) {
    const evStr = s.evicted ? ` evict ${s.evicted.pageNumber}` : '';
    const rbStr = refBitStr(s.referenceBits);
    const ptrStr = s.clockPointer !== undefined ? ` Ptr=${s.clockPointer}` : '';
    const outcome = s.isHit ? 'HIT ' : `FAULT${evStr}`;
    console.log(
      `  Step ${String(s.stepIndex + 1).padStart(2)}: Req=${s.requested.pageNumber}  ${outcome.padEnd(14)} Frames=${frameStr(s.frameState)}${rbStr}${ptrStr}  faults=${s.faultsSoFar}`
    );
  }
  console.log(`  Total faults=${trace.totalFaults}  hits=${trace.totalHits}  hitRate=${trace.hitRate.toFixed(3)}`);
}

// ─── B.1 FIFO ─────────────────────────────────────────────────────────────────

console.log('\n=== FIFO (expected faults=9, hitRate=0.250) ===');
const fifo = runFIFO(FRAMES, refs);
printTrace(fifo);
assertEq(fifo.totalFaults, 9,  'FIFO totalFaults');
assertEq(fifo.totalHits,   3,  'FIFO totalHits');
assertEq(fifo.algorithm,   'FIFO', 'FIFO algorithm label');
// Spot-check key steps from B.1
assert(fifo.steps[0].isHit === false, 'FIFO step1 is fault');
assert(fifo.steps[7].isHit === true,  'FIFO step8 is hit (req=1)');
assert(fifo.steps[8].isHit === true,  'FIFO step9 is hit (req=2)');
assert(fifo.steps[11].isHit === true, 'FIFO step12 is hit (req=5)');
assert(fifo.steps[3].evicted?.pageNumber === 1, 'FIFO step4 evicts page 1');
assert(fifo.steps[9].evicted?.pageNumber === 1, 'FIFO step10 evicts page 1 (from frame1)');

// ─── B.2 LRU ──────────────────────────────────────────────────────────────────

console.log('\n=== LRU (expected faults=10, hitRate=0.167) ===');
const lru = runLRU(FRAMES, refs);
printTrace(lru);
assertEq(lru.totalFaults, 10, 'LRU totalFaults');
assertEq(lru.totalHits,    2, 'LRU totalHits');
assertEq(lru.algorithm, 'LRU', 'LRU algorithm label');
assert(lru.steps[7].isHit === true,  'LRU step8 is hit (req=1)');
assert(lru.steps[8].isHit === true,  'LRU step9 is hit (req=2)');
assert(lru.steps[9].isHit  === false, 'LRU step10 is fault');
assert(lru.steps[10].isHit === false, 'LRU step11 is fault');
assert(lru.steps[11].isHit === false, 'LRU step12 is fault');

// ─── B.3 Optimal ──────────────────────────────────────────────────────────────

console.log('\n=== Optimal (expected faults=7, hitRate=0.417) ===');
const opt = runOptimal(FRAMES, refs);
printTrace(opt);
assertEq(opt.totalFaults, 7,  'Optimal totalFaults');
assertEq(opt.totalHits,   5,  'Optimal totalHits');
assertEq(opt.algorithm, 'OPTIMAL', 'Optimal algorithm label');
// Steps 5,6,8,9 must be hits, plus one more hit in steps 10-12
assert(opt.steps[4].isHit === true, 'Optimal step5 is hit (req=1)');
assert(opt.steps[5].isHit === true, 'Optimal step6 is hit (req=2)');
assert(opt.steps[7].isHit === true, 'Optimal step8 is hit (req=1)');
assert(opt.steps[8].isHit === true, 'Optimal step9 is hit (req=2)');
assert(opt.steps[3].evicted?.pageNumber === 3, 'Optimal step4 evicts page 3 (furthest next use)');
assert(opt.steps[6].evicted?.pageNumber === 4, 'Optimal step7 evicts page 4 (furthest next use)');

// ─── B.4 Clock ────────────────────────────────────────────────────────────────

console.log('\n=== Clock (expected faults=9, hitRate=0.250) ===');
const clk = runClock(FRAMES, refs);
printTrace(clk);
assertEq(clk.totalFaults, 9,  'Clock totalFaults');
assertEq(clk.totalHits,   3,  'Clock totalHits');
assertEq(clk.algorithm, 'CLOCK', 'Clock algorithm label');

// Verify full step-by-step trace against Appendix B.4
const C = clk.steps;

// Step 1: FAULT load, Frames=[1,-,-], RefBits=[1,0,0], Ptr=1
assert(C[0].isHit === false,           'Clock step1 is fault');
assert(C[0].frameState[0].pageNumber === 1, 'Clock step1 frame0=1');
assert(C[0].frameState[1].pageNumber === null, 'Clock step1 frame1=empty');
assert(C[0].referenceBits[0] === true,  'Clock step1 refBit[0]=1');
assert(C[0].referenceBits[1] === false, 'Clock step1 refBit[1]=0');
assert(C[0].clockPointer === 1,        'Clock step1 ptr=1');

// Step 4: FAULT, evict 1, Frames=[4,2,3], RefBits=[1,0,0], Ptr=1
assert(C[3].isHit === false,           'Clock step4 is fault');
assert(C[3].evicted?.pageNumber === 1, 'Clock step4 evicts page 1');
assert(C[3].frameState[0].pageNumber === 4, 'Clock step4 frame0=4');
assert(C[3].referenceBits[0] === true,  'Clock step4 refBit[0]=1');
assert(C[3].referenceBits[1] === false, 'Clock step4 refBit[1]=0');
assert(C[3].referenceBits[2] === false, 'Clock step4 refBit[2]=0');
assert(C[3].clockPointer === 1,        'Clock step4 ptr=1');

// Step 5: FAULT, evict 2, Frames=[4,1,3], RefBits=[1,1,0], Ptr=2
assert(C[4].evicted?.pageNumber === 2, 'Clock step5 evicts page 2');
assert(C[4].clockPointer === 2,        'Clock step5 ptr=2');

// Step 6: FAULT, evict 3, Frames=[4,1,2], RefBits=[1,1,1], Ptr=0
assert(C[5].evicted?.pageNumber === 3, 'Clock step6 evicts page 3');
assert(C[5].clockPointer === 0,        'Clock step6 ptr=0');

// Step 7: FAULT, evict 4, Frames=[5,1,2], RefBits=[1,0,0], Ptr=1
assert(C[6].evicted?.pageNumber === 4, 'Clock step7 evicts page 4');
assert(C[6].frameState[0].pageNumber === 5, 'Clock step7 frame0=5');
assert(C[6].clockPointer === 1,        'Clock step7 ptr=1');

// Step 8: HIT, RefBits=[1,1,0]
assert(C[7].isHit === true,            'Clock step8 is hit');
assert(C[7].referenceBits[1] === true,  'Clock step8 refBit[1] set to 1');

// Step 9: HIT, RefBits=[1,1,1]
assert(C[8].isHit === true,            'Clock step9 is hit');
assert(C[8].referenceBits[2] === true,  'Clock step9 refBit[2] set to 1');

// Step 10: FAULT, evict 1 (from frame1), Frames=[5,3,2], RefBits=[0,1,0], Ptr=2
assert(C[9].isHit === false,           'Clock step10 is fault');
assert(C[9].evicted?.pageNumber === 1, 'Clock step10 evicts page 1');
assert(C[9].frameState[1].pageNumber === 3, 'Clock step10 frame1=3');
assert(C[9].referenceBits[0] === false, 'Clock step10 refBit[0]=0');
assert(C[9].referenceBits[1] === true,  'Clock step10 refBit[1]=1');
assert(C[9].referenceBits[2] === false, 'Clock step10 refBit[2]=0');
assert(C[9].clockPointer === 2,        'Clock step10 ptr=2');

// Step 11: FAULT, evict 2 (from frame2), Frames=[5,3,4], RefBits=[0,1,1], Ptr=0
assert(C[10].evicted?.pageNumber === 2, 'Clock step11 evicts page 2');
assert(C[10].clockPointer === 0,        'Clock step11 ptr=0');

// Step 12: HIT, RefBits=[1,1,1]
assert(C[11].isHit === true,            'Clock step12 is hit (req=5)');
assert(C[11].referenceBits[0] === true,  'Clock step12 refBit[0]=1');

// ─── Second Chance ─────────────────────────────────────────────────────────────

console.log('\n=== Second Chance (expected faults <= 9) ===');
const sc = runSecondChance(FRAMES, refs);
printTrace(sc);
assertEq(sc.algorithm, 'SECOND_CHANCE', 'Second Chance algorithm label');
assert(sc.totalFaults <= 9,            'Second Chance faults <= FIFO (9)');
assert(sc.totalFaults + sc.totalHits === refs.length, 'Second Chance faults+hits = ref length');
console.log(`  (actual faults=${sc.totalFaults})`);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

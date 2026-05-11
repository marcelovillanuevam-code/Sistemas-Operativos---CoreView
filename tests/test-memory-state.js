// test-memory-state.js - Memory/COW frame layout tests.
// Run with: node tests/test-memory-state.js

import { parseProcessesFromForm } from '../data.js';
import { computeMemoryState } from '../engine/memory-state.js';
import {
  getProcessTable,
  setProcessTable,
  simulatedFork,
  writeProcessPage,
} from '../engine/process-model.js';

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
  assert(actual === expected, `${message}  (expected ${expected}, got ${actual})`);
}

function makeFormData(entries) {
  return { get: key => (key in entries ? String(entries[key]) : null) };
}

function freeFrameCount(memoryState) {
  return memoryState.frames.filter(frame => frame.ownerPid === null).length;
}

function buildCowPresetProcesses() {
  const raw = [
    {
      pid: 1,
      arrival: 0,
      burst: 6,
      priority: 2,
      sharedPages: 4,
      threads: [
        { arrival: 0, burst: 4, stackPages: 1 },
        { arrival: 1, burst: 2, stackPages: 1 },
      ],
    },
    {
      pid: 2,
      arrival: 2,
      burst: 5,
      priority: 1,
      sharedPages: 5,
      threads: [
        { arrival: 2, burst: 3, stackPages: 2 },
        { arrival: 3, burst: 2, stackPages: 1 },
      ],
    },
    {
      pid: 3,
      arrival: 4,
      burst: 4,
      priority: 4,
      sharedPages: 2,
      threads: [],
    },
  ];

  const formData = makeFormData({ processes: JSON.stringify(raw) });
  return parseProcessesFromForm(formData);
}

console.log('\n=== COW memory materialization with one free frame ===');
{
  setProcessTable(buildCowPresetProcesses());
  const child1 = simulatedFork(1);
  const child2 = simulatedFork(2);
  const child3 = simulatedFork(3);
  const processes = getProcessTable();
  const config = { totalMemory: 640, pageSize: 32, numFrames: 20 };

  let memoryState = computeMemoryState(processes, config);
  assertEq(memoryState.requiredPhysicalPages, 17, 'initial COW preset needs 17 physical frames');
  assertEq(freeFrameCount(memoryState), 3, '20 frames leaves 3 free frames before writes');

  assertEq(writeProcessPage(processes, child1.pid, 0).duplicated, true, 'P1.1 COW write duplicates page 0');
  assertEq(writeProcessPage(processes, child2.pid, 0).duplicated, true, 'P2.1 COW write duplicates page 0');

  memoryState = computeMemoryState(processes, config);
  assertEq(memoryState.requiredPhysicalPages, 19, 'after P1.1 and P2.1 writes only one frame remains');
  assertEq(freeFrameCount(memoryState), 1, 'one physical frame is still free before P3.1 write');
  assert(
    !memoryState.frames.some(frame => frame.ownerPid === child3.pid && frame.pageNumber === 0),
    'P3.1 page 0 is still shared before its write'
  );

  const p31Write = writeProcessPage(processes, child3.pid, 0);
  assertEq(p31Write.duplicated, true, 'P3.1 COW write duplicates page 0 with the last free frame');

  memoryState = computeMemoryState(processes, config);
  const p31Frame = memoryState.frames.find(frame => frame.ownerPid === child3.pid && frame.pageNumber === 0);
  assert(Boolean(p31Frame), 'P3.1 page 0 gets a visible physical frame');
  assertEq(p31Frame?.frameIndex, 19, 'P3.1 page 0 uses the final free frame F19');
  assertEq(memoryState.requiredPhysicalPages, 20, 'all 20 frames are required after three COW copies');
  assertEq(freeFrameCount(memoryState), 0, 'no frames remain free after P3.1 materializes');
}

console.log(`\nMemory state tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;

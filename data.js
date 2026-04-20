// data.js — Data layer. Parse and validate user input into Process[] and MemoryConfig.
// No DOM access. Depends on nothing else.

import { makeThread, makeProcess, makeMemoryConfig, makePageRef } from './types.js';

/**
 * Shared builder: assigns globally-sequential TIDs in pid order.
 * @param {{ pid, arrival, burst, priority, sharedPages, threads: {arrival,burst,stackPages}[] }[]} rawList
 * @returns {import('./types.js').Process[]}
 */
function _buildProcesses(rawList) {
  const sorted = [...rawList].sort((a, b) => Number(a.pid) - Number(b.pid));
  let nextTid = 1;

  return sorted.map(raw => {
    const pid        = Number(raw.pid);
    const arrivalTime = Number(raw.arrival);
    const priority   = Number(raw.priority);
    const sharedPages = Number(raw.sharedPages);

    let threads;
    if (!raw.threads || raw.threads.length === 0) {
      threads = [makeThread({
        tid: nextTid++,
        parentPid: pid,
        arrivalTime,
        burstTime: Number(raw.burst),
        priority,
        stackPages: 1,
      })];
    } else {
      threads = raw.threads.map(t => makeThread({
        tid: nextTid++,
        parentPid: pid,
        arrivalTime: Number(t.arrival),
        burstTime:   Number(t.burst),
        priority,
        stackPages:  Number(t.stackPages) || 1,
      }));
    }

    const burstTime = threads.reduce((s, t) => s + t.burstTime, 0);
    const numPages  = sharedPages + threads.reduce((s, t) => s + t.stackPages, 0);

    return makeProcess({ pid, arrivalTime, burstTime, priority, sharedPages, numPages, threads });
  });
}

/**
 * @param {FormData} formData  — expects key 'processes' with JSON of raw process array
 * @returns {import('./types.js').Process[]}
 */
export function parseProcessesFromForm(formData) {
  const raw = formData.get('processes');
  if (!raw) return [];
  return _buildProcesses(JSON.parse(raw));
}

/**
 * Parses 5-column (single-threaded) or 9-column (multi-threaded) .txt file.
 * @param {string} fileContent
 * @returns {import('./types.js').Process[]}
 */
export function parseProcessesFromFile(fileContent) {
  const lines = fileContent
    .trim()
    .split(/\r?\n/)
    .filter(l => { const t = l.trim(); return t.length > 0 && !t.startsWith('#'); });

  if (lines.length === 0) throw new Error('File is empty');

  const colCount = lines[0].split(',').length;
  if (colCount === 5) return _parse5Col(lines);
  if (colCount === 9) return _parse9Col(lines);
  throw new Error(`Expected 5 or 9 columns, got ${colCount}`);
}

function _parse5Col(lines) {
  const rawList = lines.map((line, i) => {
    const parts = line.split(',').map(s => s.trim());
    if (parts.length !== 5) throw new Error(`Line ${i + 1}: expected 5 columns`);
    const nums = parts.map(Number);
    if (nums.some(isNaN)) throw new Error(`Line ${i + 1}: all values must be numbers`);
    const [pid, arrival, burst, priority, sharedPages] = nums;
    return { pid, arrival, burst, priority, sharedPages, threads: [] };
  });
  return _buildProcesses(rawList);
}

function _parse9Col(lines) {
  const grouped = new Map();
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(',').map(s => s.trim());
    if (parts.length !== 9) throw new Error(`Line ${i + 1}: expected 9 columns`);
    const nums = parts.map(Number);
    if (nums.some(isNaN)) throw new Error(`Line ${i + 1}: all values must be numbers`);
    const [pid, arrival, , priority, sharedPages, , threadArrival, threadBurst, stackPages] = nums;
    if (!grouped.has(pid)) {
      grouped.set(pid, { pid, arrival, priority, sharedPages, threads: [] });
    }
    grouped.get(pid).threads.push({ arrival: threadArrival, burst: threadBurst, stackPages });
  }
  return _buildProcesses([...grouped.values()]);
}

/**
 * @param {FormData} formData  — expects keys 'totalMemory' and 'pageSize'
 * @returns {import('./types.js').MemoryConfig}
 */
export function parseMemoryConfig(formData) {
  const totalMemory = Number(formData.get('totalMemory'));
  const pageSize    = Number(formData.get('pageSize'));
  const numFrames   = Math.floor(totalMemory / pageSize);
  return makeMemoryConfig({ totalMemory, pageSize, numFrames });
}

/**
 * @param {string} fileContent  — expects "totalMemory,pageSize" on first non-comment line
 * @returns {import('./types.js').MemoryConfig}
 */
export function parseMemoryConfigFromFile(fileContent) {
  const line = fileContent
    .trim()
    .split(/\r?\n/)
    .find(l => l.trim() && !l.trim().startsWith('#'));
  if (!line) throw new Error('Memory config file is empty');
  const [totalMemory, pageSize] = line.split(',').map(s => Number(s.trim()));
  if (isNaN(totalMemory) || isNaN(pageSize)) {
    throw new Error('Memory config: expected "totalMemory,pageSize"');
  }
  const numFrames = Math.floor(totalMemory / pageSize);
  return makeMemoryConfig({ totalMemory, pageSize, numFrames });
}

/**
 * @param {import('./types.js').Process[]} processes
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateProcesses(processes) {
  const errors = [];

  for (const proc of processes) {
    if (!Number.isInteger(proc.sharedPages) || proc.sharedPages < 1) {
      errors.push(`P${proc.pid}: sharedPages must be >= 1 (got ${proc.sharedPages})`);
    }
    if (proc.threads.length === 0) {
      errors.push(`P${proc.pid}: must have at least 1 thread`);
    }
    if (proc.threads.length > 8) {
      errors.push(`P${proc.pid}: max 8 threads per process (has ${proc.threads.length})`);
    }

    for (const thread of proc.threads) {
      if (!Number.isInteger(thread.burstTime) || thread.burstTime <= 0) {
        errors.push(`P${proc.pid} T${thread.tid}: burst must be > 0 (got ${thread.burstTime})`);
      }
      if (!Number.isInteger(thread.stackPages) || thread.stackPages < 1) {
        errors.push(`P${proc.pid} T${thread.tid}: stackPages must be >= 1 (got ${thread.stackPages})`);
      }
      if (thread.arrivalTime < proc.arrivalTime) {
        errors.push(
          `P${proc.pid} T${thread.tid}: thread arrival (${thread.arrivalTime}) must be >= process arrival (${proc.arrivalTime})`
        );
      }
    }

    const expectedPages = proc.sharedPages + proc.threads.reduce((s, t) => s + t.stackPages, 0);
    if (proc.numPages !== expectedPages) {
      errors.push(`P${proc.pid}: numPages should be ${expectedPages} (is ${proc.numPages})`);
    }

    const expectedBurst = proc.threads.reduce((s, t) => s + t.burstTime, 0);
    if (proc.burstTime !== expectedBurst) {
      errors.push(`P${proc.pid}: burstTime should be ${expectedBurst} (is ${proc.burstTime})`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generates a PageRef[] interleaved by arrival order, cycling each process's pages sequentially.
 * @param {import('./types.js').Process[]} processes
 * @param {number} length
 * @returns {import('./types.js').PageRef[]}
 */
export function generateReferenceString(processes, length) {
  if (!processes.length || length <= 0) return [];

  const sorted = [...processes].sort((a, b) => a.arrivalTime - b.arrivalTime || a.pid - b.pid);
  const iters  = sorted.map(p => ({ pid: p.pid, pages: p.numPages, index: 0 }));

  const refs = [];
  let i = 0;
  while (refs.length < length) {
    const it = iters[i % iters.length];
    refs.push(makePageRef({ pid: it.pid, pageNumber: it.index % it.pages }));
    it.index++;
    i++;
  }
  return refs;
}

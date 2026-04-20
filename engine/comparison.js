// comparison.js — Runs all algorithms and assembles ComparisonResult. Pure function, zero DOM.

import { runFCFS }              from './scheduling-fcfs.js';
import { runSJF }               from './scheduling-sjf.js';
import { runHRRN }              from './scheduling-hrrn.js';
import { runRoundRobin }        from './scheduling-rr.js';
import { runSRTF }              from './scheduling-srtf.js';
import { runPriorityPreemptive } from './scheduling-priority.js';
import { runMLQ }               from './scheduling-mlq.js';
import { runMLFQ }              from './scheduling-mlfq.js';
import { runFIFO }              from './paging-fifo.js';
import { runLRU }               from './paging-lru.js';
import { runOptimal }           from './paging-optimal.js';
import { runClock }             from './paging-clock.js';
import { runSecondChance }      from './paging-second-chance.js';

/** Default configs used when none supplied — one entry per algorithm. */
export const DEFAULT_SCHEDULING_CONFIGS = [
  { algorithm: 'FCFS' },
  { algorithm: 'SJF' },
  { algorithm: 'HRRN' },
  { algorithm: 'RR', quantum: 2 },
  { algorithm: 'SRTF' },
  { algorithm: 'PRIORITY_PREEMPTIVE' },
  {
    algorithm: 'MLQ',
    mlqQueues: [
      { algorithm: 'RR',   priorityRange: [1, 1], quantum: 2 },
      { algorithm: 'RR',   priorityRange: [2, 2], quantum: 4 },
      { algorithm: 'FCFS', priorityRange: [3, 99] },
    ],
  },
  {
    algorithm: 'MLFQ',
    mlfqLevels: [
      { algorithm: 'RR',   quantum: 2 },
      { algorithm: 'RR',   quantum: 4 },
      { algorithm: 'FCFS', quantum: Infinity },
    ],
  },
];

export const ALL_PAGE_ALGORITHMS = ['FIFO', 'LRU', 'OPTIMAL', 'CLOCK', 'SECOND_CHANCE'];

function _runScheduling(processes, config) {
  switch (config.algorithm) {
    case 'FCFS':                return runFCFS(processes);
    case 'SJF':                 return runSJF(processes);
    case 'HRRN':                return runHRRN(processes);
    case 'RR':                  return runRoundRobin(processes, config.quantum ?? 2);
    case 'SRTF':                return runSRTF(processes);
    case 'PRIORITY_PREEMPTIVE': return runPriorityPreemptive(processes);
    case 'MLQ':                 return runMLQ(processes, config);
    case 'MLFQ':                return runMLFQ(processes, config);
    default: throw new Error(`Unknown algorithm: ${config.algorithm}`);
  }
}

const _pageRunners = {
  FIFO: runFIFO, LRU: runLRU, OPTIMAL: runOptimal,
  CLOCK: runClock, SECOND_CHANCE: runSecondChance,
};

/**
 * @param {import('../types.js').Process[]} processes
 * @param {import('../types.js').SchedulingConfig[]} [configs]
 * @returns {import('../types.js').ComparisonResult}
 */
export function compareScheduling(processes, configs = DEFAULT_SCHEDULING_CONFIGS) {
  const schedulingComparisons = [];
  for (const config of configs) {
    try {
      const trace = _runScheduling(processes, config);
      schedulingComparisons.push({ algorithm: config.algorithm, config, metrics: trace.aggregateMetrics, trace });
    } catch (_) {
      // skip failed algorithms
    }
  }
  return { inputProcesses: processes, schedulingComparisons };
}

/**
 * @param {number} numFrames
 * @param {import('../types.js').PageRef[]} refs
 * @param {import('../types.js').PageReplacementAlgorithm[]} [algorithms]
 * @returns {import('../types.js').ComparisonResult}
 */
export function comparePageReplacement(numFrames, refs, algorithms = ALL_PAGE_ALGORITHMS) {
  const pageReplacementComparisons = [];
  for (const algo of algorithms) {
    try {
      const trace = _pageRunners[algo](numFrames, refs);
      pageReplacementComparisons.push({ algorithm: algo, totalFaults: trace.totalFaults, hitRate: trace.hitRate, trace });
    } catch (_) {
      // skip
    }
  }
  return { inputProcesses: [], pageReplacementComparisons };
}

// comparison.js — Runs all algorithms and assembles ComparisonResult. Pure function, zero DOM.
// Uses setTimeout yield between runs to prevent UI freeze (see Risk 4). Caches traces.

/**
 * @param {import('../types.js').Process[]} processes
 * @param {import('../types.js').SchedulingConfig[]} configs
 * @returns {import('../types.js').ComparisonResult}
 */
export function compareScheduling(processes, configs) {
  throw new Error('Not implemented');
}

/**
 * @param {number} numFrames
 * @param {import('../types.js').PageRef[]} refs
 * @param {import('../types.js').PageReplacementAlgorithm[]} algorithms
 * @returns {import('../types.js').ComparisonResult}
 */
export function comparePageReplacement(numFrames, refs, algorithms) {
  throw new Error('Not implemented');
}

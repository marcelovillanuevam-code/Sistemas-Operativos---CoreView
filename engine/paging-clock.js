// paging-clock.js — Clock (circular buffer) page replacement algorithm. Pure function, zero DOM.
// Uses reference bits; pointer scans on fault, clears bits, evicts first 0-bit frame. Capped at 32 frames.

/** @param {number} numFrames @param {import('../types.js').PageRef[]} refs @returns {import('../types.js').PageReplacementTrace} */
export function runClock(numFrames, refs) {
  throw new Error('Not implemented');
}

// state-diagram.js — Canvas 2D state diagram renderer. 5-node process state graph.
// Shows thread clusters for multi-threaded processes. Highlights state transitions.

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pid: number, state: import('../types.js').ProcessState, threadStates?: object[] }[]} processStates
 * @param {{ pid: number, state: import('../types.js').ProcessState }[]} previousStates
 */
export function renderStateDiagram(ctx, processStates, previousStates) {
  throw new Error('Not implemented');
}

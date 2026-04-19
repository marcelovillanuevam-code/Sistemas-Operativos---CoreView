// thread-visuals.js — Thread-specific renderers. Up to 8 rows (system cap).
// Thread state diagram, memory sharing grid, thread Gantt, and event log.

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../types.js').Thread[]} threads
 * @param {{ tid: number, state: import('../types.js').ThreadState }[]} currentStates
 * @param {{ tid: number, state: import('../types.js').ThreadState }[]} previousStates
 * @param {import('../types.js').ProcessState} processState
 */
export function renderThreadStateDiagram(ctx, threads, currentStates, previousStates, processState) {
  throw new Error('Not implemented');
}

/**
 * @param {HTMLElement} container
 * @param {import('../types.js').SharedResources} sharedResources
 * @param {import('../types.js').Thread[]} threads
 * @param {number[]} activeTids
 */
export function renderMemorySharing(container, sharedResources, threads, activeTids) {
  throw new Error('Not implemented');
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../types.js').ThreadTrace} trace
 * @param {number} currentStep
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
export function renderThreadGantt(ctx, trace, currentStep, canvasWidth, canvasHeight) {
  throw new Error('Not implemented');
}

/**
 * @param {HTMLElement} container
 * @param {import('../types.js').ThreadEvent[]} events
 * @param {number} currentStep
 */
export function renderThreadEventLog(container, events, currentStep) {
  throw new Error('Not implemented');
}

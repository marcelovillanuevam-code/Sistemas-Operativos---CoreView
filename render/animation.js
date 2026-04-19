// animation.js — AnimationController factory. Pure step counter — zero rendering logic inside.
// Single setInterval; step always pauses first to prevent race conditions (see Risk 2).

/**
 * @param {number} totalSteps
 * @returns {AnimationController}
 */
export function makeAnimationController(totalSteps) {
  throw new Error('Not implemented');
}

/**
 * @typedef {object} AnimationController
 * @property {() => void}          play
 * @property {() => void}          pause
 * @property {() => void}          stepForward
 * @property {() => void}          stepBackward
 * @property {(n: number) => void} goToStep
 * @property {(s: 1|2|4) => void}  setSpeed
 * @property {(cb: Function) => void} onStepChange
 * @property {() => number}        getCurrentStep
 * @property {() => boolean}       isPlaying
 */

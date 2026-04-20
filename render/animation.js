// animation.js — AnimationController factory. Pure step counter — zero rendering logic inside.
// Single setInterval; step always pauses first to prevent race conditions (see Risk 2).

const BASE_INTERVAL_MS = 800;

/**
 * @param {number} totalSteps
 * @returns {AnimationController}
 */
export function makeAnimationController(totalSteps) {
  if (!Number.isFinite(totalSteps) || totalSteps < 1) {
    throw new Error('totalSteps must be a positive number');
  }

  let currentStep = 0;
  let intervalId = null;
  let speed = 1;
  const listeners = [];

  function notify() {
    for (const cb of listeners) cb(currentStep);
  }

  function clearTimer() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function tick() {
    if (currentStep >= totalSteps - 1) {
      clearTimer();
      return;
    }
    currentStep++;
    notify();
    if (currentStep >= totalSteps - 1) clearTimer();
  }

  function startTimer() {
    clearTimer();
    if (currentStep >= totalSteps - 1) return;
    intervalId = setInterval(tick, BASE_INTERVAL_MS / speed);
  }

  return {
    play() {
      if (intervalId !== null) return;
      if (currentStep >= totalSteps - 1) return;
      startTimer();
    },

    pause() {
      clearTimer();
    },

    stepForward() {
      clearTimer();
      if (currentStep < totalSteps - 1) {
        currentStep++;
        notify();
      }
    },

    stepBackward() {
      clearTimer();
      if (currentStep > 0) {
        currentStep--;
        notify();
      }
    },

    goToStep(n) {
      clearTimer();
      const clamped = Math.max(0, Math.min(totalSteps - 1, Math.floor(n)));
      if (clamped !== currentStep) {
        currentStep = clamped;
        notify();
      }
    },

    setSpeed(multiplier) {
      if (multiplier !== 1 && multiplier !== 2 && multiplier !== 4) {
        throw new Error('Speed must be 1, 2, or 4');
      }
      speed = multiplier;
      if (intervalId !== null) startTimer();
    },

    onStepChange(callback) {
      if (typeof callback === 'function') listeners.push(callback);
    },

    getCurrentStep() {
      return currentStep;
    },

    isPlaying() {
      return intervalId !== null;
    },
  };
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

/*
 * CoreView thread worker protocol
 *
 * Main thread -> Worker:
 * - { type: 'init', tid, pid, totalBurst, simSpeedMs }
 *   Initializes tid, pid, remainingBurst, executedSoFar, simSpeedMs and
 *   running state. Replies with { type: 'ready', tid }.
 * - { type: 'run' }
 *   Starts or resumes execution. Every simSpeedMs milliseconds the worker
 *   emits { type: 'tick', tid, remainingBurst, executedSoFar }. When the
 *   burst reaches 0, it emits { type: 'done', tid, executedSoFar } and stops.
 * - { type: 'preempt' }
 *   Pauses execution without resetting state. Replies with
 *   { type: 'preempted', tid, remainingBurst }.
 * - { type: 'terminate' }
 *   Clears any active timer and closes the worker.
 *
 * Unknown message types reply with:
 * { type: 'error', tid, error: 'unknown message type', received: <type> }.
 */

let tid = null;
let pid = null;
let remainingBurst = 0;
let executedSoFar = 0;
let simSpeedMs = 0;
let isRunning = false;
let timerId = null;

function clearTimer() {
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

function scheduleNextTick() {
  clearTimer();

  if (!isRunning || remainingBurst <= 0) {
    return;
  }

  timerId = setTimeout(function handleTick() {
    timerId = null;

    if (!isRunning || remainingBurst <= 0) {
      return;
    }

    remainingBurst -= 1;
    executedSoFar += 1;

    self.postMessage({
      type: 'tick',
      tid: tid,
      remainingBurst: remainingBurst,
      executedSoFar: executedSoFar
    });

    if (remainingBurst === 0) {
      isRunning = false;
      self.postMessage({
        type: 'done',
        tid: tid,
        executedSoFar: executedSoFar
      });
      return;
    }

    scheduleNextTick();
  }, simSpeedMs);
}

function handleInit(message) {
  clearTimer();

  tid = message.tid;
  pid = message.pid;
  remainingBurst = Number(message.totalBurst);
  executedSoFar = 0;
  simSpeedMs = Number(message.simSpeedMs);
  isRunning = false;

  self.postMessage({
    type: 'ready',
    tid: tid
  });
}

function handleRun() {
  if (isRunning || remainingBurst <= 0) {
    return;
  }

  isRunning = true;
  scheduleNextTick();
}

function handlePreempt() {
  isRunning = false;
  clearTimer();

  self.postMessage({
    type: 'preempted',
    tid: tid,
    remainingBurst: remainingBurst
  });
}

self.onmessage = function handleMessage(event) {
  const message = event.data || {};

  switch (message.type) {
    case 'init':
      handleInit(message);
      break;
    case 'run':
      handleRun();
      break;
    case 'preempt':
      handlePreempt();
      break;
    case 'terminate':
      clearTimer();
      self.close();
      break;
    default:
      self.postMessage({
        type: 'error',
        tid: tid,
        error: 'unknown message type',
        received: message.type
      });
      break;
  }
};

// types.js — Core data structure factory functions (JSDoc-typed). All contracts between Engine and Rendering.

// ─── Enums ───────────────────────────────────────────────────────────────────

/** @typedef {'NEW'|'READY'|'RUNNING'|'WAITING'|'TERMINATED'} ThreadState */
/** @typedef {'NEW'|'READY'|'RUNNING'|'WAITING'|'TERMINATED'} ProcessState */
/** @typedef {'FCFS'|'SJF'|'HRRN'|'RR'|'SRTF'|'PRIORITY_PREEMPTIVE'|'MLQ'|'MLFQ'} SchedulingAlgorithm */
/** @typedef {'FIFO'|'LRU'|'OPTIMAL'|'CLOCK'|'SECOND_CHANCE'} PageReplacementAlgorithm */

// ─── §1.1 Thread ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} Thread
 * @property {number}      tid           - globally unique, 1-based, sequential across all processes
 * @property {number}      parentPid     - owning process PID
 * @property {number}      arrivalTime   - >= parent process arrivalTime
 * @property {number}      burstTime     - > 0
 * @property {number}      priority      - inherits from process, can override per-thread
 * @property {ThreadState} state         - independent per thread
 * @property {number}      remainingTime - engine internal, starts equal to burstTime
 * @property {number}      stackPages    - >= 1, private stack memory in pages
 */

/**
 * @param {{ tid: number, parentPid: number, arrivalTime: number, burstTime: number,
 *           priority: number, state?: ThreadState, remainingTime?: number, stackPages?: number }} fields
 * @returns {Thread}
 */
export function makeThread({ tid, parentPid, arrivalTime, burstTime, priority, state = 'NEW', remainingTime, stackPages = 1 }) {
  return { tid, parentPid, arrivalTime, burstTime, priority, state, remainingTime: remainingTime ?? burstTime, stackPages };
}

// ─── §1.2 Process ────────────────────────────────────────────────────────────

/**
 * @typedef {object} Process
 * @property {number}   pid         - unique, 1-based
 * @property {number}   arrivalTime - >= 0
 * @property {number}   burstTime   - computed: sum of thread burst times
 * @property {number}   priority    - lower = higher priority (1 is top)
 * @property {number}   sharedPages - > 0, code/data/heap pages shared by all threads
 * @property {number}   numPages    - computed: sharedPages + sum(thread.stackPages)
 * @property {Thread[]} threads     - length >= 1, max 8
 */

/**
 * @param {{ pid: number, arrivalTime: number, burstTime: number, priority: number,
 *           sharedPages: number, numPages: number, threads: Thread[] }} fields
 * @returns {Process}
 */
export function makeProcess({ pid, arrivalTime, burstTime, priority, sharedPages, numPages, threads }) {
  return { pid, arrivalTime, burstTime, priority, sharedPages, numPages, threads };
}

// ─── §1.3 SchedulableEntity ──────────────────────────────────────────────────

/**
 * @typedef {object} SchedulableEntity
 * @property {number} pid           - owning process PID
 * @property {number} tid           - globally unique thread ID
 * @property {string} label         - 'P1' for single-threaded, 'P1-T2' for multi-threaded
 * @property {number} arrivalTime   - from the thread
 * @property {number} burstTime     - from the thread
 * @property {number} priority      - from the thread (may override process priority)
 * @property {number} remainingTime - engine internal, starts equal to burstTime
 */

/**
 * @param {{ pid: number, tid: number, label: string, arrivalTime: number,
 *           burstTime: number, priority: number, remainingTime?: number }} fields
 * @returns {SchedulableEntity}
 */
export function makeSchedulableEntity({ pid, tid, label, arrivalTime, burstTime, priority, remainingTime }) {
  return { pid, tid, label, arrivalTime, burstTime, priority, remainingTime: remainingTime ?? burstTime };
}

// ─── §1.4 SchedulingConfig ───────────────────────────────────────────────────

/**
 * @typedef {object} MLQQueueConfig
 * @property {'FCFS'|'RR'|'SJF'} algorithm
 * @property {[number, number]}   priorityRange
 * @property {number}             [quantum]
 *
 * @typedef {object} MLFQLevelConfig
 * @property {'FCFS'|'RR'} algorithm
 * @property {number}      quantum
 * @property {number}      [promoteAfter]
 * @property {number}      [demoteAfter]
 *
 * @typedef {object} SchedulingConfig
 * @property {SchedulingAlgorithm} algorithm
 * @property {number}              [quantum]
 * @property {MLQQueueConfig[]}    [mlqQueues]
 * @property {MLFQLevelConfig[]}   [mlfqLevels]
 */

/**
 * @param {{ algorithm: SchedulingAlgorithm, quantum?: number,
 *           mlqQueues?: MLQQueueConfig[], mlfqLevels?: MLFQLevelConfig[] }} fields
 * @returns {SchedulingConfig}
 */
export function makeSchedulingConfig({ algorithm, quantum, mlqQueues, mlfqLevels }) {
  return { algorithm, quantum, mlqQueues, mlfqLevels };
}

// ─── §1.5 SchedulingTrace ────────────────────────────────────────────────────

/**
 * @typedef {object} TimelineEntry
 * @property {number}                 time
 * @property {number|null}            runningPid
 * @property {number|null}            runningTid
 * @property {SchedulableEntity[]}    readyQueue          - after dispatch (running entity removed)
 * @property {number[]}               arrivedThisTick     - tids arriving at this time
 * @property {number[]}               completedThisTick   - tids completing at this time
 * @property {boolean}                contextSwitch
 * @property {{ level: number, entities: SchedulableEntity[], algorithm: string }[]} [queueLevels]
 * @property {{ tid: number, from: number, to: number }[]} [promotions]
 * @property {{ tid: number, from: number, to: number }[]} [demotions]
 * @property {{ pid: number, state: ProcessState, threadStates?: { tid: number, state: ThreadState }[] }[]} processStates
 */

/**
 * @param {{ time: number, runningPid: number|null, runningTid: number|null,
 *           readyQueue: SchedulableEntity[], arrivedThisTick: number[],
 *           completedThisTick: number[], contextSwitch: boolean,
 *           processStates: object[], queueLevels?: object[],
 *           promotions?: object[], demotions?: object[] }} fields
 * @returns {TimelineEntry}
 */
export function makeTimelineEntry({ time, runningPid, runningTid, readyQueue, arrivedThisTick, completedThisTick, contextSwitch, processStates, queueLevels, promotions, demotions }) {
  return { time, runningPid, runningTid, readyQueue, arrivedThisTick, completedThisTick, contextSwitch, processStates, queueLevels, promotions, demotions };
}

/**
 * @typedef {object} ProcessMetrics
 * @property {number} pid
 * @property {number} completionTime  - join-barrier: last thread completion
 * @property {number} turnaroundTime  - completionTime - arrivalTime
 * @property {number} waitingTime     - turnaroundTime - sum(thread burstTimes)
 * @property {number} responseTime    - min(thread firstRunTimes) - process arrivalTime
 */

/**
 * @param {{ pid: number, completionTime: number, turnaroundTime: number,
 *           waitingTime: number, responseTime: number }} fields
 * @returns {ProcessMetrics}
 */
export function makeProcessMetrics({ pid, completionTime, turnaroundTime, waitingTime, responseTime }) {
  return { pid, completionTime, turnaroundTime, waitingTime, responseTime };
}

/**
 * @typedef {object} ThreadMetrics
 * @property {number} tid
 * @property {number} pid
 * @property {number} completionTime
 * @property {number} turnaroundTime  - thread completion - thread arrival
 * @property {number} waitingTime     - turnaroundTime - burstTime
 * @property {number} responseTime    - thread firstRun - thread arrival
 */

/**
 * @param {{ tid: number, pid: number, completionTime: number, turnaroundTime: number,
 *           waitingTime: number, responseTime: number }} fields
 * @returns {ThreadMetrics}
 */
export function makeThreadMetrics({ tid, pid, completionTime, turnaroundTime, waitingTime, responseTime }) {
  return { tid, pid, completionTime, turnaroundTime, waitingTime, responseTime };
}

/**
 * @typedef {object} AggregateMetrics
 * @property {number} avgCompletionTime   - thread-level average
 * @property {number} avgTurnaroundTime   - thread-level average
 * @property {number} avgWaitingTime      - thread-level average
 * @property {number} avgResponseTime     - thread-level average
 * @property {number} cpuUtilization      - 0–100
 * @property {number} totalContextSwitches
 * @property {number} throughput          - threads / total time
 */

/**
 * @param {{ avgCompletionTime: number, avgTurnaroundTime: number, avgWaitingTime: number,
 *           avgResponseTime: number, cpuUtilization: number, totalContextSwitches: number,
 *           throughput: number }} fields
 * @returns {AggregateMetrics}
 */
export function makeAggregateMetrics({ avgCompletionTime, avgTurnaroundTime, avgWaitingTime, avgResponseTime, cpuUtilization, totalContextSwitches, throughput }) {
  return { avgCompletionTime, avgTurnaroundTime, avgWaitingTime, avgResponseTime, cpuUtilization, totalContextSwitches, throughput };
}

/**
 * @typedef {object} SchedulingTrace
 * @property {SchedulingAlgorithm} algorithm
 * @property {SchedulingConfig}    config
 * @property {TimelineEntry[]}     timeline
 * @property {ProcessMetrics[]}    processMetrics  - one per process (join-barrier)
 * @property {ThreadMetrics[]}     threadMetrics   - one per thread
 * @property {AggregateMetrics}    aggregateMetrics
 */

/**
 * @param {{ algorithm: SchedulingAlgorithm, config: SchedulingConfig, timeline: TimelineEntry[],
 *           processMetrics: ProcessMetrics[], threadMetrics: ThreadMetrics[],
 *           aggregateMetrics: AggregateMetrics }} fields
 * @returns {SchedulingTrace}
 */
export function makeSchedulingTrace({ algorithm, config, timeline, processMetrics, threadMetrics, aggregateMetrics }) {
  return { algorithm, config, timeline, processMetrics, threadMetrics, aggregateMetrics };
}

// ─── §1.6 MemoryConfig & MemoryState ─────────────────────────────────────────

/**
 * @typedef {object} MemoryConfig
 * @property {number} totalMemory
 * @property {number} pageSize
 * @property {number} numFrames  - computed: totalMemory / pageSize
 */

/**
 * @param {{ totalMemory: number, pageSize: number, numFrames: number }} fields
 * @returns {MemoryConfig}
 */
export function makeMemoryConfig({ totalMemory, pageSize, numFrames }) {
  return { totalMemory, pageSize, numFrames };
}

/**
 * @typedef {object} FrameEntry
 * @property {number}       frameIndex
 * @property {number|null}  ownerPid
 * @property {number|null}  pageNumber
 * @property {number}       loadedAt
 * @property {boolean}      [referenceBit]
 */

/**
 * @param {{ frameIndex: number, ownerPid: number|null, pageNumber: number|null,
 *           loadedAt: number, referenceBit?: boolean }} fields
 * @returns {FrameEntry}
 */
export function makeFrameEntry({ frameIndex, ownerPid, pageNumber, loadedAt, referenceBit }) {
  return { frameIndex, ownerPid, pageNumber, loadedAt, referenceBit };
}

/**
 * @typedef {object} MemoryState
 * @property {FrameEntry[]} frames
 * @property {number}       internalFragmentation
 */

/**
 * @param {{ frames: FrameEntry[], internalFragmentation: number }} fields
 * @returns {MemoryState}
 */
export function makeMemoryState({ frames, internalFragmentation }) {
  return { frames, internalFragmentation };
}

// ─── §1.7 PageReplacementTrace ───────────────────────────────────────────────

/**
 * @typedef {object} PageRef
 * @property {number} pid
 * @property {number} pageNumber
 */

/**
 * @param {{ pid: number, pageNumber: number }} fields
 * @returns {PageRef}
 */
export function makePageRef({ pid, pageNumber }) {
  return { pid, pageNumber };
}

/**
 * @typedef {object} PageReplacementStep
 * @property {number}       stepIndex
 * @property {PageRef}      requested
 * @property {boolean}      isHit
 * @property {PageRef|null} evicted
 * @property {FrameEntry[]} frameState
 * @property {number}       [clockPointer]
 * @property {boolean[]}    [referenceBits]
 * @property {number}       faultsSoFar
 */

/**
 * @param {{ stepIndex: number, requested: PageRef, isHit: boolean, evicted: PageRef|null,
 *           frameState: FrameEntry[], clockPointer?: number, referenceBits?: boolean[],
 *           faultsSoFar: number }} fields
 * @returns {PageReplacementStep}
 */
export function makePageReplacementStep({ stepIndex, requested, isHit, evicted, frameState, clockPointer, referenceBits, faultsSoFar }) {
  return { stepIndex, requested, isHit, evicted, frameState, clockPointer, referenceBits, faultsSoFar };
}

/**
 * @typedef {object} PageReplacementTrace
 * @property {PageReplacementAlgorithm} algorithm
 * @property {PageRef[]}                referenceString
 * @property {PageReplacementStep[]}    steps
 * @property {number}                   totalFaults
 * @property {number}                   totalHits
 * @property {number}                   hitRate
 */

/**
 * @param {{ algorithm: PageReplacementAlgorithm, referenceString: PageRef[],
 *           steps: PageReplacementStep[], totalFaults: number, totalHits: number,
 *           hitRate: number }} fields
 * @returns {PageReplacementTrace}
 */
export function makePageReplacementTrace({ algorithm, referenceString, steps, totalFaults, totalHits, hitRate }) {
  return { algorithm, referenceString, steps, totalFaults, totalHits, hitRate };
}

// ─── §1.8 ThreadTrace ────────────────────────────────────────────────────────

/**
 * @typedef {object} ThreadEvent
 * @property {'CREATED'|'DISPATCHED'|'PREEMPTED'|'BLOCKED'|'UNBLOCKED'|'COMPLETED'|'JOINED'} type
 * @property {number} tid
 * @property {string} description
 */

/**
 * @param {{ type: string, tid: number, description: string }} fields
 * @returns {ThreadEvent}
 */
export function makeThreadEvent({ type, tid, description }) {
  return { type, tid, description };
}

/**
 * @typedef {object} ThreadTimelineEntry
 * @property {number} time
 * @property {{ tid: number, state: ThreadState, remainingBurst: number }[]} threadStates
 * @property {number|null}    runningTid
 * @property {ThreadEvent|null} event
 */

/**
 * @param {{ time: number, threadStates: object[], runningTid: number|null,
 *           event: ThreadEvent|null }} fields
 * @returns {ThreadTimelineEntry}
 */
export function makeThreadTimelineEntry({ time, threadStates, runningTid, event }) {
  return { time, threadStates, runningTid, event };
}

/**
 * @typedef {object} SharedResources
 * @property {string}   codeSegment
 * @property {string}   dataSegment
 * @property {string}   heapSegment
 * @property {number[]} sharedPageNumbers
 * @property {{ tid: number, localIndex: number, stackPageNumbers: number[] }[]} threadStacks
 */

/**
 * @param {{ codeSegment: string, dataSegment: string, heapSegment: string,
 *           sharedPageNumbers: number[], threadStacks: object[] }} fields
 * @returns {SharedResources}
 */
export function makeSharedResources({ codeSegment, dataSegment, heapSegment, sharedPageNumbers, threadStacks }) {
  return { codeSegment, dataSegment, heapSegment, sharedPageNumbers, threadStacks };
}

/**
 * @typedef {object} ThreadTrace
 * @property {number}               pid
 * @property {number}               processArrivalTime
 * @property {Thread[]}             threads
 * @property {ThreadTimelineEntry[]} timeline
 * @property {SharedResources}      sharedResources
 * @property {ThreadMetrics[]}      threadMetrics
 */

/**
 * @param {{ pid: number, processArrivalTime: number, threads: Thread[],
 *           timeline: ThreadTimelineEntry[], sharedResources: SharedResources,
 *           threadMetrics: ThreadMetrics[] }} fields
 * @returns {ThreadTrace}
 */
export function makeThreadTrace({ pid, processArrivalTime, threads, timeline, sharedResources, threadMetrics }) {
  return { pid, processArrivalTime, threads, timeline, sharedResources, threadMetrics };
}

// ─── §1.9 ComparisonResult ───────────────────────────────────────────────────

/**
 * @typedef {object} ComparisonResult
 * @property {Process[]} inputProcesses
 * @property {{ algorithm: SchedulingAlgorithm, config: SchedulingConfig,
 *              metrics: AggregateMetrics, trace: SchedulingTrace }[]} [schedulingComparisons]
 * @property {{ algorithm: PageReplacementAlgorithm, totalFaults: number,
 *              hitRate: number, trace: PageReplacementTrace }[]} [pageReplacementComparisons]
 */

/**
 * @param {{ inputProcesses: Process[], schedulingComparisons?: object[],
 *           pageReplacementComparisons?: object[] }} fields
 * @returns {ComparisonResult}
 */
export function makeComparisonResult({ inputProcesses, schedulingComparisons, pageReplacementComparisons }) {
  return { inputProcesses, schedulingComparisons, pageReplacementComparisons };
}

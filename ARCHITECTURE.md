# OS Simulator — Architecture v3.1

**System Architecture Document**

OS Scheduling & Memory Paging Simulator

Vanilla HTML + CSS + JavaScript • Solo Developer • Contest Submission

Version 3.1 — Threads Integrated, All Audit Fixes Applied

Real stack pages • Globally unique TIDs • 8-thread system cap

---

## Trace Notation Convention

All test case traces in this document follow these rules:

- **Ready queue is shown AFTER dispatch.** The entity that runs at time T has been removed from the ready queue. The ready queue shows what remains.

- **Ticks with no state change may be omitted.** If the same entity continues running and no arrivals/completions/preemptions occur, the tick is skipped in the trace. The Gantt chart shows every tick; the trace narrative shows decision points.

- **Quantum expiry processing order:** (1) arrivals at this tick enter the ready queue, (2) the preempted entity goes to the BACK of the ready queue, (3) dispatch from the front of the queue.

- **Ready queue ordering is FCFS** (longest-waiting first). Within the same arrival tick, ties broken by pid, then by local thread index.

- **Completion is recorded at the START of the next tick.** If an entity's remaining burst reaches 0 during tick T, its completion time is T+1.

---

## Step 1 — Core Data Structures

All interfaces in TypeScript notation for documentation. Implementation is vanilla JS. These are the contracts between Engine and Rendering.

### 1.1 Thread

The unit of CPU scheduling. Each thread belongs to exactly one process.

```typescript
interface Thread {
  tid: number;              // globally unique, 1-based, sequential across all processes
  parentPid: number;        // owning process PID
  arrivalTime: number;      // >= parent process arrivalTime
  burstTime: number;        // > 0
  priority: number;         // inherits from process, can override per-thread
  state: ThreadState;       // independent per thread
  remainingTime: number;    // engine internal, starts equal to burstTime
  stackPages: number;       // >= 1, private stack memory in pages
}

type ThreadState = 'NEW' | 'READY' | 'RUNNING' | 'WAITING' | 'TERMINATED';
```

**TID assignment:** TIDs are assigned sequentially across all threads in the simulation. P1's 2 threads get tid=1,2. P2's 1 thread gets tid=3. P3's 3 threads get tid=4,5,6. Globally unique, never reused.

**Stack pages:** Private per thread. Default 1, minimum 1. Consume real memory. The Threads screen shows the shared vs. private breakdown; Memory and Page Replacement screens see only total numPages.

**System cap:** Maximum 8 threads per process. System restriction enforced in input validation.

### 1.2 Process

```typescript
interface Process {
  pid: number;              // unique, 1-based
  arrivalTime: number;      // >= 0
  burstTime: number;        // computed: sum of thread burst times
  priority: number;         // lower = higher priority (1 is top)
  sharedPages: number;      // > 0, code/data/heap pages shared by all threads
  numPages: number;         // computed: sharedPages + sum(thread.stackPages)
  threads: Thread[];        // length >= 1, max 8
}
```

**Backward compatibility:** When no threads defined, auto-generate one thread with the next sequential global tid, stackPages=1. numPages = sharedPages + 1. Every code path always operates on threads.

### 1.3 SchedulableEntity

The unit visible in traces and consumed by scheduling algorithms. Produced by `expandToThreads()`.

```typescript
interface SchedulableEntity {
  pid: number;
  tid: number;              // globally unique thread ID
  label: string;            // 'P1' for single-threaded, 'P1-T2' for multi-threaded
  arrivalTime: number;      // from the thread
  burstTime: number;        // from the thread
  priority: number;         // from the thread (may override process priority)
  remainingTime: number;    // engine internal, starts equal to burstTime
}
```

**Label convention:** Single-threaded (threads.length === 1): label = `'P{pid}'`. Multi-threaded: label = `'P{pid}-T{n}'` where n is the local index within its parent (1-based), NOT the global tid.

### 1.4 SchedulingConfig

```typescript
interface SchedulingConfig {
  algorithm: SchedulingAlgorithm;
  quantum?: number;
  mlqQueues?: {
    algorithm: 'FCFS' | 'RR' | 'SJF';
    priorityRange: [number, number];
    quantum?: number;
  }[];
  mlfqLevels?: {
    algorithm: 'FCFS' | 'RR';
    quantum: number;
    promoteAfter?: number;
    demoteAfter?: number;
  }[];
}

type SchedulingAlgorithm = 'FCFS' | 'SJF' | 'HRRN' | 'RR' | 'SRTF' | 'PRIORITY_PREEMPTIVE' | 'MLQ' | 'MLFQ';
```

### 1.5 SchedulingTrace

Complete output of one scheduling algorithm. The UI is a trace player.

```typescript
interface SchedulingTrace {
  algorithm: SchedulingAlgorithm;
  config: SchedulingConfig;
  timeline: TimelineEntry[];
  processMetrics: ProcessMetrics[];    // one per process (join-barrier)
  threadMetrics: ThreadMetrics[];      // one per thread
  aggregateMetrics: AggregateMetrics;
}

interface TimelineEntry {
  time: number;
  runningPid: number | null;
  runningTid: number | null;
  readyQueue: SchedulableEntity[];     // after dispatch (running entity removed)
  arrivedThisTick: number[];           // tids arriving at this time
  completedThisTick: number[];         // tids completing at this time
  contextSwitch: boolean;
  // MLQ/MLFQ only:
  queueLevels?: {
    level: number;
    entities: SchedulableEntity[];
    algorithm: string;
  }[];
  promotions?: { tid: number; from: number; to: number }[];
  demotions?:  { tid: number; from: number; to: number }[];
  // Process/thread state tracking:
  processStates: {
    pid: number;
    state: ProcessState;
    threadStates?: { tid: number; state: ThreadState; }[];
  }[];
}

type ProcessState = 'NEW' | 'READY' | 'RUNNING' | 'WAITING' | 'TERMINATED';

interface ProcessMetrics {
  pid: number;
  completionTime: number;     // join-barrier: last thread completion
  turnaroundTime: number;     // completionTime - arrivalTime
  waitingTime: number;        // turnaroundTime - sum(thread burstTimes)
  responseTime: number;       // min(thread firstRunTimes) - process arrivalTime
}

interface ThreadMetrics {
  tid: number;
  pid: number;
  completionTime: number;
  turnaroundTime: number;     // thread completion - thread arrival
  waitingTime: number;        // turnaroundTime - burstTime
  responseTime: number;       // thread firstRun - thread arrival
}

interface AggregateMetrics {
  avgCompletionTime: number;  // thread-level average
  avgTurnaroundTime: number;  // thread-level average
  avgWaitingTime: number;     // thread-level average
  avgResponseTime: number;    // thread-level average
  cpuUtilization: number;     // 0–100
  totalContextSwitches: number;
  throughput: number;         // threads / total time
}
```

**Process-level metric formulas (join-barrier):**

- CT = max(thread.completionTime) across all threads of this process
- TAT = CT - process.arrivalTime
- WT = TAT - sum(thread.burstTime for all threads in this process)
- RT = min(thread.firstRunTime) - process.arrivalTime (earliest thread to get CPU)

### 1.6 MemoryConfig & MemoryState

Memory and page replacement see numPages per process (shared + stack total). No shared/stack distinction.

```typescript
interface MemoryConfig {
  totalMemory: number;
  pageSize: number;
  numFrames: number;         // computed: totalMemory / pageSize
}

interface MemoryState {
  frames: FrameEntry[];
  internalFragmentation: number;
}

interface FrameEntry {
  frameIndex: number;
  ownerPid: number | null;
  pageNumber: number | null;
  loadedAt: number;
  referenceBit?: boolean;
}
```

### 1.7 PageReplacementTrace

```typescript
interface PageReplacementTrace {
  algorithm: PageReplacementAlgorithm;
  referenceString: PageRef[];
  steps: PageReplacementStep[];
  totalFaults: number;
  totalHits: number;
  hitRate: number;
}

type PageReplacementAlgorithm = 'FIFO' | 'LRU' | 'OPTIMAL' | 'CLOCK' | 'SECOND_CHANCE';

interface PageRef {
  pid: number;
  pageNumber: number;
}

interface PageReplacementStep {
  stepIndex: number;
  requested: PageRef;
  isHit: boolean;
  evicted: PageRef | null;
  frameState: FrameEntry[];
  clockPointer?: number;
  referenceBits?: boolean[];
  faultsSoFar: number;
}
```

### 1.8 ThreadTrace (Threads Screen)

```typescript
interface ThreadTrace {
  pid: number;
  processArrivalTime: number;
  threads: Thread[];
  timeline: ThreadTimelineEntry[];
  sharedResources: SharedResources;
  threadMetrics: ThreadMetrics[];
}

interface ThreadTimelineEntry {
  time: number;
  threadStates: {
    tid: number;
    state: ThreadState;
    remainingBurst: number;
  }[];
  runningTid: number | null;
  event: ThreadEvent | null;
}

interface ThreadEvent {
  type: 'CREATED' | 'DISPATCHED' | 'PREEMPTED' | 'BLOCKED' | 'UNBLOCKED' | 'COMPLETED' | 'JOINED';
  tid: number;
  description: string;
}

interface SharedResources {
  codeSegment: string;
  dataSegment: string;
  heapSegment: string;
  sharedPageNumbers: number[];
  threadStacks: {
    tid: number;
    localIndex: number;
    stackPageNumbers: number[];
  }[];
}
```

### 1.9 ComparisonResult

```typescript
interface ComparisonResult {
  inputProcesses: Process[];
  schedulingComparisons?: {
    algorithm: SchedulingAlgorithm;
    config: SchedulingConfig;
    metrics: AggregateMetrics;
    trace: SchedulingTrace;
  }[];
  pageReplacementComparisons?: {
    algorithm: PageReplacementAlgorithm;
    totalFaults: number;
    hitRate: number;
    trace: PageReplacementTrace;
  }[];
}
```

---

## Step 2 — Module Boundaries

Three layers with hard boundaries.

### 2.1 Data Layer (`data.js`)

**Responsibility:** Parse, validate, normalize input into Process[] (with threads) and MemoryConfig.

```javascript
parseProcessesFromForm(formData): Process[]
parseProcessesFromFile(fileContent: string): Process[]
parseMemoryConfig(formData): MemoryConfig
parseMemoryConfigFromFile(fileContent: string): MemoryConfig
generateReferenceString(processes: Process[], length: number): PageRef[]
validateProcesses(processes: Process[]): ValidationResult
  // sharedPages >= 1, stackPages >= 1, thread arrival >= process arrival,
  // max 8 threads, burst > 0, numPages computed correctly
```

**Depends on:** Nothing. **Must NOT access:** DOM, Engine, Rendering.

### 2.2 Engine Layer (`engine/`)

**Responsibility:** Pure computation. Zero DOM, zero side effects, testable in Node.

```javascript
// Scheduling (each internally calls expandToThreads):
runFCFS(processes: Process[]): SchedulingTrace
runSJF(processes: Process[]): SchedulingTrace
runHRRN(processes: Process[]): SchedulingTrace
runRoundRobin(processes: Process[], quantum: number): SchedulingTrace
runSRTF(processes: Process[]): SchedulingTrace
runPriorityPreemptive(processes: Process[]): SchedulingTrace
runMLQ(processes: Process[], config: SchedulingConfig): SchedulingTrace
runMLFQ(processes: Process[], config: SchedulingConfig): SchedulingTrace

// Thread utilities (engine/thread-utils.js):
expandToThreads(processes: Process[]): SchedulableEntity[]
generateThreadTrace(processes: Process[], targetPid: number, config: SchedulingConfig): ThreadTrace

// Page replacement:
runFIFO(frames: number, refs: PageRef[]): PageReplacementTrace
runLRU(frames: number, refs: PageRef[]): PageReplacementTrace
runOptimal(frames: number, refs: PageRef[]): PageReplacementTrace
runClock(frames: number, refs: PageRef[]): PageReplacementTrace
runSecondChance(frames: number, refs: PageRef[]): PageReplacementTrace

// Comparison:
compareScheduling(processes: Process[], configs: SchedulingConfig[]): ComparisonResult
comparePageReplacement(numFrames: number, refs: PageRef[], algorithms: PageReplacementAlgorithm[]): ComparisonResult
```

**Depends on:** Interface types only. **Must NOT access:** DOM, Data Layer, Rendering, global mutable state.

### 2.3 Rendering Layer (`render/`)

**Responsibility:** Consume traces, render to Canvas/DOM. Never compute logic.

```javascript
class AnimationController {
  constructor(totalSteps);
  play(); pause(); stepForward(); stepBackward();
  goToStep(n); setSpeed(1|2|4);
  onStepChange(cb); getCurrentStep(); isPlaying();
}

renderGanttChart(ctx, trace, currentStep, canvasWidth, canvasHeight): void
renderReadyQueue(container, entry: TimelineEntry): void
renderStateDiagram(ctx, processStates, previousStates): void
renderMemoryGrid(container, memoryState, config): void
renderPageReplacementTable(container, trace, currentStep): void
renderClockDiagram(ctx, step, numFrames): void
renderComparisonChart(ctx, comparison, metric, chartType): void
renderMetricsDashboard(container, traces: SchedulingTrace[]): void

// Thread renderers (render/thread-visuals.js):
renderThreadStateDiagram(ctx, threads, currentStates, previousStates, processState): void
renderMemorySharing(container, sharedResources, threads, activeTids): void
renderThreadGantt(ctx, trace: ThreadTrace, currentStep, canvasWidth, canvasHeight): void
renderThreadEventLog(container, events: ThreadEvent[], currentStep): void
```

**Depends on:** Trace interfaces, DOM/Canvas. **Must NOT access:** Data Layer, Engine Layer.

---

## Step 3 — File & Folder Structure

```
os-simulator/
├── index.html
├── style.css
├── app.js
├── data.js
├── engine/
│   ├── scheduling-fcfs.js
│   ├── scheduling-sjf.js
│   ├── scheduling-hrrn.js
│   ├── scheduling-rr.js
│   ├── scheduling-srtf.js
│   ├── scheduling-priority.js
│   ├── scheduling-mlq.js
│   ├── scheduling-mlfq.js
│   ├── paging-fifo.js
│   ├── paging-lru.js
│   ├── paging-optimal.js
│   ├── paging-clock.js
│   ├── paging-second-chance.js
│   ├── comparison.js
│   ├── engine-utils.js
│   └── thread-utils.js
├── render/
│   ├── gantt.js
│   ├── ready-queue.js
│   ├── state-diagram.js
│   ├── memory-grid.js
│   ├── page-table.js
│   ├── clock-visual.js
│   ├── comparison-chart.js
│   ├── metrics-dashboard.js
│   ├── animation.js
│   └── thread-visuals.js
├── screens/
│   ├── screen-input.js
│   ├── screen-scheduling.js
│   ├── screen-memory.js
│   ├── screen-paging.js
│   ├── screen-threads.js
│   ├── screen-metrics.js
│   └── screen-comparison.js
├── tests/
│   ├── test-scheduling.js
│   ├── test-paging.js
│   ├── test-data.js
│   └── test-threads.js
└── assets/
```

**Justifications:**

- **Separate files per algorithm:** Each scheduling and paging algorithm is isolated for independent testing and clear ownership. One bug in MLFQ never touches FCFS.
- **One `style.css`:** Solo project. CSS splitting adds no value and creates merge headaches.
- **`screens/` folder:** Each screen file wires its DOM elements to engine + render calls. This is the glue layer between Data/Engine/Render and the user-facing tabs.

---

## Step 4 — Screen Layout & Navigation

7 tabs: Input, Scheduling, Memory, Page Replacement, Threads, Metrics, Comparison.

Tab-based navigation via show/hide CSS class. Global AppState object. Each visualization screen owns its own AnimationController.

| Screen | State Required | Produces |
|--------|---------------|----------|
| 1. Input | None | Process[] (with threads), MemoryConfig |
| 2. Scheduling | Process[], algorithm | SchedulingTrace (cached) |
| 3. Memory | Process[] + MemoryConfig | MemoryState |
| 4. Page Replacement | MemoryConfig + PageRef[] | PageReplacementTrace |
| 5. Threads | Process[], SchedulingTrace, selected PID | ThreadTrace |
| 6. Metrics | All computed traces | Read-only dashboard |
| 7. Comparison | Process[] + MemoryConfig + algorithms | ComparisonResult |

**AppState structure:**

```javascript
const AppState = {
  processes: [],              // Process[] with threads
  memoryConfig: null,         // MemoryConfig
  currentAlgorithm: null,     // SchedulingAlgorithm
  schedulingTrace: null,      // SchedulingTrace (cached)
  pageReplacementTrace: null, // PageReplacementTrace (cached)
  referenceString: [],        // PageRef[]
  threadTraces: new Map(),    // Map<pid, ThreadTrace>
  selectedThreadPid: null,    // number | null
  comparisonResult: null,     // ComparisonResult (cached)
};
```

---

## Step 5 — Rendering Strategy

| Element | Tech | Justification |
|---------|------|---------------|
| Gantt Chart | Canvas 2D | Smooth scrolling. SchedulableEntity labels. Thread shade variations. |
| Ready Queue | DOM | Cards with tooltips. CSS transitions. |
| State Diagram | Canvas 2D | 5-node graph. Thread clusters for multi-threaded. |
| Memory Grid | DOM Grid | Hoverable. Sees total numPages only. |
| Page Table | DOM table | Highlighted current step. |
| Clock Visual | Canvas 2D | Circular buffer. Cap 32 frames. Pointer tween animation. |
| Comparison | Canvas 2D | Grouped bars. 'Avg Thread TAT' labels. |
| Metrics | DOM tables | Dual: Thread Metrics + Process Metrics (join-barrier). |
| Thread State Diagram | Canvas 2D | Up to 8 rows (system cap). Process summary bar. |
| Memory Sharing | DOM Grid | Shared segments + private stacks with real page counts. |
| Thread Gantt | Canvas 2D | One row per thread. Idle gaps visible. |
| Thread Events | DOM table | Scrolling log synced with animation. |

### 5.1 Gantt Chart Animation Detail

- Render the full Gantt chart immediately but highlight/reveal blocks progressively during animation.
- Each process gets a distinct color from a predefined palette (not random).
- Context switches shown as thin vertical lines or gaps between blocks.
- Time markers on the x-axis.
- Process/thread labels inside each block using SchedulableEntity.label.
- Current time indicator (vertical line or highlight).
- Animation controls: Play/Pause, Step Forward, Step Back, Speed slider (1x, 2x, 4x).

### 5.2 Clock/Second Chance Circular Visualization

- Render as a circle with sectors (one per frame).
- Arc math auto-scales to frame count. Cap at 32 frames.
- Pointer shown as an arrow or highlighted sector.
- Reference bits displayed inside each sector.
- Pointer tween animation on advancement.

### 5.3 External Libraries

None required. All rendering uses native Canvas 2D API and DOM manipulation. No chart library needed — the visualizations are custom enough that a library would constrain more than help.

---

## Step 6 — Threads Module

### 6.1 Educational Goals

- **Shared address space:** Threads share code/data/heap and pages. Stacks are private, consume real pages.
- **Independent execution:** Each thread transitions between states independently.
- **Lifecycle:** Create, execute, terminate. Process joins on all threads (join-barrier).
- **Scheduling granularity:** Scheduler dispatches threads, not processes.

**NOT included:** No synchronization primitives, no user/kernel threading models, no thread pools.

### 6.2 expandToThreads()

Returns SchedulableEntity[] with full scheduling data (arrivalTime, burstTime, priority, remainingTime). All 8 algorithms call this at the start. Sort by arrivalTime, then pid, then tid.

For single-threaded processes, the auto-generated thread produces a SchedulableEntity with label `'P{pid}'` — identical output to a system without thread support. This is the backward compatibility guarantee.

### 6.3 Join-Barrier

Process → TERMINATED only when ALL threads complete. See ProcessMetrics formulas in §1.5.

### 6.4 generateThreadTrace()

Runs full simulation on ALL processes (threads compete globally), then filters to targetPid. Produces ThreadTrace with lifecycle events and SharedResources with real page assignments.

**Why run the full simulation?** Threads compete globally for CPU time. P1-T1 may be delayed by P2-T1 running. Filtering after full simulation ensures correct timing. Running only the target process's threads would produce wrong completion times.

### 6.5 Threads Screen

| Panel | Content | Tech |
|-------|---------|------|
| Process Selector | Dropdown. Multi-threaded shown with '(N threads)'. | DOM |
| Thread State Diagram | Up to 8 rows. Process summary bar with join-barrier. | Canvas |
| Memory Sharing | Shared segments + private stacks (real page counts). Stacks appear as threads are created. | DOM |
| Thread Gantt | One row per thread. Idle gaps as lighter shade. | Canvas |
| Event Log | CREATED/DISPATCHED/PREEMPTED/COMPLETED/JOINED. Counters. | DOM |

**Single-threaded processes:** Selectable in the dropdown. Shows 1 thread row, 1 stack in Memory Sharing View. This is the degenerate case — demonstrates that even single-threaded processes have a stack allocation.

### 6.6 Input Changes

**Manual input:** Collapsible thread sub-rows per process. SharedPages per process, StackPages per thread. Burst auto-sums from thread bursts.

**File format (backward compatible):**

5 columns (single-threaded):
```
PID,Arrival,Burst,Priority,SharedPages
1,0,5,2,4          # numPages = 4 + 1(auto stack) = 5
```

9 columns (multi-threaded):
```
PID,Arrival,Burst,Priority,SharedPages,ThreadID,ThreadArrival,ThreadBurst,StackPages
1,0,8,2,3,1,0,5,1  # P1-T1
1,0,8,2,3,2,0,3,1  # P1-T2. P1 numPages = 3+1+1 = 5
```

**Validation:** max 8 threads per process, thread arrival >= process arrival, stackPages >= 1, sharedPages >= 1, burst > 0.

---

## Step 7 — Implementation Risks

**Risk 1: MLFQ Correctness.**
Why: Only algorithm with mid-execution queue changes.
Mitigation: Trace includes promotions/demotions with reasons. Implement last among scheduling algorithms. Validate against the textbook trace in Appendix A.9.

**Risk 2: Animation Pause/Resume.**
Why: Race conditions between timer and manual steps.
Mitigation: Single setInterval. Step always pauses first. AnimationController is a pure step counter — no rendering logic inside it.

**Risk 3: Clock Circular Buffer.**
Why: Variable sector sizes from user-configured frame count.
Mitigation: Arc math auto-scales to frame count. Cap at 32 frames. Pointer tween animation for smooth movement.

**Risk 4: Comparison Performance.**
Why: 8 scheduling + 5 paging algorithms run sequentially.
Mitigation: setTimeout yield between algorithm runs to prevent UI freeze. Cache traces. Render static charts (no animation on comparison screen).

**Risk 5: SchedulingTrace Consistency.**
Why: 8 algorithms must produce traces with identical shape/contracts.
Mitigation: Shared `validateTrace()` function that asserts structure. Shared `buildTimelineEntry()` helper used by all algorithms to construct entries.

**Risk 6: Thread Expansion Breaking Tests.**
Why: expandToThreads() changes the input for all algorithms — even single-threaded cases now go through expansion.
Mitigation: Single-threaded expansion must produce identical metrics to the pre-thread system. All Appendix A test cases must pass unchanged after the thread refactor. This is the regression firewall.

**Risk 7: Join-Barrier Metrics Confusion.**
Why: Two interpretations of TAT — thread-level vs. process-level (join-barrier).
Mitigation: Dual tables everywhere: 'Thread Metrics' + 'Process Metrics (join-barrier)'. Explicit labels. AggregateMetrics uses thread-level averages consistently.

**Risk 8: Threads Screen Complexity.**
Why: 4 synchronized panels with complex state diagram.
Mitigation: System cap = 8 threads keeps rendering bounded. Build Gantt + Events first (simplest), State Diagram last (hardest). Each panel uses the same ThreadTrace — no separate data sources.

---

## Appendix A — Scheduling Test Cases (Single-Threaded)

Each process auto-generates 1 thread (stackPages=1). numPages = sharedPages + 1.

### A.1 Shared Input

| PID | Arrival | Burst | Priority | SharedPages |
|-----|---------|-------|----------|-------------|
| 1   | 0       | 5     | 2        | 4           |
| 2   | 1       | 3     | 1        | 3           |
| 3   | 2       | 7     | 3        | 5           |

### A.2 FCFS

Gantt: `| P1 (0-5) | P2 (5-8) | P3 (8-15) |`

```
P1: CT=5,  TAT=5,  WT=0, RT=0
P2: CT=8,  TAT=7,  WT=4, RT=4
P3: CT=15, TAT=13, WT=6, RT=6
Avg TAT=8.33, Avg WT=3.33, CPU Util=100%
```

### A.3 SJF

Same as FCFS for this input (when P1 finishes at t=5, P2 burst=3 < P3 burst=7).

```
Avg TAT=8.33, Avg WT=3.33
```

### A.4 HRRN

At t=5: P2 RR=(4+3)/3=2.33, P3 RR=(3+7)/7=1.43. Picks P2.

Same Gantt as FCFS.

```
Avg TAT=8.33, Avg WT=3.33
```

### A.5 Round Robin (q=2)

```
t=0:  P1 runs. Ready: []
t=2:  P1 preempted. P2 runs. Ready: [P3, P1]
t=4:  P2 preempted. P3 runs. Ready: [P1, P2]
t=6:  P3 preempted. P1 runs. Ready: [P2, P3]
t=8:  P1 preempted. P2 runs. Ready: [P3, P1]
t=9:  P2 done. P3 runs. Ready: [P1]
t=11: P3 preempted. P1 runs. Ready: [P3]
t=12: P1 done. P3 runs.
t=15: P3 done.
```

Gantt: `| P1(0-2) | P2(2-4) | P3(4-6) | P1(6-8) | P2(8-9) | P3(9-11) | P1(11-12) | P3(12-15) |`

```
P1: CT=12, TAT=12, WT=7,  RT=0
P2: CT=9,  TAT=8,  WT=5,  RT=1
P3: CT=15, TAT=13, WT=6,  RT=2
```

### A.6 SRTF

```
t=0: P1 runs (rem=5).
t=1: P2 arrives (burst=3). P2 preempts P1 (rem=3 < rem=4).
t=4: P2 done. P1 resumes (rem=4).
t=8: P1 done. P3 runs (rem=7).
t=15: P3 done.
```

Gantt: `| P1(0-1) | P2(1-4) | P1(4-8) | P3(8-15) |`

```
P1: CT=8,  TAT=8,  WT=3, RT=0
P2: CT=4,  TAT=3,  WT=0, RT=0
P3: CT=15, TAT=13, WT=6, RT=6
```

### A.7 Priority Preemptive

Same Gantt and metrics as SRTF for this input (P2 pri=1 highest, P1 pri=2, P3 pri=3 lowest).

```
P1: CT=8,  TAT=8,  WT=3, RT=0
P2: CT=4,  TAT=3,  WT=0, RT=0
P3: CT=15, TAT=13, WT=6, RT=6
```

### A.8 Multilevel Queue

Q1(RR q=2): priority 1. Q2(RR q=4): priority 2. Q3(FCFS): priority 3. Higher queues preempt lower.

**Input (different from A.1):**

| PID | Arrival | Burst | Priority | Queue |
|-----|---------|-------|----------|-------|
| 1   | 0       | 4     | 3        | Q3    |
| 2   | 1       | 3     | 1        | Q1    |
| 3   | 2       | 5     | 2        | Q2    |
| 4   | 3       | 2     | 1        | Q1    |

```
t=0:  P1 runs (Q3).
t=1:  P2 arrives (Q1), preempts P1. P2 runs.
t=3:  P2 quantum expires. P4 arrives (Q1). Arrivals before preempted → P4 runs.
      Ready: [P2(Q1), P3(Q2), P1(Q3)]
t=5:  P4 done. P2 runs (Q1, rem=1).
t=6:  P2 done. P3 runs (Q2).
t=11: P3 done. P1 runs (Q3).
t=14: P1 done.
```

Gantt: `| P1(0-1) | P2(1-3) | P4(3-5) | P2(5-6) | P3(6-11) | P1(11-14) |`

```
P1: CT=14, TAT=14, WT=10, RT=0
P2: CT=6,  TAT=5,  WT=2,  RT=0
P3: CT=11, TAT=9,  WT=4,  RT=4
P4: CT=5,  TAT=2,  WT=0,  RT=0
```

### A.9 Multilevel Feedback Queue

Q0(RR q=2), Q1(RR q=4), Q2(FCFS). All enter Q0. Demote on full quantum use. Aging: 15 ticks in Q2 → promote to Q0.

**Input (different from A.1):**

| PID | Arrival | Burst |
|-----|---------|-------|
| 1   | 0       | 10    |
| 2   | 1       | 3     |
| 3   | 15      | 5     |

```
t=0-1:  P1 runs in Q0 (2 ticks).
t=2:    P1 demoted Q0→Q1. P2 runs in Q0.
t=4:    P2 demoted Q0→Q1. P1 runs in Q1.
t=8:    P1 demoted Q1→Q2. P2 runs in Q1 (rem=1).
t=9:    P2 done.
t=9-12: P1 runs in Q2 (rem=4).
t=13:   P1 done.
t=13-14: IDLE.
t=15:   P3 arrives Q0. Runs 2 ticks.
t=17:   P3 demoted Q0→Q1. Runs 3 ticks in Q1.
t=20:   P3 done.
```

Gantt: `| P1(0-2) | P2(2-4) | P1(4-8) | P2(8-9) | P1(9-13) | IDLE(13-15) | P3(15-20) |`

```
P1: CT=13, TAT=13, WT=3, RT=0   (went through Q0→Q1→Q2)
P2: CT=9,  TAT=8,  WT=5, RT=1   (went through Q0→Q1)
P3: CT=20, TAT=5,  WT=0, RT=0   (went through Q0→Q1)
```

---

## Appendix B — Page Replacement Test Cases

Reference string: `[1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]` — 3 frames.

### B.1 FIFO

```
Step 1:  Req=1, FAULT load. Frames=[1,-,-]
Step 2:  Req=2, FAULT load. Frames=[1,2,-]
Step 3:  Req=3, FAULT load. Frames=[1,2,3]
Step 4:  Req=4, FAULT evict 1. Frames=[4,2,3]
Step 5:  Req=1, FAULT evict 2. Frames=[4,1,3]
Step 6:  Req=2, FAULT evict 3. Frames=[4,1,2]
Step 7:  Req=5, FAULT evict 4. Frames=[5,1,2]
Step 8:  Req=1, HIT.
Step 9:  Req=2, HIT.
Step 10: Req=3, FAULT evict 1. Frames=[5,3,2]
Step 11: Req=4, FAULT evict 2. Frames=[5,3,4]
Step 12: Req=5, HIT.
```

**Faults: 9, Hit rate: 0.25**

### B.2 LRU

```
Steps 1-3: Cold start faults. Frames=[1,2,3]
Steps 4-7: Faults (evict least recently used each time).
Steps 8-9: HITs.
Steps 10-12: 3 Faults.
```

**Faults: 10, Hit rate: 0.167**

### B.3 Optimal

```
Steps 1-3: Cold start faults. Frames=[1,2,3]
Step 4:  Req=4, evict 3 (next use @step 10). Frames=[1,2,4]
Step 5:  Req=1, HIT.
Step 6:  Req=2, HIT.
Step 7:  Req=5, evict 4 (next use @step 11). Frames=[1,2,5]
Step 8:  Req=1, HIT.
Step 9:  Req=2, HIT.
Step 10: Req=3, evict 5 (next use @step 12). Frames=[1,2,3]
Step 11: Req=4, evict 1 (never used again). Frames=[4,2,3]
Step 12: Req=5, evict 4 (never used again). Frames=[5,2,3]
```

**Faults: 7, Hit rate: 0.417**

### B.4 Clock (3 frames)

Same reference string. Pointer starts at frame 0. On fault: scan from pointer, give second chance to frames with refBit=1 (clear it), evict first frame with refBit=0. On hit: set refBit=1.

```
Step 1:  Req=1, FAULT load. Frames=[1,-,-] RefBits=[1,0,0] Ptr=1
Step 2:  Req=2, FAULT load. Frames=[1,2,-] RefBits=[1,1,0] Ptr=2
Step 3:  Req=3, FAULT load. Frames=[1,2,3] RefBits=[1,1,1] Ptr=0
Step 4:  Req=4, FAULT. Ptr=0: ref=1→clear. Ptr=1: ref=1→clear. Ptr=2: ref=1→clear.
         Ptr=0: ref=0→evict 1. Frames=[4,2,3] RefBits=[1,0,0] Ptr=1
Step 5:  Req=1, FAULT. Ptr=1: ref=0→evict 2. Frames=[4,1,3] RefBits=[1,1,0] Ptr=2
Step 6:  Req=2, FAULT. Ptr=2: ref=0→evict 3. Frames=[4,1,2] RefBits=[1,1,1] Ptr=0
Step 7:  Req=5, FAULT. Clear all, evict frame 0. Frames=[5,1,2] RefBits=[1,0,0] Ptr=1
Step 8:  Req=1, HIT. RefBits=[1,1,0]
Step 9:  Req=2, HIT. RefBits=[1,1,1]
Step 10: Req=3, FAULT. Clear all, evict frame 1. Frames=[5,3,2] RefBits=[0,1,0] Ptr=2
Step 11: Req=4, FAULT. Ptr=2: ref=0→evict 2. Frames=[5,3,4] RefBits=[0,1,1] Ptr=0
Step 12: Req=5, HIT. RefBits=[1,1,1]
```

**Faults: 9, Hit rate: 0.25** (same as FIFO for this string)

---

## Appendix C — Thread Test Cases

### C.1 Multi-Threaded Input

| PID | Arr | Pri | SharedPg | TID | Local | T.Arr | T.Burst | StackPg |
|-----|-----|-----|----------|-----|-------|-------|---------|---------|
| 1   | 0   | 2   | 3        | 1   | 1     | 0     | 5       | 1       |
| 1   | 0   | 2   | 3        | 2   | 2     | 0     | 3       | 1       |
| 2   | 1   | 1   | 3        | 3   | 1     | 1     | 4       | 1       |
| 3   | 3   | 3   | 4        | 4   | 1     | 3     | 2       | 1       |
| 3   | 3   | 3   | 4        | 5   | 2     | 4     | 3       | 2       |
| 3   | 3   | 3   | 4        | 6   | 3     | 5     | 2       | 1       |

**Page count computation:**
- P1: numPages = 3 (shared) + 1 + 1 (stacks) = 5
- P2: numPages = 3 (shared) + 1 (stack) = 4
- P3: numPages = 4 (shared) + 1 + 2 + 1 (stacks) = 8

### C.2 FCFS (Thread-Aware)

Gantt: `| P1-T1(0-5) | P1-T2(5-8) | P2(8-12) | P3-T1(12-14) | P3-T2(14-17) | P3-T3(17-19) |`

**Thread metrics:**

```
tid=1 P1-T1: CT=5,  TAT=5,  WT=0
tid=2 P1-T2: CT=8,  TAT=8,  WT=5
tid=3 P2:    CT=12, TAT=11, WT=7
tid=4 P3-T1: CT=14, TAT=11, WT=9
tid=5 P3-T2: CT=17, TAT=13, WT=10
tid=6 P3-T3: CT=19, TAT=14, WT=12
```

**Process metrics (join-barrier):**

```
P1: CT=8,  TAT=8  (last: P1-T2)
P2: CT=12, TAT=11 (only thread)
P3: CT=19, TAT=16 (last: P3-T3)
```

### C.3 RR(q=2) (Thread-Aware)

Ready queue: FCFS ordering. Arrivals enter before preempted entity on quantum expiry.

```
t=0:  P1-T1 runs. Ready: [P1-T2]
t=2:  P1-T1 quantum expires. P1-T2 runs. Ready: [P2, P1-T1]
t=4:  P1-T2 quantum expires. P3-T2 arrives. P2 runs. Ready: [P1-T1, P3-T1, P3-T2, P1-T2]
t=6:  P2 quantum expires. P1-T1 runs. Ready: [P3-T1, P3-T2, P1-T2, P3-T3, P2]
t=8:  P1-T1 quantum expires (rem=1). P3-T1 runs. Ready: [P3-T2, P1-T2, P3-T3, P2, P1-T1]
t=10: P3-T1 done. P3-T2 runs. Ready: [P1-T2, P3-T3, P2, P1-T1]
t=12: P3-T2 quantum expires (rem=1). P1-T2 runs. Ready: [P3-T3, P2, P1-T1, P3-T2]
t=13: P1-T2 done. P3-T3 runs. Ready: [P2, P1-T1, P3-T2]
t=15: P3-T3 done. P2 runs. Ready: [P1-T1, P3-T2]
t=17: P2 done. P1-T1 runs. Ready: [P3-T2]
t=18: P1-T1 done. P3-T2 runs.
t=19: P3-T2 done.
```

**Thread metrics:**

```
tid=1 P1-T1: CT=18, TAT=18, WT=13
tid=2 P1-T2: CT=13, TAT=13, WT=10
tid=3 P2:    CT=17, TAT=16, WT=12
tid=4 P3-T1: CT=10, TAT=7,  WT=5
tid=5 P3-T2: CT=19, TAT=15, WT=12
tid=6 P3-T3: CT=15, TAT=10, WT=8
```

**Process metrics (join-barrier):**

```
P1: CT=18, TAT=18
P2: CT=17, TAT=16
P3: CT=19, TAT=16
```

### C.4 ThreadTrace — P3 under FCFS

**Events:**

```
t=3:  T1 CREATED
t=4:  T2 CREATED
t=5:  T3 CREATED
t=12: T1 DISPATCHED
t=14: T1 COMPLETED
t=14: T2 DISPATCHED
t=17: T2 COMPLETED
t=17: T3 DISPATCHED
t=19: T3 COMPLETED
t=19: P3 JOINED
```

**SharedResources** (sharedPages=4, numPages=8):

```
Shared pages: [0, 1, 2, 3]
P3-T1 (tid=4, local=1): stack [4]       (1 stackPage)
P3-T2 (tid=5, local=2): stack [5, 6]    (2 stackPages)
P3-T3 (tid=6, local=3): stack [7]       (1 stackPage)
```

---

## Appendix D — Deployment

Must run on `ubiquitous.udem.edu`. Vanilla HTML/CSS/JS. No build step. No bundler. Relative paths only. ES modules (`type="module"` in script tags).

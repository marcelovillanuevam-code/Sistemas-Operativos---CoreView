# Claude Code Prompts — Sequential Build Plan (v3.1)
# Aligned with ARCHITECTURE.md v3.1 (Threads Integrated)
# Run these ONE AT A TIME. Commit to git after each. Do not proceed until verification passes.

---

## PROMPT 0 — Project Scaffolding

```
Read ARCHITECTURE.md in this directory. Based on the file/folder structure in Step 3, scaffold the project:

1. Create all directories: engine/, render/, screens/, tests/, assets/
2. Create empty files with only a header comment describing the file's responsibility (copy from ARCHITECTURE.md Step 3)
3. Create index.html with the basic shell:
   - 7-tab navigation: Input, Scheduling, Memory, Page Replacement, Threads, Metrics, Comparison
   - Each tab shows/hides a placeholder div with the screen name
   - Use type="module" on script tags (ES modules — see Appendix D)
   - No styling beyond basic visibility toggling
4. Create types.js that defines ALL core data structures as JSDoc-typed factory functions:
   - Thread, Process, SchedulableEntity
   - SchedulingConfig, SchedulingTrace, TimelineEntry
   - ProcessMetrics, ThreadMetrics, AggregateMetrics
   - MemoryConfig, MemoryState, FrameEntry
   - PageReplacementTrace, PageRef, PageReplacementStep
   - ThreadTrace, ThreadTimelineEntry, ThreadEvent, SharedResources
   - ComparisonResult
   - Copy field names, types, and comments EXACTLY from ARCHITECTURE.md §1.1–§1.9
   - Include all type enums: ThreadState, ProcessState, SchedulingAlgorithm, PageReplacementAlgorithm

Do not write any algorithm logic. Do not add CSS beyond basic layout. This is skeleton only.
```

### ✅ Verify before continuing:
- Open index.html in browser. Click each of the 7 tabs — does it show the right placeholder?
- Open types.js — do the data structures match ARCHITECTURE.md exactly? Count: 20 interfaces/types.
- Confirm the file tree matches ARCHITECTURE.md Step 3 exactly.

---

## PROMPT 1 — expandToThreads + FCFS (Reference Implementation)

```
Read ARCHITECTURE.md — specifically §1.1 Thread, §1.2 Process, §1.3 SchedulableEntity, §6.2 expandToThreads, and Appendix A.2 FCFS.

Implement TWO things in order:

PART A — expandToThreads() in engine/thread-utils.js:
- Takes Process[] → returns SchedulableEntity[]
- For each process, iterate its threads array
- For single-threaded processes (threads.length === 1): label = 'P{pid}'
- For multi-threaded processes: label = 'P{pid}-T{n}' where n is the thread's local index (1-based within parent), NOT the global tid
- Each SchedulableEntity gets: pid, tid (globally unique), label, arrivalTime, burstTime, priority, remainingTime (= burstTime)
- Sort result by arrivalTime, then pid, then tid
- Backward compatibility: if a process has no threads array, auto-generate one thread with stackPages=1 and the next sequential global tid

PART B — runFCFS() in engine/scheduling-fcfs.js:
- Pure function: takes Process[] → returns SchedulingTrace
- First line: call expandToThreads(processes) to get SchedulableEntity[]
- Operate entirely on entities (threads), not processes
- FCFS: dispatch entities in arrival order, ties broken by pid then tid
- The trace timeline must capture every discrete time unit: runningPid, runningTid, readyQueue (after dispatch), contextSwitch, arrivedThisTick, completedThisTick, processStates
- Compute ThreadMetrics: per-thread CT, TAT, WT, RT
- Compute ProcessMetrics using join-barrier formulas from §1.5:
  CT = max(thread CTs), TAT = CT - process.arrivalTime, WT = TAT - sum(thread bursts), RT = min(thread firstRuns) - process.arrivalTime
- Compute AggregateMetrics: thread-level averages, CPU utilization, context switches, throughput
- Zero DOM access. Must run in Node.js.

Write tests in tests/test-scheduling.js using the Appendix A.1 shared input:
  P1: Arrival=0, Burst=5, Priority=2, SharedPages=4
  P2: Arrival=1, Burst=3, Priority=1, SharedPages=3
  P3: Arrival=2, Burst=7, Priority=3, SharedPages=5

These are single-threaded, so each auto-generates 1 thread (stackPages=1).

Expected FCFS results (from Appendix A.2):
  P1: CT=5,  TAT=5,  WT=0, RT=0
  P2: CT=8,  TAT=7,  WT=4, RT=4
  P3: CT=15, TAT=13, WT=6, RT=6
  Avg TAT=8.33, Avg WT=3.33, CPU Util=100%

Since these are single-threaded, ThreadMetrics and ProcessMetrics should produce identical values per process.

Print the trace timeline and metrics to console. Assert expected values.

FCFS is the simplest algorithm — it sets the pattern for all others. The expandToThreads + SchedulableEntity pipeline established here is used by every subsequent algorithm. Get it right.
```

### ✅ Verify before continuing:
- `node tests/test-scheduling.js` passes with exact expected values
- Inspect the timeline: does each tick have correct runningPid, runningTid, readyQueue?
- Confirm processStates tracks all 3 processes through NEW→READY→RUNNING→TERMINATED
- Verify expandToThreads produces labels 'P1', 'P2', 'P3' (single-threaded format)

---

## PROMPT 2 — SJF and HRRN (Non-Preemptive)

```
Read the FCFS implementation and ARCHITECTURE.md Appendix A.3, A.4.

Implement SJF and HRRN using the identical SchedulingTrace contract. Both must call expandToThreads() as their first step.

SJF (Shortest Job First — Non-Preemptive):
- When CPU is free, pick the entity with shortest burstTime from the ready queue
- Ties broken by arrivalTime, then pid, then tid

HRRN (Highest Response Ratio Next):
- Response Ratio = (waitingTime + burstTime) / burstTime
- When CPU is free, pick the entity with highest response ratio
- Recalculate ratios at every scheduling decision point

Test with Appendix A.1 shared input. For this specific input, both produce the same Gantt as FCFS (see A.3, A.4).

Add a SECOND test case that differentiates SJF from FCFS:
  P1: Arrival=0, Burst=7, Priority=2, SharedPages=3
  P2: Arrival=1, Burst=3, Priority=2, SharedPages=2
  P3: Arrival=2, Burst=2, Priority=2, SharedPages=2

For this input under SJF: P1 runs 0-7, then P3 (burst=2) runs 7-9, then P2 runs 9-12.
Under FCFS: P1 runs 0-7, then P2 runs 7-10, then P3 runs 10-12.
Verify the difference.

Assert both ThreadMetrics and ProcessMetrics (should be identical since single-threaded).
```

### ✅ Verify before continuing:
- Both tests pass in Node
- SJF and FCFS produce DIFFERENT results on the second test case
- HRRN response ratio calculation is correct — hand-check at least one decision point

---

## PROMPT 3 — Round Robin and SRTF (Preemptive)

```
Read ARCHITECTURE.md Appendix A.5 (RR) and A.6 (SRTF), plus the Trace Notation Convention at the top (quantum expiry processing order is critical).

Both must call expandToThreads() first.

Round Robin:
- Quantum is a parameter (default 2)
- Quantum expiry order: (1) arrivals at this tick enter ready queue, (2) preempted entity goes to BACK of ready queue, (3) dispatch from front
- The trace must show preemption as a context switch at every quantum boundary
- Track remainingTime on each entity

SRTF (Shortest Remaining Time First):
- Preemptive version of SJF
- At every time unit, if a newly arrived entity has shorter remainingTime than the running entity, preempt
- Ties broken by arrivalTime, then pid, then tid

Test Round Robin with Appendix A.1 input, quantum=2 (expected from A.5):
  Gantt: P1(0-2) | P2(2-4) | P3(4-6) | P1(6-8) | P2(8-9) | P3(9-11) | P1(11-12) | P3(12-15)
  P1: CT=12, TAT=12, WT=7,  RT=0
  P2: CT=9,  TAT=8,  WT=5,  RT=1
  P3: CT=15, TAT=13, WT=6,  RT=2

Also test RR with quantum=1 and quantum=4 on the same input to verify different quantum values work.

Test SRTF with Appendix A.1 input (expected from A.6):
  Gantt: P1(0-1) | P2(1-4) | P1(4-8) | P3(8-15)
  P1: CT=8,  TAT=8,  WT=3, RT=0
  P2: CT=4,  TAT=3,  WT=0, RT=0
  P3: CT=15, TAT=13, WT=6, RT=6

Assert all values.
```

### ✅ Verify before continuing:
- RR with q=2 matches A.5 exactly
- RR with q=1 and q=4 produce different (but valid) results
- SRTF preemption points match hand calculation (P2 preempts P1 at t=1)
- Context switch count in each trace is correct

---

## PROMPT 4 — Priority Preemptive

```
Read ARCHITECTURE.md Appendix A.7.

Implement Priority Scheduling (Preemptive). Must call expandToThreads() first.

- Lower number = higher priority (1 is highest)
- If a new entity arrives with higher priority than running entity, preempt immediately
- Ties broken by arrivalTime, then pid, then tid

Test with Appendix A.1 input (expected from A.7 — same as SRTF for this input):
  P2 (pri=1) preempts P1 (pri=2) at t=1. P3 (pri=3) waits until both finish.
  P1: CT=8,  TAT=8,  WT=3, RT=0
  P2: CT=4,  TAT=3,  WT=0, RT=0
  P3: CT=15, TAT=13, WT=6, RT=6

Add a second test case where priority differs from SRTF:
  P1: Arrival=0, Burst=3, Priority=3, SharedPages=2
  P2: Arrival=1, Burst=5, Priority=1, SharedPages=2
  P3: Arrival=3, Burst=2, Priority=2, SharedPages=2

Under Priority: P1(0-1), P2 preempts (1-6), P3(6-8), P1 resumes(8-10).
Under SRTF: P1(0-3), P3(3-5), P2(5-10) — different because SRTF uses burst, not priority.
Verify they differ.
```

### ✅ Verify before continuing:
- Preemption happens at correct times
- After higher-priority entities finish, lower-priority entities resume correctly
- Second test case confirms Priority != SRTF

---

## PROMPT 5 — Multilevel Queue

```
Read ARCHITECTURE.md Appendix A.8.

Implement Multilevel Queue scheduling. Must call expandToThreads() first.

Configuration (from A.8):
- Q1 (highest priority): RR with quantum=2, accepts priority 1
- Q2: RR with quantum=4, accepts priority 2
- Q3 (lowest priority): FCFS, accepts priority 3

Rules:
- Each entity is assigned to a queue based on its priority (permanent — no movement)
- Higher-priority queues always preempt lower-priority queues
- Within each queue, the queue's own algorithm applies

The trace must include queueLevels at every tick showing which entities are in which queue.

Test with A.8 input (different from A.1):
  P1: Arrival=0, Burst=4, Priority=3, SharedPages=3  → Q3
  P2: Arrival=1, Burst=3, Priority=1, SharedPages=2  → Q1
  P3: Arrival=2, Burst=5, Priority=2, SharedPages=3  → Q2
  P4: Arrival=3, Burst=2, Priority=1, SharedPages=2  → Q1

Expected (from A.8):
  Gantt: P1(0-1) | P2(1-3) | P4(3-5) | P2(5-6) | P3(6-11) | P1(11-14)
  P1: CT=14, TAT=14, WT=10, RT=0
  P2: CT=6,  TAT=5,  WT=2,  RT=0
  P3: CT=11, TAT=9,  WT=4,  RT=4
  P4: CT=5,  TAT=2,  WT=0,  RT=0

Assert all values. Verify queueLevels in the trace show correct queue assignments.
```

### ✅ Verify before continuing:
- Queue assignments match priorities (P2,P4→Q1, P3→Q2, P1→Q3)
- Higher-priority queue preempts lower (P2 preempts P1 at t=1)
- Within Q1, RR q=2 applies (P2 quantum expires at t=3, P4 runs)
- Arrivals before preempted on quantum expiry (P4 arrives at t=3, enters before P2)

---

## PROMPT 6 — Multilevel Feedback Queue

```
Read ARCHITECTURE.md Appendix A.9. This is the hardest scheduling algorithm. Take your time.

Must call expandToThreads() first.

Configuration (from A.9):
- Q0 (highest): RR, quantum=2
- Q1 (middle): RR, quantum=4
- Q2 (lowest): FCFS

Rules:
- ALL new entities enter Q0
- If an entity uses its full quantum without finishing, demote to next lower queue
- If an entity is preempted by a higher-priority queue arrival (not quantum expiry), stay in current queue
- Higher-priority queues always preempt lower-priority queues
- Aging: entity waiting 15+ ticks in Q2 gets promoted back to Q0

The trace MUST capture:
- queueLevels at every tick
- promotions[] and demotions[] arrays with { tid, from, to } for every queue change
- These are critical for visualization later

Test with A.9 input:
  P1: Arrival=0,  Burst=10, Priority=2, SharedPages=3
  P2: Arrival=1,  Burst=3,  Priority=2, SharedPages=2
  P3: Arrival=15, Burst=5,  Priority=2, SharedPages=3

Expected trace (from A.9):
  t=0-1:  P1 runs in Q0 (2 ticks)
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

  P1: CT=13, TAT=13, WT=3, RT=0   (went through Q0→Q1→Q2)
  P2: CT=9,  TAT=8,  WT=5, RT=1   (went through Q0→Q1)
  P3: CT=20, TAT=5,  WT=0, RT=0   (went through Q0→Q1)

Include the full hand-traced timeline as comments in the test, then assert against it.
```

### ✅ Verify before continuing:
- This is the algorithm most likely to have bugs. Trace through the output step by step manually.
- Verify demotion events appear in the trace at correct ticks
- Test with a case where aging/promotion triggers (entity waits 15+ ticks in Q2)
- Test with a case where all entities finish in Q0 (short bursts, no demotions)
- Test with a case where an entity goes through all 3 queues

---

## PROMPT 7 — Page Replacement Algorithms (All 5)

```
Read ARCHITECTURE.md §1.7 PageReplacementTrace and Appendix B (all sections).

Implement ALL FIVE page replacement algorithms as pure functions in their respective files:
- engine/paging-fifo.js
- engine/paging-lru.js
- engine/paging-optimal.js
- engine/paging-clock.js
- engine/paging-second-chance.js

Each function signature: (frames: number, refs: PageRef[]) → PageReplacementTrace

PageRef is { pid: number, pageNumber: number } — NOT a raw number. For testing, use pid=1 for all refs in the standard test case (single-process scenario).

The trace must capture for EVERY step:
- requested: which PageRef was requested
- isHit: boolean
- evicted: PageRef | null (null if empty frame available or hit)
- frameState: complete FrameEntry[] after this step
- faultsSoFar: running count
- For Clock/Second Chance: clockPointer position and referenceBits array

Standard test case from Appendix B — reference string (all pid=1):
  [1,2,3,4,1,2,5,1,2,3,4,5] — 3 frames

Expected total faults:
  FIFO:    9  (hit rate 0.25)   — Appendix B.1
  LRU:     10 (hit rate 0.167)  — Appendix B.2
  Optimal: 7  (hit rate 0.417)  — Appendix B.3
  Clock:   9  (hit rate 0.25)   — Appendix B.4

For Second Chance: implement as a variant of FIFO with reference bits. Expected faults should be <= FIFO. Test and record the actual count.

For Clock specifically, verify the full step-by-step trace matches Appendix B.4 exactly — every pointer position, every reference bit state.

Write tests in tests/test-paging.js. Assert total fault counts. Print full step-by-step traces for manual verification.
```

### ✅ Verify before continuing:
- `node tests/test-paging.js` passes all fault count assertions
- Clock step-by-step trace matches B.4 exactly (all 12 steps, pointer positions, ref bits)
- Run a second shorter test case and manually verify EVERY step of LRU and Optimal
- Verify that PageRef objects (not raw numbers) flow through the entire pipeline

---

## PROMPT 8 — Multi-Threaded Test Cases (Thread Expansion Validation)

```
Read ARCHITECTURE.md Appendix C (all sections) and §6.2-§6.4.

This is the riskiest prompt. You are validating that expandToThreads() works with multi-threaded processes AND that existing single-threaded tests still pass unchanged.

PART A — Verify backward compatibility:
Run ALL Appendix A test cases (A.2 through A.9) again. They must produce IDENTICAL results to Prompts 1-6. Single-threaded processes auto-generate 1 thread with stackPages=1. The expandToThreads pipeline must be transparent — no metric should change.

If any test fails, FIX expandToThreads or the algorithm, do not adjust the test. The single-threaded contract is sacred.

PART B — Multi-threaded FCFS:
Create the Appendix C.1 multi-threaded input:
  P1: arr=0, pri=2, sharedPg=3, threads=[{tid=1,arr=0,burst=5,stack=1}, {tid=2,arr=0,burst=3,stack=1}]
  P2: arr=1, pri=1, sharedPg=3, threads=[{tid=3,arr=1,burst=4,stack=1}]
  P3: arr=3, pri=3, sharedPg=4, threads=[{tid=4,arr=3,burst=2,stack=1}, {tid=5,arr=4,burst=3,stack=2}, {tid=6,arr=5,burst=2,stack=1}]

Verify page counts: P1=5, P2=4, P3=8

Run FCFS. Expected from C.2:
  Gantt: P1-T1(0-5) | P1-T2(5-8) | P2(8-12) | P3-T1(12-14) | P3-T2(14-17) | P3-T3(17-19)

  Thread metrics:
    tid=1 P1-T1: CT=5,  TAT=5,  WT=0
    tid=2 P1-T2: CT=8,  TAT=8,  WT=5
    tid=3 P2:    CT=12, TAT=11, WT=7
    tid=4 P3-T1: CT=14, TAT=11, WT=9
    tid=5 P3-T2: CT=17, TAT=13, WT=10
    tid=6 P3-T3: CT=19, TAT=14, WT=12

  Process metrics (join-barrier):
    P1: CT=8,  TAT=8
    P2: CT=12, TAT=11
    P3: CT=19, TAT=16

Verify labels: P1-T1, P1-T2, P2 (single-threaded→no suffix), P3-T1, P3-T2, P3-T3.

PART C — Multi-threaded RR(q=2):
Same C.1 input. Run Round Robin with quantum=2. Expected from C.3:
  Full trace walkthrough:
    t=0:  P1-T1 runs. Ready: [P1-T2]
    t=2:  P1-T1 quantum expires. P1-T2 runs. Ready: [P2, P1-T1]
    t=4:  P1-T2 quantum expires. P3-T2 arrives. P2 runs. Ready: [P1-T1, P3-T1, P3-T2, P1-T2]
    ... (full trace in Appendix C.3)
    t=19: P3-T2 done.

  Thread metrics:
    tid=1: CT=18, tid=2: CT=13, tid=3: CT=17, tid=4: CT=10, tid=5: CT=19, tid=6: CT=15

  Process join-barrier:
    P1: CT=18, P2: CT=17, P3: CT=19

Assert all values.
```

### ✅ Verify before continuing:
- ALL Appendix A tests still pass unchanged (backward compatibility)
- Multi-threaded FCFS matches C.2 exactly — both thread and process metrics
- Multi-threaded RR matches C.3 exactly — ready queue ordering matters
- Labels are correct: single-threaded='P{pid}', multi-threaded='P{pid}-T{n}'
- numPages computation is correct: P1=5, P2=4, P3=8

---

## PROMPT 9 — engine-utils.js + generateThreadTrace

```
Read ARCHITECTURE.md §2.2 (engine-utils, comparison), §6.4 (generateThreadTrace), §1.8 (ThreadTrace), and Appendix C.4.

PART A — engine-utils.js shared helpers:
- validateTrace(trace: SchedulingTrace): boolean — asserts structural correctness:
  - timeline has entries for every tick from 0 to max completion
  - every tick has processStates for all processes
  - threadMetrics and processMetrics have correct counts
  - aggregateMetrics values are consistent
- buildTimelineEntry(...): TimelineEntry — shared factory used by all algorithms for consistent structure (if not already extracted in prior prompts, extract it now)

PART B — generateThreadTrace() in engine/thread-utils.js:
- Takes (processes: Process[], targetPid: number, config: SchedulingConfig) → ThreadTrace
- Runs the FULL scheduling simulation on ALL processes (threads compete globally)
- Filters the timeline to only the target process's threads
- Produces ThreadTimelineEntry[] with per-thread states at each tick
- Produces ThreadEvent[] (CREATED, DISPATCHED, PREEMPTED, COMPLETED, JOINED)
- Produces SharedResources with real page number assignments:
  - sharedPageNumbers: [0, 1, ..., sharedPages-1]
  - threadStacks: each thread gets consecutive page numbers after the shared range

Test with Appendix C.4 — P3 under FCFS:
  Events: t=3: T1 CREATED. t=4: T2 CREATED. t=5: T3 CREATED.
  t=12: T1 DISPATCHED. t=14: T1 COMPLETED. t=14: T2 DISPATCHED. t=17: T2 COMPLETED.
  t=17: T3 DISPATCHED. t=19: T3 COMPLETED. t=19: P3 JOINED.

  SharedResources (sharedPages=4, numPages=8):
    Shared pages: [0,1,2,3]
    P3-T1 (tid=4, local=1): stack [4]       (1 stackPage)
    P3-T2 (tid=5, local=2): stack [5,6]     (2 stackPages)
    P3-T3 (tid=6, local=3): stack [7]       (1 stackPage)

PART C — comparison.js:
- compareScheduling(processes, configs): ComparisonResult — runs all specified algorithms, collects traces and aggregate metrics
- comparePageReplacement(numFrames, refs, algorithms): ComparisonResult — runs all specified paging algorithms
- Both return the full ComparisonResult structure from §1.9

Test compareScheduling by running FCFS + SJF + RR(q=2) on Appendix A.1 input and verifying each algorithm's metrics match previous test results.
```

### ✅ Verify before continuing:
- validateTrace passes on all previously-generated traces
- ThreadTrace for P3 under FCFS matches C.4 events exactly
- SharedResources page assignments are correct (shared [0-3], stacks [4], [5,6], [7])
- compareScheduling produces consistent results with individual algorithm runs

---

## PROMPT 10 — Gantt Chart Renderer + Animation Controller

```
Read ARCHITECTURE.md §2.3 (AnimationController API), §5.1 (Gantt chart detail), and the rendering strategy table.

PART A — AnimationController in render/animation.js:
- constructor(totalSteps) — sets up the step counter
- play() — starts auto-advancing via setInterval
- pause() — stops the interval
- stepForward() — always pauses first, then advances one step
- stepBackward() — always pauses first, then goes back one step
- goToStep(n) — jump to specific step
- setSpeed(multiplier) — 1x, 2x, 4x (adjusts interval timing)
- onStepChange(callback) — register callback for step changes
- getCurrentStep(), isPlaying() — getters
- Single setInterval, never multiple. Step operations always pause first to prevent races.

PART B — Gantt chart renderer in render/gantt.js:
- renderGanttChart(ctx, trace, currentStep, canvasWidth, canvasHeight): void
- Horizontal Gantt chart using Canvas 2D
- Each entity gets a distinct color from a predefined palette (not random). At least 8 distinct colors.
- SchedulableEntity.label shown inside each block (P1, P2, P1-T1, P1-T2, etc.)
- Time markers on x-axis
- Context switches shown as thin vertical lines or gaps
- Current time indicator (vertical line or highlight) at currentStep
- Draw the full chart immediately but highlight/reveal blocks progressively during animation (blocks ahead of currentStep are dimmed or hidden)

PART C — Wire to Scheduling screen:
- In screens/screen-scheduling.js, create a minimal wiring:
  - Canvas element for the Gantt chart
  - Play/Pause button, Step Forward/Back buttons, Speed selector (1x/2x/4x)
  - Load a hardcoded FCFS trace from Appendix A.1 for testing
  - AnimationController drives the Gantt chart

Do not build the full scheduling screen yet. Do not touch any other screen. This is Gantt + animation controls only.
```

### ✅ Verify before continuing:
- Open in browser, see the FCFS Gantt chart rendered
- Click Step Forward repeatedly — does it advance one time unit with visible indicator?
- Click Step Back — does it go back?
- Play at 1x, 2x, 4x — does speed change noticeably?
- Labels show correctly in Gantt blocks (P1, P2, P3 for single-threaded)

---

## PROMPT 11 — Process Input Screen

```
Read ARCHITECTURE.md §6.6 (input changes), §2.1 (data layer API), and types.js.

Build the Process Input screen (first tab) and implement the data layer in data.js.

PART A — data.js:
- parseProcessesFromForm(formData): Process[] — reads the form table, auto-generates threads for single-threaded processes (stackPages=1, next sequential tid), computes burstTime and numPages
- parseProcessesFromFile(fileContent: string): Process[] — parses both formats:
  5 columns: PID,Arrival,Burst,Priority,SharedPages → auto-generate 1 thread, numPages = SharedPages + 1
  9 columns: PID,Arrival,Burst,Priority,SharedPages,ThreadID,ThreadArrival,ThreadBurst,StackPages → group rows by PID, build thread arrays
- parseMemoryConfig(formData): MemoryConfig
- validateProcesses(processes): ValidationResult — enforce: sharedPages >= 1, stackPages >= 1, thread arrival >= process arrival, max 8 threads per process, burst > 0, numPages computed correctly
- generateReferenceString(processes, length): PageRef[] — sequential pages per process, interleaved by scheduling order

PART B — Input screen UI (screens/screen-input.js):
- Manual input form:
  - Add Process button creates a row: PID (auto-increment), Arrival Time, Burst Time, Priority, SharedPages
  - Collapsible thread sub-rows per process: ThreadID (auto-increment within process), Thread Arrival, Thread Burst, StackPages
  - When threads are added, process Burst auto-sums from thread bursts
  - Delete button per process and per thread
  - Input validation with inline error messages (not alerts)
- File upload:
  - Accept .txt files in both 5-column and 9-column formats
  - Parse and populate the same table as manual input
  - Clear error messages for malformed files
- Memory configuration section:
  - Memory Size, Page Size inputs
  - Auto-calculate and display number of frames (Memory Size / Page Size)
  - Validation: Memory Size must be divisible by Page Size
- "Run Simulation" button:
  - Validates all inputs
  - Stores Process[] and MemoryConfig in AppState
  - Switches to Scheduling tab
  - Does NOT run any algorithm yet

Do not touch any other screen.
```

### ✅ Verify before continuing:
- Add 3 processes manually. Add 2 threads to one of them. Verify Burst auto-sums.
- Delete a thread — does burst update?
- Upload 5-column sample file — does it parse and populate the table?
- Upload 9-column sample file — does it group threads correctly?
- Upload malformed file — clear error message?
- Try invalid values (negative burst, thread arrival < process arrival, 9 threads) — validation catches each?
- Click Run Simulation — does it switch tabs with data preserved in AppState?

---

## PROMPT 12 — Scheduling Screen (Full Wiring)

```
Read ARCHITECTURE.md §4 (screen state flow), §5 (rendering strategy table).

Wire the scheduling screen to the full engine and rendering pipeline. Replace the hardcoded Gantt test from Prompt 10.

- Algorithm selector: buttons for all 8 algorithms (FCFS, SJF, HRRN, RR, SRTF, Priority, MLQ, MLFQ)
- When an algorithm is selected, run it against AppState.processes and render:
  - Gantt chart (already built) — now with real data from the selected algorithm
  - Ready queue visualization below the Gantt (render/ready-queue.js): horizontal boxes showing entity labels, synced with animation step
  - Currently running entity highlighted
  - Metrics table: DUAL display — Thread Metrics table + Process Metrics (join-barrier) table, plus averages row. Use labels from §1.5.
  - CPU Utilization percentage
- For Round Robin: show quantum input field
- For MLQ/MLFQ: show queue levels visually (stacked queues with entities listed per level)
- Process state diagram (render/state-diagram.js): 5 circles (New, Ready, Running, Waiting, Terminated) with arrows. Highlight current state of each process during animation. For multi-threaded processes, show thread clusters.
- All visualizations sync with the AnimationController — stepping forward/back updates everything together
- Cache the SchedulingTrace in AppState so switching algorithms doesn't re-run unnecessarily (clear cache when input changes)

Do not touch any other screen.
```

### ✅ Verify before continuing:
- Select FCFS, then RR, then SRTF — does the Gantt chart change?
- Change quantum for RR — does the result update?
- Do metrics match the hand-calculated values from Appendix A?
- Does the ready queue animation sync with Gantt chart step-by-step?
- For MLQ/MLFQ — do queue levels display correctly?
- Are both Thread Metrics and Process Metrics tables shown?

---

## PROMPT 13 — Memory & Page Replacement Screens

```
Read ARCHITECTURE.md §1.6 (MemoryConfig/MemoryState), §1.7 (PageReplacementTrace), §5 (rendering table), and Appendix B.

Build the Memory visualization screen (tab 3) and Page Replacement screen (tab 4).

Memory screen (screens/screen-memory.js, render/memory-grid.js):
- Show main memory as a grid of frames (colored blocks, DOM CSS Grid)
- Each frame shows page number and owning process PID
- Empty frames visually distinct (gray/empty)
- Show internal fragmentation for the last page of each process
- Color legend mapping colors to processes
- Uses total numPages per process (no shared/stack distinction — that's the Threads screen)

Page Replacement screen (screens/screen-paging.js):
- Algorithm selector: FIFO, LRU, Optimal, Clock, Second Chance
- Page reference string display: auto-generated from processes via generateReferenceString(), OR let user input a custom reference string
- Step-by-step animation showing:
  - Current page request highlighted
  - Frame state (table or block grid via render/page-table.js)
  - Hit/Fault indicator with running counter
  - For Clock/Second Chance: circular buffer visualization (render/clock-visual.js) with pointer and reference bits. Cap at 32 frames. Arc math auto-scales.
- Own AnimationController: play, pause, step forward/back, speed (1x/2x/4x)

Do not touch any other screen.
```

### ✅ Verify before continuing:
- Memory grid shows correct number of frames based on MemoryConfig
- Run FIFO with Appendix B reference string — 9 faults?
- Run LRU — 10 faults?
- Run Optimal — 7 faults?
- Step through Clock — does pointer move correctly? Do ref bits match B.4?
- Does the animation controller work independently from the scheduling screen's controller?

---

## PROMPT 14 — Threads Screen

```
Read ARCHITECTURE.md §6.5 (Threads Screen panels), §1.8 (ThreadTrace), and Appendix C.4.

Build the Threads screen (tab 5). This screen has 5 panels.

screens/screen-threads.js orchestrates. render/thread-visuals.js provides rendering functions.

Panel 1 — Process Selector:
- Dropdown listing all processes. Multi-threaded processes show '(N threads)' suffix.
- Single-threaded processes are selectable too (degenerate case: 1 thread row, 1 stack).
- On selection, call generateThreadTrace(processes, selectedPid, currentSchedulingConfig) and render all panels.

Panel 2 — Thread Gantt (Canvas 2D, renderThreadGantt):
- One row per thread of the selected process.
- Idle gaps shown as lighter shade.
- Time axis shared with scheduling Gantt.
- Thread labels: P{pid}-T{n} (local index).

Panel 3 — Memory Sharing View (DOM Grid, renderMemorySharing):
- Top: shared segments (code/data/heap) with sharedPageNumbers displayed.
- Below: one stack block per thread with stackPageNumbers. 
- Stacks appear as threads are CREATED in the animation (not all at once).
- Real page counts from SharedResources.

Panel 4 — Thread State Diagram (Canvas 2D, renderThreadStateDiagram):
- Up to 8 rows (one per thread). System cap guarantees this fits.
- Each row: 5 state nodes (NEW, READY, RUNNING, WAITING, TERMINATED) with current state highlighted.
- Process-level summary bar at bottom showing the join-barrier state.
- No "+N more" indicator needed — system cap = 8 threads.

Panel 5 — Event Log (DOM table, renderThreadEventLog):
- Scrolling table of ThreadEvents: CREATED, DISPATCHED, PREEMPTED, COMPLETED, JOINED.
- Synced with animation step — only shows events up to currentStep.
- Event counters (dispatches, preemptions, completions).

Own AnimationController. Play/pause/step/speed.
```

### ✅ Verify before continuing:
- Select a multi-threaded process — do all 4 visualization panels populate?
- Select a single-threaded process — does it show 1 thread row and 1 stack?
- Does the Thread Gantt show correct idle gaps?
- Does the Memory Sharing View show correct page numbers matching C.4?  
- Do events match the C.4 expected event sequence?
- Does animation step correctly across all panels simultaneously?

---

## PROMPT 15 — Metrics & Comparison Screens

```
Read ARCHITECTURE.md §1.9 (ComparisonResult), §5 (rendering table — metrics and comparison rows).

Build the Metrics dashboard (tab 6) and Algorithm Comparison screen (tab 7).

Metrics screen (screens/screen-metrics.js, render/metrics-dashboard.js):
- DUAL metrics tables (this is critical — see Risk 7):
  1. Thread Metrics table: per-thread CT, TAT, WT, RT for the current scheduling algorithm
  2. Process Metrics table (join-barrier): per-process CT, TAT, WT, RT using join-barrier formulas
  - Clear section labels: "Thread-Level Metrics" and "Process-Level Metrics (Join-Barrier)"
- Bar charts for TAT, WT, RT across all threads (Canvas 2D)
- CPU Utilization gauge or bar
- Total page faults for the current page replacement algorithm
- Clear labeling — a non-technical user should understand what each metric means

Comparison screen (screens/screen-comparison.js, render/comparison-chart.js):
- Run ALL 8 scheduling algorithms on current process list via compareScheduling()
- Side-by-side grouped bar chart: avg thread TAT, avg thread WT, avg thread RT per algorithm
- Labels say "Avg Thread TAT" not just "Avg TAT" (disambiguation per Risk 7)
- Highlight the best-performing algorithm for each metric
- Run ALL 5 page replacement algorithms on current reference string via comparePageReplacement()
- Side-by-side bar chart: total page faults per algorithm
- Highlight algorithm with fewest faults
- Performance: run algorithms sequentially with setTimeout yield between each. Show loading indicator if > 2 seconds. Cache results.

Do not touch any other screen.
```

### ✅ Verify before continuing:
- Do BOTH Thread Metrics and Process Metrics tables appear with correct labels?
- Do comparison values match individual algorithm results from earlier tests?
- Are "best" algorithms highlighted correctly for each metric?
- Does the comparison page handle edge cases (all algorithms same result)?
- Does the loading indicator appear for large inputs?

---

## PROMPT 16 — Styling and Polish

```
Read the entire project. Now apply consistent styling.

Design direction:
- Dark theme with high-contrast process colors
- Clean, modern UI — developer tool aesthetic, not corporate dashboard
- Monospace font for numbers, metrics, PIDs, and thread labels
- Smooth transitions between tabs
- Animation easing on Gantt chart and memory visualizations
- Responsive enough to not break on common screen sizes (1366px+)

Specific polish items:
- Gantt chart blocks: subtle rounded corners, slight shadows
- Ready queue: animate entities entering/leaving (slide in/out with CSS transitions)
- Page fault events: flash red briefly on fault
- Algorithm selector buttons: clear active state (highlighted border or background)
- Metrics tables: alternating row colors, clear distinction between Thread and Process tables
- Comparison charts: legend with algorithm names and colors
- Thread State Diagram: smooth state transition animations
- Memory Sharing View: visual distinction between shared (one color family) and stack (another)
- Tab bar: clear active tab indicator
- All Canvas renderers: use a consistent color palette defined in one place (top of style.css or a colors constant)

Do not change any logic or data structures. Style only.
```

### ✅ Verify before continuing:
- Does the app look cohesive across all 7 screens?
- Do animations feel smooth, not janky?
- Is text readable on all screens (contrast check)?
- Does the dark theme work with the process color palette?
- Does it look presentable for a contest submission?
- No screen breaks at 1366px width?

---

## PROMPT 17 — Final Integration Test

```
Run this complete integration test.

PART A — Single-threaded integration:
Load this as a 5-column file (test_single.txt):
PID,Arrival,Burst,Priority,SharedPages
1,0,8,2,4
2,1,4,1,3
3,3,9,3,5
4,5,5,2,2
5,6,2,1,4

Memory config: Size=64, PageSize=4

Go through EVERY scheduling algorithm. Verify: no crashes, metrics display correctly (both tables), Gantt chart renders, animation controls work.

Go through EVERY page replacement algorithm. Verify: no crashes, fault counts reasonable, step-through works, Clock pointer moves correctly.

Go to Metrics screen — both tables populated. Go to Comparison screen — all algorithms appear.

PART B — Multi-threaded integration:
Load this as a 9-column file (test_multi.txt):
PID,Arrival,Burst,Priority,SharedPages,ThreadID,ThreadArrival,ThreadBurst,StackPages
1,0,8,2,3,1,0,5,1
1,0,8,2,3,2,0,3,1
2,1,4,1,3,3,1,4,1
3,3,7,3,4,4,3,2,1
3,3,7,3,4,5,4,3,2
3,3,7,3,4,6,5,2,1

Verify: processes parsed correctly (P1=5 pages, P2=4 pages, P3=8 pages).

Go through at least FCFS, RR(q=2), Priority, MLFQ. Verify: Gantt shows thread labels (P1-T1, P1-T2, P2, P3-T1, etc.), metrics show dual tables.

Go to Threads screen. Select P3. Verify: 3 thread rows in Gantt, memory sharing shows shared[0-3] + stacks[4],[5,6],[7], event log shows CREATED/DISPATCHED/COMPLETED/JOINED events.

PART C — Edge cases:
- Single process with 1 thread (minimum viable input)
- Single process with 8 threads (maximum system cap)
- All processes arrive at t=0
- All processes have same burst time
- All processes have same priority (for priority-based algorithms)
- Empty ready queue periods (idle CPU)
- RR with quantum=1 (maximum context switches)

Fix any bugs found. Do not add new features.
```

### ✅ Final verification:
- Zero crashes across all algorithm × input combinations
- Thread labels correct everywhere
- Dual metrics tables always present
- Animation controls work on every screen that has them
- Comparison screen shows all algorithms
- File upload works for both formats
- Edge cases handled gracefully

---

# NOTES

- If Claude Code generates more than 300 lines in a single response, something is probably wrong. Good incremental steps produce focused, testable chunks.
- After every prompt, COMMIT to git: `git commit -m "Prompt XX: description"`
- If a prompt's output doesn't pass verification, do NOT move to the next prompt. Fix it first.
- Prompt 8 is the riskiest — it validates that thread expansion doesn't break anything. If it fails, everything after it is built on a broken foundation.
- The dual metrics tables (Thread + Process join-barrier) must appear everywhere metrics are shown. This is not optional.
- All algorithm engines use expandToThreads() as their first step, even for single-threaded input. No exceptions.
- The test cases in the prompts match ARCHITECTURE.md appendices exactly. Do not substitute different values.

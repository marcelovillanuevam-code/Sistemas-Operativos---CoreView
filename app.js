// app.js — Application entry point. Initialises AppState, tab navigation, and screen modules.

// app.js — Application entry point. AppState is the single mutable state object.
// Tab navigation is handled inline in index.html (plain script, works over file://).
// Screen modules will be imported here as they are implemented.

export const AppState = {
  processes: [],                // Process[] with threads
  memoryConfig: null,           // MemoryConfig
  currentAlgorithm: null,       // SchedulingAlgorithm
  schedulingTrace: null,        // SchedulingTrace (cached)
  pageReplacementTrace: null,   // PageReplacementTrace (cached)
  referenceString: [],          // PageRef[]
  threadTraces: new Map(),      // Map<pid, ThreadTrace>
  selectedThreadPid: null,      // number | null
  comparisonResult: null,       // ComparisonResult (cached)
};

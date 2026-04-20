// app.js — Application entry point. AppState is the single mutable state object.
// Tab navigation is handled inline in index.html (plain script, works over file://).

import { initInputScreen }     from './screens/screen-input.js';
import { initSchedulingScreen } from './screens/screen-scheduling.js';
import { initMemoryScreen }    from './screens/screen-memory.js';
import { initPagingScreen }    from './screens/screen-paging.js';

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

initInputScreen();
initSchedulingScreen();
initMemoryScreen();
initPagingScreen();

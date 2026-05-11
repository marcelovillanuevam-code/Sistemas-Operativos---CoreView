// app.js — Application entry point. AppState is the single mutable state object.
// Tab navigation is handled inline in index.html (plain script, works over file://).

import { initInputScreen }      from './screens/screen-input.js';
import { initSchedulingScreen }  from './screens/screen-scheduling.js';
import { initMemoryScreen }      from './screens/screen-memory.js';
import { initPagingScreen }      from './screens/screen-paging.js';
import { initThreadsScreen }     from './screens/screen-threads.js';
import { initThreadsMulticoreScreen } from './screens/threads-multicore.js';
import { initMetricsScreen }     from './screens/screen-metrics.js';
import { initComparisonScreen }  from './screens/screen-comparison.js';
import { setAppStatus }          from './render/ui-feedback.js';

export const AppState = {
  processes: [],
  memoryConfig: null,
  currentAlgorithm: null,
  schedulingTrace: null,
  pageReplacementTrace: null,
  referenceString: [],
  threadTraces: new Map(),
  selectedThreadPid: null,
  comparisonResult: null,
};

initInputScreen();
initSchedulingScreen();
initMemoryScreen();
initPagingScreen();
initThreadsScreen();
initThreadsMulticoreScreen();
initMetricsScreen();
initComparisonScreen();

// Initial header status
setAppStatus('Sin datos cargados', 'idle');

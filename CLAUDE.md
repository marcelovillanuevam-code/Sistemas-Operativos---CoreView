# CoreView — OS Scheduling & Memory Paging Simulator

## Architecture
- Read ARCHITECTURE.md for all data structures, APIs, and test cases
- Three layers: Data (data.js) → Engine (engine/) → Render (render/)
- Engine layer is pure functions, zero DOM, testable in Node
- Rendering layer consumes traces, never computes logic
- All scheduling algorithms call expandToThreads() as first step

## Tech Stack
- Vanilla HTML + CSS + JavaScript (NO frameworks)
- ES modules (type="module" in script tags)
- Canvas 2D for Gantt charts, state diagrams, clock visual, comparison charts
- DOM for ready queue, memory grid, page table, metrics tables

## Code Style
- JSDoc type annotations on all public functions
- One algorithm per file in engine/
- Factory functions for data structures (not classes)
- No global mutable state — AppState is the single state object

## Testing
- Run tests with: node tests/test-scheduling.js
- Run paging tests with: node tests/test-paging.js
- Run thread tests with: node tests/test-threads.js
- All engine code must be testable in Node with zero browser APIs
- Test expected values come from ARCHITECTURE.md appendices — do not change them

## Key Contracts
- SchedulingTrace has BOTH threadMetrics[] AND processMetrics[] (join-barrier)
- AggregateMetrics uses thread-level averages
- Single-threaded processes auto-generate 1 thread with stackPages=1
- Process.numPages = sharedPages + sum(thread.stackPages) — always computed
- PageRef is {pid, pageNumber}, not a raw number
- Labels: single-threaded='P{pid}', multi-threaded='P{pid}-T{n}' where n=local index

## Dev Server (REQUIRED for UI testing)
- ES modules are blocked by browsers over file:// — always serve via HTTP
- Start server: `python -m http.server 8765` from project root
- URL: http://localhost:8765/
- After every prompt that touches HTML/CSS/JS UI files, ensure the server is running and tell the user to refresh http://localhost:8765/
- Check if already running: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8765/index.html` — start it if not 200

## Deployment
- Must run on ubiquitous.udem.edu
- No build step, no bundler
- Relative paths only
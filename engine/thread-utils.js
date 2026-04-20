// thread-utils.js — Thread expansion and thread trace generation utilities. Zero DOM, zero side effects.

/**
 * @param {import('../types.js').Process[]} processes
 * @returns {import('../types.js').SchedulableEntity[]}
 */
export function expandToThreads(processes) {
  let maxTid = 0;
  for (const p of processes) {
    if (p.threads && p.threads.length > 0) {
      for (const t of p.threads) {
        if (t.tid > maxTid) maxTid = t.tid;
      }
    }
  }
  let nextTid = maxTid + 1;

  const entities = [];

  for (const p of processes) {
    let threads = p.threads;
    if (!threads || threads.length === 0) {
      threads = [{
        tid: nextTid++,
        parentPid: p.pid,
        arrivalTime: p.arrivalTime,
        burstTime: p.burstTime,
        priority: p.priority,
        state: 'NEW',
        remainingTime: p.burstTime,
        stackPages: 1,
      }];
    }

    const isMultiThreaded = threads.length > 1;

    for (let i = 0; i < threads.length; i++) {
      const t = threads[i];
      const label = isMultiThreaded ? `P${p.pid}-T${i + 1}` : `P${p.pid}`;
      entities.push({
        pid: p.pid,
        tid: t.tid,
        label,
        arrivalTime: t.arrivalTime,
        burstTime: t.burstTime,
        priority: t.priority,
        remainingTime: t.burstTime,
      });
    }
  }

  entities.sort((a, b) => {
    if (a.arrivalTime !== b.arrivalTime) return a.arrivalTime - b.arrivalTime;
    if (a.pid !== b.pid) return a.pid - b.pid;
    return a.tid - b.tid;
  });

  return entities;
}

/**
 * Runs a lightweight internal FCFS on all processes, then filters to targetPid.
 * Does NOT import scheduling-fcfs.js (circular dependency guard).
 *
 * @param {import('../types.js').Process[]} processes
 * @param {number} targetPid
 * @param {import('../types.js').SchedulingConfig} config
 * @returns {import('../types.js').ThreadTrace}
 */
export function generateThreadTrace(processes, targetPid, config) {
  const entities = expandToThreads(processes);
  const work = new Map(entities.map(e => [e.tid, { ...e }]));

  const firstRunTime = new Map();
  const completionTime = new Map();
  const completed = new Set();
  const readyQueue = [];
  let running = null;
  const timeline = [];
  let time = 0;
  const maxTime = entities.reduce((s, e) => s + e.burstTime, 0) + 1;

  while (time <= maxTime) {
    const completedThisTick = [];
    if (running !== null && work.get(running).remainingTime === 0) {
      completedThisTick.push(running);
      completionTime.set(running, time);
      completed.add(running);
      running = null;
    }

    const arrivedThisTick = [];
    for (const e of entities) {
      if (e.arrivalTime === time && !completed.has(e.tid) && running !== e.tid && !readyQueue.includes(e.tid)) {
        arrivedThisTick.push(e.tid);
        readyQueue.push(e.tid);
      }
    }

    if (running === null && readyQueue.length > 0) {
      const next = readyQueue.shift();
      if (!firstRunTime.has(next)) firstRunTime.set(next, time);
      running = next;
    }

    timeline.push({ time, runningTid: running, arrivedThisTick, completedThisTick });

    if (completed.size === entities.length && running === null) break;

    if (running !== null) work.get(running).remainingTime--;
    time++;
  }

  // ── Target process data ──────────────────────────────────────────────────────
  const targetProcess = processes.find(p => p.pid === targetPid);
  let targetThreads = targetProcess.threads;
  if (!targetThreads || targetThreads.length === 0) {
    const entity = entities.find(e => e.pid === targetPid);
    targetThreads = [{
      tid: entity.tid,
      parentPid: targetPid,
      arrivalTime: entity.arrivalTime,
      burstTime: entity.burstTime,
      priority: entity.priority,
      state: 'NEW',
      remainingTime: entity.burstTime,
      stackPages: 1,
    }];
  }

  const targetTids = new Set(targetThreads.map(t => t.tid));

  // ── Thread metrics for targetPid ─────────────────────────────────────────────
  const threadMetrics = targetThreads.map(t => {
    const ct = completionTime.get(t.tid) ?? 0;
    const frt = firstRunTime.get(t.tid) ?? ct;
    const tat = ct - t.arrivalTime;
    const wt = tat - t.burstTime;
    const rt = frt - t.arrivalTime;
    return { tid: t.tid, pid: targetPid, completionTime: ct, turnaroundTime: tat, waitingTime: wt, responseTime: rt };
  });

  const completionByTid = new Map(threadMetrics.map(m => [m.tid, m.completionTime]));
  const endTime = Math.max(...threadMetrics.map(m => m.completionTime));
  const joinTime = endTime;

  // ── Build remaining burst tracking ──────────────────────────────────────────
  const remainingByTid = new Map(targetThreads.map(t => [t.tid, t.burstTime]));

  // ── Build ThreadTrace timeline + full event log ───────────────────────────────
  const threadTimeline = [];
  const allEvents = [];   // all events with time, for the event log
  let prevRunningTid = null;

  for (const entry of timeline) {
    const t = entry.time;
    if (t > endTime) break;

    const runningTid = targetTids.has(entry.runningTid) ? entry.runningTid : null;

    // Update remaining burst
    if (runningTid !== null) {
      const prev = remainingByTid.get(runningTid);
      if (prev > 0) remainingByTid.set(runningTid, prev - 1);
    }

    // Thread states
    const threadStates = targetThreads.map(thread => {
      const ct = completionByTid.get(thread.tid);
      let state;
      if (ct !== undefined && t >= ct) {
        state = 'TERMINATED';
      } else if (runningTid === thread.tid) {
        state = 'RUNNING';
      } else if (t >= thread.arrivalTime) {
        state = 'READY';
      } else {
        state = 'NEW';
      }
      const rem = remainingByTid.get(thread.tid) ?? 0;
      return { tid: thread.tid, state, remainingBurst: state === 'TERMINATED' ? 0 : rem };
    });

    // ── Collect ALL events this tick ─────────────────────────────────────────
    const tickEvents = [];

    // CREATED: target threads arriving this tick
    for (const tid of entry.arrivedThisTick) {
      if (targetTids.has(tid)) {
        const thread = targetThreads.find(th => th.tid === tid);
        const localIdx = targetThreads.indexOf(thread) + 1;
        const label = targetThreads.length > 1 ? `T${localIdx}` : `P${targetPid}`;
        tickEvents.push({ type: 'CREATED', tid, description: `${label} created at t=${t}`, time: t });
      }
    }

    // COMPLETED: target threads completing this tick
    for (const tid of entry.completedThisTick) {
      if (targetTids.has(tid)) {
        const thread = targetThreads.find(th => th.tid === tid);
        const localIdx = targetThreads.indexOf(thread) + 1;
        const label = targetThreads.length > 1 ? `T${localIdx}` : `P${targetPid}`;
        tickEvents.push({ type: 'COMPLETED', tid, description: `${label} completed at t=${t}`, time: t });
      }
    }

    // DISPATCHED: target thread newly dispatched (wasn't running before or was different)
    const prevWasTarget = prevRunningTid !== null && targetTids.has(prevRunningTid);
    const completedThisTick = entry.completedThisTick.filter(tid => targetTids.has(tid));
    const prevJustCompleted = completedThisTick.includes(prevRunningTid);
    if (runningTid !== null && (prevRunningTid !== runningTid || prevJustCompleted)) {
      const thread = targetThreads.find(th => th.tid === runningTid);
      const localIdx = targetThreads.indexOf(thread) + 1;
      const label = targetThreads.length > 1 ? `T${localIdx}` : `P${targetPid}`;
      tickEvents.push({ type: 'DISPATCHED', tid: runningTid, description: `${label} dispatched at t=${t}`, time: t });
    }

    // PREEMPTED: target thread was running but isn't now and didn't complete
    if (prevWasTarget && prevRunningTid !== runningTid && !prevJustCompleted) {
      const thread = targetThreads.find(th => th.tid === prevRunningTid);
      const localIdx = targetThreads.indexOf(thread) + 1;
      const label = targetThreads.length > 1 ? `T${localIdx}` : `P${targetPid}`;
      tickEvents.push({ type: 'PREEMPTED', tid: prevRunningTid, description: `${label} preempted at t=${t}`, time: t });
    }

    allEvents.push(...tickEvents);

    // Primary event for timeline entry: CREATED > PREEMPTED > COMPLETED > DISPATCHED
    const primary = tickEvents.find(e => e.type === 'CREATED')
      || tickEvents.find(e => e.type === 'PREEMPTED')
      || tickEvents.find(e => e.type === 'COMPLETED')
      || tickEvents.find(e => e.type === 'DISPATCHED')
      || null;

    // Update prevRunningTid: track whatever thread of this process is now running
    prevRunningTid = runningTid;

    threadTimeline.push({ time: t, threadStates, runningTid, event: primary });
  }

  // JOINED event at joinTime
  const joinedEvent = { type: 'JOINED', tid: -1, description: `P${targetPid} all threads joined at t=${joinTime}`, time: joinTime };
  allEvents.push(joinedEvent);
  const lastEntry = threadTimeline[threadTimeline.length - 1];
  if (lastEntry && !lastEntry.event) {
    lastEntry.event = joinedEvent;
  }

  // ── SharedResources ──────────────────────────────────────────────────────────
  const sharedPageNumbers = Array.from({ length: targetProcess.sharedPages }, (_, i) => i);
  let nextPage = targetProcess.sharedPages;
  const threadStacks = targetThreads.map((t, i) => {
    const stackPageNumbers = Array.from({ length: t.stackPages }, () => nextPage++);
    return { tid: t.tid, localIndex: i + 1, stackPageNumbers };
  });

  return {
    pid: targetPid,
    processArrivalTime: targetProcess.arrivalTime,
    threads: targetThreads,
    timeline: threadTimeline,
    allEvents,    // flat list with {type,tid,description,time} — used by event log renderer
    sharedResources: {
      codeSegment: 'code',
      dataSegment: 'data',
      heapSegment: 'heap',
      sharedPageNumbers,
      threadStacks,
    },
    threadMetrics,
  };
}

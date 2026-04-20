import { parseProcessesFromFile } from '../data.js';
import { runFCFS } from '../engine/scheduling-fcfs.js';
import { generateThreadTrace } from '../engine/thread-utils.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __d = dirname(fileURLToPath(import.meta.url));
const root = dirname(__d);

// Bug #1
const multi = parseProcessesFromFile(readFileSync(join(root,'_testfiles','test_multi.txt'),'utf8'));
console.log('─── Bug #1: P3 events under FCFS ───');
const tt = generateThreadTrace(multi, 3, { algorithm: 'FCFS' });
console.log('Events in timeline:');
for (const e of tt.timeline) if (e.event) console.log(`  t=${e.time}: ${e.event.type} tid=${e.event.tid}`);
console.log('Last tick:', tt.timeline[tt.timeline.length-1]?.time);
console.log('Thread completion times:', tt.threadMetrics.map(m=>`tid=${m.tid}:${m.completionTime}`).join(', '));

console.log('\n─── Bug #2: Idle CPU gap ───');
const c6 = parseProcessesFromFile('1,5,3,1,2\n2,20,4,1,2');
console.log('Processes:', c6.map(p=>({pid:p.pid, arr:p.arrivalTime, burst:p.burstTime})));
const ft = runFCFS(c6);
console.log('Timeline length:', ft.timeline.length);
console.log('First entry time:', ft.timeline[0]?.time, 'running:', ft.timeline[0]?.runningTid);
console.log('Last entry time:', ft.timeline[ft.timeline.length-1]?.time, 'running:', ft.timeline[ft.timeline.length-1]?.runningTid);
console.log('Thread metrics:', ft.threadMetrics);
console.log('Process metrics:', ft.processMetrics);
// Show every timeline entry
console.log('\nTimeline:');
for (const e of ft.timeline) {
  console.log(`  t=${e.time} running=${e.runningTid} arrived=[${e.arrivedThisTick.join(',')}] completed=[${e.completedThisTick.join(',')}]`);
}

// csv-export.js - CSV builders and browser download helper.

import { expandToThreads } from './thread-utils.js';

function escapeCSV(cell) {
  const str = String(cell ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function metricValue(metric, ...keys) {
  for (const key of keys) {
    if (metric?.[key] !== undefined && metric[key] !== null) return metric[key];
  }
  return '';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function buildThreadLookup(processes) {
  if (!Array.isArray(processes) || processes.length === 0) return new Map();
  return new Map(expandToThreads(processes).map(thread => [thread.tid, thread]));
}

function average(threadMetrics, key) {
  if (!Array.isArray(threadMetrics) || threadMetrics.length === 0) return '0.00';
  return (
    threadMetrics.reduce((sum, metric) => sum + (Number(metric?.[key]) || 0), 0) /
    threadMetrics.length
  ).toFixed(2);
}

/**
 * Genera CSV de resultados de simulación.
 *
 * Output format:
 *   PID,TID,Arrival,Burst,Completion,Turnaround,Waiting,Response
 *   1,1,0,5,5,5,0,0
 *   ...
 *
 *   # Algorithm,FCFS
 *   # Cores,2
 *   # Avg Turnaround,4.50
 *   # Avg Waiting,2.25
 *   # Generated,2026-05-09T17:30:00Z
 */
export function buildResultsCSV(threadMetrics, metadata = {}) {
  const metrics = Array.isArray(threadMetrics) ? threadMetrics : [];
  const threadLookup = buildThreadLookup(metadata.processes);
  const headers = ['PID', 'TID', 'Arrival', 'Burst', 'Completion',
                   'Turnaround', 'Waiting', 'Response'];

  const rows = metrics.map(metric => {
    const tid = metricValue(metric, 'tid');
    const sourceThread = threadLookup.get(tid);
    return [
      firstNonEmpty(metricValue(metric, 'pid', 'parentPid'), sourceThread?.pid, sourceThread?.parentPid),
      tid,
      firstNonEmpty(metricValue(metric, 'arrivalTime', 'arrival'), sourceThread?.arrivalTime),
      firstNonEmpty(metricValue(metric, 'burstTime', 'burst'), sourceThread?.burstTime),
      metricValue(metric, 'completionTime', 'completion'),
      metricValue(metric, 'turnaroundTime', 'turnaround'),
      metricValue(metric, 'waitingTime', 'waiting'),
      metricValue(metric, 'responseTime', 'response'),
    ];
  });

  const lines = [
    headers.join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ];

  lines.push('');
  if (metadata.algorithm) lines.push(`# Algorithm,${escapeCSV(metadata.algorithm)}`);
  if (metadata.numCores) lines.push(`# Cores,${escapeCSV(metadata.numCores)}`);
  if (metadata.quantum) lines.push(`# Quantum,${escapeCSV(metadata.quantum)}`);
  lines.push(`# Avg Turnaround,${average(metrics, 'turnaroundTime')}`);
  lines.push(`# Avg Waiting,${average(metrics, 'waitingTime')}`);
  lines.push(`# Generated,${new Date().toISOString()}`);

  return lines.join('\n');
}

function comparisonMetricValue(comparison, metric) {
  const metrics = comparison?.metrics || {};
  const map = {
    avgTurnaround: ['avgTurnaround', 'avgTurnaroundTime'],
    avgWaiting: ['avgWaiting', 'avgWaitingTime'],
    avgResponse: ['avgResponse', 'avgResponseTime'],
    totalTime: ['totalTime', 'totalCompletionTime'],
  };

  for (const key of map[metric] || [metric]) {
    if (comparison?.[key] !== undefined && comparison[key] !== null) return comparison[key];
    if (metrics[key] !== undefined && metrics[key] !== null) return metrics[key];
  }

  if (metric === 'totalTime' && Array.isArray(comparison?.trace?.threadMetrics)) {
    return Math.max(0, ...comparison.trace.threadMetrics.map(item => item.completionTime || 0));
  }

  return null;
}

/**
 * Genera CSV de comparación de varios algoritmos lado a lado.
 *
 * Output format:
 *   Metric,FCFS,SJF,RR,SRTF
 *   Avg Turnaround,5.20,4.10,5.80,4.05
 *   Avg Waiting,2.30,1.20,2.90,1.15
 */
export function buildComparisonCSV(comparisonData) {
  const comparisons = Array.isArray(comparisonData) ? comparisonData : [];
  const algorithms = comparisons.map(item => item.algorithm);
  const metrics = ['avgTurnaround', 'avgWaiting', 'avgResponse', 'totalTime'];
  const labels = {
    avgTurnaround: 'Avg Turnaround',
    avgWaiting: 'Avg Waiting',
    avgResponse: 'Avg Response',
    totalTime: 'Total Time'
  };

  const lines = ['Metric,' + algorithms.map(escapeCSV).join(',')];
  for (const metric of metrics) {
    const row = [labels[metric]];
    for (const comparison of comparisons) {
      const value = comparisonMetricValue(comparison, metric);
      row.push(value != null ? Number(value).toFixed(2) : '');
    }
    lines.push(row.map(escapeCSV).join(','));
  }
  lines.push('');
  lines.push(`# Generated,${new Date().toISOString()}`);
  return lines.join('\n');
}

/**
 * Trigger de descarga del CSV en el navegador.
 */
export function downloadCSV(csvString, filename = 'coreview-results.csv') {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

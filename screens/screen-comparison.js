// screen-comparison.js — Comparison screen glue. Runs all algorithms via comparison engine,
// renders grouped bar charts. Sequential runs with setTimeout yield. Caches in AppState.

import { AppState }            from '../app.js';
import { compareScheduling, comparePageReplacement, DEFAULT_SCHEDULING_CONFIGS, ALL_PAGE_ALGORITHMS } from '../engine/comparison.js';
import { buildComparisonCSV, downloadCSV } from '../engine/csv-export.js';
import { renderSchedulingComparisonChart, renderPageReplacementComparisonChart } from '../render/comparison-chart.js';
import { toast, navigateTo }   from '../render/ui-feedback.js';

export function initComparisonScreen() {
  document.querySelector('[data-tab="comparison"]')?.addEventListener('click', _onTabActivated);
  _ensureComparisonExportButton();

  // Wire the no-data link to navigate to input
  const noData = document.getElementById('cmp-no-data');
  if (noData && !noData.dataset.linked) {
    noData.dataset.linked = '1';
    noData.querySelector('strong')?.addEventListener('click', () => navigateTo('input'));
    const s = noData.querySelector('strong');
    if (s) s.style.cursor = 'pointer';
  }
}

let _lastProcKey  = '';
let _lastPageKey  = '';
let _running      = false;

function _timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function _ensureComparisonExportButton() {
  const content = document.getElementById('cmp-content');
  if (!content || document.getElementById('cmp-export-csv')) return;

  const actions = document.createElement('div');
  actions.className = 'cmp-export-actions';
  actions.style.marginTop = 'var(--space-4)';
  actions.innerHTML = `<button type="button" id="cmp-export-csv" class="inp-btn" hidden>Export comparison CSV</button>`;
  content.prepend(actions);

  actions.querySelector('#cmp-export-csv')?.addEventListener('click', () => {
    const comparisons = AppState.comparisonResult?.schedulingComparisons || [];
    if (!comparisons.length) return;
    const csv = buildComparisonCSV(comparisons);
    downloadCSV(csv, `coreview-comparison-${_timestampForFilename()}.csv`);
  });
}

function _setComparisonExportVisible(visible) {
  const button = document.getElementById('cmp-export-csv');
  if (button) button.hidden = !visible;
}

function _onTabActivated() {
  const procKey = JSON.stringify(AppState.processes);
  const pageKey = JSON.stringify({ refs: AppState.referenceString, cfg: AppState.memoryConfig });

  const noData  = document.getElementById('cmp-no-data');
  const content = document.getElementById('cmp-content');
  const loading = document.getElementById('cmp-loading');

  if (!AppState.processes || AppState.processes.length === 0) {
    noData.style.display  = '';
    content.style.display = 'none';
    loading.style.display = 'none';
    _setComparisonExportVisible(false);
    return;
  }

  noData.style.display = 'none';

  if (
    AppState.comparisonResult &&
    procKey === _lastProcKey &&
    pageKey === _lastPageKey
  ) {
    content.style.display = '';
    loading.style.display = 'none';
    _drawCharts(AppState.comparisonResult);
    _setComparisonExportVisible((AppState.comparisonResult.schedulingComparisons || []).length > 0);
    return;
  }

  if (_running) return;

  content.style.display = 'none';
  loading.style.display = '';
  _setComparisonExportVisible(false);
  _runComparison(AppState.processes, AppState.referenceString, AppState.memoryConfig, procKey, pageKey);
}

async function _runComparison(processes, refs, memConfig, procKey, pageKey) {
  _running = true;

  const loading = document.getElementById('cmp-loading');
  const content = document.getElementById('cmp-content');

  _setLoadingText('Running scheduling algorithms…');

  const schedulingComparisons = [];
  for (const config of DEFAULT_SCHEDULING_CONFIGS) {
    await _yield();
    _setLoadingText(`Running ${config.algorithm}…`);
    try {
      const { schedulingComparisons: sc } = compareScheduling(processes, [config]);
      if (sc && sc.length > 0) schedulingComparisons.push(sc[0]);
    } catch (_) { /* skip */ }
  }

  _setLoadingText('Running page replacement algorithms…');
  let pageResult = { pageReplacementComparisons: [] };

  if (refs && refs.length > 0 && memConfig && memConfig.numFrames > 0) {
    for (const algo of ALL_PAGE_ALGORITHMS) {
      await _yield();
      _setLoadingText(`Running ${algo}…`);
      try {
        const { pageReplacementComparisons: pc } = comparePageReplacement(memConfig.numFrames, refs, [algo]);
        if (pc && pc.length > 0) pageResult.pageReplacementComparisons.push(pc[0]);
      } catch (_) { /* skip */ }
    }
  }

  const result = {
    inputProcesses: processes,
    schedulingComparisons,
    pageReplacementComparisons: pageResult.pageReplacementComparisons,
  };

  AppState.comparisonResult = result;
  _lastProcKey = procKey;
  _lastPageKey = pageKey;
  _running = false;

  if (loading) loading.style.display = 'none';
  if (content) content.style.display = '';
  _drawCharts(result);
  _setComparisonExportVisible(schedulingComparisons.length > 0);

  const totalAlgos = schedulingComparisons.length + pageResult.pageReplacementComparisons.length;
  toast(`Comparison complete — ${totalAlgos} algorithms evaluated.`, 'ok');
}

function _yield() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function _setLoadingText(msg) {
  const el = document.getElementById('cmp-loading-msg');
  if (el) el.textContent = msg;
}

function _drawCharts(result) {
  _drawSchedulingChart(result.schedulingComparisons || []);
  _drawPageChart(result.pageReplacementComparisons || []);
  _renderBestSummary(result);
}

function _drawSchedulingChart(comparisons) {
  const canvas = document.getElementById('cmp-sched-chart');
  const insight = document.getElementById('cmp-sched-insight');
  if (!canvas) return;
  canvas.width  = canvas.parentElement.clientWidth || 800;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  renderSchedulingComparisonChart(ctx, comparisons);
  _renderSchedulingInsight(insight, comparisons);
}

function _drawPageChart(comparisons) {
  const canvas = document.getElementById('cmp-page-chart');
  const insight = document.getElementById('cmp-page-insight');
  if (!canvas) return;

  if (!comparisons || comparisons.length === 0) {
    canvas.parentElement.style.display = 'none';
    if (insight) insight.textContent = '';
    return;
  }
  canvas.parentElement.style.display = '';
  canvas.width  = canvas.parentElement.clientWidth || 600;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  renderPageReplacementComparisonChart(ctx, comparisons);
  _renderPageInsight(insight, comparisons);
}

function _renderPageInsight(element, comparisons) {
  if (!element) return;
  const faults = comparisons.map(item => item.totalFaults);
  const minFaults = Math.min(...faults);
  const maxFaults = Math.max(...faults);
  const allEqual = minFaults === maxFaults;
  const allZeroHit = comparisons.every(item => item.hitRate === 0);

  if (allEqual) {
    element.textContent = allZeroHit
      ? `Tie en page faults: todos produjeron ${minFaults} page faults y 0% hit rate. Es normal si la reference string no reutiliza pages dentro de los frames disponibles.`
      : `Tie en page faults: todos produjeron ${minFaults} page faults con esta reference string; revisa el hit rate para ver si hubo reutilización.`;
    return;
  }

  const best = comparisons
    .filter(item => item.totalFaults === minFaults)
    .map(item => item.algorithm)
    .join(', ');
  const worst = comparisons
    .filter(item => item.totalFaults === maxFaults)
    .map(item => item.algorithm)
    .join(', ');
  element.textContent = `Best page replacement: ${best} con ${minFaults} page faults. Más alto: ${worst} con ${maxFaults}; la diferencia muestra cuánto ayudó la política de reemplazo.`;
}

function _renderSchedulingInsight(element, comparisons) {
  if (!element) return;
  if (!comparisons || comparisons.length === 0) {
    element.textContent = '';
    return;
  }

  const bestTat = _bestByMetric(comparisons, 'avgTurnaroundTime');
  const bestWt = _bestByMetric(comparisons, 'avgWaitingTime');
  const bestRt = _bestByMetric(comparisons, 'avgResponseTime');
  const sameWinner = bestTat.algorithms === bestWt.algorithms && bestWt.algorithms === bestRt.algorithms;

  if (sameWinner) {
    element.textContent = bestTat.count > 1
      ? `Empate en las tres métricas principales: ${bestTat.algorithms} comparten el menor Avg TAT, Avg WT y Avg RT.`
      : `${bestTat.algorithms} domina esta corrida: tiene el menor Avg TAT, Avg WT y Avg RT.`;
    return;
  }

  element.textContent =
    `Lectura rápida: ${bestTat.algorithms} minimiza Avg TAT (${bestTat.value}), ` +
    `${bestWt.algorithms} minimiza Avg WT (${bestWt.value}) y ` +
    `${bestRt.algorithms} minimiza Avg RT (${bestRt.value}). ` +
    `Si una estrella aparece en varias barras, hay empate en esa métrica.`;
}

function _bestByMetric(comparisons, key) {
  const minValue = Math.min(...comparisons.map(item => item.metrics[key] ?? Infinity));
  const winners = comparisons
    .filter(item => item.metrics[key] === minValue)
    .map(item => item.algorithm);
  return {
    algorithms: winners.join(', '),
    count: winners.length,
    value: minValue.toFixed(2),
  };
}

function _renderBestSummary(result) {
  const el = document.getElementById('cmp-best-summary');
  if (!el) return;
  el.innerHTML = '';

  const sc = result.schedulingComparisons;
  const pc = result.pageReplacementComparisons;

  if ((!sc || sc.length === 0) && (!pc || pc.length === 0)) return;

  const items = [];

  if (sc && sc.length > 0) {
    const bestTAT = sc.reduce((a, b) => a.metrics.avgTurnaroundTime <= b.metrics.avgTurnaroundTime ? a : b);
    const bestWT  = sc.reduce((a, b) => a.metrics.avgWaitingTime    <= b.metrics.avgWaitingTime    ? a : b);
    const bestRT  = sc.reduce((a, b) => a.metrics.avgResponseTime   <= b.metrics.avgResponseTime   ? a : b);

    items.push({ label: 'Best Avg TAT', algo: bestTAT.algorithm, val: bestTAT.metrics.avgTurnaroundTime.toFixed(2) });
    items.push({ label: 'Best Avg WT',  algo: bestWT.algorithm,  val: bestWT.metrics.avgWaitingTime.toFixed(2)    });
    items.push({ label: 'Best Avg RT',  algo: bestRT.algorithm,  val: bestRT.metrics.avgResponseTime.toFixed(2)   });
  }

  if (pc && pc.length > 0) {
    const bestFaults = pc.reduce((a, b) => a.totalFaults <= b.totalFaults ? a : b);
    items.push({ label: 'Fewest page faults', algo: bestFaults.algorithm, val: String(bestFaults.totalFaults) });
  }

  const title = document.createElement('div');
  title.className = 'cmp-best-title';
  title.textContent = '★ Best results';
  el.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'cmp-best-grid';
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'cmp-best-card';
    card.innerHTML =
      `<div class="cmp-best-card-label">${item.label}</div>` +
      `<div class="cmp-best-card-algo">${item.algo}</div>` +
      `<div class="cmp-best-card-val">${item.val}</div>`;
    grid.appendChild(card);
  }
  el.appendChild(grid);
}

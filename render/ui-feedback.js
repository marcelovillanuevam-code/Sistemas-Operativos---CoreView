// ui-feedback.js — Toast notifications and global status indicator.
// Pure DOM, no engine logic. Reusable across screens.

const ICONS = { ok: '✓', info: 'i', warn: '!', err: '×' };
const DEFAULT_DURATION = 3200;

/**
 * Show a transient toast in the bottom-right corner.
 * @param {string} message
 * @param {'ok'|'info'|'warn'|'err'} [kind='info']
 * @param {number} [durationMs]
 */
export function toast(message, kind = 'info', durationMs = DEFAULT_DURATION) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const t = document.createElement('div');
  t.className = `toast toast--${kind}`;
  t.innerHTML =
    `<span class="toast-icon">${ICONS[kind] ?? 'i'}</span>` +
    `<span class="toast-msg"></span>` +
    `<button class="toast-close" aria-label="Cerrar">×</button>`;
  t.querySelector('.toast-msg').textContent = message;

  const close = () => {
    if (t.classList.contains('toast--leaving')) return;
    t.classList.add('toast--leaving');
    setTimeout(() => t.remove(), 220);
  };

  t.querySelector('.toast-close').addEventListener('click', close);
  container.appendChild(t);

  if (durationMs > 0) setTimeout(close, durationMs);
}

/**
 * Update the small status pill in the app header.
 * @param {string} text
 * @param {'idle'|'ok'|'warn'|'err'} kind
 */
export function setAppStatus(text, kind = 'idle') {
  const dot = document.getElementById('app-status-dot');
  const lbl = document.getElementById('app-status-text');
  if (!dot || !lbl) return;
  dot.className = `app-status-dot app-status-dot--${kind}`;
  lbl.textContent = text;
}

/**
 * Switch to a tab programmatically.
 * @param {string} tab — the data-tab attribute value
 */
export function navigateTo(tab) {
  const btn = document.querySelector(`nav [data-tab="${tab}"]`);
  if (btn) btn.click();
}

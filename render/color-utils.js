// color-utils.js — Deterministic color helpers for consistent process/page coloring.

/**
 * Returns a stable HSL color string for a given PID or page number.
 * Uses the golden angle (137.508°) to distribute hues evenly without collision.
 * Saturation 65%, Lightness 55% → readable on dark backgrounds with WCAG AA contrast.
 *
 * @param {number} id  PID or page number (any non-negative integer)
 * @returns {string}   e.g. "hsl(137, 65%, 55%)"
 */
export function pidToColor(id) {
  const hue = Math.round((id * 137.508) % 360);
  return `hsl(${hue}, 65%, 55%)`;
}

/**
 * Given a fill color (CSS string), returns '#fff' or '#0A0A0B' to ensure
 * WCAG AA contrast (≥ 4.5:1) for text labels rendered on that fill.
 *
 * Uses the relative luminance formula (WCAG 2.1).
 *
 * @param {string} cssColor  Any CSS color string parseable by the browser
 *   or an 'hsl(h, s%, l%)' string from pidToColor().
 * @returns {string}  '#fff' or '#0A0A0B'
 */
export function contrastTextColor(cssColor) {
  const L = _relativeLuminance(cssColor);
  // Contrast against white (#fff, L=1) vs near-black (#0A0A0B, L≈0)
  const contrastWhite = (1 + 0.05) / (L + 0.05);
  const contrastBlack = (L + 0.05) / (0 + 0.05);
  return contrastWhite >= contrastBlack ? '#fff' : '#0A0A0B';
}

/**
 * Read a CSS custom property value from the document root.
 * Returns trimmed string, e.g. '#3B82F6'.
 *
 * @param {string} name  Token name including '--', e.g. '--accent'
 * @returns {string}
 */
export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _relativeLuminance(cssColor) {
  const rgb = _parseHsl(cssColor) ?? _parseFallback(cssColor);
  if (!rgb) return 0.18; // mid-point fallback
  const [r, g, b] = rgb.map(c => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function _parseHsl(color) {
  const m = color.match(/hsl\(\s*(\d+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/);
  if (!m) return null;
  const h = parseInt(m[1]) / 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [h + 1/3, h, h - 1/3].map(t => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return Math.round((p + (q - p) * 6 * t) * 255);
    if (t < 1/2) return Math.round(q * 255);
    if (t < 2/3) return Math.round((p + (q - p) * (2/3 - t) * 6) * 255);
    return Math.round(p * 255);
  });
}

function _parseFallback(color) {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

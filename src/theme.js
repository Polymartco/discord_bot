// ── Polymart design system ────────────────────────────────────────────────────
// Single source of truth for the bot's visual language: a cohesive dark
// "trading terminal" palette shared by Discord embeds (integer colors) and the
// canvas card renderer (hex strings), plus small text primitives — meters,
// sparklines, delta badges — that give every embed a consistent, premium feel.
//
// This module is pure JS with NO native dependencies, so it is safe to import
// from anywhere (unlike chart.js / canvasKit.js, which need @napi-rs/canvas).

// ── Core palette (hex — for canvas) ───────────────────────────────────────────
export const HEX = {
  // Deep indigo → near-black backdrop
  bg0:       '#0b0d1a', // darkest (page bottom)
  bg1:       '#12152b', // top of the gradient
  surface:   '#191d38', // raised panel
  surfaceAlt:'#20254a', // secondary panel / row hover
  border:    '#2c3363', // hairline panel border
  borderSoft:'#232849', // softer inner divider

  // Text
  text:      '#eef1ff', // primary
  textMuted: '#9aa4cf', // secondary
  textFaint: '#606a9a', // tertiary / axis labels

  // Brand + semantics
  brand:     '#6366f1', // indigo
  brandBright:'#8b93ff',
  green:     '#26d07c',
  greenDim:  '#1a8f57',
  red:       '#f2495c',
  redDim:    '#b3313f',
  gold:      '#f5a623',
  blue:      '#5865f2', // Discord blurple
  cyan:      '#22d3ee',
  violet:    '#a855f7',
  pink:      '#ec4899',
  white:     '#ffffff',
};

// Translucent fills for glows / area gradients (rgba)
export const RGBA = {
  greenFill:  'rgba(38, 208, 124, 0.28)',
  greenFade:  'rgba(38, 208, 124, 0.00)',
  redFill:    'rgba(242, 73, 92, 0.26)',
  redFade:    'rgba(242, 73, 92, 0.00)',
  brandFill:  'rgba(99, 102, 241, 0.22)',
  brandFade:  'rgba(99, 102, 241, 0.00)',
  highlight:  'rgba(255, 255, 255, 0.05)', // inner top highlight on panels
  shadow:     'rgba(0, 0, 0, 0.45)',
  gridLine:   'rgba(255, 255, 255, 0.045)',
};

// Harmonious multi-series ramp (charts, donut, overview) — ordered for contrast.
export const SERIES = [
  '#6366f1', '#26d07c', '#f2495c', '#f5a623',
  '#22d3ee', '#a855f7', '#ec4899', '#38bdf8',
];

// ── Embed accent colors (integers — for discord.js setColor) ──────────────────
export const GREEN = 0x26d07c;
export const RED   = 0xf2495c;
export const BLUE  = 0x5865f2;
export const GOLD  = 0xf5a623;
export const BRAND = 0x6366f1;
export const SLATE = 0x2c3363; // neutral panel accent

/** Accent color for a signed number: green ≥ 0, red < 0. */
export const colorOf = n => (n >= 0 ? GREEN : RED);

// ── Semantic iconography ──────────────────────────────────────────────────────
// A small, consistent icon set so the same concept always reads the same way.
export const ICON = {
  up:      '📈',
  down:    '📉',
  money:   '💰',
  chart:   '📊',
  trophy:  '🏆',
  fire:    '🔥',
  spark:   '✨',
  bolt:    '⚡',
  target:  '🎯',
  gem:     '💎',
  coin:    '🪙',
  bank:    '🏦',
  bell:    '🔔',
  ok:      '✅',
  err:     '⛔',
  warn:    '⚠️',
  link:    '🔗',
  clock:   '🕒',
  rocket:  '🚀',
  medal:   ['🥇', '🥈', '🥉'],
};

// ── Text primitives ───────────────────────────────────────────────────────────

/** Unicode ▲ / ▼ / ▬ for a signed value (▬ only when exactly 0). */
export const arrow = n => (n > 0 ? '▲' : n < 0 ? '▼' : '▬');

/**
 * A compact signed-percent badge, e.g. "▲ +2.41%" — the arrow makes direction
 * legible at a glance even in monochrome. `digits` controls decimal places.
 */
export function deltaBadge(pct, digits = 2) {
  const v = Number.isFinite(pct) ? pct : 0;
  return `${arrow(v)} ${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

/**
 * Sleek segmented meter, e.g. ▰▰▰▰▰▰▱▱▱▱ — cleaner than the blocky █/░ bar.
 * `pct` is 0..1 (clamped). Use for XP, allocation share, win-rate, etc.
 */
export function meter(pct, width = 12) {
  const p = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
  const filled = Math.round(p * width);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, width - filled));
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
/**
 * Inline sparkline from a numeric series using block glyphs, e.g. ▂▃▅▇▆█▄▂.
 * Renders identically on desktop and mobile Discord. Returns '' for tiny inputs.
 */
export function sparkline(values, maxLen = 24) {
  const nums = (values || []).filter(v => Number.isFinite(v));
  if (nums.length < 2) return '';
  // Downsample evenly if the series is long, so the spark stays readable.
  let series = nums;
  if (nums.length > maxLen) {
    series = Array.from({ length: maxLen }, (_, i) =>
      nums[Math.floor((i / (maxLen - 1)) * (nums.length - 1))]);
  }
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  return series.map(v => SPARK[Math.min(SPARK.length - 1, Math.floor(((v - min) / range) * (SPARK.length - 1)))]).join('');
}

/** A thin full-width rule for embed descriptions. */
export const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/** Right-pad/truncate a label to a fixed monospace column width. */
export function pad(str, width, right = false) {
  const s = String(str);
  if (s.length >= width) return s.slice(0, width);
  const fill = ' '.repeat(width - s.length);
  return right ? fill + s : s + fill;
}

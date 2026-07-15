// ── Canvas toolkit ────────────────────────────────────────────────────────────
// Reusable drawing primitives for the card renderer (chart.js): rounded panels,
// gradients, soft shadows, glows, pills, and a branded header — the ingredients
// that make a flat canvas look like a polished fintech dashboard.
//
// Imports @napi-rs/canvas, so this module (like chart.js) must only be loaded
// behind the optional-canvas guard. It never touches Discord.

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { HEX, RGBA } from './theme.js';

// ── Font resolution ───────────────────────────────────────────────────────────
// Pick the best REAL font present on this host rather than the generic
// "monospace" the old renderer used. Segoe UI (Windows) / Helvetica / DejaVu are
// all excellent; Consolas / Menlo / DejaVu Mono give crisp tabular numbers.
const families = new Set(GlobalFonts.families.map(f => f.family));
const firstAvailable = (cands, fallback) => cands.find(c => families.has(c)) ?? fallback;

export const FONT = {
  sans: firstAvailable(['Segoe UI', 'Helvetica Neue', 'Arial', 'DejaVu Sans', 'Liberation Sans', 'Roboto'], 'sans-serif'),
  mono: firstAvailable(['Consolas', 'Menlo', 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New'], 'monospace'),
};

const GENERIC = new Set(['sans-serif', 'monospace', 'serif']);
const familyToken = fam => (GENERIC.has(fam) ? fam : `"${fam}"`);

/**
 * Set ctx.font from parts. size in px; weight 'normal'|'bold'; mono picks the
 * tabular font. Returns the ctx for chaining convenience.
 */
export function setFont(ctx, size, { weight = 'normal', mono = false } = {}) {
  ctx.font = `${weight === 'bold' ? 'bold ' : ''}${size}px ${familyToken(mono ? FONT.mono : FONT.sans)}`;
  return ctx;
}

// ── Geometry ──────────────────────────────────────────────────────────────────
export function roundRectPath(ctx, x, y, w, h, r = 8) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x,     y + h, rad);
  ctx.arcTo(x,     y + h, x,     y,     rad);
  ctx.arcTo(x,     y,     x + w, y,     rad);
  ctx.closePath();
}

/** Run `fn` with a temporary drop shadow, then restore. */
export function withShadow(ctx, { color = RGBA.shadow, blur = 18, x = 0, y = 8 } = {}, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = x;
  ctx.shadowOffsetY = y;
  fn();
  ctx.restore();
}

/** Vertical gradient from an array of [offset, color] stops. */
export function vGradient(ctx, x, y, h, stops) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

// ── Panels ────────────────────────────────────────────────────────────────────
/**
 * Draw a rounded surface panel with an optional soft drop shadow, hairline
 * border, and a subtle inner top highlight — the base unit of the card layout.
 */
export function panel(ctx, x, y, w, h, {
  r = 14, fill = HEX.surface, stroke = HEX.border, shadow = true, highlight = true,
} = {}) {
  if (shadow) {
    withShadow(ctx, { blur: 22, y: 10 }, () => {
      ctx.fillStyle = fill;
      roundRectPath(ctx, x, y, w, h, r);
      ctx.fill();
    });
  } else {
    ctx.fillStyle = fill;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
  }
  if (highlight) {
    // Faint gradient overlay: lighter at the top, invisible by mid-panel.
    ctx.fillStyle = vGradient(ctx, x, y, h, [[0, RGBA.highlight], [0.5, 'rgba(255,255,255,0)']]);
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.stroke();
  }
}

/** Fill the whole canvas with the signature backdrop + a soft brand glow. */
export function backdrop(ctx, w, h, { glow = HEX.brand } = {}) {
  ctx.fillStyle = vGradient(ctx, 0, 0, h, [[0, HEX.bg1], [1, HEX.bg0]]);
  ctx.fillRect(0, 0, w, h);
  // Radial brand glow anchored to the top-left header region.
  const g = ctx.createRadialGradient(w * 0.18, -40, 20, w * 0.18, -40, h * 0.9);
  g.addColorStop(0, hexToRgba(glow, 0.16));
  g.addColorStop(1, hexToRgba(glow, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ── Pills / badges ────────────────────────────────────────────────────────────
/**
 * Draw a rounded pill with centered text; returns its width so callers can lay
 * pills out in a row. Pass `x` as the left edge (align 'left') or right edge
 * (align 'right').
 */
export function pill(ctx, x, y, text, {
  fg = HEX.text, bg = HEX.surfaceAlt, size = 15, weight = 'bold',
  mono = false, padX = 12, h = 26, align = 'left', stroke = null,
} = {}) {
  setFont(ctx, size, { weight, mono });
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const left = align === 'right' ? x - w : x;
  ctx.fillStyle = bg;
  roundRectPath(ctx, left, y, w, h, h / 2);
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; roundRectPath(ctx, left + 0.5, y + 0.5, w - 1, h - 1, h / 2); ctx.stroke(); }
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, y + h / 2 + 0.5);
  ctx.textBaseline = 'alphabetic';
  return w;
}

// ── Brand header ──────────────────────────────────────────────────────────────
/**
 * Rounded-square monogram tile with a brand gradient and a "P" — the little
 * logo mark used at the top-left of every card.
 */
export function brandMark(ctx, x, y, size = 34) {
  ctx.save();
  withShadow(ctx, { color: hexToRgba(HEX.brand, 0.5), blur: 14, y: 3 }, () => {
    ctx.fillStyle = vGradient(ctx, x, y, size, [[0, HEX.brandBright], [1, HEX.brand]]);
    roundRectPath(ctx, x, y, size, size, size * 0.28);
    ctx.fill();
  });
  ctx.fillStyle = HEX.white;
  setFont(ctx, size * 0.62, { weight: 'bold' });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', x + size / 2, y + size / 2 + size * 0.04);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

/**
 * Standard card header: brand mark + wordmark/eyebrow at the left, and an
 * optional right-aligned value (e.g. a big price or badge). Returns the y just
 * below the header so the caller can place content.
 */
export function header(ctx, { x, y, w, title, subtitle, rightText, rightColor = HEX.text }) {
  const markSize = 34;
  brandMark(ctx, x, y, markSize);
  const tx = x + markSize + 14;

  ctx.textAlign = 'left';
  ctx.fillStyle = HEX.text;
  setFont(ctx, 20, { weight: 'bold' });
  ctx.fillText(title, tx, y + 16);

  if (subtitle) {
    ctx.fillStyle = HEX.textFaint;
    setFont(ctx, 12.5);
    ctx.fillText(subtitle.toUpperCase(), tx, y + 32);
  }

  if (rightText) {
    ctx.textAlign = 'right';
    ctx.fillStyle = rightColor;
    setFont(ctx, 26, { weight: 'bold', mono: true });
    ctx.fillText(rightText, x + w, y + 26);
    ctx.textAlign = 'left';
  }
  return y + markSize + 8;
}

// ── Text helpers ──────────────────────────────────────────────────────────────
/** Truncate text to fit maxWidth, adding an ellipsis. Assumes font already set. */
export function clip(ctx, text, maxWidth) {
  let s = String(text);
  if (ctx.measureText(s).width <= maxWidth) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

// ── Color utils ───────────────────────────────────────────────────────────────
export function hexToRgba(hex, a = 1) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export { createCanvas };

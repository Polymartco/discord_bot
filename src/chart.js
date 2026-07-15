// ── Card renderer ─────────────────────────────────────────────────────────────
// Every image the bot posts (price charts, market overview, heatmap, donut,
// leaderboard, comparison) is drawn here in the shared "Polymart terminal"
// visual language: gradient backdrop, rounded panels with soft shadows, glowing
// lines, and crisp Segoe UI / Consolas typography. Primitives live in
// canvasKit.js; the palette lives in theme.js.

import { HEX, RGBA, SERIES } from './theme.js';
import {
  createCanvas, setFont, panel, backdrop, header, brandMark, pill,
  roundRectPath, vGradient, withShadow, hexToRgba, clip, FONT,
} from './canvasKit.js';

// ── Small local formatters (kept here to avoid a cycle with utils.js) ─────────
const fmtPrice = n =>
  n < 1 ? n.toFixed(5) : n < 100 ? n.toFixed(3) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signPct = n => `${n >= 0 ? '+' : ''}${(n ?? 0).toFixed(2)}%`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Trace a smoothed polyline along `pts` (caller sets up path + stroke/fill).
function traceSmooth(ctx, pts) {
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

// ── Single price chart ────────────────────────────────────────────────────────
export function drawPriceChart({ history, label, currentPrice, changePct }) {
  const W = 880, H = 420, M = 26;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const change = changePct ?? 0;
  const up = change >= 0;
  const accent = up ? HEX.green : HEX.red;

  backdrop(ctx, W, H, { glow: accent });

  // ── Header: brand mark, ticker + name, big price + delta pill ───────────────
  const parts = (label || '').split(' — ');
  const ticker = parts[0] || label || '—';
  const name = parts[1] || '';

  brandMark(ctx, M, M, 34);
  const tx = M + 48;
  ctx.textAlign = 'left';
  ctx.fillStyle = HEX.textFaint; setFont(ctx, 11.5, { weight: 'bold' });
  ctx.fillText('POLYMART  ·  LIVE QUOTE', tx, M + 11);
  ctx.fillStyle = HEX.text; setFont(ctx, 23, { weight: 'bold' });
  ctx.fillText(ticker, tx, M + 34);
  if (name) {
    const tw = ctx.measureText(ticker).width;
    ctx.fillStyle = HEX.textMuted; setFont(ctx, 14);
    ctx.fillText(clip(ctx, name, W - tx - tw - 230), tx + tw + 10, M + 33);
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = HEX.text; setFont(ctx, 30, { weight: 'bold', mono: true });
  ctx.fillText(`$${fmtPrice(currentPrice)}`, W - M, M + 22);
  pill(ctx, W - M, M + 32, `${up ? '▲' : '▼'} ${signPct(change)}`, {
    align: 'right', bg: hexToRgba(accent, 0.16), fg: accent, size: 13.5, h: 23,
    stroke: hexToRgba(accent, 0.45),
  });

  // ── Chart panel ─────────────────────────────────────────────────────────────
  const pX = M, pY = 96, pW = W - M * 2, pH = H - pY - M;
  panel(ctx, pX, pY, pW, pH, { r: 16 });

  const PAD = { top: 20, right: 78, bottom: 24, left: 20 };
  const plotX = pX + PAD.left, plotY = pY + PAD.top;
  const plotW = pW - PAD.left - PAD.right, plotH = pH - PAD.top - PAD.bottom;

  const prices = Array.isArray(history) && history.length ? history : [currentPrice];
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const lo = minP - (maxP - minP || Math.abs(minP) || 1) * 0.08;
  const hi = maxP + (maxP - minP || Math.abs(maxP) || 1) * 0.08;
  const range = hi - lo || 1;

  // Grid + right-edge price axis
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = plotY + (plotH / 4) * i;
    ctx.strokeStyle = RGBA.gridLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.stroke();
    ctx.fillStyle = HEX.textFaint; setFont(ctx, 11.5, { mono: true }); ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(hi - (i / 4) * range), plotX + plotW + 10, y);
  }
  ctx.textBaseline = 'alphabetic';

  const px = i => plotX + (i / (prices.length - 1 || 1)) * plotW;
  const py = v => plotY + ((hi - v) / range) * plotH;
  const pts = prices.map((v, i) => ({ x: px(i), y: py(v) }));

  // Area fill (accent → transparent)
  ctx.save();
  roundRectPath(ctx, pX + 1, pY + 1, pW - 2, pH - 2, 15); ctx.clip();
  ctx.beginPath();
  traceSmooth(ctx, pts);
  ctx.lineTo(pts[pts.length - 1].x, plotY + plotH);
  ctx.lineTo(pts[0].x, plotY + plotH);
  ctx.closePath();
  ctx.fillStyle = vGradient(ctx, plotY, 0, plotH + PAD.top, [
    [0, hexToRgba(accent, 0.30)], [1, hexToRgba(accent, 0)],
  ]);
  ctx.fill();
  ctx.restore();

  // Glowing price line
  withShadow(ctx, { color: hexToRgba(accent, 0.55), blur: 12, y: 2 }, () => {
    ctx.beginPath();
    traceSmooth(ctx, pts);
    ctx.strokeStyle = accent; ctx.lineWidth = 2.75; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
  });

  // Current-price marker: halo + white-ringed dot
  const last = pts[pts.length - 1];
  ctx.beginPath(); ctx.arc(last.x, last.y, 9, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(accent, 0.22); ctx.fill();
  ctx.beginPath(); ctx.arc(last.x, last.y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = accent; ctx.fill();
  ctx.strokeStyle = HEX.white; ctx.lineWidth = 2; ctx.stroke();

  return canvas.toBuffer('image/png');
}

// ── Market overview: top N stocks normalized on one chart ─────────────────────
export function drawMarketOverview(stocks, topN = 6) {
  const entries = Object.entries(stocks)
    .filter(([, s]) => Array.isArray(s.history) && s.history.length > 2)
    .sort((a, b) => (b[1].volume ?? 0) - (a[1].volume ?? 0))
    .slice(0, topN);
  if (!entries.length) return null;

  const W = 880, H = 470, M = 26;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, W, H);
  header(ctx, { x: M, y: M, w: W - M * 2, title: 'Market Overview', subtitle: 'Polymart · Top movers by volume' });

  const pX = M, pY = 92, pW = W - M * 2, pH = H - pY - M;
  panel(ctx, pX, pY, pW, pH, { r: 16 });
  const PAD = { top: 22, right: 22, bottom: 58, left: 22 };
  const plotX = pX + PAD.left, plotY = pY + PAD.top;
  const plotW = pW - PAD.left - PAD.right, plotH = pH - PAD.top - PAD.bottom;

  for (let i = 0; i <= 4; i++) {
    const y = plotY + (plotH / 4) * i;
    ctx.strokeStyle = RGBA.gridLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.stroke();
  }

  entries.forEach(([, stock], idx) => {
    const hist = stock.history.slice(-100);
    const sMin = Math.min(...hist), sMax = Math.max(...hist), sRange = sMax - sMin || 1;
    const col = SERIES[idx % SERIES.length];
    const pts = hist.map((v, i) => ({ x: plotX + (i / (hist.length - 1)) * plotW, y: plotY + ((sMax - v) / sRange) * plotH }));
    withShadow(ctx, { color: hexToRgba(col, 0.4), blur: 7, y: 1 }, () => {
      ctx.beginPath(); traceSmooth(ctx, pts);
      ctx.strokeStyle = col; ctx.lineWidth = 2.25; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    });
  });

  // Legend pills along the bottom (opaque so lines don't bleed through; stops
  // before overflowing the panel rather than wrapping onto itself).
  legendRow(ctx, entries.map(([ticker, stock], idx) => ({
    text: `${ticker}  ${signPct(stock.change ?? 0)}`, col: SERIES[idx % SERIES.length],
  })), plotX, pY + pH - 34, plotX + plotW);

  return canvas.toBuffer('image/png');
}

// Lay a single row of opaque, colored legend pills left→right, stopping before
// `maxRight`. Shared by the overview and comparison charts.
function legendRow(ctx, items, x, y, maxRight) {
  let lx = x;
  for (const { text, col } of items) {
    setFont(ctx, 13, { weight: 'bold' });
    const est = Math.ceil(ctx.measureText(text).width) + 24;
    if (lx + est > maxRight) break;
    lx += pill(ctx, lx, y, text, { bg: '#141830', fg: col, size: 13, h: 24, stroke: hexToRgba(col, 0.5) }) + 10;
  }
}

// ── Sector heatmap: horizontal diverging bars sorted by avg % change ──────────
export function drawSectorHeatmap(stocks) {
  const sectorMap = {};
  for (const [, s] of Object.entries(stocks)) {
    if (!s.sector) continue;
    (sectorMap[s.sector] ??= { total: 0, count: 0 });
    sectorMap[s.sector].total += s.change ?? 0;
    sectorMap[s.sector].count++;
  }
  const sorted = Object.entries(sectorMap)
    .map(([name, { total, count }]) => ({ name, pct: count ? total / count : 0 }))
    .sort((a, b) => b.pct - a.pct);
  if (!sorted.length) return null;

  const M = 26, rowH = 30, gap = 10, top = 96;
  const W = 880;
  const H = top + sorted.length * (rowH + gap) + 18;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, W, H);
  header(ctx, { x: M, y: M, w: W - M * 2, title: 'Sector Performance', subtitle: 'Polymart · Average change by sector' });

  const pX = M, pY = 82, pW = W - M * 2, pH = H - pY - M;
  panel(ctx, pX, pY, pW, pH, { r: 16 });

  // Left names column · magnitude bar · right-aligned value column.
  const nameX = pX + 24, barX = pX + 180;
  const barMaxW = pW - (barX - pX) - 118;
  const maxPct = Math.max(0.1, ...sorted.map(s => Math.abs(s.pct)));

  sorted.forEach((sec, i) => {
    const y = pY + 16 + i * (rowH + gap);
    const pos = sec.pct >= 0;
    const col = pos ? HEX.green : HEX.red;

    ctx.textBaseline = 'middle';
    ctx.fillStyle = HEX.text; setFont(ctx, 14.5); ctx.textAlign = 'left';
    ctx.fillText(clip(ctx, cap(sec.name), barX - nameX - 14), nameX, y + rowH / 2);

    // Track + magnitude bar (length ∝ |change|, color = direction).
    ctx.fillStyle = hexToRgba(HEX.white, 0.04);
    roundRectPath(ctx, barX, y, barMaxW, rowH, 8); ctx.fill();
    const bw = Math.max(4, Math.round((Math.abs(sec.pct) / maxPct) * barMaxW));
    ctx.fillStyle = vGradient(ctx, y, 0, rowH, [[0, hexToRgba(col, 0.95)], [1, hexToRgba(col, 0.68)]]);
    roundRectPath(ctx, barX, y, bw, rowH, 8); ctx.fill();

    ctx.fillStyle = col; setFont(ctx, 14, { weight: 'bold', mono: true }); ctx.textAlign = 'right';
    ctx.fillText(signPct(sec.pct), pX + pW - 22, y + rowH / 2);
    ctx.textBaseline = 'alphabetic';
  });

  return canvas.toBuffer('image/png');
}

// ── Portfolio allocation donut ────────────────────────────────────────────────
export function drawPortfolioDonut(slices, { title = 'Portfolio Allocation' } = {}) {
  const data = (slices || []).filter(s => s.value > 0).sort((a, b) => b.value - a.value);
  if (!data.length) return null;

  const total = data.reduce((s, d) => s + d.value, 0);
  const top = data.slice(0, 7);
  const rest = data.slice(7).reduce((s, d) => s + d.value, 0);
  if (rest > 0) top.push({ label: 'Other', value: rest });

  const W = 880, H = 440, M = 26;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, W, H);
  header(ctx, { x: M, y: M, w: W - M * 2, title, subtitle: 'Polymart · Allocation breakdown' });

  const pX = M, pY = 92, pW = W - M * 2, pH = H - pY - M;
  panel(ctx, pX, pY, pW, pH, { r: 16 });

  const cx = pX + pH / 2 + 6, cy = pY + pH / 2, rOuter = pH / 2 - 34, rInner = rOuter * 0.62;
  let start = -Math.PI / 2;
  top.forEach((d, i) => {
    const angle = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rOuter, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = SERIES[i % SERIES.length];
    ctx.fill();
    // thin gap between slices, in panel color
    ctx.strokeStyle = HEX.surface; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(start) * rOuter, cy + Math.sin(start) * rOuter); ctx.stroke();
    start += angle;
  });

  // Donut hole + centered total
  ctx.beginPath(); ctx.arc(cx, cy, rInner, 0, Math.PI * 2); ctx.fillStyle = HEX.surface; ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = HEX.textFaint; setFont(ctx, 12.5, { weight: 'bold' }); ctx.fillText('TOTAL', cx, cy - 8);
  ctx.fillStyle = HEX.text; setFont(ctx, 22, { weight: 'bold', mono: true });
  ctx.fillText(`$${Math.round(total).toLocaleString()}`, cx, cy + 18);
  ctx.textAlign = 'left';

  // Legend on the right
  const lx = cx + rOuter + 40;
  const legendTop = pY + 30;
  const step = Math.min(34, (pH - 60) / top.length);
  ctx.textBaseline = 'middle';
  top.forEach((d, i) => {
    const y = legendTop + i * step + step / 2;
    ctx.fillStyle = SERIES[i % SERIES.length];
    roundRectPath(ctx, lx, y - 7, 14, 14, 4); ctx.fill();
    ctx.fillStyle = HEX.text; setFont(ctx, 14.5); ctx.textAlign = 'left';
    ctx.fillText(clip(ctx, d.label, 150), lx + 24, y);
    ctx.fillStyle = HEX.textMuted; setFont(ctx, 13.5, { mono: true }); ctx.textAlign = 'right';
    ctx.fillText(`${(d.value / total * 100).toFixed(1)}%`, pX + pW - 22, y);
  });
  ctx.textBaseline = 'alphabetic';

  return canvas.toBuffer('image/png');
}

// ── Leaderboard card ──────────────────────────────────────────────────────────
// rows: [{ name, value (display string), barValue (number for bar length) }]
export function drawLeaderboardCard(rows, { title = 'Server Leaderboard' } = {}) {
  if (!rows?.length) return null;

  const M = 26, rowH = 46, top = 92;
  const W = 880;
  const H = top + rows.length * rowH + 20;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, W, H, { glow: HEX.gold });
  header(ctx, { x: M, y: M, w: W - M * 2, title, subtitle: 'Polymart · Season standings' });

  const pX = M, pY = 80, pW = W - M * 2, pH = H - pY - M;
  panel(ctx, pX, pY, pW, pH, { r: 16 });

  const maxVal = Math.max(...rows.map(r => Math.abs(r.barValue ?? 0)), 1);
  const nameX = pX + 74, barX = pX + 250, barMaxW = pW - (barX - pX) - 150;
  const medals = ['#f5a623', '#c8ccd8', '#cd7f32'];

  rows.forEach((r, i) => {
    const y = pY + 12 + i * rowH;
    if (i % 2 === 1) { ctx.fillStyle = hexToRgba(HEX.white, 0.02); roundRectPath(ctx, pX + 8, y - 2, pW - 16, rowH - 6, 8); ctx.fill(); }

    // Rank chip
    ctx.textBaseline = 'middle';
    if (i < 3) {
      ctx.fillStyle = hexToRgba(medals[i], 0.16);
      roundRectPath(ctx, pX + 16, y + rowH / 2 - 15, 40, 30, 9); ctx.fill();
      ctx.strokeStyle = hexToRgba(medals[i], 0.5); ctx.lineWidth = 1;
      roundRectPath(ctx, pX + 16.5, y + rowH / 2 - 14.5, 39, 29, 9); ctx.stroke();
      ctx.fillStyle = medals[i]; setFont(ctx, 16, { weight: 'bold', mono: true }); ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), pX + 36, y + rowH / 2 + 1);
    } else {
      ctx.fillStyle = HEX.textFaint; setFont(ctx, 14, { weight: 'bold', mono: true }); ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), pX + 36, y + rowH / 2 + 1);
    }

    ctx.fillStyle = i < 3 ? HEX.text : HEX.textMuted; setFont(ctx, 15.5, { weight: i < 3 ? 'bold' : 'normal' }); ctx.textAlign = 'left';
    ctx.fillText(clip(ctx, String(r.name), barX - nameX - 12), nameX, y + rowH / 2 + 1);

    // Value bar
    const bw = Math.max(6, Math.round((Math.abs(r.barValue ?? 0) / maxVal) * barMaxW));
    const col = (r.barValue ?? 0) >= 0 ? HEX.green : HEX.red;
    ctx.fillStyle = hexToRgba(HEX.white, 0.05); roundRectPath(ctx, barX, y + rowH / 2 - 6, barMaxW, 12, 6); ctx.fill();
    ctx.fillStyle = vGradient(ctx, y, 0, rowH, [[0, hexToRgba(col, 0.95)], [1, hexToRgba(col, 0.65)]]);
    roundRectPath(ctx, barX, y + rowH / 2 - 6, bw, 12, 6); ctx.fill();

    ctx.fillStyle = HEX.text; setFont(ctx, 14.5, { weight: 'bold', mono: true }); ctx.textAlign = 'right';
    ctx.fillText(r.value, pX + pW - 22, y + rowH / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  });

  return canvas.toBuffer('image/png');
}

// ── Comparison chart: 2+ assets normalized and overlaid ──────────────────────
export function drawCompareChart(assets) {
  if (!assets?.length) return null;

  const W = 880, H = 430, M = 26;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, W, H);
  header(ctx, { x: M, y: M, w: W - M * 2, title: assets.map(a => a.ticker).join('  vs  '), subtitle: 'Polymart · Normalized comparison' });

  const pX = M, pY = 92, pW = W - M * 2, pH = H - pY - M;
  panel(ctx, pX, pY, pW, pH, { r: 16 });
  const PAD = { top: 22, right: 22, bottom: 56, left: 22 };
  const plotX = pX + PAD.left, plotY = pY + PAD.top;
  const plotW = pW - PAD.left - PAD.right, plotH = pH - PAD.top - PAD.bottom;

  for (let i = 0; i <= 4; i++) {
    const y = plotY + (plotH / 4) * i;
    ctx.strokeStyle = RGBA.gridLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.stroke();
  }

  assets.forEach((asset, idx) => {
    const hist = asset.history;
    if (!hist || hist.length < 2) return;
    const sMin = Math.min(...hist), sMax = Math.max(...hist), sRange = sMax - sMin || 1;
    const col = SERIES[idx % SERIES.length];
    const pts = hist.map((v, i) => ({ x: plotX + (i / (hist.length - 1)) * plotW, y: plotY + ((sMax - v) / sRange) * plotH }));
    withShadow(ctx, { color: hexToRgba(col, 0.45), blur: 8, y: 1 }, () => {
      ctx.beginPath(); traceSmooth(ctx, pts);
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    });
  });

  legendRow(ctx, assets.map((asset, idx) => ({
    text: `${asset.ticker}  ${signPct(asset.change ?? 0)}`, col: SERIES[idx % SERIES.length],
  })), plotX, pY + pH - 32, plotX + plotW);

  return canvas.toBuffer('image/png');
}

import { createCanvas } from '@napi-rs/canvas';

const COLORS = {
  bg:        '#1a1a2e',
  gridLine:  '#2a2a4a',
  text:      '#a0a0c0',
  textBright:'#e0e0ff',
  green:     '#2ecc71',
  red:       '#e74c3c',
  greenFill: 'rgba(46, 204, 113, 0.15)',
  redFill:   'rgba(231, 76, 60, 0.15)',
};

const MULTI_COLORS = ['#2ecc71','#e74c3c','#3498db','#f1c40f','#9b59b6','#e67e22','#1abc9c','#e91e63'];

const W = 800, H = 400;
const PAD = { top: 50, right: 80, bottom: 40, left: 20 };

// ── Single price chart ────────────────────────────────────────────────────────
export function drawPriceChart({ history, label, currentPrice, changePct }) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  const prices = history.length > 0 ? history : [currentPrice];
  const minP   = Math.min(...prices) * 0.995;
  const maxP   = Math.max(...prices) * 1.005;
  const range  = maxP - minP || 1;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top  - PAD.bottom;

  const isUp    = prices[prices.length - 1] >= prices[0];
  const lineCol = isUp ? COLORS.green : COLORS.red;
  const fillCol = isUp ? COLORS.greenFill : COLORS.redFill;

  // Split "TICKER — Name" label into components
  const parts  = (label || '').split(' — ');
  const ticker = parts[0] || label;
  const name   = parts[1] || '';

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // Horizontal grid lines + right-side price labels
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y     = PAD.top + (innerH / 5) * i;
    const price = maxP - (i / 5) * range;

    ctx.strokeStyle = COLORS.gridLine;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(W - PAD.right, y);
    ctx.stroke();

    ctx.fillStyle = COLORS.text;
    ctx.font      = '13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(
      `\u{1FA99} ${price < 1 ? price.toFixed(5) : price < 100 ? price.toFixed(3) : price.toFixed(2)}`,
      W - PAD.right + 8, y + 4
    );
  }

  const px = i   => PAD.left + (i / (prices.length - 1 || 1)) * innerW;
  const py = val => PAD.top  + ((maxP - val) / range) * innerH;
  const points = prices.map((v, i) => ({ x: px(i), y: py(v) }));

  // Area fill
  ctx.beginPath();
  ctx.moveTo(points[0].x, PAD.top + innerH);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, PAD.top + innerH);
  ctx.closePath();
  ctx.fillStyle = fillCol;
  ctx.fill();

  // Price line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = lineCol;
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  // Current price dot
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
  ctx.fillStyle   = lineCol;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Current price label box (sits in right padding)
  const priceStr = currentPrice < 1 ? currentPrice.toFixed(5) : currentPrice < 100 ? currentPrice.toFixed(3) : currentPrice.toFixed(2);
  ctx.fillStyle = lineCol;
  ctx.fillRect(last.x + 8, last.y - 12, 75, 24);
  ctx.fillStyle = '#ffffff';
  ctx.font      = 'bold 13px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(priceStr, last.x + 14, last.y + 4);

  // Title: ticker (bold bright) + name (muted)
  ctx.fillStyle = COLORS.textBright;
  ctx.font      = 'bold 20px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(ticker, PAD.left + 5, 32);

  if (name) {
    const tickerW = ctx.measureText(ticker).width;
    ctx.fillStyle = COLORS.text;
    ctx.font      = '14px monospace';
    ctx.fillText(name, PAD.left + 5 + tickerW + 10, 32);
  }

  // Change badge (top right, inside chart area)
  const badge = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;
  ctx.fillStyle = lineCol;
  ctx.font      = 'bold 16px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(badge, W - PAD.right, 32);

  return canvas.toBuffer('image/png');
}

// ── Market overview: top N stocks normalized on one chart ─────────────────────
export function drawMarketOverview(stocks, topN = 8) {
  const entries = Object.entries(stocks)
    .filter(([, s]) => Array.isArray(s.history) && s.history.length > 2)
    .sort((a, b) => (b[1].volume ?? 0) - (a[1].volume ?? 0))
    .slice(0, topN);

  if (entries.length === 0) return null;

  const OW = 800, OH = 450;
  const OPAD = { top: 50, right: 20, bottom: 50, left: 20 };
  const innerW = OW - OPAD.left - OPAD.right;
  const innerH = OH - OPAD.top  - OPAD.bottom;

  const canvas = createCanvas(OW, OH);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, OW, OH);

  ctx.fillStyle = COLORS.textBright;
  ctx.font      = 'bold 20px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('📊 Market Overview', OPAD.left + 5, 32);

  // Horizontal grid
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 4; i++) {
    const y = OPAD.top + (innerH / 4) * i;
    ctx.beginPath(); ctx.moveTo(OPAD.left, y); ctx.lineTo(OW - OPAD.right, y); ctx.stroke();
  }

  // One line per stock, normalized to its own price range
  entries.forEach(([, stock], idx) => {
    const hist   = stock.history.slice(-100);
    const sMin   = Math.min(...hist);
    const sMax   = Math.max(...hist);
    const sRange = sMax - sMin || 1;

    ctx.beginPath();
    hist.forEach((v, i) => {
      const x = OPAD.left + (i / (hist.length - 1)) * innerW;
      const y = OPAD.top  + ((sMax - v) / sRange) * innerH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = MULTI_COLORS[idx % MULTI_COLORS.length];
    ctx.lineWidth   = 2;
    ctx.stroke();
  });

  // Legend at bottom
  const legendY = OH - 18;
  let legendX   = OPAD.left + 5;
  ctx.font      = '12px monospace';
  entries.forEach(([ticker, stock], idx) => {
    const col    = MULTI_COLORS[idx % MULTI_COLORS.length];
    const change = stock.change ?? 0;
    const label  = `${ticker} ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    ctx.fillStyle = col;
    ctx.fillRect(legendX, legendY - 8, 10, 10);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.fillText(label, legendX + 14, legendY);
    legendX += label.length * 7.5 + 18;
  });

  return canvas.toBuffer('image/png');
}

// ── Sector heatmap: horizontal bar chart sorted by avg % change ───────────────
export function drawSectorHeatmap(stocks) {
  const sectorMap = {};
  for (const [, s] of Object.entries(stocks)) {
    const sec = s.sector;
    if (!sec) continue;
    if (!sectorMap[sec]) sectorMap[sec] = { total: 0, count: 0 };
    sectorMap[sec].total += s.change ?? 0;
    sectorMap[sec].count++;
  }

  const sorted = Object.entries(sectorMap)
    .map(([name, { total, count }]) => ({ name, pct: count > 0 ? total / count : 0 }))
    .sort((a, b) => b.pct - a.pct);

  if (sorted.length === 0) return null;

  const barH    = 26;
  const gap     = 6;
  const barAreaTop = 50;
  const HW = 800;
  const HH = barAreaTop + sorted.length * (barH + gap) + 20;

  const canvas = createCanvas(HW, HH);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, HW, HH);

  ctx.fillStyle = COLORS.textBright;
  ctx.font      = 'bold 20px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('📊 Sector Performance', 20, 32);

  const centerX = 420;
  const maxBarW = 330;
  const maxPct  = Math.max(0.1, ...sorted.map(s => Math.abs(s.pct)));

  sorted.forEach((sec, i) => {
    const y   = barAreaTop + i * (barH + gap);
    const bw  = Math.round((Math.abs(sec.pct) / maxPct) * maxBarW);
    const col = sec.pct >= 0 ? COLORS.green : COLORS.red;
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

    ctx.fillStyle = COLORS.text;
    ctx.font      = '13px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(cap(sec.name), centerX - 15, y + barH / 2 + 4);

    ctx.fillStyle = col;
    if (sec.pct >= 0) ctx.fillRect(centerX, y, bw, barH);
    else               ctx.fillRect(centerX - bw, y, bw, barH);

    ctx.fillStyle = COLORS.textBright;
    ctx.font      = 'bold 12px monospace';
    ctx.textAlign = sec.pct >= 0 ? 'left' : 'right';
    ctx.fillText(
      `${sec.pct >= 0 ? '+' : ''}${sec.pct.toFixed(2)}%`,
      sec.pct >= 0 ? centerX + bw + 8 : centerX - bw - 8,
      y + barH / 2 + 4
    );
  });

  // Center divider
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(centerX, barAreaTop - 5);
  ctx.lineTo(centerX, barAreaTop + sorted.length * (barH + gap));
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

// ── Portfolio allocation donut ────────────────────────────────────────────────
// slices: [{ label, value }]. Top 8 shown; the remainder is grouped into "Other".
export function drawPortfolioDonut(slices, { title = 'Portfolio Allocation' } = {}) {
  const data = (slices || []).filter(s => s.value > 0).sort((a, b) => b.value - a.value);
  if (!data.length) return null;

  const total = data.reduce((s, d) => s + d.value, 0);
  const top   = data.slice(0, 8);
  const rest  = data.slice(8).reduce((s, d) => s + d.value, 0);
  if (rest > 0) top.push({ label: 'Other', value: rest });

  const W = 800, H = 420;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = COLORS.textBright; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`🥧 ${title}`, 24, 34);

  const cx = 210, cy = 235, rOuter = 150, rInner = 88;
  let start = -Math.PI / 2;
  top.forEach((d, i) => {
    const angle = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rOuter, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = MULTI_COLORS[i % MULTI_COLORS.length];
    ctx.fill();
    start += angle;
  });

  // Punch the donut hole and label the total in the centre.
  ctx.beginPath(); ctx.arc(cx, cy, rInner, 0, Math.PI * 2); ctx.fillStyle = COLORS.bg; ctx.fill();
  ctx.fillStyle = COLORS.text;       ctx.textAlign = 'center'; ctx.font = '14px monospace';
  ctx.fillText('Total', cx, cy - 6);
  ctx.fillStyle = COLORS.textBright; ctx.font = 'bold 17px monospace';
  ctx.fillText(`$${Math.round(total).toLocaleString()}`, cx, cy + 16);

  // Legend.
  let ly = 120; const lx = 440;
  ctx.font = '14px monospace';
  top.forEach((d, i) => {
    const pct = (d.value / total * 100).toFixed(1);
    ctx.fillStyle = MULTI_COLORS[i % MULTI_COLORS.length];
    ctx.fillRect(lx, ly - 12, 14, 14);
    ctx.fillStyle = COLORS.textBright; ctx.textAlign = 'left';
    ctx.fillText(d.label.slice(0, 14), lx + 22, ly);
    ctx.fillStyle = COLORS.text; ctx.textAlign = 'right';
    ctx.fillText(`${pct}%  $${Math.round(d.value).toLocaleString()}`, W - 24, ly);
    ly += 30;
  });

  return canvas.toBuffer('image/png');
}

// ── Leaderboard card ──────────────────────────────────────────────────────────
// rows: [{ name, value (display string), barValue (number for bar length) }]
export function drawLeaderboardCard(rows, { title = 'Server Leaderboard' } = {}) {
  if (!rows?.length) return null;

  const rowH = 44, topPad = 64, W = 800;
  const H = topPad + rows.length * rowH + 16;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = COLORS.textBright; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`🏆 ${title}`, 24, 40);

  const maxVal  = Math.max(...rows.map(r => Math.abs(r.barValue ?? 0)), 1);
  const barX    = 300, barMaxW = 380;

  rows.forEach((r, i) => {
    const y     = topPad + i * rowH;
    const medal = ['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`;

    ctx.fillStyle = i < 3 ? COLORS.textBright : COLORS.text;
    ctx.font = 'bold 16px monospace'; ctx.textAlign = 'left';
    ctx.fillText(medal, 24, y + 22);
    ctx.fillText(String(r.name).slice(0, 18), 74, y + 22);

    const bw = Math.max(4, Math.round((Math.abs(r.barValue ?? 0) / maxVal) * barMaxW));
    ctx.fillStyle = (r.barValue ?? 0) >= 0 ? COLORS.green : COLORS.red;
    ctx.fillRect(barX, y + 8, bw, 20);

    ctx.fillStyle = COLORS.textBright; ctx.textAlign = 'right'; ctx.font = '14px monospace';
    ctx.fillText(r.value, W - 24, y + 23);
  });

  return canvas.toBuffer('image/png');
}

// ── Comparison chart: 2+ assets normalized and overlaid ──────────────────────
export function drawCompareChart(assets) {
  if (!assets || assets.length === 0) return null;

  const CW = 800, CH = 400;
  const CPAD = { top: 50, right: 20, bottom: 50, left: 20 };
  const innerW = CW - CPAD.left - CPAD.right;
  const innerH = CH - CPAD.top  - CPAD.bottom;

  const canvas = createCanvas(CW, CH);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CW, CH);

  // Horizontal grid
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 4; i++) {
    const y = CPAD.top + (innerH / 4) * i;
    ctx.beginPath(); ctx.moveTo(CPAD.left, y); ctx.lineTo(CW - CPAD.right, y); ctx.stroke();
  }

  // Title
  ctx.fillStyle = COLORS.textBright;
  ctx.font      = 'bold 18px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(assets.map(a => a.ticker).join(' vs '), CPAD.left + 5, 32);

  // One line per asset, each normalized independently
  assets.forEach((asset, idx) => {
    const hist = asset.history;
    if (!hist || hist.length < 2) return;
    const sMin   = Math.min(...hist);
    const sMax   = Math.max(...hist);
    const sRange = sMax - sMin || 1;
    const col    = MULTI_COLORS[idx % MULTI_COLORS.length];

    ctx.beginPath();
    hist.forEach((v, i) => {
      const x = CPAD.left + (i / (hist.length - 1)) * innerW;
      const y = CPAD.top  + ((sMax - v) / sRange) * innerH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = col;
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();
  });

  // Legend at bottom
  const legendY = CH - 18;
  let legendX   = CPAD.left + 5;
  ctx.font      = '12px monospace';
  assets.forEach((asset, idx) => {
    const col    = MULTI_COLORS[idx % MULTI_COLORS.length];
    const change = asset.change ?? 0;
    const label  = `${asset.ticker} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`;
    ctx.fillStyle = col;
    ctx.fillRect(legendX, legendY - 8, 10, 10);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.fillText(label, legendX + 14, legendY);
    legendX += label.length * 7.5 + 18;
  });

  return canvas.toBuffer('image/png');
}

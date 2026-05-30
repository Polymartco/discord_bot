import { createCanvas } from '@napi-rs/canvas';

const W = 800, H = 400;
const PAD = { top: 40, right: 30, bottom: 50, left: 70 };

export function drawPriceChart({ history, label, currentPrice, changePct, color = '#6366f1' }) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  const prices = history.length > 0 ? history : [currentPrice];
  const minP   = Math.min(...prices) * 0.999;
  const maxP   = Math.max(...prices) * 1.001;
  const range  = maxP - minP || 1;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top  - PAD.bottom;

  const px = i   => PAD.left  + (i / (prices.length - 1 || 1)) * innerW;
  const py = val => PAD.top   + (1 - (val - minP) / range) * innerH;

  ctx.fillStyle = '#0f0f1a';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#1e1e3a';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = PAD.top + (i / 5) * innerH;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
  }
  for (let i = 0; i <= 6; i++) {
    const x = PAD.left + (i / 6) * innerW;
    ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, H - PAD.bottom); ctx.stroke();
  }

  const lineColor = changePct >= 0 ? '#22c55e' : '#ef4444';

  const grad = ctx.createLinearGradient(0, PAD.top, 0, H - PAD.bottom);
  grad.addColorStop(0, lineColor + '55');
  grad.addColorStop(1, lineColor + '00');

  ctx.beginPath();
  prices.forEach((p, i) => i === 0 ? ctx.moveTo(px(i), py(p)) : ctx.lineTo(px(i), py(p)));
  ctx.lineTo(px(prices.length - 1), H - PAD.bottom);
  ctx.lineTo(PAD.left, H - PAD.bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  prices.forEach((p, i) => i === 0 ? ctx.moveTo(px(i), py(p)) : ctx.lineTo(px(i), py(p)));
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const curY = py(currentPrice);
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = lineColor + 'aa';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD.left, curY); ctx.lineTo(W - PAD.right, curY); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '13px monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const val = minP + (1 - i / 5) * range;
    const y   = PAD.top + (i / 5) * innerH;
    ctx.fillText(val < 1 ? val.toFixed(5) : val < 100 ? val.toFixed(3) : val.toFixed(2), PAD.left - 8, y + 4);
  }

  ctx.textAlign = 'left';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#f9fafb';
  ctx.fillText(label, PAD.left, 26);

  const changeStr = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;
  ctx.font = 'bold 16px monospace';
  ctx.fillStyle = lineColor;
  ctx.fillText(changeStr, PAD.left + ctx.measureText(label).width + 12, 26);

  ctx.textAlign = 'right';
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#f9fafb';
  ctx.fillText(
    currentPrice < 1 ? currentPrice.toFixed(5) : currentPrice < 100 ? currentPrice.toFixed(3) : currentPrice.toFixed(2),
    W - PAD.right, 26
  );

  ctx.textAlign = 'center';
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText(`Last ${prices.length} ticks`, W / 2, H - 12);

  return canvas.toBuffer('image/png');
}

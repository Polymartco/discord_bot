import { EmbedBuilder, AttachmentBuilder } from 'discord.js';

// Embed accent colors — match chart palette
export const GREEN = 0x2ecc71;
export const RED   = 0xe74c3c;
export const BLUE  = 0x5865f2;
export const GOLD  = 0xf59e0b;

export const sign     = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
export const cash     = n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const priceFmt = (n, decimals = 4) => n < 1 ? n.toFixed(5) : n < 100 ? n.toFixed(decimals) : n.toFixed(2);
export const colorOf  = n => n >= 0 ? GREEN : RED;

// canvas is optional — all chart helpers return null when not installed
let _drawPriceChart    = null;
let _drawMarketOverview = null;
let _drawSectorHeatmap  = null;
let _drawCompareChart   = null;
try {
  const mod = await import('./chart.js');
  _drawPriceChart     = mod.drawPriceChart;
  _drawMarketOverview = mod.drawMarketOverview;
  _drawSectorHeatmap  = mod.drawSectorHeatmap;
  _drawCompareChart   = mod.drawCompareChart;
} catch {}

// ── Single price chart ────────────────────────────────────────────────────────
export function chartAttachment(history, label, currentPrice, changePct) {
  if (!_drawPriceChart) return null;
  try {
    const buf = _drawPriceChart({ history, label, currentPrice, changePct });
    return new AttachmentBuilder(buf, { name: 'chart.png' });
  } catch { return null; }
}

// ── Market overview (multi-line) ──────────────────────────────────────────────
export function marketOverviewBuffer(stocks) {
  if (!_drawMarketOverview) return null;
  try { return _drawMarketOverview(stocks); } catch { return null; }
}

export function marketOverviewAttachment(stocks) {
  const buf = marketOverviewBuffer(stocks);
  return buf ? new AttachmentBuilder(buf, { name: 'overview.png' }) : null;
}

// ── Sector heatmap ────────────────────────────────────────────────────────────
export function sectorHeatmapBuffer(stocks) {
  if (!_drawSectorHeatmap) return null;
  try { return _drawSectorHeatmap(stocks); } catch { return null; }
}

export function sectorHeatmapAttachment(stocks) {
  const buf = sectorHeatmapBuffer(stocks);
  return buf ? new AttachmentBuilder(buf, { name: 'heatmap.png' }) : null;
}

// ── Comparison chart ──────────────────────────────────────────────────────────
export function compareChartAttachment(assets) {
  if (!_drawCompareChart) return null;
  try {
    const buf = _drawCompareChart(assets);
    return buf ? new AttachmentBuilder(buf, { name: 'compare.png' }) : null;
  } catch { return null; }
}

// ── Embed helpers ─────────────────────────────────────────────────────────────
export function errorEmbed(message) {
  return new EmbedBuilder().setColor(RED).setDescription(`❌ ${message}`);
}

export function successEmbed(message) {
  return new EmbedBuilder().setColor(GREEN).setDescription(`✅ ${message}`);
}

export function requireSetup(config, interaction) {
  if (!config.setup_by) {
    interaction.reply({ embeds: [errorEmbed('This server has not been set up yet. An admin must run `/setup` first.')], ephemeral: true });
    return false;
  }
  return true;
}

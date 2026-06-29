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

/** Compact money for large figures: $1.2M / $3.4K. Falls back to cash() under $1k. */
export function compact(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${n < 0 ? '-' : ''}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${n < 0 ? '-' : ''}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${n < 0 ? '-' : ''}$${(abs / 1e3).toFixed(1)}K`;
  return cash(n);
}

// canvas is optional — all chart helpers return null when not installed
let _drawPriceChart     = null;
let _drawMarketOverview = null;
let _drawSectorHeatmap  = null;
let _drawCompareChart   = null;
let _drawPortfolioDonut = null;
let _drawLeaderboardCard = null;
try {
  const mod = await import('./chart.js');
  _drawPriceChart      = mod.drawPriceChart;
  _drawMarketOverview  = mod.drawMarketOverview;
  _drawSectorHeatmap   = mod.drawSectorHeatmap;
  _drawCompareChart    = mod.drawCompareChart;
  _drawPortfolioDonut  = mod.drawPortfolioDonut;
  _drawLeaderboardCard = mod.drawLeaderboardCard;
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

// ── Portfolio allocation donut ────────────────────────────────────────────────
export function portfolioDonutAttachment(slices, opts) {
  if (!_drawPortfolioDonut) return null;
  try {
    const buf = _drawPortfolioDonut(slices, opts);
    return buf ? new AttachmentBuilder(buf, { name: 'allocation.png' }) : null;
  } catch { return null; }
}

// ── Leaderboard card ──────────────────────────────────────────────────────────
export function leaderboardCardAttachment(rows, opts) {
  if (!_drawLeaderboardCard) return null;
  try {
    const buf = _drawLeaderboardCard(rows, opts);
    return buf ? new AttachmentBuilder(buf, { name: 'leaderboard.png' }) : null;
  } catch { return null; }
}

// ── Embed helpers ─────────────────────────────────────────────────────────────
export function errorEmbed(message) {
  return new EmbedBuilder().setColor(RED).setDescription(`❌ ${message}`);
}

export function successEmbed(message) {
  return new EmbedBuilder().setColor(GREEN).setDescription(`✅ ${message}`);
}

/**
 * Branded embed with a consistent palette colour, timestamp, and "Polymart" footer.
 * Pass `interaction` to stamp the bot avatar into the footer icon.
 */
export function brandEmbed({ title, color = BLUE, interaction } = {}) {
  const embed = new EmbedBuilder().setColor(color).setTimestamp();
  if (title) embed.setTitle(title);
  const icon = interaction?.client?.user?.displayAvatarURL?.();
  embed.setFooter({ text: 'Polymart', ...(icon ? { iconURL: icon } : {}) });
  return embed;
}

export function requireSetup(config, interaction) {
  if (!config.setup_by) {
    interaction.reply({ embeds: [errorEmbed('This server has not been set up yet. An admin must run `/setup` first.')], ephemeral: true });
    return false;
  }
  return true;
}

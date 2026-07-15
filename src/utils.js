import { EmbedBuilder, AttachmentBuilder } from 'discord.js';

// Palette + text primitives live in the design system (theme.js). Re-exported
// here so the many `import { ... } from '../utils.js'` call-sites keep working
// and every embed shares one visual language with the rendered cards.
export { GREEN, RED, BLUE, GOLD, BRAND, SLATE, colorOf, ICON, RULE, arrow, deltaBadge, meter, sparkline } from './theme.js';
import { GREEN, RED, BLUE, GOLD, BRAND, ICON } from './theme.js';

export const sign     = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
export const cash     = n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const priceFmt = (n, decimals = 4) => n < 1 ? n.toFixed(5) : n < 100 ? n.toFixed(decimals) : n.toFixed(2);

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
const BRAND_NAME = 'Polymart';

/**
 * Stamp a timestamp + "Polymart" brand mark onto an embed, preserving any
 * footer text already set (appended as "<existing>  ·  Polymart"). Pass
 * `interaction` to use the bot avatar as the footer icon. Mutates and returns
 * the same embed so it can be used inline: `embeds: [polish(embed, interaction)]`.
 */
export function polish(embed, interaction) {
  const icon     = interaction?.client?.user?.displayAvatarURL?.();
  const existing = embed.data?.footer?.text;
  embed.setFooter({ text: existing ? `${existing}  ·  ${BRAND_NAME}` : BRAND_NAME, ...(icon ? { iconURL: icon } : {}) });
  if (!embed.data?.timestamp) embed.setTimestamp();
  return embed;
}

/**
 * Author block for a personal embed: the member's name + avatar sitting above
 * the embed body — a clean, professional "whose data is this" header. Falls back
 * to a plain name if no avatar is resolvable.
 */
export function userAuthor(interaction, name) {
  const u        = interaction?.user;
  const iconURL  = u?.displayAvatarURL?.();
  const authName = name ?? u?.username ?? BRAND_NAME;
  return iconURL ? { name: authName, iconURL } : { name: authName };
}

/**
 * A compact notice embed (error / success / info / warn). Kept intentionally
 * minimal — a colored accent bar, one icon, one line — so transient replies read
 * cleanly. `kind` selects the accent + icon.
 */
export function noticeEmbed(message, { kind = 'info', interaction, title } = {}) {
  const style = {
    error:   { color: RED,   icon: ICON.err },
    success: { color: GREEN, icon: ICON.ok },
    warn:    { color: GOLD, icon: ICON.warn },
    info:    { color: BRAND, icon: ICON.spark },
  }[kind] ?? { color: BRAND, icon: ICON.spark };

  const embed = new EmbedBuilder().setColor(style.color);
  if (title) embed.setTitle(`${style.icon}  ${title}`).setDescription(message);
  else       embed.setDescription(`${style.icon}  ${message}`);
  return polish(embed, interaction);
}

export function errorEmbed(message, interaction) {
  return noticeEmbed(message, { kind: 'error', interaction });
}

export function successEmbed(message, interaction) {
  return noticeEmbed(message, { kind: 'success', interaction });
}

/**
 * Branded embed with a consistent palette colour, timestamp, and "Polymart" footer.
 * Pass `interaction` to stamp the bot avatar into the footer icon.
 */
export function brandEmbed({ title, color = BRAND, interaction } = {}) {
  const embed = new EmbedBuilder().setColor(color);
  if (title) embed.setTitle(title);
  return polish(embed, interaction);
}

export function requireSetup(config, interaction) {
  if (!config.setup_by) {
    interaction.reply({ embeds: [errorEmbed('This server has not been set up yet. An admin must run `/setup` first.')], ephemeral: true });
    return false;
  }
  return true;
}

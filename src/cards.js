import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { api } from './api.js';
import { chartAttachment, colorOf, deltaBadge, sparkline, ICON, polish } from './utils.js';
import { buildId } from './interactionRouter.js';

// ── Shared trade button row ───────────────────────────────────────────────────
// Refresh re-renders the card (view:stock); Buy/Sell open a quantity modal.
// State (owner, ticker, type) is encoded in the customId so it survives restarts.
export function tradeButtons(ownerId, ticker, type = 'stock', { includeRefresh = true } = {}) {
  const row = new ActionRowBuilder();
  if (includeRefresh) {
    row.addComponents(new ButtonBuilder()
      .setCustomId(buildId('view', 'stock', ownerId, ticker, type))
      .setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary));
  }
  row.addComponents(
    new ButtonBuilder().setCustomId(buildId('trade', 'buy',  ownerId, ticker, type)).setLabel('Buy').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buildId('trade', 'sell', ownerId, ticker, type)).setLabel('Sell').setStyle(ButtonStyle.Danger),
  );
  return row;
}

// ── Full /stock detail card (embed + chart + buttons) ─────────────────────────
// Throws ApiError if the ticker is unknown — callers handle the user-facing message.
export async function buildStockCard(interaction, rawTicker, type = 'stock') {
  const s = await api.stock(rawTicker);
  const ticker = s.ticker ?? rawTicker;

  const price   = s.price   ?? 0;
  const change  = s.change  ?? 0;
  const rsi     = s.rsi     != null ? s.rsi.toFixed(1) : '—';
  const volume  = s.volume  != null ? s.volume.toLocaleString() : '—';
  const sector  = s.sector  ?? '—';
  const streak  = s.streak  != null ? `${s.streak > 0 ? '↑' : '↓'} ${Math.abs(s.streak)} ticks` : '—';
  const high52w = s.high52w != null ? `$${s.high52w.toFixed(2)}` : '—';
  const low52w  = s.low52w  != null ? `$${s.low52w.toFixed(2)}`  : '—';
  const ath     = s.allTimeHigh != null ? `$${s.allTimeHigh.toFixed(2)}` : '—';
  const bidAsk  = (s.bid != null && s.ask != null) ? `$${s.bid.toFixed(2)} / $${s.ask.toFixed(2)}` : '—';
  const macd    = s.macd    != null ? s.macd.toFixed(4) : '—';
  const bbBw    = s.bbBw    != null ? s.bbBw.toFixed(4) : '—';
  const vwap    = s.vwap    != null ? s.vwap.toFixed(2) : '—';
  const beta    = s.beta    != null ? s.beta.toFixed(2) : '—';
  const atr     = s.atr     != null ? s.atr.toFixed(2)  : '—';
  const label   = `${ticker} — ${s.name ?? ticker}`;

  const history = Array.isArray(s.history) ? s.history : [];
  const dir     = change > 0 ? ICON.up : change < 0 ? ICON.down : '▬';
  const spark   = sparkline(history);

  // Second line under the price headline: sector chip + a mini sparkline (either
  // may be absent). Kept on its own line so it never inflates the ## heading.
  const hasSector = sector !== '—';
  const subline   = [hasSector ? `\`${sector}\`` : null, spark || null].filter(Boolean).join('  ');

  const att   = chartAttachment(history, label, price, change);
  const embed = new EmbedBuilder()
    .setTitle(`${dir}  ${label}`)
    .setColor(colorOf(change))
    .setDescription(`## $${price.toFixed(2)}  ${deltaBadge(change)}` + (subline ? `\n${subline}` : ''))
    .addFields(
      { name: 'RSI',           value: rsi,     inline: true },
      { name: 'Volume',        value: volume,  inline: true },
      { name: 'Streak',        value: streak,  inline: true },
      { name: '52W High',      value: high52w, inline: true },
      { name: '52W Low',       value: low52w,  inline: true },
      { name: 'All-Time High', value: ath,     inline: true },
      { name: 'Bid / Ask',     value: bidAsk,  inline: true },
      { name: 'MACD',          value: macd,    inline: true },
      { name: 'BB Width',      value: bbBw,    inline: true },
    )
    .setFooter({ text: `VWAP $${vwap}  ·  Beta ${beta}  ·  ATR ${atr}` });

  if (att) embed.setImage('attachment://chart.png');
  polish(embed, interaction);

  return {
    embeds:     [embed],
    files:      att ? [att] : [],
    components: [tradeButtons(interaction.user.id, ticker, type)],
  };
}

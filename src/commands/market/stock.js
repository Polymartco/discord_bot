import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { chartAttachment, sign, colorOf, errorEmbed } from '../../utils.js';
import { validateTickerFormat, ValidationError } from '../../validate.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stock')
    .setDescription('Get detailed stock info with price chart')
    .addStringOption(o => o.setName('ticker').setDescription('Stock ticker e.g. APEX').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();

    let ticker;
    try {
      ticker = validateTickerFormat(interaction.options.getString('ticker'));
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    let s, hist;
    try {
      [s, hist] = await Promise.all([
        api.stock(ticker),
        api.history(ticker, 80),
      ]);
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(`**${ticker}** not found. Check the ticker and try again.`)] });
      throw err;
    }

    // Null-safe field access — API may return partial data
    const price    = s.price    ?? 0;
    const change   = s.change   ?? 0;
    const rsi      = s.rsi      != null ? s.rsi.toFixed(1) : '—';
    const volume   = s.volume   != null ? s.volume.toLocaleString() : '—';
    const sector   = s.sector   ?? '—';
    const streak   = s.streak   != null ? `${s.streak > 0 ? '↑' : '↓'} ${Math.abs(s.streak)} ticks` : '—';
    const high52w  = s.high52w  != null ? `$${s.high52w.toFixed(2)}` : '—';
    const low52w   = s.low52w   != null ? `$${s.low52w.toFixed(2)}`  : '—';
    const ath      = s.allTimeHigh != null ? `$${s.allTimeHigh.toFixed(2)}` : '—';
    const bidAsk   = (s.bid != null && s.ask != null) ? `$${s.bid.toFixed(2)} / $${s.ask.toFixed(2)}` : '—';
    const macd     = s.macd     != null ? s.macd.toFixed(4) : '—';
    const bbBw     = s.bbBw     != null ? s.bbBw.toFixed(4) : '—';
    const vwap     = s.vwap     != null ? s.vwap.toFixed(2) : '—';
    const beta     = s.beta     != null ? s.beta.toFixed(2) : '—';
    const atr      = s.atr      != null ? s.atr.toFixed(2)  : '—';
    const label    = `${s.ticker ?? ticker} — ${s.name ?? ticker}`;

    const att = chartAttachment(hist?.history ?? [], label, price, change);

    const embed = new EmbedBuilder()
      .setTitle(label)
      .setColor(colorOf(change))
      .addFields(
        { name: 'Price',     value: `$${price.toFixed(2)}`, inline: true },
        { name: 'Change',    value: sign(change),           inline: true },
        { name: 'RSI',       value: rsi,                    inline: true },
        { name: 'Volume',    value: volume,                 inline: true },
        { name: 'Sector',    value: sector,                 inline: true },
        { name: 'Streak',    value: streak,                 inline: true },
        { name: '52w Hi',    value: high52w,                inline: true },
        { name: '52w Lo',    value: low52w,                 inline: true },
        { name: 'ATH',       value: ath,                    inline: true },
        { name: 'Bid / Ask', value: bidAsk,                 inline: true },
        { name: 'MACD',      value: macd,                   inline: true },
        { name: 'BB Width',  value: bbBw,                   inline: true },
      )
      .setFooter({ text: `VWAP $${vwap} • Beta ${beta} • ATR ${atr}` });

    if (att) embed.setImage('attachment://chart.png');
    await interaction.editReply({ embeds: [embed], ...(att ? { files: [att] } : {}) });
  },
};

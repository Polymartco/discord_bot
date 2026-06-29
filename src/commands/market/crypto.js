import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { chartAttachment, sign, colorOf, priceFmt, cash, errorEmbed } from '../../utils.js';
import { validateTickerFormat, ValidationError } from '../../validate.js';
import { respondTickerAutocomplete } from '../../autocomplete.js';

export default {
  data: new SlashCommandBuilder()
    .setName('crypto')
    .setDescription('Crypto coin detail with chart')
    .addStringOption(o => o.setName('symbol').setDescription('Crypto symbol e.g. BTCX').setRequired(true).setAutocomplete(true)),

  autocomplete: (interaction) => respondTickerAutocomplete(interaction, 'crypto'),

  async execute(interaction) {
    await interaction.deferReply();

    let symbol;
    try {
      symbol = validateTickerFormat(interaction.options.getString('symbol'));
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    let c, hist;
    try {
      [c, hist] = await Promise.all([
        api.cryptoCoin(symbol),
        api.cryptoHistory(symbol, 80),
      ]);
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(`**${symbol}** not found. Crypto symbols end in X, e.g. BTCX.`)] });
      throw err;
    }

    const price     = c.price    ?? 0;
    const changePct = c.changePct ?? c.change ?? 0;
    const label     = `${symbol} — ${c.name ?? symbol}`;
    const att       = chartAttachment(hist?.history ?? [], label, price, changePct);

    const embed = new EmbedBuilder()
      .setTitle(`🪙 ${label}`)
      .setColor(colorOf(changePct))
      .addFields(
        { name: 'Price',      value: priceFmt(price, 4),                                                               inline: true },
        { name: 'Change',     value: sign(changePct),                                                                   inline: true },
        { name: 'Market Cap', value: c.marketCap  != null ? `$${(c.marketCap / 1e9).toFixed(2)}B` : '—',             inline: true },
        { name: 'Dominance',  value: c.dominance  != null ? `${c.dominance.toFixed(2)}%` : '—',                       inline: true },
        { name: 'RSI',        value: c.rsi        != null ? c.rsi.toFixed(1) : '—',                                   inline: true },
        { name: 'Category',   value: c.category   ?? '—',                                                              inline: true },
        { name: 'ATH',        value: c.ath        != null ? cash(c.ath) : '—',                                        inline: true },
        { name: '% from ATH', value: c.pctFromAth != null ? `${c.pctFromAth.toFixed(2)}%` : '—',                     inline: true },
      );

    if (att) embed.setImage('attachment://chart.png');
    await interaction.editReply({ embeds: [embed], ...(att ? { files: [att] } : {}) });
  },
};

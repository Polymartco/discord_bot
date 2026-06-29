import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { chartAttachment, sign, colorOf, priceFmt, errorEmbed } from '../../utils.js';
import { validateTickerFormat, ValidationError } from '../../validate.js';
import { respondTickerAutocomplete } from '../../autocomplete.js';

export default {
  data: new SlashCommandBuilder()
    .setName('forex')
    .setDescription('Currency pair detail with chart')
    .addStringOption(o => o.setName('pair').setDescription('Forex pair e.g. EURUSD').setRequired(true).setAutocomplete(true)),

  autocomplete: (interaction) => respondTickerAutocomplete(interaction, 'forex'),

  async execute(interaction) {
    await interaction.deferReply();

    let pair;
    try {
      pair = validateTickerFormat(interaction.options.getString('pair'));
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    let p, hist;
    try {
      [p, hist] = await Promise.all([
        api.forexPair(pair),
        api.forexHistory(pair, 80),
      ]);
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(`**${pair}** not found. Forex pairs use 6-letter codes like EURUSD.`)] });
      throw err;
    }

    const price     = p.price    ?? 0;
    const changePct = p.changePct ?? p.change ?? 0;
    const att = chartAttachment(hist?.history ?? [], pair, price, changePct);

    const embed = new EmbedBuilder()
      .setTitle(`💱 ${pair}`)
      .setColor(colorOf(changePct))
      .addFields(
        { name: 'Price',         value: priceFmt(price, 5),                                              inline: true },
        { name: 'Change',        value: sign(changePct),                                                 inline: true },
        { name: 'Spread (pips)', value: p.spreadPips != null ? String(p.spreadPips) : '—',              inline: true },
        { name: 'Session',       value: p.activeSession ?? '—',                                         inline: true },
        { name: 'RSI',           value: p.rsi           != null ? p.rsi.toFixed(1) : '—',              inline: true },
        { name: 'Bid / Ask',     value: (p.bid != null && p.ask != null) ? `${priceFmt(p.bid, 5)} / ${priceFmt(p.ask, 5)}` : '—', inline: true },
        { name: 'Pivot',         value: p.pivotP        != null ? p.pivotP.toFixed(5)  : '—',          inline: true },
        { name: 'R1',            value: p.pivotR1       != null ? p.pivotR1.toFixed(5) : '—',          inline: true },
        { name: 'S1',            value: p.pivotS1       != null ? p.pivotS1.toFixed(5) : '—',          inline: true },
      );

    if (att) embed.setImage('attachment://chart.png');
    await interaction.editReply({ embeds: [embed], ...(att ? { files: [att] } : {}) });
  },
};

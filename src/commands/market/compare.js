import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { sign, BLUE, errorEmbed, compareChartAttachment } from '../../utils.js';
import { validateTickerFormat, ValidationError } from '../../validate.js';

export default {
  data: new SlashCommandBuilder()
    .setName('compare')
    .setDescription('Overlay two stock price histories on a single normalized chart')
    .addStringOption(o => o.setName('ticker1').setDescription('First stock ticker').setRequired(true))
    .addStringOption(o => o.setName('ticker2').setDescription('Second stock ticker').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();

    let t1, t2;
    try {
      t1 = validateTickerFormat(interaction.options.getString('ticker1'));
      t2 = validateTickerFormat(interaction.options.getString('ticker2'));
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    if (t1 === t2) return interaction.editReply({ embeds: [errorEmbed('Pick two different tickers to compare.')] });

    let s1, s2;
    try {
      [s1, s2] = await Promise.all([api.stock(t1), api.stock(t2)]);
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    const assets = [
      { ticker: t1, history: Array.isArray(s1.history) ? s1.history : [], change: s1.change ?? 0 },
      { ticker: t2, history: Array.isArray(s2.history) ? s2.history : [], change: s2.change ?? 0 },
    ];

    const att = compareChartAttachment(assets);

    const c1 = s1.change ?? 0;
    const c2 = s2.change ?? 0;
    const winner = c1 > c2 ? t1 : c2 > c1 ? t2 : null;

    const embed = new EmbedBuilder()
      .setTitle(`${t1} vs ${t2}`)
      .setColor(BLUE)
      .addFields(
        { name: `${t1} Price`,  value: `$${(s1.price ?? 0).toFixed(2)}`, inline: true },
        { name: `${t2} Price`,  value: `$${(s2.price ?? 0).toFixed(2)}`, inline: true },
        { name: '​',        value: '​',                          inline: true },
        { name: `${t1} Change`, value: sign(c1),                          inline: true },
        { name: `${t2} Change`, value: sign(c2),                          inline: true },
        { name: 'Leading',      value: winner ?? 'Tied',                  inline: true },
        { name: `${t1} RSI`,   value: s1.rsi != null ? s1.rsi.toFixed(1) : '—', inline: true },
        { name: `${t2} RSI`,   value: s2.rsi != null ? s2.rsi.toFixed(1) : '—', inline: true },
        { name: `${t1} Vol`,   value: s1.volume != null ? s1.volume.toLocaleString() : '—', inline: true },
      )
      .setFooter({ text: 'Each line is normalized to its own price range for visual comparison' });

    if (att) embed.setImage('attachment://compare.png');

    await interaction.editReply({ embeds: [embed], ...(att ? { files: [att] } : {}) });
  },
};

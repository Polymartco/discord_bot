import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api, ApiError } from '../../api.js';
import { sign, BLUE, errorEmbed } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Top gainers and losers this tick')
    .addIntegerOption(o => o.setName('limit').setDescription('How many per side, 1–10').setMinValue(1).setMaxValue(10)),

  async execute(interaction) {
    await interaction.deferReply();
    const limit = interaction.options.getInteger('limit') ?? 5;

    let gainers, losers;
    try {
      const result = await api.topMovers(limit);
      gainers = Array.isArray(result?.gainers) ? result.gainers : [];
      losers  = Array.isArray(result?.losers)  ? result.losers  : [];
    } catch (err) {
      if (err instanceof ApiError) return interaction.editReply({ embeds: [errorEmbed('Could not fetch top movers. Try again in a moment.')] });
      throw err;
    }

    const fmt = arr => arr.map((s, i) =>
      `\`${String(i + 1).padStart(2)}\` **${s.ticker ?? '?'}** ${sign(s.change ?? 0)} @ $${(s.price ?? 0).toFixed(2)}`
    ).join('\n');

    const embed = new EmbedBuilder()
      .setTitle('Top Movers')
      .setColor(BLUE)
      .addFields(
        { name: '📈 Gainers', value: fmt(gainers) || '—', inline: true },
        { name: '📉 Losers',  value: fmt(losers)  || '—', inline: true },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};

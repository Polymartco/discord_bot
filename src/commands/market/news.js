import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { api } from '../../api.js';
import { BLUE } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('news')
    .setDescription('Recent market-moving events')
    .addIntegerOption(o => o.setName('limit').setDescription('Number of events (1–15)').setMinValue(1).setMaxValue(15)),

  async execute(interaction) {
    await interaction.deferReply();
    const limit = interaction.options.getInteger('limit') ?? 8;
    const events = await api.events(limit);

    const list = Array.isArray(events) ? events : Object.values(events);

    const lines = list.map(e => {
      const icon   = (e.effect ?? 0) >= 0 ? '🟢' : '🔴';
      const effect = e.effect != null ? ` (${e.effect >= 0 ? '+' : ''}${e.effect.toFixed(2)}%)` : '';
      const sector = e.sector ? ` [${e.sector}]` : '';
      return `${icon} ${e.text ?? e.headline ?? ''}${effect}${sector}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('📰 Market News')
      .setColor(BLUE)
      .setDescription(lines.join('\n') || 'No recent events.');

    await interaction.editReply({ embeds: [embed] });
  },
};

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getOrCreateUser, stmt, getConfig } from '../../db.js';
import { cash, BLUE, errorEmbed } from '../../utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Your recent trade history')
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { guildId, user } = interaction;
    const page   = interaction.options.getInteger('page') ?? 1;
    const config = getConfig(guildId);

    getOrCreateUser(guildId, user.id, config.starting_balance);

    const trades = stmt.getTrades.all(guildId, user.id, 10, (page - 1) * 10);
    if (!trades.length) {
      return interaction.editReply({ content: page === 1 ? 'You have no trades yet.' : 'No trades on this page.' });
    }

    const lines = trades.map(t => {
      const date = new Date(t.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const side = t.side.toUpperCase().padEnd(4);
      return `\`${date}\` **${side}** ${t.ticker} — ${t.shares}×${cash(t.price)} = ${cash(t.total)} (fee ${cash(t.fee)})`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`Trade History — Page ${page}`)
      .setColor(BLUE)
      .setDescription(lines.join('\n'));

    await interaction.editReply({ embeds: [embed] });
  },
};

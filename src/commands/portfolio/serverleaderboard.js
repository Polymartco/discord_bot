import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { stmt, getConfig } from '../../db.js';
import { cash, GOLD, errorEmbed } from '../../utils.js';
import { assertGuildSetup, ValidationError } from '../../validate.js';

export default {
  data: new SlashCommandBuilder()
    .setName('serverleaderboard')
    .setDescription('Richest users in this server by cash balance'),

  async execute(interaction) {
    await interaction.deferReply();
    const { guildId } = interaction;
    const config = getConfig(guildId);

    try {
      assertGuildSetup(config);
    } catch (err) {
      if (err instanceof ValidationError) return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      throw err;
    }

    const rows = stmt.serverLeaderboard.all(guildId);
    if (!rows.length) {
      return interaction.editReply({ content: 'No users registered yet.' });
    }

    const userTags = await Promise.allSettled(
      rows.map(r => interaction.client.users.fetch(r.user_id))
    );

    const lines = rows.map((r, i) => {
      const tag = userTags[i].status === 'fulfilled' ? userTags[i].value.username : `<@${r.user_id}>`;
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${String(i + 1).padStart(2)}\``;
      return `${medal} **${tag}** — ${cash(r.balance)}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('🏆 Server Leaderboard')
      .setColor(GOLD)
      .setDescription(lines.join('\n'));

    await interaction.editReply({ embeds: [embed] });
  },
};

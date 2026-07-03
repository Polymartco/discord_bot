import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { stmt } from '../../db.js';
import { cash, GOLD, polish } from '../../utils.js';

const medal = i => ['🥇', '🥈', '🥉'][i] ?? `\`${String(i + 1).padStart(2)}\``;

export default {
  data: new SlashCommandBuilder()
    .setName('casinotop')
    .setDescription('Biggest casino winners in this server')
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply();
    const rows = stmt.casinoLeaderboard.all(interaction.guildId);
    if (!rows.length) return interaction.editReply({ content: 'No casino games played in this server yet.' });

    const tags  = await Promise.allSettled(rows.map(r => interaction.client.users.fetch(r.user_id)));
    const lines = rows.map((r, i) => {
      const tag = tags[i].status === 'fulfilled' ? tags[i].value.username : `User ${i + 1}`;
      return `${medal(i)} **${tag}** — ${cash(r.net)} net`;
    });

    await interaction.editReply({
      embeds: [polish(new EmbedBuilder().setTitle('🎰 Casino Leaderboard — Net Profit').setColor(GOLD).setDescription(lines.join('\n')), interaction)],
    });
  },
};

import { SlashCommandBuilder } from 'discord.js';
import { stmt, getOrCreateUser, getConfig } from '../../db.js';
import { brandEmbed, GOLD } from '../../utils.js';
import { ACHIEVEMENTS } from '../../achievements.js';

export default {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('View your unlocked badges')
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const { guildId, user } = interaction;
    const config = getConfig(guildId);
    getOrCreateUser(guildId, user.id, config.starting_balance);

    const owned = new Set(stmt.getAchievements.all(guildId, user.id).map(a => a.code));
    const lines = ACHIEVEMENTS.map(a =>
      owned.has(a.code)
        ? `${a.emoji} **${a.name}** — ${a.desc}`
        : `🔒 ${a.name} — _${a.desc}_`
    );

    const embed = brandEmbed({ title: `🏅 ${user.username}'s Achievements`, color: GOLD, interaction })
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${owned.size} / ${ACHIEVEMENTS.length} unlocked` });

    await interaction.editReply({ embeds: [embed] });
  },
};

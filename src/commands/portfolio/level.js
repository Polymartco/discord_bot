import { SlashCommandBuilder } from 'discord.js';
import { getOrCreateUser, getConfig, stmt } from '../../db.js';
import { brandEmbed, BLUE, cash } from '../../utils.js';
import { levelProgress, rankTitle, progressBar } from '../../progression.js';

export default {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Your level, rank, and XP progress')
    .setDMPermission(false)
    .addUserOption(o => o.setName('user').setDescription('View another member')),

  async execute(interaction) {
    const { guildId } = interaction;
    const target = interaction.options.getUser('user') ?? interaction.user;
    const config = getConfig(guildId);
    const dbUser = getOrCreateUser(guildId, target.id, config.starting_balance);

    const xp = dbUser.xp ?? 0;
    const { level, into, span, pct } = levelProgress(xp);
    const rank = rankTitle(level);

    const embed = brandEmbed({ title: `${rank.emoji} ${target.username} — Level ${level}`, color: BLUE, interaction })
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `**${rank.title}**\n\n` +
        `${progressBar(pct, 16)}  **${Math.round(pct * 100)}%**\n` +
        `\`${into.toLocaleString()} / ${span.toLocaleString()}\` XP to level **${level + 1}**`,
      )
      .addFields(
        { name: 'Total XP',     value: xp.toLocaleString(),               inline: true },
        { name: 'Rank',         value: `${rank.emoji} ${rank.title}`,     inline: true },
        { name: 'Daily Streak', value: `🔥 ${dbUser.daily_streak ?? 0}`,   inline: true },
      );

    return interaction.reply({ embeds: [embed] });
  },
};

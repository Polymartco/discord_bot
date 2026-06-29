import { SlashCommandBuilder } from 'discord.js';
import { stmt, getOrCreateUser, getConfig } from '../../db.js';
import { cash, brandEmbed, BLUE } from '../../utils.js';
import { levelProgress, rankTitle, progressBar } from '../../progression.js';
import { ACHIEVEMENTS } from '../../achievements.js';

export default {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Your trader profile — level, rank, streak, and badges')
    .setDMPermission(false)
    .addUserOption(o => o.setName('user').setDescription('View another member’s profile')),

  async execute(interaction) {
    await interaction.deferReply();
    const { guildId } = interaction;
    const target = interaction.options.getUser('user') ?? interaction.user;
    const config = getConfig(guildId);
    const dbUser = getOrCreateUser(guildId, target.id, config.starting_balance);

    const xp = dbUser.xp ?? 0;
    const { level, into, span, pct } = levelProgress(xp);
    const rank   = rankTitle(level);
    const earned = stmt.getAchievements.all(guildId, target.id).length;

    const embed = brandEmbed({ title: `${rank.emoji} ${target.username}'s Profile`, color: BLUE, interaction })
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: 'Rank',         value: `${rank.emoji} ${rank.title}`,                         inline: true },
        { name: 'Level',        value: `L${level}`,                                           inline: true },
        { name: 'Cash',         value: cash(dbUser.balance),                                  inline: true },
        { name: 'Daily Streak', value: `🔥 ${dbUser.daily_streak ?? 0} (best ${dbUser.best_streak ?? 0})`, inline: true },
        { name: 'Badges',       value: `🏅 ${earned}/${ACHIEVEMENTS.length}`,                inline: true },
        { name: 'Total XP',     value: xp.toLocaleString(),                                   inline: true },
        { name: `Progress to L${level + 1}`, value: `${progressBar(pct)} ${Math.round(pct * 100)}%  (${into}/${span} XP)`, inline: false },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};

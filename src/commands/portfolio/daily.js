import { SlashCommandBuilder } from 'discord.js';
import { getOrCreateUser, getConfig, stmt } from '../../db.js';
import { cash, brandEmbed, errorEmbed, GREEN } from '../../utils.js';
import { rankTitle, levelFromXp } from '../../progression.js';
import { recordDaily, progressField } from '../../postTrade.js';

const DAY = 86400;

export default {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily bonus — keep a streak going for bigger rewards')
    .setDMPermission(false),

  async execute(interaction) {
    const { guildId, user } = interaction;
    const config  = getConfig(guildId);
    const dbUser  = getOrCreateUser(guildId, user.id, config.starting_balance);
    const now     = Math.floor(Date.now() / 1000);
    const elapsed = now - dbUser.last_daily;

    if (elapsed < DAY) {
      const remaining = DAY - elapsed;
      const h = Math.floor(remaining / 3600);
      const m = Math.floor((remaining % 3600) / 60);
      return interaction.reply({ embeds: [errorEmbed(`Daily already claimed. Next in **${h}h ${m}m**.`)], ephemeral: true });
    }

    // Consecutive if claimed within the 24–48h window; otherwise the streak resets.
    const streak     = dbUser.last_daily > 0 && elapsed < DAY * 2 ? (dbUser.daily_streak ?? 0) + 1 : 1;
    const streakBonus = Math.round(config.daily_bonus * 0.1 * Math.min(streak - 1, 10)); // +10%/day, caps at +100%
    const payout     = config.daily_bonus + streakBonus;
    const newBalance = dbUser.balance + payout;

    stmt.updateBalance.run(newBalance, guildId, user.id);
    stmt.setLastDaily.run(now, guildId, user.id);
    stmt.setStreak.run(streak, streak, guildId, user.id);

    const summary = recordDaily({ guildId, userId: user.id, streak });
    const rank    = rankTitle(levelFromXp(stmt.getUser.get(guildId, user.id)?.xp ?? 0));

    const embed = brandEmbed({ title: '💰 Daily Bonus Claimed', color: GREEN, interaction })
      .setDescription(
        `You claimed **${cash(payout)}**` +
        (streakBonus > 0 ? ` _(includes ${cash(streakBonus)} streak bonus)_` : '') + '.'
      )
      .addFields(
        { name: 'Streak',      value: `🔥 ${streak} day${streak === 1 ? '' : 's'}`, inline: true },
        { name: 'New Balance', value: cash(newBalance),                             inline: true },
        { name: 'Rank',        value: `${rank.emoji} ${rank.title}`,                inline: true },
      );

    const field = progressField(summary);
    if (field) embed.addFields(field);

    await interaction.reply({ embeds: [embed] });
  },
};

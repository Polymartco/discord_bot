import { SlashCommandBuilder } from 'discord.js';
import { getOrCreateUser, getConfig, stmt } from '../../db.js';
import { cash, brandEmbed, errorEmbed, GREEN, GOLD } from '../../utils.js';
import { rankTitle, levelFromXp } from '../../progression.js';
import { recordDaily, progressField } from '../../postTrade.js';
import { rand } from '../../casinoLib.js';
import { progressQuests } from '../../quests.js';

const DAY = 86400;
const MILESTONES = [7, 14, 30, 60, 100]; // streak days that pay a bonus crate

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

    // Consecutive if claimed within the 24–48h window; otherwise the streak resets —
    // unless the player has a Streak Freeze and missed at most one day (48–72h), which
    // spends one freeze to keep the streak alive.
    const prevStreak = dbUser.daily_streak ?? 0;
    let streak, freezeUsed = false;
    if (dbUser.last_daily > 0 && elapsed < DAY * 2) {
      streak = prevStreak + 1;                              // normal consecutive claim
    } else if (dbUser.last_daily > 0 && elapsed < DAY * 3 && prevStreak > 0 && (dbUser.streak_freezes ?? 0) > 0
               && stmt.consumeStreakFreeze.run(guildId, user.id).changes === 1) {
      streak = prevStreak + 1; freezeUsed = true;           // one missed day, saved by a freeze
    } else {
      streak = 1;                                           // streak reset
    }
    const streakBonus = Math.round(config.daily_bonus * 0.1 * Math.min(streak - 1, 20)); // +10%/day, caps at +200%

    // Milestone crate: fires ONLY on the exact newly-crossed milestone (streak can
    // only ever be prevStreak+1 or reset to 1), so no day past a milestone re-pays.
    const crate = (MILESTONES.includes(streak) && streak > prevStreak) ? rand(1, 4) * config.daily_bonus : 0;

    const payout     = config.daily_bonus + streakBonus + crate;
    const newBalance = dbUser.balance + payout;

    stmt.updateBalance.run(newBalance, guildId, user.id);
    stmt.setLastDaily.run(now, guildId, user.id);
    stmt.setStreak.run(streak, streak, guildId, user.id);

    // recordDaily awards XP and may pay a level-up bonus — read the balance after it.
    const summary   = recordDaily({ guildId, userId: user.id, streak });
    try { summary.quests = progressQuests({ guildId, userId: user.id, source: 'daily', streak }); } catch {}
    const finalUser = stmt.getUser.get(guildId, user.id);
    const finalBal  = finalUser?.balance ?? newBalance;
    const bestStreak = Math.max(streak, finalUser?.best_streak ?? 0);
    const rank      = rankTitle(levelFromXp(finalUser?.xp ?? 0));
    const nextMile  = MILESTONES.find(m => m > streak);

    const embed = brandEmbed({ title: '💰 Daily Bonus Claimed', color: crate > 0 ? GOLD : GREEN, interaction })
      .setDescription(
        `You claimed **${cash(payout)}**` +
        (streakBonus > 0 ? ` _(includes ${cash(streakBonus)} streak bonus)_` : '') + '.' +
        (freezeUsed ? `\n❄️ **Streak freeze used** — your ${prevStreak}-day streak is safe!` : '') +
        (crate > 0 ? `\n🎁 **${streak}-day milestone crate:** +${cash(crate)}!` : '')
      )
      .addFields(
        { name: 'Streak',      value: `🔥 ${streak} day${streak === 1 ? '' : 's'}`,  inline: true },
        { name: 'Best',        value: `🏆 ${bestStreak} day${bestStreak === 1 ? '' : 's'}`, inline: true },
        { name: 'New Balance', value: cash(finalBal),                                inline: true },
        { name: 'Rank',        value: `${rank.emoji} ${rank.title}`,                 inline: true },
      );
    if (nextMile) embed.addFields({ name: 'Next crate', value: `🎁 in ${nextMile - streak} day${nextMile - streak === 1 ? '' : 's'}`, inline: true });

    const field = progressField(summary);
    if (field) embed.addFields(field);

    await interaction.reply({ embeds: [embed] });
  },
};

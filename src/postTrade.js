import { stmt } from './db.js';
import {
  levelFromXp, xpForTrade, levelProgress, progressBar, rankTitle, levelUpReward,
  XP_DAILY, XP_WORK, XP_BEG,
} from './progression.js';
import { getAchievement } from './achievements.js';
import { cash } from './utils.js';
import { happyHourActive, HAPPY_MULT } from './happyhour.js';

// ── Shared progression hook ───────────────────────────────────────────────────
// Called after a successful trade, casino game, daily claim, or timed reward by
// every code path. Awards XP, recomputes level, pays a one-time level-up coin
// bonus, detects rank-ups, unlocks achievements, and returns a rich summary the
// caller can surface. This is the single funnel that makes EVERY action feel
// like progress.

/**
 * Award `amount` XP and settle any level-up. Returns:
 *   { leveledUp, prevLevel, newLevel, levelsGained, coins, rankUp, xpGained, xp }
 * `coins` is the one-time level-up bonus already credited to the balance.
 * `rankUp` is the new rank def when the rank band changed, else null.
 */
export function awardXp(guildId, userId, amount = 0) {
  const blank = { leveledUp: false, prevLevel: 1, newLevel: 1, levelsGained: 0, coins: 0, rankUp: null, xpGained: 0, xp: 0 };
  const user = stmt.getUser.get(guildId, userId);
  if (!user) return blank;

  const prevLevel = user.level ?? 1;
  const gained    = happyHourActive(guildId) ? amount * HAPPY_MULT : amount; // 2× XP during Happy Hour (cosmetic — mints no coins)
  const newXp     = (user.xp ?? 0) + gained;
  const newLevel  = levelFromXp(newXp);
  stmt.setXp.run(newXp, newLevel, guildId, userId);

  let coins = 0, rankUp = null;
  if (newLevel > prevLevel) {
    // Pay each newly-crossed level's bonus (monotonic XP ⇒ each pays exactly once).
    for (let L = prevLevel + 1; L <= newLevel; L++) coins += levelUpReward(L);
    if (coins > 0) stmt.adjustBalance.run(coins, guildId, userId); // race-safe (relative) credit
    const prevRank = rankTitle(prevLevel), newRank = rankTitle(newLevel);
    if (newRank.title !== prevRank.title) rankUp = newRank;
  }

  return { leveledUp: newLevel > prevLevel, prevLevel, newLevel, levelsGained: newLevel - prevLevel, coins, rankUp, xpGained: gained, xp: newXp };
}

// Insert any not-yet-owned achievement codes; returns the newly unlocked defs.
// Shared with the casino (casinoStats.js).
export function unlockAchievements(guildId, userId, codes) {
  if (!codes.length) return [];
  const owned = new Set(stmt.getAchievements.all(guildId, userId).map(a => a.code));
  const newly = [];
  for (const code of codes) {
    if (owned.has(code)) continue;
    const def = getAchievement(code);
    if (!def) continue;
    stmt.insertAchievement.run(guildId, userId, code);
    newly.push(def);
  }
  return newly;
}

const unlock = unlockAchievements;

/** Run after a filled trade. `total` is dollar value, `pnlPct` only meaningful for sells. */
export function recordTrade({ guildId, userId, side, total = 0, pnlPct = 0, balance = 0 }) {
  const xp = awardXp(guildId, userId, xpForTrade(total));

  const tradeCount = stmt.countUserTrades.get(guildId, userId)?.cnt ?? 0;
  const codes = [];
  if (tradeCount >= 1)   codes.push('first_trade');
  if (tradeCount >= 10)  codes.push('ten_trades');
  if (tradeCount >= 100) codes.push('hundred_trades');
  if (side === 'sell' && pnlPct >= 25)  codes.push('big_winner');
  if (side === 'sell' && pnlPct >= 100) codes.push('ten_bagger');
  if (balance >= 1_000_000)             codes.push('whale');

  return { ...xp, unlocked: unlock(guildId, userId, codes) };
}

/** Run after a successful daily claim. */
export function recordDaily({ guildId, userId, streak = 0 }) {
  const xp = awardXp(guildId, userId, XP_DAILY);
  const codes = [];
  if (streak >= 7)   codes.push('streak_7');
  if (streak >= 30)  codes.push('streak_30');
  if (streak >= 100) codes.push('streak_100');
  return { ...xp, unlocked: unlock(guildId, userId, codes) };
}

/** Run after a timed reward (/beg, /work, /crate). Pure XP — coins are handled by the caller. */
export function recordTimed({ guildId, userId, kind }) {
  const amount = kind === 'work' ? XP_WORK : kind === 'crate' ? 20 : XP_BEG;
  const xp = awardXp(guildId, userId, amount);
  return { ...xp, unlocked: [] };
}

// Small once-per-UTC-day XP for opening a display command — so browsing rewards
// progress too. Atomic claim (period-guarded) so it can never become a faucet.
export const XP_VIEW = 12;
export function dailyViewXp(guildId, userId) {
  const day = new Date().toISOString().slice(0, 10);
  if (stmt.claimDailyViewXp.run(day, guildId, userId, day).changes !== 1) return null; // already claimed today
  return awardXp(guildId, userId, XP_VIEW);
}

/**
 * Render a progression summary as an embed field, or null when there's nothing
 * to show. With `showBar` (default), always appends a live XP bar so progress
 * is visible on every result — the goal-gradient nudge that keeps players
 * chasing the next level.
 */
export function progressField(summary = {}, { showBar = true } = {}) {
  const parts = [];

  if (summary.rankUp) parts.push(`⭐ **NEW RANK:** ${summary.rankUp.emoji} **${summary.rankUp.title}**!`);

  if (summary.leveledUp) {
    const lvl = summary.levelsGained > 1
      ? `**+${summary.levelsGained} levels → L${summary.newLevel}**`
      : `You're now level **${summary.newLevel}**`;
    parts.push(`🎉 **Level up!** ${lvl}.` + (summary.coins > 0 ? `  💰 +${cash(summary.coins)} bonus!` : ''));
  }

  if (summary.unlocked?.length) {
    parts.push(`🏅 Unlocked: ${summary.unlocked.map(u => `${u.emoji} **${u.name}**`).join(', ')}`);
  }

  if (summary.quests?.length) {
    parts.push(...summary.quests.map(q => `✅ **Quest complete:** ${q.emoji} ${q.name} — claim with \`/quests\``));
  }

  if (showBar && Number.isFinite(summary.xp) && summary.xp > 0) {
    const { level, pct } = levelProgress(summary.xp);
    parts.push(`\`L${level}\` ${progressBar(pct)} ${Math.round(pct * 100)}%` + (summary.xpGained ? `  ·  +${summary.xpGained} XP` : ''));
  }

  if (!parts.length) return null;
  return { name: '🎯 Progress', value: parts.join('\n'), inline: false };
}

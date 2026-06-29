import { stmt } from './db.js';
import { levelFromXp, xpForTrade, XP_DAILY } from './progression.js';
import { getAchievement } from './achievements.js';

// ── Shared progression hook ───────────────────────────────────────────────────
// Called after a successful trade or daily claim by every code path (slash
// buy/sell, the trade modal, /daily). Awards XP, recomputes level, unlocks any
// newly-earned achievements, and returns a summary the caller can surface.

function applyXp(guildId, userId, amount) {
  const user = stmt.getUser.get(guildId, userId);
  if (!user) return { leveledUp: false, newLevel: 1 };
  const before   = user.level ?? 1;
  const newXp    = (user.xp ?? 0) + amount;
  const newLevel = levelFromXp(newXp);
  stmt.setXp.run(newXp, newLevel, guildId, userId);
  return { leveledUp: newLevel > before, newLevel };
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
  const xp = applyXp(guildId, userId, xpForTrade(total));

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
  const xp = applyXp(guildId, userId, XP_DAILY);
  const codes = [];
  if (streak >= 7)  codes.push('streak_7');
  if (streak >= 30) codes.push('streak_30');
  return { ...xp, unlocked: unlock(guildId, userId, codes) };
}

/** Render a progression summary as an embed field, or null when there's nothing to show. */
export function progressField({ leveledUp, newLevel, unlocked }) {
  const parts = [];
  if (leveledUp)        parts.push(`🎉 **Level up!** You're now level **${newLevel}**.`);
  if (unlocked?.length) parts.push(`🏅 Unlocked: ${unlocked.map(u => `${u.emoji} **${u.name}**`).join(', ')}`);
  if (!parts.length) return null;
  return { name: '🎯 Progress', value: parts.join('\n'), inline: false };
}

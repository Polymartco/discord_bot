import { stmt } from './db.js';
import { unlockAchievements } from './postTrade.js';

const DEFAULTS = { games: 0, wins: 0, wagered: 0, won: 0, lost: 0, net: 0, biggest_win: 0, cur_streak: 0, best_streak: 0 };

/**
 * Record a settled casino game.
 *  - bet : amount staked
 *  - net : profit (winnings − stake); negative on a loss, 0 on a push
 *  - flags: { jackpot, blackjackNatural, minesSafe }
 * Returns the newly unlocked achievement defs (possibly empty).
 */
export function recordGame({ guildId, userId, bet, net, flags = {} }) {
  const s = stmt.getCasinoStats.get(guildId, userId) ?? DEFAULTS;

  const games   = s.games + 1;
  const wins    = s.wins + (net > 0 ? 1 : 0);
  const wagered = s.wagered + bet;
  const won     = s.won + (net > 0 ? net : 0);
  const lost    = s.lost + (net < 0 ? -net : 0);
  const netTot  = s.net + net;
  const biggest = Math.max(s.biggest_win, net);

  // Streak: positive = win streak, negative = loss streak, pushes leave it unchanged.
  let streak = s.cur_streak;
  if (net > 0)      streak = streak >= 0 ? streak + 1 : 1;
  else if (net < 0) streak = streak <= 0 ? streak - 1 : -1;
  const best = Math.max(s.best_streak, streak);

  stmt.upsertCasinoStats.run(guildId, userId, games, wins, wagered, won, lost, netTot, biggest, streak, best);

  const codes = [];
  if (flags.jackpot)             codes.push('jackpot');
  if (flags.blackjackNatural)    codes.push('blackjack_natural');
  if (bet >= 100_000)            codes.push('high_roller');
  if ((flags.minesSafe ?? 0) >= 10) codes.push('mines_master');
  if (streak >= 5)               codes.push('lucky_streak');

  return unlockAchievements(guildId, userId, codes);
}

/** Format newly unlocked achievements as an embed field, or null. */
export function unlockField(unlocked) {
  if (!unlocked?.length) return null;
  return { name: '🏅 Achievement unlocked', value: unlocked.map(u => `${u.emoji} **${u.name}**`).join(', '), inline: false };
}

// ── Progressive jackpot helpers ───────────────────────────────────────────────
export const JACKPOT_SEED = 1000;   // pool floor after a win
export const JACKPOT_RATE = 0.02;   // share of each slots bet fed into the pool

export function jackpotPool(guildId) {
  return (stmt.getJackpot.get(guildId)?.pool ?? 0) + JACKPOT_SEED;
}

export function contributeJackpot(guildId, bet) {
  stmt.addJackpot.run(guildId, Math.round(bet * JACKPOT_RATE));
}

/** Award the whole pool and reset it to zero (display adds the seed back). */
export function awardJackpot(guildId) {
  const pool = jackpotPool(guildId);
  stmt.setJackpot.run(guildId, 0);
  return pool;
}

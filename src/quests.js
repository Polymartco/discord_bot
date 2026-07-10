// ── Quest / mission engine ────────────────────────────────────────────────────
// Rotating daily & weekly claimable objectives — the "come back tomorrow / play
// one more" retention loop. Pure logic over the quest_progress table; the
// /quests board and the claim button consume these functions.
//
// Exploit posture (play-money, but no infinite faucets):
//  • Rewards are once-per-period (atomic claimed-guard UPDATE), so a 0-edge game
//    like coinflip can be farmed for at most one bounded daily reward.
//  • Claims re-check the period key (stale post-rollover buttons are rejected)
//    and pay only when the guarded UPDATE reports exactly one row changed.

import { stmt } from './db.js';
import { adjust } from './casinoLib.js';
import { awardXp } from './postTrade.js';

// ── Quest catalogue ───────────────────────────────────────────────────────────
// metric decides how an event advances the quest (see applyEvent). goal = target,
// reward = coins on claim, xp = XP on claim.
export const DAILY_QUESTS = [
  { code: 'd_warmup',  name: 'Warm Up',       emoji: '🎲', desc: 'Play 5 casino games',       metric: 'play',                   goal: 5,     reward: 300, xp: 40 },
  { code: 'd_winner',  name: 'On a Roll',     emoji: '🏆', desc: 'Win 3 casino games',        metric: 'win',                    goal: 3,     reward: 400, xp: 50 },
  { code: 'd_wager',   name: 'Big Spender',   emoji: '💸', desc: 'Wager 10,000 in total',     metric: 'wager',                  goal: 10000, reward: 500, xp: 60 },
  { code: 'd_flipper', name: 'Coin Caller',   emoji: '🪙', desc: 'Win 3 coinflips',           metric: 'win_game', game: 'coinflip', goal: 3,   reward: 350, xp: 45 },
  { code: 'd_spinner', name: 'Reel Deal',     emoji: '🎰', desc: 'Spin the slots 5 times',    metric: 'play_game', game: 'slots',  goal: 5,   reward: 300, xp: 40 },
  { code: 'd_jackpot', name: 'Lucky Reels',   emoji: '✨', desc: 'Hit a 10×+ slots line',     metric: 'slots_mult', min: 10,      goal: 1,     reward: 600, xp: 70 },
  { code: 'd_grind',   name: 'Clock In',      emoji: '💼', desc: 'Work 2 shifts',             metric: 'source', source: 'work',    goal: 2,     reward: 300, xp: 40 },
  { code: 'd_daily',   name: 'Daily Ritual',  emoji: '📅', desc: 'Claim your daily bonus',    metric: 'source', source: 'daily',   goal: 1,     reward: 250, xp: 30 },
  { code: 'd_oracle',  name: 'Market Oracle', emoji: '🔮', desc: 'Settle 3 market predictions', metric: 'play_game', game: 'predict', goal: 3,   reward: 400, xp: 55 },
];

export const WEEKLY_QUESTS = [
  { code: 'w_grinder', name: 'Grinder',       emoji: '⚙️', desc: 'Play 100 casino games',     metric: 'play',                   goal: 100,    reward: 3000, xp: 200 },
  { code: 'w_winner',  name: 'Sharp Shooter', emoji: '🎯', desc: 'Win 25 casino games',       metric: 'win',                    goal: 25,     reward: 3000, xp: 200 },
  { code: 'w_wager',   name: 'Whale Watch',   emoji: '🐋', desc: 'Wager 100,000 in total',    metric: 'wager',                  goal: 100000, reward: 3500, xp: 220 },
  { code: 'w_streak',  name: 'Heater',        emoji: '🔥', desc: 'Ride a 5-win streak',       metric: 'win_streak',             goal: 5,      reward: 2500, xp: 150 },
  { code: 'w_seer',    name: 'The Seer',      emoji: '🧿', desc: 'Win 5 market predictions',  metric: 'win_game', game: 'predict', goal: 5,      reward: 3000, xp: 190 },
];

const DAILY_ACTIVE  = 3; // quests shown per day
const WEEKLY_ACTIVE = 2; // quests shown per week

// ── Period keys (UTC) ─────────────────────────────────────────────────────────
function isoWeek(d) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (dt.getUTCDay() + 6) % 7;      // Mon=0..Sun=6
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);   // nearest Thursday
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((dt - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function periodKeys(d = new Date()) {
  return { daily: d.toISOString().slice(0, 10), weekly: isoWeek(d) };
}

// ── Deterministic rotation ────────────────────────────────────────────────────
// Everyone in the same period sees the same quests; the set rotates each period.
function seededPick(pool, n, seedStr) {
  let seed = 7;
  for (const ch of seedStr) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  return pool
    .map((q, i) => ({ q, k: (seed ^ Math.imul(i + 1, 2654435761)) >>> 0 }))
    .sort((a, b) => a.k - b.k)
    .slice(0, Math.min(n, pool.length))
    .map(x => x.q);
}

export function activeQuests(scope, periodKey) {
  return scope === 'weekly'
    ? seededPick(WEEKLY_QUESTS, WEEKLY_ACTIVE, 'w' + periodKey)
    : seededPick(DAILY_QUESTS, DAILY_ACTIVE, 'd' + periodKey);
}

// ── Progress ──────────────────────────────────────────────────────────────────
// Given the quest, the settled event, and the current progress, return the new
// progress value. Reach-style metrics (win_streak) cap at the goal.
function applyEvent(q, e, before) {
  switch (q.metric) {
    case 'play':       return e.game ? before + 1 : before;
    case 'win':        return e.win ? before + 1 : before;
    case 'wager':      return e.game ? before + (e.bet || 0) : before;
    case 'play_game':  return e.game === q.game ? before + 1 : before;
    case 'win_game':   return (e.win && e.game === q.game) ? before + 1 : before;
    case 'slots_mult': return (e.game === 'slots' && (e.flags?.mult || 0) >= q.min) ? before + 1 : before;
    case 'source':     return e.source === q.source ? before + 1 : before;
    case 'win_streak': return e.win ? Math.max(before, Math.min(q.goal, e.streak || 0)) : before;
    default:           return before;
  }
}

/**
 * Advance any active quests for a settled action. Returns the quests that JUST
 * completed (for an in-game nudge). Callers wrap this in try/catch — it must
 * never break a settled game.
 */
export function progressQuests(event = {}) {
  const { guildId, userId } = event;
  if (!guildId || !userId) return [];
  const keys = periodKeys();
  const completed = [];

  for (const scope of ['daily', 'weekly']) {
    const pk = keys[scope];
    for (const q of activeQuests(scope, pk)) {
      const row    = stmt.getQuestRow.get(guildId, userId, scope, pk, q.code);
      const before = row?.progress ?? 0;
      const after  = applyEvent(q, event, before);
      if (after !== before) {
        stmt.upsertQuestProgress.run(guildId, userId, scope, pk, q.code, after);
        if (before < q.goal && after >= q.goal && !row?.claimed) completed.push(q);
      }
    }
  }
  return completed;
}

// ── Board (for /quests) ───────────────────────────────────────────────────────
export function questBoard(guildId, userId) {
  const keys = periodKeys();
  const build = scope => activeQuests(scope, keys[scope]).map(q => {
    const row      = stmt.getQuestRow.get(guildId, userId, scope, keys[scope], q.code);
    const progress = Math.min(q.goal, row?.progress ?? 0);
    const claimed  = !!row?.claimed;
    return { ...q, scope, periodKey: keys[scope], progress, claimed, done: progress >= q.goal, claimable: progress >= q.goal && !claimed };
  });
  return { daily: build('daily'), weekly: build('weekly'), periodKeys: keys };
}

// ── Claim ─────────────────────────────────────────────────────────────────────
/** Claim a single quest. Atomic + period-checked. Returns { ok, quest?, reward?, xp?, reason? }. */
export function claimQuest(guildId, userId, scope, periodKey, code) {
  const keys = periodKeys();
  if (keys[scope] !== periodKey) return { ok: false, reason: 'expired' };   // stale post-rollover button
  const q = activeQuests(scope, periodKey).find(x => x.code === code);
  if (!q) return { ok: false, reason: 'unknown' };

  const res = stmt.claimQuest.run(guildId, userId, scope, periodKey, code, q.goal);
  if (res.changes !== 1) return { ok: false, reason: 'not-claimable' };      // already claimed or unfinished

  adjust(guildId, userId, q.reward);
  const xp = awardXp(guildId, userId, q.xp);
  return { ok: true, quest: q, reward: q.reward, xp };
}

/** Claim every currently-claimable quest. Returns { claimed:[], coins, xpTotal, leveledUp, newLevel }. */
export function claimAll(guildId, userId) {
  const board = questBoard(guildId, userId);
  const claimed = [];
  let coins = 0, xpTotal = 0, leveledUp = false, newLevel = 0;
  for (const scope of ['daily', 'weekly']) {
    for (const q of board[scope]) {
      if (!q.claimable) continue;
      const r = claimQuest(guildId, userId, scope, q.periodKey, q.code);
      if (r.ok) {
        claimed.push(r.quest);
        coins += r.reward;
        xpTotal += q.xp;
        if (r.xp?.leveledUp) { leveledUp = true; newLevel = r.xp.newLevel; }
      }
    }
  }
  return { claimed, coins, xpTotal, leveledUp, newLevel };
}

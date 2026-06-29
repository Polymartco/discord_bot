// ── Achievement catalogue ─────────────────────────────────────────────────────
// Pure data. Unlock conditions are evaluated in postTrade.js from cheap, already-
// available context (trade counts, realized P&L %, balance, daily streak) — no
// extra API calls. Codes are stable identifiers stored in the `achievements` table.

export const ACHIEVEMENTS = [
  { code: 'first_trade',    name: 'First Steps',    emoji: '🐣', desc: 'Place your first trade.' },
  { code: 'ten_trades',     name: 'Getting Active', emoji: '⚡', desc: 'Place 10 trades.' },
  { code: 'hundred_trades', name: 'Day Trader',     emoji: '🔁', desc: 'Place 100 trades.' },
  { code: 'big_winner',     name: 'Green Day',      emoji: '🚀', desc: 'Close a position up 25% or more.' },
  { code: 'ten_bagger',     name: 'Ten Bagger',     emoji: '💎', desc: 'Close a position up 100% or more.' },
  { code: 'whale',          name: 'Whale Alert',    emoji: '🐋', desc: 'Reach a $1,000,000 cash balance.' },
  { code: 'streak_7',       name: 'Committed',      emoji: '🔥', desc: 'Reach a 7-day daily streak.' },
  { code: 'streak_30',      name: 'Unstoppable',    emoji: '🌋', desc: 'Reach a 30-day daily streak.' },
];

const BY_CODE = new Map(ACHIEVEMENTS.map(a => [a.code, a]));

export function getAchievement(code) {
  return BY_CODE.get(code) ?? null;
}

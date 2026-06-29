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

  // ── Casino ──
  { code: 'jackpot',           name: 'Jackpot!',      emoji: '🎰', desc: 'Hit the slots jackpot.' },
  { code: 'blackjack_natural', name: 'Natural',       emoji: '🃏', desc: 'Win with a natural blackjack.' },
  { code: 'high_roller',       name: 'High Roller',   emoji: '💸', desc: 'Place a single bet of 100,000+.' },
  { code: 'mines_master',      name: 'Minesweeper',   emoji: '💣', desc: 'Cash out Mines with 10+ safe tiles.' },
  { code: 'lucky_streak',      name: 'On Fire',       emoji: '🍀', desc: 'Win 5 casino games in a row.' },
];

const BY_CODE = new Map(ACHIEVEMENTS.map(a => [a.code, a]));

export function getAchievement(code) {
  return BY_CODE.get(code) ?? null;
}

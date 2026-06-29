import { stmt, getOrCreateUser, getConfig } from './db.js';
import { ValidationError } from './validate.js';

// ── Shared casino economy helpers ─────────────────────────────────────────────
// The casino uses the same local `users.balance` wallet as trading, so winnings
// show up on /balance and the leaderboard. All amounts are whole-coin friendly
// but stored as the existing REAL balance.

export const MIN_BET = 1;
export const MAX_BET = 1_000_000;

/** Ensure the player's local account exists and return it. */
export function ensureUser(guildId, userId) {
  const config = getConfig(guildId);
  return getOrCreateUser(guildId, userId, config.starting_balance);
}

/** Validate a bet against the balance. Returns the (rounded) bet or throws ValidationError. */
export function validateBet(raw, balance) {
  const bet = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!Number.isFinite(bet) || bet <= 0) throw new ValidationError('Bet must be a positive number.');
  if (bet < MIN_BET) throw new ValidationError(`Minimum bet is ${MIN_BET} coin.`);
  if (bet > MAX_BET) throw new ValidationError(`Maximum bet is ${MAX_BET.toLocaleString()} coins.`);
  const rounded = Math.round(bet * 100) / 100;
  if (rounded > balance) throw new ValidationError(`You can't afford that — your balance is ${balance.toLocaleString()} coins.`);
  return rounded;
}

/** Adjust a balance by delta (clamped at 0). Returns the new balance. */
export function adjust(guildId, userId, delta) {
  stmt.adjustBalance.run(delta, guildId, userId);
  return stmt.getUser.get(guildId, userId).balance;
}

// ── Timed rewards (/beg, /work) ───────────────────────────────────────────────
/** Returns { ready, remaining } for a DB-backed cooldown column on the user row. */
export function checkCooldown(dbUser, column, cooldownSec) {
  const now     = Math.floor(Date.now() / 1000);
  const elapsed = now - (dbUser[column] ?? 0);
  if (elapsed < cooldownSec) return { ready: false, remaining: cooldownSec - elapsed, now };
  return { ready: true, remaining: 0, now };
}

export function humanDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h ? `${h}h` : null, m ? `${m}m` : null, (!h && s) ? `${s}s` : null].filter(Boolean).join(' ') || '0s';
}

export const rand    = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];

// ── Cards (Blackjack) ─────────────────────────────────────────────────────────
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(r) {
  if (r === 'A') return 11;
  if (r === 'K' || r === 'Q' || r === 'J') return 10;
  return parseInt(r, 10);
}

/** Best blackjack total, demoting aces from 11→1 as needed. */
export function handValue(cards) {
  let total = cards.reduce((s, c) => s + cardValue(c.r), 0);
  let aces  = cards.filter(c => c.r === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

export const cardStr = c => `${c.r}${c.s}`;
export const handStr = cards => cards.map(cardStr).join('  ');
export const isBlackjack = cards => cards.length === 2 && handValue(cards) === 21;

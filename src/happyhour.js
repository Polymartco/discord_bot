import { stmt, getConfig } from './db.js';

// ── Happy Hour ────────────────────────────────────────────────────────────────
// A time-boxed 2× event. EXPLOIT-SAFE by design: it multiplies only XP and the
// bounded, cooldown-gated FAUCET rewards (/work, /beg, /crate) — never a casino
// gross payout (doubling RTP would turn fair games into coin printers). Stored as
// a per-guild unix-seconds expiry so it's naturally restart-safe.

export const HAPPY_MULT = 2;

export function happyHourActive(guildId) {
  const until = getConfig(guildId)?.happy_hour_until ?? 0;
  return until > Math.floor(Date.now() / 1000);
}

export function happyHourRemaining(guildId) {
  return Math.max(0, (getConfig(guildId)?.happy_hour_until ?? 0) - Math.floor(Date.now() / 1000));
}

/** Multiplier to apply to a faucet reward right now (1 or HAPPY_MULT). */
export function happyMultiplier(guildId) {
  return happyHourActive(guildId) ? HAPPY_MULT : 1;
}

/** Start (or extend) Happy Hour for `minutes`. Returns the new expiry (unix s). */
export function startHappyHour(guildId, minutes) {
  const until = Math.floor(Date.now() / 1000) + minutes * 60;
  stmt.setHappyHourUntil.run(until, guildId);
  return until;
}

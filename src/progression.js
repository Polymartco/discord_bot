// ── XP / level / rank progression (pure functions, no I/O) ────────────────────
// Total XP required to *reach* a level L is 50 * (L-1)^2, so the curve widens as
// you climb. levelFromXp is the inverse. Everything here is deterministic and
// dependency-free so it can be reused anywhere and unit-tested in isolation.

export function levelFromXp(xp) {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}

export function xpForLevel(level) {
  return 50 * (level - 1) ** 2;
}

/** Progress through the current level: { level, into, span, pct, next }. */
export function levelProgress(xp) {
  const level = levelFromXp(xp);
  const base  = xpForLevel(level);
  const next  = xpForLevel(level + 1);
  const span  = next - base;
  const into  = xp - base;
  return { level, into, span, next, pct: span > 0 ? into / span : 0 };
}

/** XP awarded for a trade of the given total dollar value (flat base + size bonus). */
export function xpForTrade(total = 0) {
  return Math.min(100, 20 + Math.floor(Math.abs(total) / 1000));
}

export const XP_DAILY = 30;

// ── Rank titles by level band ─────────────────────────────────────────────────
const RANKS = [
  { min: 1,  title: 'Intern',            emoji: '🧑‍💼' },
  { min: 5,  title: 'Junior Analyst',    emoji: '📊' },
  { min: 10, title: 'Analyst',           emoji: '📈' },
  { min: 18, title: 'Portfolio Manager', emoji: '💼' },
  { min: 28, title: 'Fund Manager',      emoji: '🏦' },
  { min: 40, title: 'Whale',             emoji: '🐋' },
  { min: 60, title: 'Market Legend',     emoji: '👑' },
];

export function rankTitle(level) {
  let rank = RANKS[0];
  for (const tier of RANKS) if (level >= tier.min) rank = tier;
  return rank;
}

/** Text progress bar for embeds, e.g. ███░░░░░░░ */
export function progressBar(pct, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round((pct || 0) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

import { getFreshPrice, ApiError } from './api.js';

// ── Error type ────────────────────────────────────────────────────────────────
export class ValidationError extends Error {
  constructor(msg) { super(msg); this.name = 'ValidationError'; }
}

// ── Format helpers (local only — no circular dep on utils) ───────────────────
const fmt = n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Input validators ──────────────────────────────────────────────────────────

/**
 * Normalises and validates a ticker string.
 * Returns the normalised (uppercased, trimmed) ticker on success.
 * Throws ValidationError on failure.
 */
export function validateTickerFormat(raw) {
  if (!raw || typeof raw !== 'string') throw new ValidationError('Ticker must be a non-empty string.');
  const t = raw.trim().toUpperCase();
  if (t.length === 0)   throw new ValidationError('Ticker cannot be blank.');
  if (t.length > 12)    throw new ValidationError(`"${t}" is too long — tickers are at most 12 characters.`);
  if (!/^[A-Z0-9]+$/.test(t)) throw new ValidationError(`"${t}" contains invalid characters. Use letters and numbers only.`);
  return t;
}

/**
 * Validates a share/unit quantity.
 * - Must be a finite positive number
 * - Must not exceed MAX_SHARES (guards against obvious typos like 1e9)
 * - Precision capped at 8 decimal places
 */
export function validateShareAmount(shares, { min = 0.00000001, max = 10_000_000 } = {}) {
  if (!Number.isFinite(shares))  throw new ValidationError('Share amount must be a number.');
  if (shares < min)              throw new ValidationError(`Share amount must be at least ${min}.`);
  if (shares > max)              throw new ValidationError(`Share amount cannot exceed ${max.toLocaleString()} — did you mean a smaller number?`);
  // Reject numbers with more than 8 significant decimal places (likely a formatting error)
  const rounded = parseFloat(shares.toFixed(8));
  if (Math.abs(rounded - shares) > 1e-12) {
    throw new ValidationError('Share amount has too many decimal places (max 8).');
  }
}

/**
 * Parses a shares string that may be "all" or a numeric string.
 * Returns the numeric value.
 */
export function parseSharesOrAll(raw, holdingShares) {
  if (typeof raw === 'string' && raw.trim().toLowerCase() === 'all') {
    if (!holdingShares || holdingShares <= 0) throw new ValidationError('You have no shares to sell.');
    return holdingShares;
  }
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`"${raw}" is not a valid share amount. Enter a positive number or "all".`);
  return n;
}

// ── Business-logic validators ─────────────────────────────────────────────────

/** Throws ValidationError if the guild has not been configured. */
export function assertGuildSetup(config) {
  if (!config?.setup_by) {
    throw new ValidationError('This server has not been set up yet. An admin must run `/setup` first.');
  }
}

/** Throws ValidationError if balance is insufficient for the given total cost. */
export function assertSufficientBalance(balance, totalCost) {
  if (balance < totalCost) {
    const shortfall = totalCost - balance;
    throw new ValidationError(
      `Insufficient balance. Order costs ${fmt(totalCost)} but you only have ${fmt(balance)} ` +
      `(short by ${fmt(shortfall)}).`
    );
  }
}

/** Throws ValidationError if the holding is missing or shares are insufficient. */
export function assertSufficientHolding(holding, ticker, requestedShares) {
  if (!holding || holding.shares <= 0) {
    throw new ValidationError(`You don't hold any **${ticker}**. Check \`/portfolio\` for your positions.`);
  }
  if (requestedShares > holding.shares + 1e-9) {
    throw new ValidationError(
      `You only hold ${holding.shares.toLocaleString()} shares of **${ticker}**, ` +
      `but you tried to sell ${requestedShares.toLocaleString()}.`
    );
  }
}

/** Throws ValidationError if price is not a valid positive finite number. */
export function assertValidPrice(price, ticker) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new ValidationError(`Invalid price data returned for ${ticker}. The market may be temporarily unavailable.`);
  }
}

// ── Live asset existence check ────────────────────────────────────────────────

/**
 * Hits the API to confirm the asset actually exists.
 * Returns the fresh price on success.
 * Throws ValidationError (not ApiError) so callers can show user-friendly messages.
 */
export async function assertAssetExists(ticker, assetType) {
  try {
    return await getFreshPrice(ticker, assetType);
  } catch (err) {
    if (err instanceof ApiError) {
      throw new ValidationError(`"${ticker}" was not found as a **${assetType}**. Check the ticker and try again.`);
    }
    throw err;
  }
}

// ── Slippage detection ────────────────────────────────────────────────────────

/**
 * Compares a fresh price against a previously-cached price.
 * Returns a warning string if the price moved by more than thresholdPct%, else null.
 */
export function slippageWarning(freshPrice, cachedPrice, thresholdPct = 0.5) {
  if (!cachedPrice || !freshPrice || cachedPrice === freshPrice) return null;
  const pct = Math.abs((freshPrice - cachedPrice) / cachedPrice) * 100;
  if (pct < thresholdPct) return null;
  const dir = freshPrice > cachedPrice ? '▲' : '▼';
  return `⚠️ Price moved ${dir}${pct.toFixed(2)}% since last fetch`;
}

// ── Concentration warning ─────────────────────────────────────────────────────

/**
 * Returns a warning string if a single position would exceed concentrationPct of total portfolio.
 * totalPortfolioValue should include the new position cost.
 */
export function concentrationWarning(positionCost, totalPortfolioValue, concentrationPct = 50) {
  if (totalPortfolioValue <= 0) return null;
  const pct = (positionCost / totalPortfolioValue) * 100;
  if (pct < concentrationPct) return null;
  return `⚠️ This position is ${pct.toFixed(0)}% of your portfolio`;
}

// ── Per-user command rate limiting ───────────────────────────────────────────
// Prevents users from spamming trade commands and burning API budget / DB writes.
const cooldowns = new Map(); // `userId:commandKey` → lastUsedMs

// Prune stale entries every 5 minutes so the map doesn't grow forever.
setInterval(() => {
  const cutoff = Date.now() - 300_000;
  for (const [key, ts] of cooldowns) {
    if (ts < cutoff) cooldowns.delete(key);
  }
}, 300_000).unref();

/**
 * Throws ValidationError if the user has used this command key within cooldownMs.
 * Call with the same key for commands that share a cooldown (e.g. buy + sell → 'trade').
 */
export function assertCommandCooldown(userId, commandKey, cooldownMs) {
  const key     = `${userId}:${commandKey}`;
  const lastUsed = cooldowns.get(key) ?? 0;
  const elapsed  = Date.now() - lastUsed;
  if (elapsed < cooldownMs) {
    const remaining = ((cooldownMs - elapsed) / 1000).toFixed(1);
    throw new ValidationError(`Slow down! You can use this again in **${remaining}s**.`);
  }
  cooldowns.set(key, Date.now());
}

// ── Shared error reply helper ─────────────────────────────────────────────────

/**
 * Handles a ValidationError or ApiError by replying (or editing reply) with an error embed.
 * Returns true if the error was handled; false (re-throws) for unexpected errors.
 */
export function handleKnownError(err, interaction, editReply = true) {
  if (err instanceof ValidationError || err instanceof ApiError) {
    const embed = {
      color: 0xef4444,
      description: `❌ ${err.message}`,
    };
    const payload = { embeds: [embed] };
    if (editReply) interaction.editReply(payload).catch(() => {});
    else           interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
    return true;
  }
  return false;
}

import { EmbedBuilder } from 'discord.js';
import { stmt } from './db.js';
import { api, getFreshPrice } from './api.js';
import { adjust } from './casinoLib.js';
import { ValidationError } from './validate.js';
import { awardXp, progressField } from './postTrade.js';
import { xpForBet } from './progression.js';
import { progressQuests } from './quests.js';
import { cash, sign, GREEN, RED, GOLD, polish } from './utils.js';

// ── Market Prediction game ────────────────────────────────────────────────────
// A directional bet on a live asset that auto-settles after a short horizon.
// Entry price is authoritative (getFreshPrice); settlement runs on the alert
// poller's tick and is crash/restart-safe via an atomic settled 0→1 guard.

export const HORIZONS = { '5m': 300, '15m': 900, '1h': 3600 };
export const DEFAULT_HORIZON = '15m';
const WIN_MULT   = 1.95;  // 5% house edge — short-horizon direction is ~50/50, so this stops it being a break-even printer
const MAX_ACTIVE = 5;     // per-user pending cap (anti-spam)

/**
 * Escrow a stake and open a prediction. The caller must have already validated
 * the bet against the player's balance. Throws ValidationError / ApiError.
 * Escrow happens only AFTER a valid entry price is fetched (bad ticker → no debit).
 */
export async function createPrediction({ guildId, userId, channelId, ticker, assetType, direction, stake, horizon }) {
  const horizonSec = HORIZONS[horizon] ?? HORIZONS[DEFAULT_HORIZON];
  const active = stmt.countActivePredictions.get(guildId, userId)?.cnt ?? 0;
  if (active >= MAX_ACTIVE) throw new ValidationError(`You already have ${MAX_ACTIVE} predictions in play — wait for one to settle.`);

  const entry = await getFreshPrice(ticker, assetType); // throws ApiError on a bad ticker/price
  adjust(guildId, userId, -stake);                      // escrow only once the price is known-good
  const settleAt = Math.floor(Date.now() / 1000) + horizonSec;
  stmt.insertPrediction.run(guildId, userId, channelId ?? null, ticker, assetType, direction, stake, entry, settleAt);
  return { entry, settleAt, horizonSec };
}

/**
 * Settle every prediction whose horizon has elapsed. Called on the poller tick.
 * Uses the same batched, cache-backed price maps as the alert poller. Safe to
 * call concurrently / after a restart — the atomic settle guard pays each once.
 */
export async function settlePredictions(client) {
  const now = Math.floor(Date.now() / 1000);
  const due = stmt.getDuePredictions.all(now);
  if (!due.length) return;

  const sets = { stock: new Set(), crypto: new Set(), forex: new Set() };
  for (const p of due) sets[p.asset_type]?.add(p.ticker);

  const price = {}; // keyed `${assetType}:${ticker}` to avoid cross-market collisions
  const loaders = [['stock', api.stocks], ['crypto', api.cryptoCoins], ['forex', api.forexPairs]];
  await Promise.all(loaders.map(async ([type, fn]) => {
    if (!sets[type].size) return;
    try {
      const all = await fn();
      for (const t of sets[type]) { const pr = all?.[t]?.price; if (Number.isFinite(pr) && pr > 0) price[`${type}:${t}`] = pr; }
    } catch (err) { console.warn(`[predict] price fetch failed for ${type}:`, err?.message); }
  }));

  for (const p of due) {
    const cur = price[`${p.asset_type}:${p.ticker}`];
    if (cur == null) continue;                                   // no price this tick — leave it for the next
    if (stmt.settlePrediction.run(p.id).changes !== 1) continue; // already settled by another tick/instance

    let gross, outcome;
    if (cur === p.entry_price) { gross = p.stake; outcome = 'push'; }
    else {
      const wentUp = cur > p.entry_price;
      const won = (p.direction === 'up' && wentUp) || (p.direction === 'down' && !wentUp);
      gross = won ? Math.floor(p.stake * WIN_MULT) : 0;
      outcome = won ? 'win' : 'lose';
    }
    if (gross > 0) adjust(p.guild_id, p.user_id, gross);
    const net = gross - p.stake;

    let xp = {};
    try { xp = awardXp(p.guild_id, p.user_id, xpForBet(p.stake)); } catch (err) { console.warn('[predict] awardXp:', err?.message); }
    try { progressQuests({ guildId: p.guild_id, userId: p.user_id, game: 'predict', bet: p.stake, net, win: outcome === 'win' }); } catch (err) { console.warn('[predict] quests:', err?.message); }

    if (p.channel_id) pushResult(client, p, cur, outcome, net, xp); // fire-and-forget
  }
}

function pushResult(client, p, cur, outcome, net, xp) {
  const embed = buildResultEmbed(p, cur, outcome, net, xp);
  client.channels.fetch(p.channel_id)
    .then(ch => (ch?.isTextBased() ? ch.send({ content: `<@${p.user_id}>`, embeds: [embed] }) : null))
    .catch(err => console.warn(`[predict] push to ${p.channel_id} failed:`, err?.message));
}

function buildResultEmbed(p, cur, outcome, net, xp) {
  const movePct = p.entry_price > 0 ? ((cur - p.entry_price) / p.entry_price) * 100 : 0;
  const title = outcome === 'win' ? '🔮 Prediction Hit!' : outcome === 'lose' ? '🔮 Prediction Missed' : '🔮 Prediction — Push';
  const color = outcome === 'win' ? GREEN : outcome === 'lose' ? RED : GOLD;
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(`**${p.ticker}** ${p.direction === 'up' ? '📈 up' : '📉 down'} call — moved **${sign(movePct)}**`)
    .addFields(
      { name: 'Entry',   value: cash(p.entry_price), inline: true },
      { name: 'Settle',  value: cash(cur),           inline: true },
      { name: outcome === 'lose' ? 'Lost' : 'Result', value: outcome === 'lose' ? cash(p.stake) : `${net >= 0 ? '+' : ''}${cash(net)}`, inline: true },
    );
  const f = progressField({ ...(xp || {}) }, { showBar: true });
  if (f) embed.addFields(f);
  return polish(embed);
}

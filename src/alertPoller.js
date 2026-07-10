import { EmbedBuilder } from 'discord.js';
import { stmt } from './db.js';
import { api } from './api.js';
import { botApi } from './botApi.js';
import { colorOf, cash, polish } from './utils.js';
import { settlePredictions } from './predictions.js';
import { sweepExpiredChallenges } from './challengeEngine.js';

// ── Back-off state ────────────────────────────────────────────────────────────
const failState = { consecutiveErrors: 0, backoffUntil: 0 };

// ── Channel mute tracking for local alerts ────────────────────────────────────
const badChannels        = new Map(); // channelId → { failCount, muteUntil }
const CHANNEL_MUTE_AFTER = 3;
const CHANNEL_MUTE_MS    = 3_600_000; // 1 hour

export function startAlertPoller(client) {
  setInterval(() => {
    runAlertCheck(client).catch(err => console.error('[AlertPoller] Unhandled error:', err));
    settlePredictions(client).catch(err => console.error('[Predict] settle error:', err));
    sweepExpiredChallenges(client).catch(err => console.error('[Duel] sweep error:', err));
  }, 12_000);
}

async function runAlertCheck(client) {
  if (Date.now() < failState.backoffUntil) return;

  // ── 1. Fetch local alerts + server alerts in parallel ─────────────────────
  const localAlerts  = stmt.getAllAlerts.all();
  let   serverAlerts = [];

  if (process.env.BOT_API_KEY) {
    try {
      const data = await botApi('GET', '/discord/alerts/pending');
      serverAlerts = data.alerts ?? (Array.isArray(data) ? data : []);
    } catch (err) {
      // Non-fatal — local alerts still run
      console.warn('[AlertPoller] Could not fetch server alerts:', err.message);
    }
  }

  if (!localAlerts.length && !serverAlerts.length) return;

  // ── 2. Batch-fetch prices for all tickers across both sets ────────────────
  const combined = [
    ...localAlerts.map(a => ({ ticker: a.ticker,                       assetType: a.asset_type })),
    ...serverAlerts.map(a => ({ ticker: a.symbol ?? a.ticker ?? '',    assetType: a.assetType ?? a.asset_type ?? 'stock' })),
  ];

  const stockTickers  = [...new Set(combined.filter(a => a.assetType === 'stock') .map(a => a.ticker))];
  const cryptoTickers = [...new Set(combined.filter(a => a.assetType === 'crypto').map(a => a.ticker))];
  const forexPairs    = [...new Set(combined.filter(a => a.assetType === 'forex') .map(a => a.ticker))];

  const prices = {};

  if (stockTickers.length) {
    try {
      const all = await api.stocks();
      for (const t of stockTickers) if (all[t]?.price != null && Number.isFinite(all[t].price)) prices[t] = all[t].price;
      onApiSuccess();
    } catch (err) { onApiError('stocks', err); }
  }
  if (cryptoTickers.length) {
    try {
      const all = await api.cryptoCoins();
      for (const s of cryptoTickers) if (all[s]?.price != null && Number.isFinite(all[s].price)) prices[s] = all[s].price;
      onApiSuccess();
    } catch (err) { onApiError('crypto', err); }
  }
  if (forexPairs.length) {
    try {
      const all = await api.forexPairs();
      for (const p of forexPairs) if (all[p]?.price != null && Number.isFinite(all[p].price)) prices[p] = all[p].price;
      onApiSuccess();
    } catch (err) { onApiError('forex', err); }
  }

  // ── 3. Server alerts — fire as Discord DMs ────────────────────────────────
  for (const alert of serverAlerts) {
    const ticker = alert.symbol ?? alert.ticker ?? '';
    const price  = prices[ticker];
    if (price == null) continue;

    const triggered =
      alert.direction === 'above' ? price >= alert.threshold :
      alert.direction === 'below' ? price <= alert.threshold : false;

    if (!triggered) continue;

    // Mark triggered on the server (fire-and-forget)
    botApi('POST', `/discord/alerts/${alert.id}/trigger`).catch(err =>
      console.warn(`[AlertPoller] Could not mark server alert #${alert.id} as triggered:`, err.message)
    );

    const discordId = alert.discordId ?? alert.discord_id;
    if (!discordId) continue;

    try {
      const dmUser = await client.users.fetch(discordId);
      await dmUser.send({ embeds: [buildAlertEmbed(ticker, alert.direction, alert.threshold, price, alert.note)] });
    } catch (err) {
      console.warn(`[AlertPoller] Could not DM ${discordId} for server alert #${alert.id}:`, err.message);
    }
  }

  // ── 4. Local alerts — fire in guild channel ───────────────────────────────
  for (const alert of localAlerts) {
    const price = prices[alert.ticker];
    if (price == null) continue;

    const triggered =
      alert.direction === 'above' ? price >= alert.threshold :
      alert.direction === 'below' ? price <= alert.threshold : false;

    if (!triggered) continue;

    const ch = badChannels.get(alert.channel_id);
    if (ch && Date.now() < ch.muteUntil) {
      console.warn(`[AlertPoller] Skipping muted channel ${alert.channel_id} (alert #${alert.id})`);
      stmt.deleteAlertById.run(alert.id);
      continue;
    }

    try {
      const channel = await client.channels.fetch(alert.channel_id);
      if (!channel?.isTextBased()) throw new Error('Not a text channel');
      await channel.send({ content: `<@${alert.user_id}>`, embeds: [buildAlertEmbed(alert.ticker, alert.direction, alert.threshold, price)] });
      badChannels.delete(alert.channel_id);
    } catch (err) {
      console.error(`[AlertPoller] Failed to send local alert #${alert.id} to channel ${alert.channel_id}:`, err.message);
      trackBadChannel(alert.channel_id);
    }

    stmt.deleteAlertById.run(alert.id);
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function buildAlertEmbed(ticker, direction, threshold, currentPrice, note) {
  const fields = [
    { name: 'Asset',     value: ticker,                            inline: true },
    { name: 'Condition', value: `${direction} ${cash(threshold)}`, inline: true },
    { name: 'Now',       value: cash(currentPrice),                inline: true },
  ];
  if (note) fields.push({ name: 'Note', value: note, inline: false });

  return polish(new EmbedBuilder()
    .setTitle('🔔 Price Alert Triggered')
    .setColor(colorOf(direction === 'above' ? 1 : -1))
    .addFields(fields));
}

function onApiSuccess() { failState.consecutiveErrors = 0; }

function onApiError(endpoint, err) {
  failState.consecutiveErrors++;
  console.error(`[AlertPoller] API error on ${endpoint} (#${failState.consecutiveErrors}):`, err.message);
  if (failState.consecutiveErrors >= 3) {
    const backoffSec = Math.min(300, 30 * 2 ** (failState.consecutiveErrors - 3));
    failState.backoffUntil = Date.now() + backoffSec * 1000;
    console.warn(`[AlertPoller] Backing off for ${backoffSec}s after ${failState.consecutiveErrors} consecutive errors.`);
  }
}

function trackBadChannel(channelId) {
  const entry = badChannels.get(channelId) ?? { failCount: 0, muteUntil: 0 };
  entry.failCount++;
  if (entry.failCount >= CHANNEL_MUTE_AFTER) {
    entry.muteUntil = Date.now() + CHANNEL_MUTE_MS;
    console.warn(`[AlertPoller] Channel ${channelId} muted for 1h after ${entry.failCount} failures.`);
  }
  badChannels.set(channelId, entry);
}

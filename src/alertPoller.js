import { EmbedBuilder } from 'discord.js';
import { stmt } from './db.js';
import { api, ApiError } from './api.js';
import { colorOf, cash } from './utils.js';

// Track consecutive API failures to avoid spamming logs and burning rate budget
const failState = {
  consecutiveErrors: 0,
  lastErrorAt:       0,
  backoffUntil:      0,
};

// Track channels that have failed repeatedly — skip them without retrying every cycle
const badChannels = new Map(); // channelId → { failCount, muteUntil }
const CHANNEL_MUTE_AFTER   = 3;      // mute after this many consecutive fails
const CHANNEL_MUTE_MS      = 3_600_000; // 1 hour

export function startAlertPoller(client) {
  setInterval(() => runAlertCheck(client).catch(err => {
    console.error('[AlertPoller] Unhandled error in runAlertCheck:', err);
  }), 12_000);
}

async function runAlertCheck(client) {
  // Back off if recent API errors have been accumulating
  if (Date.now() < failState.backoffUntil) return;

  const alerts = stmt.getAllAlerts.all();
  if (!alerts.length) return;

  const stockSymbols  = [...new Set(alerts.filter(a => a.asset_type === 'stock').map(a => a.ticker))];
  const cryptoSymbols = [...new Set(alerts.filter(a => a.asset_type === 'crypto').map(a => a.ticker))];
  const forexPairs    = [...new Set(alerts.filter(a => a.asset_type === 'forex').map(a => a.ticker))];

  const prices = {};

  // Batch-fetch prices per asset class (one call covers all symbols of that type)
  if (stockSymbols.length) {
    try {
      const all = await api.stocks();
      for (const t of stockSymbols) {
        if (all[t]?.price != null && Number.isFinite(all[t].price)) {
          prices[t] = all[t].price;
        }
      }
      onApiSuccess();
    } catch (err) {
      onApiError('stocks', err);
    }
  }

  if (cryptoSymbols.length) {
    try {
      const all = await api.cryptoCoins();
      for (const s of cryptoSymbols) {
        if (all[s]?.price != null && Number.isFinite(all[s].price)) {
          prices[s] = all[s].price;
        }
      }
      onApiSuccess();
    } catch (err) {
      onApiError('cryptoCoins', err);
    }
  }

  if (forexPairs.length) {
    try {
      const all = await api.forexPairs();
      for (const p of forexPairs) {
        if (all[p]?.price != null && Number.isFinite(all[p].price)) {
          prices[p] = all[p].price;
        }
      }
      onApiSuccess();
    } catch (err) {
      onApiError('forexPairs', err);
    }
  }

  // Evaluate each alert
  for (const alert of alerts) {
    const price = prices[alert.ticker];
    if (price == null) continue;  // price fetch failed for this ticker — skip

    // Validate trigger condition
    const triggered =
      alert.direction === 'above' ? price >= alert.threshold :
      alert.direction === 'below' ? price <= alert.threshold : false;

    if (!triggered) continue;

    // Check if this channel is currently muted due to repeated send failures
    const ch = badChannels.get(alert.channel_id);
    if (ch && Date.now() < ch.muteUntil) {
      console.warn(`[AlertPoller] Skipping muted channel ${alert.channel_id} (alert #${alert.id})`);
      // Delete the alert anyway — it would have fired
      stmt.deleteAlertById.run(alert.id);
      continue;
    }

    // Attempt to deliver the alert
    try {
      const channel = await client.channels.fetch(alert.channel_id);
      if (!channel?.isTextBased()) throw new Error('Not a text channel');

      const embed = new EmbedBuilder()
        .setTitle('🔔 Price Alert Triggered')
        .setColor(colorOf(alert.direction === 'above' ? 1 : -1))
        .addFields(
          { name: 'Asset',     value: alert.ticker,                                   inline: true },
          { name: 'Condition', value: `${alert.direction} ${cash(alert.threshold)}`,  inline: true },
          { name: 'Now',       value: cash(price),                                    inline: true },
        )
        .setTimestamp();

      await channel.send({ content: `<@${alert.user_id}>`, embeds: [embed] });

      // Reset bad-channel state on success
      badChannels.delete(alert.channel_id);
    } catch (err) {
      console.error(`[AlertPoller] Failed to send alert #${alert.id} to channel ${alert.channel_id}:`, err.message);
      trackBadChannel(alert.channel_id);
    }

    // Always delete the alert after it fires (one-shot), regardless of delivery outcome.
    // We don't want alerts looping forever because a channel is broken.
    stmt.deleteAlertById.run(alert.id);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function onApiSuccess() {
  failState.consecutiveErrors = 0;
}

function onApiError(endpoint, err) {
  failState.consecutiveErrors++;
  failState.lastErrorAt = Date.now();
  console.error(`[AlertPoller] API error on ${endpoint} (error #${failState.consecutiveErrors}):`, err.message);

  // Exponential back-off: 30 s, 60 s, 120 s, 240 s, max 300 s
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

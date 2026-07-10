import { EmbedBuilder } from 'discord.js';
import { stmt } from './db.js';
import { GOLD, polish } from './utils.js';

// ── Coarse scheduled jobs ─────────────────────────────────────────────────────
// A slow tick (separate from the 12s price poller) for once-a-day-ish work.
// Currently: streak-expiry reminder DMs. Started from the `ready` handler.

const CHECK_MS = 15 * 60 * 1000; // 15 minutes

export function startScheduler(client) {
  setInterval(() => runReminders(client).catch(err => console.error('[Scheduler] reminders:', err)), CHECK_MS);
}

export async function runReminders(client) {
  const now   = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);
  const candidates = stmt.reminderCandidates.all();
  const sent = new Set(); // dedup by Discord id across guilds this run

  for (const u of candidates) {
    const elapsed = now - u.last_daily;
    // Streak continues if re-claimed within 48h; nudge in the last ~8h before it resets.
    if (elapsed < 40 * 3600 || elapsed >= 48 * 3600) continue;
    if (u.last_reminded === today) continue;

    // Mark reminded BEFORE sending so a crash/retry can't double-DM (anti-spam).
    stmt.setLastReminded.run(today, u.guild_id, u.user_id);
    if (sent.has(u.user_id)) continue; // one DM per person per run
    sent.add(u.user_id);

    try {
      const dm = await client.users.fetch(u.user_id);
      await dm.send({ embeds: [reminderEmbed(u.daily_streak)] });
    } catch {
      // User has DMs closed / left — nothing we can do; already marked so we won't retry today.
    }
  }
}

function reminderEmbed(streak) {
  return polish(new EmbedBuilder()
    .setTitle('🔥 Your streak is about to expire!')
    .setColor(GOLD)
    .setDescription(`Your **${streak}-day** daily streak resets soon. Run \`/daily\` to keep it alive!\n\n_Turn these off with \`/remindme\`._`));
}

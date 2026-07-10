import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { registerComponent, buildId } from './interactionRouter.js';
import { brandEmbed, compact, errorEmbed, GOLD, BLUE, GREEN } from './utils.js';
import { progressBar } from './progression.js';
import { questBoard, claimQuest, claimAll } from './quests.js';

// ── Quest claim handler ───────────────────────────────────────────────────────
// customId (via the 'quest' namespace):
//   quest:claimall:<ownerId>
//   quest:claim:<ownerId>:<scope>:<periodKey>:<code>
// Router has already verified ownership. All coin payouts route through the
// atomic, period-checked claim functions in quests.js.

function questLine(q) {
  const fmt    = n => (n >= 1000 ? compact(n).replace('$', '') : String(Math.floor(n)));
  const marker = q.claimed ? '✅' : q.claimable ? '🎁' : '▫️';
  const bar    = progressBar(q.goal ? q.progress / q.goal : 0);
  const status = q.claimed ? ' — _claimed_' : q.claimable ? ' — **ready!**' : '';
  return `${marker} ${q.emoji} **${q.name}** — ${q.desc}\n ${bar} ${fmt(q.progress)}/${fmt(q.goal)} · 💰 ${compact(q.reward)} · ✨ ${q.xp} XP${status}`;
}

function renderBoard(interaction, guildId, userId, banner) {
  const board = questBoard(guildId, userId);
  const claimable = [...board.daily, ...board.weekly].filter(q => q.claimable);
  const payout    = claimable.reduce((s, q) => s + q.reward, 0);

  const embed = brandEmbed({ title: '🎯 Your Quests', color: banner ? GREEN : claimable.length ? GOLD : BLUE, interaction })
    .setDescription(banner || (claimable.length
      ? `You have **${claimable.length}** quest${claimable.length === 1 ? '' : 's'} ready — claim **${compact(payout)}** below!`
      : 'All caught up here. New quests rotate in each period — keep playing!'))
    .addFields(
      { name: '📅 Daily  ·  resets at UTC midnight', value: board.daily.map(questLine).join('\n') || '_none_', inline: false },
      { name: '🗓️ Weekly  ·  resets Monday',        value: board.weekly.map(questLine).join('\n') || '_none_', inline: false },
    );

  const components = [];
  if (claimable.length) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('quest', 'claimall', userId))
        .setLabel(`🎁 Claim All · ${compact(payout)}`)
        .setStyle(ButtonStyle.Success),
    ));
  }
  return { embeds: [embed], components };
}

registerComponent('quest', async (interaction, { action, ownerId, args }) => {
  const { guildId, user } = interaction;

  if (action === 'claimall') {
    const r = await Promise.resolve(claimAll(guildId, user.id));
    const banner = r.claimed.length
      ? `🎉 Claimed **${r.claimed.length}** quest${r.claimed.length === 1 ? '' : 's'} — **+${compact(r.coins)}** and **+${r.xpTotal} XP**!` +
        (r.leveledUp ? `  🎊 Level up → L${r.newLevel}!` : '')
      : 'Those quests were already claimed.';
    return interaction.update(renderBoard(interaction, guildId, user.id, banner)).catch(() => {});
  }

  if (action === 'claim') {
    const [scope, periodKey, code] = args;
    const r = claimQuest(guildId, user.id, scope, periodKey, code);
    if (!r.ok) {
      return interaction.reply({ embeds: [errorEmbed(r.reason === 'expired' ? 'That quest period has rolled over.' : "That quest isn't ready to claim.")], ephemeral: true }).catch(() => {});
    }
    const banner = `🎉 Claimed **${r.quest.name}** — **+${compact(r.reward)}** and **+${r.quest.xp} XP**!` +
      (r.xp?.leveledUp ? `  🎊 Level up → L${r.xp.newLevel}!` : '');
    return interaction.update(renderBoard(interaction, guildId, user.id, banner)).catch(() => {});
  }

  return interaction.reply({ embeds: [errorEmbed('Unknown quest action.')], ephemeral: true }).catch(() => {});
});
